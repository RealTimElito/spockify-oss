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
