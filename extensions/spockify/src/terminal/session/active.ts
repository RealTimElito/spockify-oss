/**
 * In-memory multi-session registry for concurrent Terminal Agent runs.
 */

import type { TerminalSessionSnapshot } from './store';

export type ActiveSessionStatus =
  | 'planning'
  | 'awaiting_plan'
  | 'running'
  | 'done'
  | 'cancelled'
  | 'error';

export interface ActiveTerminalSession {
  id: string;
  goal: string;
  cwd?: string;
  status: ActiveSessionStatus;
  startedAt: number;
  updatedAt: number;
  planSteps?: string[];
  abort?: AbortController;
  /** Extra allowlist patterns for this session only (policy UX). */
  sessionAllow: string[];
  lastError?: string;
}

const active = new Map<string, ActiveTerminalSession>();
const listeners = new Set<() => void>();

export function onActiveSessionsChanged(cb: () => void): { dispose: () => void } {
  listeners.add(cb);
  return {
    dispose: () => {
      listeners.delete(cb);
    },
  };
}

function notify(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

export function listActiveSessions(): ActiveTerminalSession[] {
  return [...active.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getActiveSession(id: string): ActiveTerminalSession | undefined {
  return active.get(id);
}

export function upsertActiveSession(
  partial: Omit<ActiveTerminalSession, 'updatedAt' | 'sessionAllow'> & {
    sessionAllow?: string[];
  },
): ActiveTerminalSession {
  const prev = active.get(partial.id);
  const next: ActiveTerminalSession = {
    sessionAllow: partial.sessionAllow ?? prev?.sessionAllow ?? [],
    ...prev,
    ...partial,
    updatedAt: Date.now(),
  };
  active.set(next.id, next);
  notify();
  return next;
}

export function patchActiveSession(
  id: string,
  patch: Partial<ActiveTerminalSession>,
): ActiveTerminalSession | undefined {
  const cur = active.get(id);
  if (!cur) return undefined;
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  active.set(id, next);
  notify();
  return next;
}

export function addSessionAllowPattern(id: string, pattern: string): void {
  const cur = active.get(id);
  if (!cur || !pattern.trim()) return;
  if (!cur.sessionAllow.includes(pattern)) {
    cur.sessionAllow.push(pattern);
    cur.updatedAt = Date.now();
    notify();
  }
}

export function removeActiveSession(id: string): void {
  if (active.delete(id)) notify();
}

export function clearFinishedSessions(): void {
  for (const [id, s] of active) {
    if (s.status === 'done' || s.status === 'cancelled' || s.status === 'error') {
      active.delete(id);
    }
  }
  notify();
}

/** Promote a finished snapshot into active list for UI (read-only). */
export function mirrorSnapshot(snap: TerminalSessionSnapshot): void {
  if (active.has(snap.id)) return;
  upsertActiveSession({
    id: snap.id,
    goal: snap.goal,
    cwd: snap.cwd,
    status: 'done',
    startedAt: snap.createdAt,
    planSteps: snap.planSteps,
    abort: undefined,
  });
}
