/**
 * Unit tests for web-query → grep token extraction (codebase escalate helper).
 * Kept pure via a tiny exported helper mirror — exercises the same regex rules
 * as builtins.grepPatternsFromQuery without loading vscode.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/** Mirror of builtins.grepPatternsFromQuery for pure tests. */
function synonymGrepTokens(token: string): string[] {
  const out: string[] = [];
  if (/[A-Z]/.test(token) && !token.includes('_')) {
    const snake = token
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();
    if (snake !== token.toLowerCase()) out.push(snake);
  }
  if (token.includes('_')) {
    const camel = token
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel !== token) out.push(camel);
  }
  if (token.length >= 5 && /s$/i.test(token) && !/ss$/i.test(token)) {
    out.push(token.replace(/s$/i, ''));
  }
  if (token.length >= 6 && /ing$/i.test(token)) {
    out.push(token.replace(/ing$/i, ''));
  }
  if (token.includes('.')) {
    const last = token.split('.').pop();
    if (last && last.length >= 3) out.push(last);
  }
  return out;
}

function grepPatternsFromQuery(query: string): string[] {
  const raw = query.trim();
  if (!raw) return [];
  const tokens = raw
    .split(/[^a-zA-Z0-9_./:-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .filter(
      (t) =>
        !/^(the|and|for|with|from|this|that|what|how|where|when|into|file|code|search|about|please|find|show|does|work|using|used|like|just|some|any)$/i.test(
          t,
        ),
    );
  const uniq: string[] = [];
  for (const t of tokens) {
    if (!uniq.includes(t)) uniq.push(t);
    if (uniq.length >= 8) break;
  }
  uniq.sort((a, b) => {
    const score = (s: string) =>
      (/[A-Z]/.test(s) || /_/.test(s) || /\./.test(s) ? 2 : 0) +
      Math.min(s.length, 24) / 24;
    return score(b) - score(a);
  });
  const primary = uniq.slice(0, 5);
  const expanded: string[] = [...primary];
  for (const t of primary) {
    for (const alt of synonymGrepTokens(t)) {
      if (!expanded.includes(alt)) expanded.push(alt);
      if (expanded.length >= 8) break;
    }
    if (expanded.length >= 8) break;
  }
  return expanded.slice(0, 8);
}

describe('grepPatternsFromQuery (escalate)', () => {
  it('prefers identifiers over stopwords', () => {
    const pats = grepPatternsFromQuery(
      'how does the showTimestamp helper work in chat',
    );
    assert.ok(pats.includes('showTimestamp'));
    assert.ok(!pats.includes('the'));
    assert.ok(pats.length <= 8);
  });

  it('adds camelCase↔snake_case synonyms', () => {
    const pats = grepPatternsFromQuery('showTimestamp');
    assert.ok(pats.includes('showTimestamp'));
    assert.ok(pats.includes('show_timestamp'));
  });

  it('returns empty for blank', () => {
    assert.deepEqual(grepPatternsFromQuery('  '), []);
  });
});
