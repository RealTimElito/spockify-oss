/**
 * SEARCH/REPLACE hunk parser. JavaScript has no \\Z; do not use Python
 * end-of-string escapes in these regexes.
 */

export type SrHunk = { search: string; replace: string };

export type SrParseResult = {
  hunks: SrHunk[];
  error?: string;
};

const MARK_SEARCH = /^\s*SEARCH\s*$/i;
const MARK_REPLACE = /^\s*REPLACE\s*$/i;

/** Parse SEARCH/REPLACE hunks; malformed input returns a helpful error. */
export function parseSrHunks(body: string): SrParseResult {
  const text = (body || '').replace(/\r\n/g, '\n');
  if (!text.trim()) {
    return { hunks: [], error: 'no SEARCH/REPLACE hunks found' };
  }
  const lines = text.split('\n');
  const hunks: SrHunk[] = [];
  let i = 0;
  while (i < lines.length && lines[i]!.trim() === '') i += 1;
  if (i >= lines.length) {
    return { hunks: [], error: 'no SEARCH/REPLACE hunks found' };
  }
  if (!MARK_SEARCH.test(lines[i]!)) {
    return {
      hunks: [],
      error: `expected SEARCH marker, got: ${lines[i]!.slice(0, 80)}`,
    };
  }
  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === '') i += 1;
    if (i >= lines.length) break;
    if (!MARK_SEARCH.test(lines[i]!)) {
      return {
        hunks,
        error: `expected SEARCH marker, got: ${lines[i]!.slice(0, 80)}`,
      };
    }
    i += 1;
    const searchLines: string[] = [];
    while (i < lines.length && !MARK_REPLACE.test(lines[i]!)) {
      if (MARK_SEARCH.test(lines[i]!)) {
        return { hunks, error: 'SEARCH hunk missing REPLACE marker' };
      }
      searchLines.push(lines[i]!);
      i += 1;
    }
    if (i >= lines.length) {
      return { hunks, error: 'SEARCH hunk missing REPLACE marker' };
    }
    i += 1;
    const replaceLines: string[] = [];
    while (i < lines.length && !MARK_SEARCH.test(lines[i]!)) {
      replaceLines.push(lines[i]!);
      i += 1;
    }
    // A trailing empty line at EOF is the patch terminator, not replace text.
    if (i >= lines.length && replaceLines.length && replaceLines[replaceLines.length - 1] === '') {
      replaceLines.pop();
    }
    const search = searchLines.join('\n');
    const replace = replaceLines.join('\n');
    if (!search.length) {
      return { hunks, error: 'empty SEARCH block' };
    }
    hunks.push({ search, replace });
  }
  if (!hunks.length) {
    return { hunks: [], error: 'no SEARCH/REPLACE hunks found' };
  }
  return { hunks };
}

const AT_HUNK_HDR = /^@@\s*-\d+(?:,\d+)?\s*\+\d+(?:,\d+)?\s*@@/;

/**
 * True for a bare unified-diff hunk body (one or more `@@ -l,s +l,s @@`
 * sections with +/-/context lines) that carries no `*** Begin Patch` /
 * `Update File:` wrapper and no `diff --git` / `--- a/` file headers.
 *
 * Models trained on plain git-style hunks sometimes emit exactly this shape
 * for apply_patch (path passed as a separate arg). Before this cascade entry
 * such input had no parser on the apply_patch path and always failed with
 * "no SEARCH/REPLACE hunks found" even though editCascade's L3 already knew
 * how to apply a `@@` hunk body — it was simply unreachable from the tool.
 */
export function looksLikeBareUnifiedHunk(body: string): boolean {
  const t = body || '';
  if (/^\*\*\*\s+Begin Patch\s*$/m.test(t) || /^\*\*\*\s+Update File:/m.test(t)) {
    return false;
  }
  if (/^diff --git /m.test(t) || /^--- a\//m.test(t)) {
    return false;
  }
  return AT_HUNK_HDR.test(t);
}

/** Convert one or more bare `@@` hunks into SEARCH/REPLACE pairs. */
export function bareUnifiedHunkToSrHunks(body: string): SrParseResult {
  const lines = (body || '').replace(/\r\n/g, '\n').split('\n');
  const hunks: SrHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!AT_HUNK_HDR.test(line)) {
      i += 1;
      continue;
    }
    i += 1;
    const searchLines: string[] = [];
    const replaceLines: string[] = [];
    while (i < lines.length && !AT_HUNK_HDR.test(lines[i]!)) {
      const L = lines[i]!;
      if (L.startsWith('+')) {
        replaceLines.push(L.slice(1));
      } else if (L.startsWith('-')) {
        searchLines.push(L.slice(1));
      } else if (L.startsWith(' ')) {
        searchLines.push(L.slice(1));
        replaceLines.push(L.slice(1));
      } else if (L.trim() === '') {
        searchLines.push('');
        replaceLines.push('');
      } else {
        // Unprefixed context (some models omit the leading space).
        searchLines.push(L);
        replaceLines.push(L);
      }
      i += 1;
    }
    const search = searchLines.join('\n');
    const replace = replaceLines.join('\n');
    if (!search.length && !replace.length) continue;
    if (!search.length) {
      return {
        hunks,
        error: 'bare hunk has no SEARCH context (addition-only not supported)',
      };
    }
    hunks.push({ search, replace });
  }
  if (!hunks.length) {
    return { hunks: [], error: 'no @@ hunks found' };
  }
  return { hunks };
}
