/** One continue inject when build/agent ends on prose with no tools. */

export const DOER_CONTINUE_INJECT =
  'The user goal is still open. Continue with tools now, or emit a structured done or blocked line (done | blocked:policy). Do not write another tutorial.';

/** Last-line `done` / `blocked:…` or a JSON status blob. */
export function isStructuredDoneOrBlocked(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      const s = String(j.status || j.state || '').toLowerCase();
      if (s === 'done' || s === 'blocked') return true;
      if (j.done === true || j.blocked === true) return true;
    }
  } catch {
    /* not a JSON blob */
  }
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  return /^(done|blocked)(\s*[|:].*)?$/i.test(last);
}
