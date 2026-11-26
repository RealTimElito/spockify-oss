/**
 * Parse OSS-friendly ```tool fenced JSON tool calls from assistant text.
 * Also accepts light XML / invoke forms and hallucinated `terminal_run bash "…"` lines.
 */

import { looksLikeShellCommand } from '../terminal/isShellCommand';
import type { ToolCallRequest } from './types';

let nextId = 1;

function newToolCallId(): string {
  return `call_${Date.now().toString(36)}_${nextId++}`;
}

function coerceArgs(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === 'string' && v.trim()) {
    try {
      const parsed = JSON.parse(v) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { _raw: v };
    }
  }
  return {};
}

function pushParsed(out: ToolCallRequest[], body: string): void {
  const trimmed = body.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed) as {
      name?: string;
      tool?: string;
      function?: string | { name?: string; arguments?: unknown };
      arguments?: unknown;
      args?: unknown;
      id?: string;
    };
    let name = parsed.name;
    if (!name && typeof parsed.tool === 'string') name = parsed.tool;
    if (!name && typeof parsed.function === 'string') name = parsed.function;
    if (
      !name &&
      parsed.function &&
      typeof parsed.function === 'object' &&
      typeof parsed.function.name === 'string'
    ) {
      name = parsed.function.name;
    }
    if (!name || typeof name !== 'string') return;
    const args =
      parsed.arguments ??
      parsed.args ??
      (parsed.function && typeof parsed.function === 'object'
        ? parsed.function.arguments
        : undefined);
    out.push({
      id: parsed.id || newToolCallId(),
      name,
      arguments: coerceArgs(args),
    });
  } catch {
    // ignore malformed tool JSON
  }
}

function pushTerminalRun(out: ToolCallRequest[], command: string): void {
  const cmd = command.trim();
  if (!cmd) return;
  // Never promote markdown/prose into terminal_run.
  if (!looksLikeShellCommand(cmd)) return;
  const key = `terminal_run:${cmd}`;
  if (out.some((c) => `${c.name}:${c.arguments.command}` === key)) return;
  out.push({
    id: newToolCallId(),
    name: 'terminal_run',
    arguments: { command: cmd },
  });
}

