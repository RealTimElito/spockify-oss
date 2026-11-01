/**
 * Persisted multi-chat sessions (Cursor-like history).
 * VS Code–agnostic core; wire via {@link ChatSessionStore} + MementoLike.
 */

import type { AgentMode } from './types';
import type { ChatSessionUiState } from '../chat/chatSessionUi';
import { mergeSessionUi, normalizeOpenTabIds } from '../chat/chatSessionUi';

/** Storage key for session list (workspace or global memento). */
export const CHAT_SESSIONS_STORAGE_KEY = 'spockify.chat.sessions';
/** Storage key for active chat thread id. */
export const CHAT_CURRENT_SESSION_STORAGE_KEY = 'spockify.chat.currentSessionId';
/** Open chat tab ids (active first). */
export const CHAT_OPEN_TABS_STORAGE_KEY = 'spockify.chat.openTabs';

export const CHAT_SESSION_STORE_VERSION = 1;
export const DEFAULT_MAX_CHAT_SESSIONS = 40;

/** Persisted content: string or OpenAI multimodal parts. */
export type StoredChatContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail?: string } }
    >;

export interface StoredChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: StoredChatContent;
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Model that produced this turn (assistant); kept for history attribution. */
  model?: string;
}

export interface PersistedChatSession {
  id: string;
  title: string;
  messages: StoredChatMessage[];
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
  mode: AgentMode;
  /** Model id used for the thread when known. */
  model?: string;
  /** Composer draft / chips when tab was last active. */
  ui?: ChatSessionUiState;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
  messageCount: number;
  mode: AgentMode;
  model?: string;
}

/** @deprecated Legacy rows before v1 fields; normalized on read. */
export interface LegacyChatSessionRow {
  id: string;
  title: string;
  messages: StoredChatMessage[];
  updatedAt: number;
  createdAt?: number;
  lastMessageAt?: number;
  mode?: AgentMode;
  model?: string;
  ui?: ChatSessionUiState;
}

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface SaveChatSessionInput {
  id: string;
  messages: StoredChatMessage[];
  mode: AgentMode;
  model?: string;
}

export function createChatSessionId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function textFromStoredContent(content: StoredChatContent | undefined): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter(
      (p): p is { type: 'text'; text: string } =>
        !!p && p.type === 'text' && typeof p.text === 'string',
    )
    .map((p) => p.text)
    .join('\n');
}

export function stripContextSuffixForTitle(
  content: string | StoredChatContent,
): string {
  const text = typeof content === 'string' ? content : textFromStoredContent(content);
  const idx = text.indexOf('\n\n---\n');
  return idx >= 0 ? text.slice(0, idx) : text;
}

/** Title from first user message; keeps existing title when already set. */
export function deriveChatTitle(
  messages: StoredChatMessage[],
  existingTitle?: string,
): string {
  const trimmedExisting = existingTitle?.trim();
  if (trimmedExisting && trimmedExisting !== 'Chat' && trimmedExisting !== 'New chat') {
    return trimmedExisting;
  }
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser?.content) {
    return trimmedExisting || 'Chat';
  }
  const raw = stripContextSuffixForTitle(firstUser.content).slice(0, 80);
  const title = raw.replace(/\s+/g, ' ').trim();
  return title || (contentHasStoredImage(firstUser.content) ? 'Image' : 'Chat');
}

function contentHasStoredImage(content: StoredChatContent): boolean {
  return (
    Array.isArray(content) &&
    content.some((p) => p?.type === 'image_url')
  );
}

export function normalizeChatSession(
  raw: LegacyChatSessionRow,
): PersistedChatSession {
  const updatedAt = raw.updatedAt ?? Date.now();
  const createdAt = raw.createdAt ?? updatedAt;
  const lastMessageAt =
    raw.lastMessageAt ??
    (raw.messages.length ? updatedAt : createdAt);
  const mode =
    raw.mode === 'ask' || raw.mode === 'agent' || raw.mode === 'strict'
      ? raw.mode
      : 'agent';
  return {
    id: raw.id,
    title: raw.title?.trim() || 'Chat',
    messages: Array.isArray(raw.messages) ? [...raw.messages] : [],
    createdAt,
    updatedAt,
    lastMessageAt,
    mode,
    model: raw.model,
    ui: raw.ui,
  };
}

export function normalizeChatSessionList(
  raw: LegacyChatSessionRow[] | undefined,
): PersistedChatSession[] {
  if (!raw?.length) return [];
  return raw.map(normalizeChatSession);
}

export function toChatSessionSummary(
  session: PersistedChatSession,
): ChatSessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    lastMessageAt: session.lastMessageAt,
    messageCount: session.messages.length,
    mode: session.mode,
    model: session.model,
  };
}

/** History for sidebar / clock UI — newest activity first. */
export function sortChatSessionsForHistory(
  sessions: PersistedChatSession[],
): PersistedChatSession[] {
  return [...sessions].sort((a, b) => {
    const byLast = b.lastMessageAt - a.lastMessageAt;
    if (byLast !== 0) return byLast;
    const byUpdated = b.updatedAt - a.updatedAt;
    if (byUpdated !== 0) return byUpdated;
    return b.createdAt - a.createdAt;
  });
}

export function listChatSessionSummaries(
  sessions: PersistedChatSession[],
): ChatSessionSummary[] {
  return sortChatSessionsForHistory(sessions).map(toChatSessionSummary);
}

export function upsertChatSession(
  sessions: PersistedChatSession[],
  next: PersistedChatSession,
): PersistedChatSession[] {
  const rest = sessions.filter((s) => s.id !== next.id);
  return sortChatSessionsForHistory([next, ...rest]);
}

