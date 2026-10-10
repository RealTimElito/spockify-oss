/**
 * Strip terminal chrome (OSC 633 shellIntegration, CSI) from captured PTY text.
 */

/** POSIX-safe single-quote for embedding a string in a shell command. */
export function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Remove VS Code shellIntegration OSC + common ANSI CSI so git stdout is parseable. */
export function stripTermSequences(text: string): string {
  if (!text) {
    return '';
  }
  return text
    .replace(/\x1b\]633;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
}

/** Last non-empty line after stripping terminal sequences (for rev-parse etc.). */
export function lastSignificantLine(text: string): string {
  const lines = stripTermSequences(text)
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length ? lines[lines.length - 1]! : '';
}
