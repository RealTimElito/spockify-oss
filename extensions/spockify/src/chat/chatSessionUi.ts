/**
 * Per-thread composer UI + open-tab helpers (unit-testable).
 */

import type { AgentModeUi } from './composerModes';
import type { SelectionContextChip } from '../rules/editorAttach';

export type { SelectionContextChip };

export interface ChatContextChips {
  file?: boolean;
  terminal?: boolean;
  codebase?: boolean;
  /** Web Search (@web) — SearXNG prefetch like OWUI Integrations. */
  web?: boolean;
  /** @deprecated Selections use selectionChips; ignored if present. */
  selection?: boolean;
}

export interface ChatSessionUiState {
  draft?: string;
  /** Cursor-like composer mode (Agent / Plan / Debug / Multitask / Ask). */
  agentMode?: AgentModeUi;
  contextChips?: ChatContextChips;
  /** Ctrl+L selection pills (multi). */
  selectionChips?: SelectionContextChip[];
}

export const DEFAULT_CONTEXT_CHIPS: Required<
  Omit<ChatContextChips, 'selection'>
> = {
  file: true,
  terminal: true,
  codebase: false,
  web: false,
};

export function normalizeContextChips(
  chips?: ChatContextChips,
): Required<Omit<ChatContextChips, 'selection'>> {
  return {
    file: chips?.file ?? DEFAULT_CONTEXT_CHIPS.file,
    terminal: chips?.terminal ?? DEFAULT_CONTEXT_CHIPS.terminal,
    codebase: chips?.codebase ?? DEFAULT_CONTEXT_CHIPS.codebase,
    web: chips?.web ?? DEFAULT_CONTEXT_CHIPS.web,
  };
}

export function mergeSessionUi(
  prev: ChatSessionUiState | undefined,
  patch: ChatSessionUiState | undefined,
): ChatSessionUiState {
  if (!patch) return { ...(prev ?? {}) };
  return {
    draft: patch.draft !== undefined ? patch.draft : prev?.draft,
    agentMode: patch.agentMode ?? prev?.agentMode,
    contextChips: patch.contextChips
      ? { ...prev?.contextChips, ...patch.contextChips }
      : prev?.contextChips,
    selectionChips:
      patch.selectionChips !== undefined
        ? patch.selectionChips
        : prev?.selectionChips,
  };
}

/** Ensure active session appears in the tab strip; cap length. */
/** Next/previous tab in the open-tab strip (wraps). */
export function stepOpenTabId(
  openIds: string[],
  activeId: string,
  delta: 1 | -1,
): string | undefined {
  if (!openIds.length) {
    return undefined;
  }
  const order = openIds.includes(activeId)
    ? openIds
    : normalizeOpenTabIds(openIds, activeId);
  const idx = order.indexOf(activeId);
  if (idx < 0) {
    return order[0];
  }
  const next = (idx + delta + order.length) % order.length;
  return order[next];
}

export function normalizeOpenTabIds(
  openIds: string[] | undefined,
  activeId: string,
  maxTabs = 12,
): string[] {
  const ids = [...(openIds ?? [])].filter(Boolean);
  if (!ids.includes(activeId)) {
    ids.unshift(activeId);
  } else {
    const rest = ids.filter((id) => id !== activeId);
    ids.length = 0;
    ids.push(activeId, ...rest);
  }
  return ids.slice(0, maxTabs);
}

/** Human-friendly relative time for history rows (en-US). */
export function formatChatRelativeTime(
  updatedAtMs: number,
  nowMs = Date.now(),
): string {
  const delta = Math.max(0, nowMs - updatedAtMs);
  const sec = Math.floor(delta / 1000);
  if (sec < 45) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return min === 1 ? '1 min ago' : `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr === 1 ? '1 hour ago' : `${hr} hours ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return day === 1 ? 'Yesterday' : `${day} days ago`;
  const d = new Date(updatedAtMs);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date(nowMs).getFullYear() ? 'numeric' : undefined,
  });
}

export function tabTitleFromSummary(
  title: string | undefined,
  draft: string | undefined,
  fallback = 'New chat',
): string {
  const t = (title || '').trim();
  if (t && t !== 'Chat') return t.length > 28 ? `${t.slice(0, 26)}…` : t;
  const d = (draft || '').trim();
  if (d) {
    const line = d.split('\n')[0].trim();
    if (line) {
      return line.length > 28 ? `${line.slice(0, 26)}…` : line;
    }
  }
  return fallback;
}
