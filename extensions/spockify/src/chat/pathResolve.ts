/**
 * Pure path-hint helpers for workspace file resolution (no vscode import).
 */

/** Normalize slashes; strip quotes and leading `./` (keep absolute `/…`). */
export function normalizePathHint(raw: string): string {
  let s = String(raw || '')
    .trim()
    .replace(/^['"`]+|['"`]+$/g, '')
    .replace(/\\/g, '/');
  if (s.startsWith('./')) s = s.slice(2);
  return s;
}

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:\//.test(p);
}

/**
 * Score how well a URI path matches a hint (higher = better).
 * Prefers full relative-path suffix over basename-only.
 */
export function scorePathMatch(uriPath: string, hint: string): number {
  const p = String(uriPath || '').replace(/\\/g, '/');
  const h = normalizePathHint(hint).replace(/^\/+/, '');
  if (!p || !h) return 0;
  if (p === h || p.endsWith('/' + h)) return 1000 + h.length;
  const abs = normalizePathHint(hint);
  if (isAbsolutePath(abs) && (p === abs || p.endsWith(abs))) {
    return 900 + abs.length;
  }
  const base = h.split('/').pop() || h;
  if (p.endsWith('/' + base)) return 100 + base.length;
  return 0;
}