export function buildPersistedChatSession(
  input: SaveChatSessionInput,
  previous?: PersistedChatSession,
): PersistedChatSession | undefined {
  if (!input.messages.length) {
    return undefined;
  }
  const now = Date.now();
  const createdAt = previous?.createdAt ?? now;
  const title = deriveChatTitle(input.messages, previous?.title);
  return {
    id: input.id,
    title,
    messages: [...input.messages],
    createdAt,
    updatedAt: now,
    lastMessageAt: now,
    mode: input.mode,
    model: input.model ?? previous?.model,
    ui: previous?.ui,
  };
}

export class ChatSessionStore {
  constructor(
    private readonly memento: MementoLike,
    private readonly maxSessions = DEFAULT_MAX_CHAT_SESSIONS,
  ) {}

  listHistory(): ChatSessionSummary[] {
    return listChatSessionSummaries(this.loadAll());
  }

  loadAll(): PersistedChatSession[] {
    const raw = this.memento.get<LegacyChatSessionRow[]>(
      CHAT_SESSIONS_STORAGE_KEY,
    );
    return normalizeChatSessionList(raw);
  }

  getById(id: string): PersistedChatSession | undefined {
    return this.loadAll().find((s) => s.id === id);
  }

  getCurrentSessionId(): string {
    return (
      this.memento.get<string>(CHAT_CURRENT_SESSION_STORAGE_KEY) ??
      createChatSessionId()
    );
  }

  setCurrentSessionId(id: string): void {
    void this.memento.update(CHAT_CURRENT_SESSION_STORAGE_KEY, id);
  }

  /** Active thread after reload; creates id if missing. */
  loadCurrent(): {
    id: string;
    messages: StoredChatMessage[];
    mode: AgentMode;
    model?: string;
    ui?: ChatSessionUiState;
  } {
    const id = this.getCurrentSessionId();
    const found = this.getById(id);
    if (found) {
      return {
        id: found.id,
        messages: [...found.messages],
        mode: found.mode,
        model: found.model,
        ui: found.ui,
      };
    }
    return { id, messages: [], mode: 'agent' };
  }

  getOpenTabIds(): string[] {
    return this.memento.get<string[]>(CHAT_OPEN_TABS_STORAGE_KEY) ?? [];
  }

  setOpenTabIds(ids: string[]): void {
    void this.memento.update(CHAT_OPEN_TABS_STORAGE_KEY, ids);
  }

  touchOpenTab(activeId: string, maxTabs = 12): string[] {
    const ids = normalizeOpenTabIds(this.getOpenTabIds(), activeId, maxTabs);
    this.setOpenTabIds(ids);
    return ids;
  }

  removeOpenTab(id: string): string[] {
    const ids = this.getOpenTabIds().filter((x) => x !== id);
    this.setOpenTabIds(ids);
    return ids;
  }

  /** Persist composer UI for a tab (creates shell row if needed). */
  saveSessionUi(
    id: string,
    ui: ChatSessionUiState,
    mode: AgentMode,
  ): void {
    const sessions = this.loadAll();
    const idx = sessions.findIndex((s) => s.id === id);
    const now = Date.now();
    if (idx >= 0) {
      const row = sessions[idx];
      sessions[idx] = {
        ...row,
        ui: mergeSessionUi(row.ui, ui),
        mode,
        updatedAt: now,
      };
    } else {
      sessions.push({
        id,
        title: 'New chat',
        messages: [],
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        mode,
        ui: mergeSessionUi(undefined, ui),
      });
    }
    void this.memento.update(
      CHAT_SESSIONS_STORAGE_KEY,
      sessions.slice(0, this.maxSessions),
    );
  }

  listHistoryForPanel(): ChatSessionSummary[] {
    return listChatSessionSummaries(
      this.loadAll().filter((s) => s.messages.length > 0),
    );
  }

  createNewChat(): string {
    const id = createChatSessionId();
    this.setCurrentSessionId(id);
    this.touchOpenTab(id);
    return id;
  }

  switchTo(id: string): PersistedChatSession {
    let found = this.getById(id);
    const now = Date.now();
    if (!found) {
      found = {
        id,
        title: 'New chat',
        messages: [],
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
        mode: 'agent',
      };
    }
    this.setCurrentSessionId(id);
    this.touchOpenTab(id);
    return found;
  }

  saveThread(input: SaveChatSessionInput): PersistedChatSession | undefined {
    if (!input.messages.length) {
      return undefined;
    }
    const sessions = this.loadAll();
    const previous = sessions.find((s) => s.id === input.id);
    const record = buildPersistedChatSession(input, previous);
    if (!record) return undefined;
    const next = upsertChatSession(sessions, record).slice(0, this.maxSessions);
    void this.memento.update(CHAT_SESSIONS_STORAGE_KEY, next);
    this.setCurrentSessionId(input.id);
    return record;
  }

  deleteSession(id: string): boolean {
    const sessions = this.loadAll();
    const next = sessions.filter((s) => s.id !== id);
    if (next.length === sessions.length) return false;
    void this.memento.update(CHAT_SESSIONS_STORAGE_KEY, next);
    if (this.getCurrentSessionId() === id) {
      const fallback = next[0]?.id ?? createChatSessionId();
      this.setCurrentSessionId(fallback);
    }
    return true;
  }

  renameSession(id: string, title: string): boolean {
    const trimmed = title.trim();
    if (!trimmed) return false;
    const sessions = this.loadAll();
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx < 0) return false;
    const updated: PersistedChatSession = {
      ...sessions[idx],
      title: trimmed,
      updatedAt: Date.now(),
    };
    const next = [...sessions];
    next[idx] = updated;
    void this.memento.update(CHAT_SESSIONS_STORAGE_KEY, next);
    return true;
  }
}
