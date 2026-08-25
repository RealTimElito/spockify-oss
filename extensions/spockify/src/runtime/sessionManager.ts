/**
 * Session manager — track active AgentRuntime runs for cancel/pause/resume.
 */

import type {
  AgentMessage,
  AgentMode,
  AgentSessionSnapshot,
  SessionStatus,
} from './types';

export interface ManagedSession {
  id: string;
  mode: AgentMode;
  status: SessionStatus;
  abort: AbortController;
  surface: 'chat' | 'composer' | 'terminal' | 'other';
  startedAt: number;
  /** Messages accumulated for rewind / resume after pause. */
  messages: AgentMessage[];
  /** Deterministic route key for chat tabs (persisted session id). */
  chatTabId?: string;
  /** Short live label for status bar (e.g. "Editing foo.ts", "Thinking"). */
  activityLabel?: string;
  /** Cursor-like Plan gate — mutators blocked until true. */
  planApproved?: boolean;
  /** Composer UI mode for this session turn. */
  composerUiMode?: string;
}

interface SessionInternal extends ManagedSession {
  pauseWaiters: Array<() => void>;
  /** Soft-aborts in-flight HTTP stream without cancelling the session. */
  streamAbort: AbortController;
}

/** Combine cancel + pause-stream signals into one AbortSignal. */
export function combineAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal {
  const ctrl = new AbortController();
  const onAbort = (): void => {
    if (!ctrl.signal.aborted) ctrl.abort();
  };
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      onAbort();
      return ctrl.signal;
    }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return ctrl.signal;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionInternal>();
  /** chat tab id → agent session id (chat surface only). */
  private readonly chatTabToSession = new Map<string, string>();
  private activeId: string | undefined;
  private readonly _onDidChange = new Set<() => void>();

  onDidChange(listener: () => void): { dispose(): void } {
    this._onDidChange.add(listener);
    return {
      dispose: () => {
        this._onDidChange.delete(listener);
      },
    };
  }

  private fireChange(): void {
    for (const l of this._onDidChange) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  }

  create(
    mode: AgentMode,
    surface: ManagedSession['surface'] = 'other',
    chatTabId?: string,
  ): ManagedSession {
    const id = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const session: SessionInternal = {
      id,
      mode,
      status: 'idle',
      abort: new AbortController(),
      surface,
      startedAt: Date.now(),
      messages: [],
      pauseWaiters: [],
      streamAbort: new AbortController(),
      chatTabId,
    };
    this.sessions.set(id, session);
    if (chatTabId) {
      this.chatTabToSession.set(chatTabId, id);
    }
    this.activeId = id;
    this.fireChange();
    return session;
  }

  getByChatTabId(chatTabId: string): ManagedSession | undefined {
    const id = this.chatTabToSession.get(chatTabId);
    return id ? this.sessions.get(id) : undefined;
  }

  resolveSessionId(chatTabId: string): string | undefined {
    return this.chatTabToSession.get(chatTabId);
  }

  cancelByChatTabId(chatTabId: string): boolean {
    const id = this.chatTabToSession.get(chatTabId);
    if (!id) return false;
    return this.cancel(id);
  }

  pauseByChatTabId(chatTabId: string): boolean {
    const id = this.chatTabToSession.get(chatTabId);
    if (!id) return false;
    return this.pause(id);
  }

  resumeByChatTabId(chatTabId: string): boolean {
    const id = this.chatTabToSession.get(chatTabId);
    if (!id) return false;
    return this.resume(id);
  }

  get(id: string): ManagedSession | undefined {
    return this.sessions.get(id);
  }

  getActive(): ManagedSession | undefined {
    return this.activeId ? this.sessions.get(this.activeId) : undefined;
  }

  setStatus(id: string, status: SessionStatus): void {
    const s = this.sessions.get(id);
    if (s) {
      s.status = status;
      if (
        status === 'done' ||
        status === 'cancelled' ||
        status === 'error'
      ) {
        s.activityLabel = undefined;
        if (s.chatTabId) {
          const mapped = this.chatTabToSession.get(s.chatTabId);
          if (mapped === id) {
            this.chatTabToSession.delete(s.chatTabId);
          }
        }
      }
      this.fireChange();
    }
  }

  /** Update the live status-bar activity chip (Thinking / Editing path / …). */
  setActivityLabel(id: string, label: string | undefined): void {
    const s = this.sessions.get(id);
    if (!s) return;
    const next = label?.trim() || undefined;
    if (s.activityLabel === next) return;
    s.activityLabel = next;
    this.fireChange();
  }

  setComposerUiMode(id: string, mode: string | undefined): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.composerUiMode = mode;
    if (mode === 'plan') {
      // Fresh Plan turns start gated; Agent / switch clears gate via approvePlan.
      s.planApproved = false;
    } else if (mode && mode !== 'plan') {
      s.planApproved = true;
    }
    this.fireChange();
  }

  approvePlan(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.planApproved = true;
    this.fireChange();
  }

  isPlanApproved(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return true;
    if (s.composerUiMode !== 'plan') return true;
    return s.planApproved === true;
  }

  setMessages(id: string, messages: AgentMessage[]): void {
    const s = this.sessions.get(id);
    if (s) s.messages = [...messages];
  }

  /** Signal used for the current HTTP stream (cancel ∪ soft-pause). */
  streamSignal(id: string, cancel?: AbortSignal): AbortSignal {
    const target = this.sessions.get(id);
    if (!target) {
      return cancel ?? new AbortController().signal;
    }
    return combineAbortSignals(cancel, target.streamAbort.signal);
  }

  /**
   * Pause active (or given) session. Soft-aborts the in-flight HTTP stream
   * so generation stops ASAP; the agent loop waits then continues on resume.
   */
  pause(id?: string): boolean {
    const target = this.resolve(id);
    if (!target) return false;
    if (target.status !== 'running' && target.status !== 'idle') return false;
    target.status = 'paused';
    if (!target.streamAbort.signal.aborted) {
      target.streamAbort.abort();
    }
    this.fireChange();
    return true;
  }

  /** Resume a paused session; wakes waitIfPaused waiters and arms a new stream gate. */
  resume(id?: string): boolean {
    const target = this.resolve(id);
    if (!target || target.status !== 'paused') return false;
    target.status = 'running';
    target.streamAbort = new AbortController();
    const waiters = target.pauseWaiters.splice(0, target.pauseWaiters.length);
    for (const w of waiters) w();
    this.fireChange();
    return true;
  }

  /**
   * Block until the session is no longer paused (or aborted).
   * Call at turn boundaries / after mid-stream soft-abort from AgentRuntime.
   */
  async waitIfPaused(id: string, signal?: AbortSignal): Promise<void> {
    const target = this.sessions.get(id);
    if (!target || target.status !== 'paused') return;

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const onAbort = (): void => {
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const onResume = (): void => {
        cleanup();
        resolve();
      };
      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort);
        const idx = target.pauseWaiters.indexOf(onResume);
        if (idx >= 0) target.pauseWaiters.splice(idx, 1);
      };
      target.pauseWaiters.push(onResume);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (target.status !== 'paused') {
        cleanup();
        resolve();
      }
    });
  }

  cancel(id?: string): boolean {
    const target = this.resolve(id);
    if (!target) return false;
    target.status = 'cancelled';
    target.abort.abort();
    if (!target.streamAbort.signal.aborted) {
      target.streamAbort.abort();
    }
    if (target.chatTabId) {
      this.chatTabToSession.delete(target.chatTabId);
    }
    const waiters = target.pauseWaiters.splice(0, target.pauseWaiters.length);
    for (const w of waiters) w();
    this.fireChange();
    return true;
  }

  cancelActive(): boolean {
    return this.cancel(this.activeId);
  }

  pauseActive(): boolean {
    return this.pause(this.activeId);
  }

  resumeActive(): boolean {
    return this.resume(this.activeId);
  }

  snapshot(id: string): AgentSessionSnapshot | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    return {
      id: s.id,
      mode: s.mode,
      status: s.status,
      messages: [...s.messages],
    };
  }

  list(): AgentSessionSnapshot[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      mode: s.mode,
      status: s.status,
      messages: [...s.messages],
    }));
  }

  dispose(): void {
    for (const s of this.sessions.values()) {
      s.abort.abort();
      s.streamAbort.abort();
      s.pauseWaiters.splice(0, s.pauseWaiters.length);
    }
    this.sessions.clear();
    this.chatTabToSession.clear();
    this.activeId = undefined;
    this._onDidChange.clear();
  }

  private resolve(id?: string): SessionInternal | undefined {
    if (id) return this.sessions.get(id);
    return this.activeId ? this.sessions.get(this.activeId) : undefined;
  }
}

let sharedManager: SessionManager | undefined;

export function getSessionManager(): SessionManager {
  if (!sharedManager) {
    sharedManager = new SessionManager();
  }
  return sharedManager;
}
