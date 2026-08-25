/**
 * Pure helpers for git CLI exit / error text (commit-message + remote fallback).
 */

/** Exit 1 from `git diff` means dirty — not a hard failure. */
export function isGitDiffDirtyExit(args: string[], code: number): boolean {
  return code === 1 && (args[0] === 'diff' || args[0] === 'diff-index');
}

/**
 * Build a non-empty failure string for a failed git invocation.
 * Never returns blank — whitespace-only stderr must not become `new Error("")`.
 */
export function formatGitCliFailure(
  args: string[],
  opts: {
    code?: number | string;
    stdout?: string;
    stderr?: string;
    message?: string;
  },
): string {
  const stderr = (opts.stderr || '').trim();
  const stdout = (opts.stdout || '').trim();
  const message = (opts.message || '').trim();
  const detail =
    stderr ||
    stdout ||
    message ||
    `git ${args[0] || 'command'} failed (exit ${opts.code ?? '?'})`;
  return detail.slice(0, 800);
}

/** True when captured output is a git fatal/error, not a usable diff. */
export function looksLikeGitFatalOutput(text: string): boolean {
  return /^\s*fatal:/m.test(text) || /^\s*error: /m.test(text);
}
