/**
 * Cursor-like composer UI modes ↔ Spockify runtime agent modes.
 *
 * Mapping (UI → runtime tool policy):
 *   Agent     → agent   (full tools)
 *   Ask       → ask     (read-only)
 *   Plan      → agent   (+ plan-first system hint; enables planApproval)
 *   Debug     → agent   (+ investigate/fix system hint)
 *   Multitask → agent   (+ parallel-subtask hint; auto-spawn only on explicit multi-agent language)
 *
 * Legacy `strict` remains a runtime-only config value (status bar / settings);
 * the chat mode menu does not surface it (Cursor has no Strict).
 */

import type { AgentMode } from '../runtime/types';

export type ComposerUiMode =
  | 'agent'
  | 'plan'
  | 'debug'
  | 'multitask'
  | 'ask';

/** @deprecated Prefer ComposerUiMode; kept for protocol alias. */
export type AgentModeUi = ComposerUiMode | 'strict';

export const COMPOSER_UI_MODES: readonly ComposerUiMode[] = [
  'agent',
  'plan',
  'debug',
  'multitask',
  'ask',
] as const;

export interface ComposerModeMeta {
  id: ComposerUiMode;
  label: string;
  /** Short icon glyph for the mode pill / menu. */
  icon: string;
  title: string;
}

export const COMPOSER_MODE_META: readonly ComposerModeMeta[] = [
  {
    id: 'agent',
    label: 'Agent',
    icon: '∞',
    title: 'Full tools — edit, terminal, search',
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: '☰',
    title: 'Plan first, then act (agent tools)',
  },
  {
    id: 'debug',
    label: 'Debug',
    icon: '🪲',
    title: 'Investigate root cause systematically',
  },
  {
    id: 'multitask',
    label: 'Multitask',
    icon: '◎',
    title: 'Parallel subtasks — spawn agents only when asked',
  },
  {
    id: 'ask',
    label: 'Ask',
    icon: '💬',
    title: 'Read-only — no mutating tools',
  },
];

export function isComposerUiMode(value: unknown): value is ComposerUiMode {
  return (
    value === 'agent' ||
    value === 'plan' ||
    value === 'debug' ||
    value === 'multitask' ||
    value === 'ask'
  );
}

export function normalizeComposerUiMode(
  value: unknown,
  fallback: ComposerUiMode = 'agent',
): ComposerUiMode {
  if (isComposerUiMode(value)) return value;
  if (value === 'strict') return 'agent';
  return fallback;
}

/** Map chat UI mode → Phase 1 tool policy (`ask` / `agent` / `strict`). */
export function toRuntimeAgentMode(mode: AgentModeUi | AgentMode): AgentMode {
  if (mode === 'ask') return 'ask';
  if (mode === 'strict') return 'strict';
  return 'agent';
}

/** Extra system text for Plan / Debug / Multitask (empty for Agent / Ask). */
export function composerUiModeAddon(mode: ComposerUiMode | AgentModeUi): string {
  switch (mode) {
    case 'plan':
      return [
        'Composer UI mode: PLAN.',
        'Draft a clear numbered plan before mutating tools.',
        'You CAN use read_file / grep / codebase_search / web_search / fetch_url — prefer tools over guessing.',
        'Prefer read_file / grep / codebase_search first (escalate with more grep/glob if thin); then WAIT — mutating tools (write_file, apply_patch, terminal_run, spawn agents) are BLOCKED until the user approves (reply: implement / go / approve) or switches to Agent.',
        'When locating symbols, cite startLine:endLine:rel/path (or path:line) with a path on fences.',
        'For web/docs questions use web_search / fetch_url.',
      ].join(' ');
    case 'debug':
      return [
        'Composer UI mode: DEBUG.',
        'Investigate systematically: reproduce, isolate root cause, then fix with minimal diffs.',
        'You CAN gather evidence with read_file, grep, codebase_search, and terminal_run (for failing commands) before editing.',
        'If codebase_search is thin, broaden with more grep/glob and read_file — do not invent.',
        'Cite definitions as startLine:endLine:rel/path; never answer "not in the snippet" without searching.',
      ].join(' ');
    case 'multitask':
      return [
        'Composer UI mode: MULTITASK.',
        'Prefer the normal single-agent tool loop for ordinary questions and code explanation.',
        'You CAN call spockify_create_agent_run ONLY when the user explicitly asks for multiple/parallel agents.',
        'Never spawn Explorer/Analyst/Builder/Skeptic for simple Q&A.',
      ].join(' ');
    default:
      return '';
  }
}

export function metaForComposerMode(
  mode: ComposerUiMode,
): ComposerModeMeta {
  return (
    COMPOSER_MODE_META.find((m) => m.id === mode) ?? COMPOSER_MODE_META[0]
  );
}
