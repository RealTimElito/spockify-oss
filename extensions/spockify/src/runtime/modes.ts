/**
 * ask / agent / strict mode policy for the unified tool registry.
 *
 * Chat UI also exposes Cursor-like Plan / Debug / Multitask — those map to
 * `agent` for tool policy; see `src/chat/composerModes.ts`.
 */

import type {
  AgentMode,
  RegisteredTool,
  UnifiedToolDefinition,
} from './types';

export function loadAgentModeFromConfig(
  get: (key: string, defaultValue: AgentMode) => AgentMode,
): AgentMode {
  const mode = get('agent.mode', 'agent');
  if (mode === 'ask' || mode === 'agent' || mode === 'strict') {
    return mode;
  }
  return 'agent';
}

export function loadStrictAllowlist(
  get: (key: string, defaultValue: string[]) => string[],
): string[] {
  const list = get('agent.strictAllowlist', []);
  return Array.isArray(list) ? list.map(String) : [];
}

/** Whether a tool may run in the given mode. */
export function isToolAllowed(
  tool: UnifiedToolDefinition,
  mode: AgentMode,
  strictAllowlist: string[],
  opts?: {
    composerUiMode?: string;
    planApproved?: boolean;
  },
): { ok: boolean; reason?: string } {
  if (mode === 'ask' && tool.mutates) {
    return {
      ok: false,
      reason: `Tool "${tool.name}" is mutating; blocked in ask mode.`,
    };
  }
  // Cursor Plan: autoRun=false — block mutators until the plan is approved.
  if (
    opts?.composerUiMode === 'plan' &&
    tool.mutates &&
    opts.planApproved !== true
  ) {
    return {
      ok: false,
      reason:
        `Tool "${tool.name}" blocked in Plan mode until the plan is approved. ` +
        'Present the plan first; the user can reply "implement" / "go" / "approve" (or switch to Agent).',
    };
  }
  if (mode === 'strict') {
    if (!strictAllowlist.length) {
      return {
        ok: false,
        reason:
          'strict mode requires spockify.agent.strictAllowlist to include tool names.',
      };
    }
    if (!strictAllowlist.includes(tool.name)) {
      return {
        ok: false,
        reason: `Tool "${tool.name}" not on strict allowlist.`,
      };
    }
  }
  return { ok: true };
}

export function filterToolsForMode(
  tools: RegisteredTool[],
  mode: AgentMode,
  strictAllowlist: string[],
): RegisteredTool[] {
  return tools.filter((t) => isToolAllowed(t, mode, strictAllowlist).ok);
}

export function modeSystemAddon(mode: AgentMode): string {
  switch (mode) {
    case 'ask':
      return [
        'Agent mode: ASK (read-only).',
        'You CAN search and read the workspace: read_file, grep, list_dir, glob_file_search, codebase_search — prefer these over guessing.',
        'Be careful and thorough: read real files before answering "how does this work".',
        'For "where is X defined/declared/implemented": grep or codebase_search first, then cite as ' +
          'startLine:endLine:rel/path or path:line with a path on the fence — never a bare language fence, ' +
          'and never claim "not in the snippet" without searching the workspace.',
        'If @codebase / index hits are thin, empty, or ambiguous: run multiple grep/glob passes ' +
          '(broaden patterns, synonyms, related symbols), then read_file definitions and callers — do not invent.',
        'Never claim you cannot browse the repository when explore tools are available.',
        'You CAN use web_search and fetch_url for live web/docs (Spockify SearXNG / browser fetch).',
        'Cite workspace-relative paths only (never HTML like path">path).',
        'Do NOT use terminal_run. Do NOT call mutating tools.',
        'Answer math and general questions directly without tools.',
        'If the user needs edits or shell, tell them to switch to Agent mode.',
      ].join(' ');
    case 'strict':
      return [
        'Agent mode: STRICT.',
        'Only use tools on the allowlist. Prefer the minimum tool calls needed.',
        'You CAN explore with allowlisted read/search tools; prefer read_file / grep / codebase_search over terminal_run for code inspection.',
        'If search is uncertain, broaden with more grep/glob/read_file before answering — do not guess.',
      ].join(' ');
    case 'agent':
    default:
      return [
        'Agent mode: AGENT.',
        'You CAN: explore the workspace (read_file, grep, list_dir, glob_file_search, codebase_search), ' +
          'web_search / fetch_url, write_file / apply_patch, terminal_run for real shell, ' +
          'and spawn parallel agents via spockify_create_agent_run ONLY when the user explicitly asks for multiple/parallel agents.',
        'Be careful and thorough. For code questions: search and read before answering — do not invent; prefer local tools over guessing.',
        'For "where is X defined/declared/implemented": grep or codebase_search first, then cite as ' +
          'startLine:endLine:rel/path or path:line with a path on the fence — never a bare language fence, ' +
          'and never claim "not in the snippet" without searching the workspace.',
        'When @codebase / index hits are thin, empty, or ambiguous: escalate — multiple grep/glob passes ' +
          '(broader queries, synonyms), then read_file. Never claim you cannot browse the repo.',
        'For current web/docs info: web_search then fetch_url (same Spockify path as spockify.eu chat).',
        'Prefer explore tools over terminal_run. Never use shell for arithmetic or pure Q&A.',
        'terminal_run.command MUST be a real shell argv/one-liner or short script — never markdown, plans, or docs.',
        'terminal_run is real and runs on the workspace host (including Remote SSH) — use it only when a command must execute (tests, builds, git, installs).',
        'Always invoke tools via native tool_calls or ```tool JSON — never paste terminal_run bash "…" or markdown Apply fences as a substitute.',
        'For new scripts or edits: write_file or apply_patch, then terminal_run only if execution is needed.',
        'Cite workspace-relative paths cleanly (no HTML attribute residue).',
        'After tools finish, summarize in plain language — no duplicate tool invocations in text.',
      ].join(' ');
  }
}
