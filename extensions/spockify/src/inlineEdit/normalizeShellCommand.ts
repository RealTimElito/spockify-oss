/**
 * Normalize model output for terminal Ctrl+K / shell Apply → sendText.
 * Ctrl+K is completion-only (no tools); models often emit fake terminal_run wrappers.
 */

import { parseToolCalls } from '../runtime/parseToolCalls';
import { stripEditFences } from './streamEdit';

const SHELL_LANG =
  /^(bash|sh|shell|zsh|fish|powershell|pwsh|console|terminal|cmd|bat)$/i;

/** Fence language / pathHint that should run in the integrated terminal. */
export function isShellFenceLanguage(hint?: string): boolean {
  if (!hint?.trim()) return false;
  const first = hint.trim().split(/\s+/)[0] || '';
  return SHELL_LANG.test(first);
}

/**
 * Extract a raw shell command from model text.
 * Strips markdown fences, ```tool terminal_run JSON, and `terminal_run bash "…"` wrappers.
 */
export function normalizeProposedShellCommand(raw: string): string {
  let t = String(raw ?? '').replace(/^\uFEFF/, '').trim();
  if (!t) return '';

  // Prefer real/fake tool JSON if present.
  const fromTool = commandFromToolPayload(t);
  if (fromTool) return fromTool;

  t = stripEditFences(t).trim();
  if (!t) return '';

  const fromBashFence = firstBashFenceBody(t);
  if (fromBashFence) {
    return unwrapTerminalRunWrapper(fromBashFence) || fromBashFence;
  }

  t = unwrapTerminalRunWrapper(t);
  t = t.replace(/^(?:RUN|Command|Shell)\s*:\s*/i, '').trim();
  return t;
}

function commandFromToolPayload(text: string): string | undefined {
  const calls = parseToolCalls(text);
  for (const c of calls) {
    if (c.name !== 'terminal_run' && c.name !== 'run_terminal_cmd') {
      continue;
    }
    const cmd = c.arguments.command ?? c.arguments.cmd ?? c.arguments.script;
    if (typeof cmd === 'string' && cmd.trim()) {
      return cmd.trim();
    }
  }
  // Loose JSON without fences (common leak).
  const loose =
    /\{\s*"name"\s*:\s*"(?:terminal_run|run_terminal_cmd)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/i.exec(
      text,
    );
  if (loose?.[1]) {
    try {
      const args = JSON.parse(loose[1]) as Record<string, unknown>;
      const cmd = args.command ?? args.cmd;
      if (typeof cmd === 'string' && cmd.trim()) return cmd.trim();
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function firstBashFenceBody(text: string): string | undefined {
  const re = /```(?:bash|sh|shell|zsh|fish|console|terminal)?\s*\n([\s\S]*?)```/i;
  const m = re.exec(text);
  const body = m?.[1]?.trim();
  return body || undefined;
}

/**
 * Unwrap hallucinated tool call lines:
 *   terminal_run bash "kubectl get pods"
 *   terminal_run("ls -la")
 *   terminal_run bash kubectl get pods
 */
export function unwrapTerminalRunWrapper(text: string): string {
  let t = text.trim();
  if (!t) return '';

  const quoted =
    /^(?:terminal_run|run_terminal_cmd)\s+(?:bash|sh|zsh|shell)?\s*["'`]([\s\S]*)["'`]\s*;?\s*$/i.exec(
      t,
    );
  if (quoted?.[1] != null) {
    return quoted[1].trim();
  }

  const paren =
    /^(?:terminal_run|run_terminal_cmd)\s*\(\s*["'`]([\s\S]*?)["'`]\s*\)\s*;?\s*$/i.exec(
      t,
    );
  if (paren?.[1] != null) {
    return paren[1].trim();
  }

  const bare =
    /^(?:terminal_run|run_terminal_cmd)\s+(?:bash|sh|zsh|shell)\s+(.+)$/is.exec(t);
  if (bare?.[1]) {
    let cmd = bare[1].trim();
    if (
      (cmd.startsWith('"') && cmd.endsWith('"')) ||
      (cmd.startsWith("'") && cmd.endsWith("'")) ||
      (cmd.startsWith('`') && cmd.endsWith('`'))
    ) {
      cmd = cmd.slice(1, -1);
    }
    return cmd.trim();
  }

  // Multi-line: first non-empty line is a wrapper, rest is the command.
  const lines = t.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (
    lines.length >= 2 &&
    /^(?:terminal_run|run_terminal_cmd)\b/i.test(lines[0]) &&
    !lines[0].includes('{')
  ) {
    return lines.slice(1).join('\n').trim();
  }

  return t;
}
