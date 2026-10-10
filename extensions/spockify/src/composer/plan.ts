/**
 * Composer plan helpers — extract a short plan from assistant text / nudge planning.
 */

const PLAN_HEADING = /^\s{0,3}#{1,3}\s*plan\b/im;
const NUMBERED = /^\s*\d+[.)]\s+\S+/m;

/** True when the user prompt looks multi-file / cross-cutting. */
export function looksMultiFile(instruction: string): boolean {
  const t = instruction.toLowerCase();
  if (/\b(across|throughout|multi[- ]?file|several files|all files)\b/.test(t)) {
    return true;
  }
  if (/\band\b/.test(t) && /\.(ts|tsx|js|jsx|py|go|rs|java|md)\b/.test(t)) {
    return true;
  }
  const pathHits = t.match(/[a-z0-9_./-]+\.(ts|tsx|js|jsx|py|go|rs|java|md)/g);
  return (pathHits?.length ?? 0) >= 2;
}

/** Soft check: assistant emitted a numbered or headed plan. */
export function hasPlanShape(text: string): boolean {
  if (!text.trim()) return false;
  if (PLAN_HEADING.test(text)) return true;
  const lines = text.split('\n').filter((l) => NUMBERED.test(l));
  return lines.length >= 2;
}

export function planningNudge(): string {
  return [
    'Before editing, briefly outline a numbered plan (files + steps).',
    'Then call apply_patch (or emit path-tagged fences) to implement.',
    'If a prior verify failed, fix those failures first.',
  ].join(' ');
}

/** Format verify failure for a recovery revise turn. */
export function formatVerifyFailureContext(
  command: string,
  result: {
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
    denied?: boolean;
  },
): string {
  const out = (result.stdout || '').slice(0, 4000);
  const err = (result.stderr || '').slice(0, 2000);
  return [
    'Previous Composer verify failed — fix these issues, then re-apply patches.',
    `Command: ${command}`,
    result.denied ? 'Denied by terminal policy.' : `Exit: ${result.exitCode ?? '?'}`,
    out ? `stdout:\n${out}` : '',
    err ? `stderr:\n${err}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
