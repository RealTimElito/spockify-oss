/**
 * User-facing error strings — never return blank (toasts must stay useful).
 */

export function formatCaughtError(
  err: unknown,
  fallback = 'unknown error (see Output → Spockify)',
): string {
  if (err instanceof Error) {
    const m = (err.message || '').trim();
    if (m) {
      return m;
    }
    const name = (err.name || '').trim();
    if (name && name !== 'Error') {
      return name;
    }
    const anyErr = err as Error & {
      stderr?: unknown;
      stdout?: unknown;
      code?: unknown;
    };
    const stderr = String(anyErr.stderr ?? '').trim();
    if (stderr) {
      return stderr.slice(0, 800);
    }
    const stdout = String(anyErr.stdout ?? '').trim();
    if (stdout) {
      return stdout.slice(0, 800);
    }
    if (anyErr.code !== undefined && anyErr.code !== null && `${anyErr.code}`) {
      return `${name || 'Error'} (code ${String(anyErr.code)})`;
    }
    // Empty Error.message — still surface something actionable from the stack.
    const stackLine = (err.stack || '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('Error'));
    if (stackLine) {
      return `${fallback} [${stackLine.slice(0, 200)}]`;
    }
  } else if (typeof err === 'string') {
    const s = err.trim();
    if (s) {
      return s;
    }
  } else if (err != null) {
    try {
      const s = JSON.stringify(err);
      if (s && s !== '{}' && s !== 'null') {
        return s.slice(0, 800);
      }
    } catch {
      /* ignore */
    }
    const s = String(err).trim();
    if (s && s !== '[object Object]') {
      return s;
    }
  }
  return fallback;
}