/** Unwrap hallucinated CLI-like tool text → shell command. */
export function commandFromTerminalRunProse(text: string): string | undefined {
  const t = text.trim();
  if (!t) return undefined;

  const quoted =
    /^(?:terminal_run|run_terminal_cmd)\s+(?:bash|sh|zsh|shell)?\s*["'`]([\s\S]+?)["'`]\s*;?\s*$/i.exec(
      t,
    );
  if (quoted?.[1]) return quoted[1].trim();

  const paren =
    /^(?:terminal_run|run_terminal_cmd)\s*\(\s*["'`]([\s\S]+?)["'`]\s*\)\s*;?\s*$/i.exec(
      t,
    );
  if (paren?.[1]) return paren[1].trim();

  const bare =
    /^(?:terminal_run|run_terminal_cmd)\s+(?:bash|sh|zsh|shell)\s+(.+)$/is.exec(
      t,
    );
  if (bare?.[1]) {
    let cmd = bare[1].trim();
    if (
      (cmd.startsWith('"') && cmd.endsWith('"')) ||
      (cmd.startsWith("'") && cmd.endsWith("'")) ||
      (cmd.startsWith('`') && cmd.endsWith('`'))
    ) {
      cmd = cmd.slice(1, -1);
    }
    return cmd.trim() || undefined;
  }
  return undefined;
}

/**
 * Merge native SSE tool_calls with text-fence parses.
 * Prefer native when ids collide; append unique fence calls.
 */
export function mergeToolCalls(
  native: ToolCallRequest[],
  fenced: ToolCallRequest[],
): ToolCallRequest[] {
  if (!native.length) return fenced;
  if (!fenced.length) return native;
  const out = [...native];
  const seen = new Set(
    native.map((c) => `${c.name}:${stableArgsKey(c.arguments)}`),
  );
  for (const c of fenced) {
    const key = `${c.name}:${stableArgsKey(c.arguments)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function stableArgsKey(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args);
  } catch {
    return '';
  }
}

export interface ParseToolCallsOptions {
  /**
   * When true (agent/strict), promote lone ```bash / ```sh fences to terminal_run
   * if no other tool calls were found — common OSS hallucination instead of tools.
   */
  promoteShellFences?: boolean;
}

/**
 * Extract tool calls from assistant content.
 * Supported forms:
 *   ```tool / ```tool json
 *   <tool_call>…</tool_call>
 *   call TOOL_NAME with {…}
 *   terminal_run bash "…" / terminal_run("…")  (hallucinated CLI)
 *   optional: ```bash fences → terminal_run (promoteShellFences)
 */
export function parseToolCalls(
  text: string,
  opts?: ParseToolCallsOptions,
): ToolCallRequest[] {
  const out: ToolCallRequest[] = [];
  const fence = /```tool(?:\s+\w+)?\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    pushParsed(out, m[1]);
  }
  const xml = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  while ((m = xml.exec(text)) !== null) {
    pushParsed(out, m[1]);
  }
  const xmlNamed =
    /<tool_call\s+name=["']([^"']+)["']\s*>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  while ((m = xmlNamed.exec(text)) !== null) {
    const name = m[1];
    const body = m[2].trim();
    try {
      const args = body ? coerceArgs(JSON.parse(body)) : {};
      out.push({ id: newToolCallId(), name, arguments: args });
    } catch {
      out.push({ id: newToolCallId(), name, arguments: { _raw: body } });
    }
  }
  const invoke =
    /(?:^|\n)\s*(?:call|invoke)\s+([a-zA-Z0-9_]+)\s+with\s+(\{[\s\S]*?\})(?=\s*(?:\n|$))/gi;
  while ((m = invoke.exec(text)) !== null) {
    try {
      out.push({
        id: newToolCallId(),
        name: m[1],
        arguments: coerceArgs(JSON.parse(m[2])),
      });
    } catch {
      /* ignore */
    }
  }

  // Hallucinated CLI: terminal_run bash "kubectl …" (often inside ``` fences too).
  const proseLine =
    /(?:^|\n)\s*((?:terminal_run|run_terminal_cmd)\b[^\n]*)/gi;
  while ((m = proseLine.exec(text)) !== null) {
    const cmd = commandFromTerminalRunProse(m[1]);
    if (cmd) pushTerminalRun(out, cmd);
  }

  // Fenced body that is itself a wrapper line.
  const shellFence =
    /```(?:bash|sh|shell|zsh|console|terminal)?\s*\n([\s\S]*?)```/gi;
  const shellBodies: string[] = [];
  while ((m = shellFence.exec(text)) !== null) {
    const body = m[1].trim();
    if (!body) continue;
    shellBodies.push(body);
    const fromWrapper = commandFromTerminalRunProse(body);
    if (fromWrapper) {
      pushTerminalRun(out, fromWrapper);
      continue;
    }
    // Body may start with wrapper then the command on next lines.
    const first = body.split('\n')[0]?.trim() ?? '';
    if (/^(?:terminal_run|run_terminal_cmd)\b/i.test(first)) {
      const rest = body.split('\n').slice(1).join('\n').trim();
      const cmd = commandFromTerminalRunProse(first) || rest;
      if (cmd) pushTerminalRun(out, cmd);
    }
  }

  if (opts?.promoteShellFences && !out.length && shellBodies.length) {
    for (const body of shellBodies) {
      // Skip obvious non-commands (markdown-ish / too long essays).
      if (body.length > 4000) continue;
      if (/^(?:#\s*)?(?:example|note|warning)\b/i.test(body)) continue;
      if (!looksLikeShellCommand(body)) continue;
      pushTerminalRun(out, body);
    }
  }

  return out;
}

/** Strip tool fences / hallucinated tool prose from assistant text for display. */
export function stripToolFences(
  text: string,
  opts?: { trim?: boolean },
): string {
  let s = text
    .replace(/```tool(?:\s+[\w.-]+)?\s*\n[\s\S]*?```/gi, '')
    .replace(/```apply\s*\n[\s\S]*?```/gi, '')
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, '')
    .replace(
      /(?:^|\n)\s*(?:call|invoke)\s+[a-zA-Z0-9_]+\s+with\s+\{[\s\S]*?\}(?=\s*(?:\n|$))/gi,
      '\n',
    )
    .replace(
      /(?:^|\n)\s*tool\s+[A-Za-z_][\w]*\s*\{[\s\S]*?\}(?=\s*(?:\n|$))/gi,
      '\n',
    )
    .replace(
      /(?:^|\n)\s*\{\s*"name"\s*:\s*"[A-Za-z_][\w]*"\s*,\s*"arguments"\s*:\s*[\s\S]*?\}(?=\s*(?:\n|$))/gi,
      '\n',
    )
    .replace(
      /(?:^|\n)\s*\{\s*"function"\s*:\s*\{\s*"name"\s*:\s*"[A-Za-z_][\w]*"[\s\S]*?\}\s*\}(?=\s*(?:\n|$))/gi,
      '\n',
    )
    .replace(
      /(?:^|\n)\s*Action:\s*(?:\w+\s*)?[\s\S]*?(?=\n(?:Observation|Thought|Action):|\n*$)/gi,
      '\n',
    )
    // Hallucinated CLI tool lines (with or without surrounding fences).
    .replace(
      /```(?:bash|sh|shell|zsh|console|terminal)?\s*\n\s*(?:terminal_run|run_terminal_cmd)\b[\s\S]*?```/gi,
      '',
    )
    .replace(
      /(?:^|\n)\s*(?:terminal_run|run_terminal_cmd)\s+(?:bash|sh|zsh|shell)?\s*["'`][^"'`]*["'`]\s*;?\s*(?=\n|$)/gi,
      '\n',
    )
    .replace(
      /(?:^|\n)\s*(?:terminal_run|run_terminal_cmd)\s*\(\s*["'`][^"'`]*["'`]\s*\)\s*;?\s*(?=\n|$)/gi,
      '\n',
    )
    .replace(
      /(?:^|\n)\s*(?:terminal_run|run_terminal_cmd)\s+(?:bash|sh|zsh|shell)\s+[^\n]+/gi,
      '\n',
    )
    .replace(/\n{3,}/g, '\n\n');
  if (opts?.trim !== false) {
    s = s.trim();
  }
  return s;
}

/** Format tool catalog for the system prompt. */
export function formatToolsForPrompt(
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    mutates: boolean;
  }>,
): string {
  if (!tools.length) {
    return 'No tools are available in this mode.';
  }
  const lines = tools.map((t) => {
    const schema = JSON.stringify(t.parameters ?? {});
    return `- ${t.name}${t.mutates ? ' [mutates]' : ''}: ${t.description}\n  parameters: ${schema}`;
  });
  return [
    'You MUST use the real tools below — they execute in this IDE (files, search, shell, web, agents).',
    'You CAN: read/search the workspace, web_search/fetch_url, terminal_run (real shell only), ' +
      'and spawn parallel agents when the user explicitly asks — never claim these capabilities are missing when listed.',
    'Prefer native function / tool_calls from the API.',
    'Code Q&A: prefer read_file, grep, list_dir, glob_file_search, codebase_search over terminal_run; prefer tools over guessing.',
    'If index/codebase_search hits are thin, empty, or ambiguous: escalate with multiple grep/glob passes ' +
      '(broaden patterns, synonyms, related symbols), then read_file — do not guess and never claim you cannot browse the repo.',
    'Where-is-defined questions: grep/search the workspace first; cite startLine:endLine:rel/path or path:line ' +
      'and put the path on code fences — never a bare language fence or "not in the snippet" without searching.',
    'Web/docs: use web_search and fetch_url (Spockify SearXNG + browser fetch, same as spockify.eu).',
    'Do not use terminal_run for arithmetic, pure explanation, markdown plans, or documentation prose.',
    'terminal_run.command must be a real shell argv/one-liner or short script — never paste ### headings or essays.',
    'If the API does not support native tools, emit ONLY fenced JSON like:',
    '```tool',
    '{"name":"grep","arguments":{"pattern":"showTimestamp"}}',
    '```',
    'Alternatively: <tool_call>{"name":"read_file","arguments":{"path":"src/foo.ts"}}</tool_call>',
    'NEVER write fake CLI lines such as: terminal_run bash "…"',
    'NEVER put tool invocations in ```bash fences for the user to Apply — that does not run tools.',
    'NEVER claim you lack a bash/terminal tool when terminal_run is listed — but still prefer explore tools for code reading.',
    'Available tools:',
    ...lines,
  ].join('\n');
}
