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

/** Whole message is only `done` or `blocked:…`, with no answer prose. */
export function isOnlyDispositionLine(text: string): boolean {
  return /^(done|blocked)(\s*[|:].*)?$/i.test((text || '').trim());
}

/**
 * A greeting or thanks, not a request to change or inspect the workspace.
 * The coding continue-nudge must not run on these.
 */
export function isSocialTurn(text: string): boolean {
  const head = String(text || '')
    .split(/\n---\n/)[0]
    .replace(/\s+/g, ' ')
    .trim();
  if (!head || head.length > 180) return false;
  if (
    /\b(fix|bug|error|implement|refactor|add|create|write|edit|delete|remove|run|test|build|deploy|commit|grep|search|find|where|file|function|class|code|repo|diff|patch|install|update|change|list|open|read)\b/i.test(
      head,
    )
  ) {
    return false;
  }
  if (
    /^(?:hey|hi|hello|yo|howdy|hiya|sup)(?:\s+there)?[.!?\s]*$/i.test(head)
  ) {
    return true;
  }
  if (
    /^(?:good\s+(?:morning|afternoon|evening)|thanks|thank you|thx|ok|okay|cool|nice)[.!?\s]*$/i.test(
      head,
    )
  ) {
    return true;
  }
  if (
    /^(?:how are (?:you|ya|u)|how're you|how's it going|what's up|whats up|how do you do)[.!?\s]*$/i.test(
      head,
    )
  ) {
    return true;
  }
  return /^(?:hey|hi|hello)\b.{0,48}?\bhow are (?:you|ya|u)\b[.!?\s]*$/i.test(
    head,
  );
}

export function isStructuredBlocked(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;
  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      const s = String(j.status || j.state || '').toLowerCase();
      if (s === 'blocked' || j.blocked === true) return true;
    }
  } catch {
    /* not JSON */
  }
  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || '';
  return /^blocked(\s*[|:].*)?$/i.test(last);
}
