/**
 * Recover path + SEARCH/REPLACE hunks from Codex-style apply_patch bodies:
 *
 *   *** Begin Patch
 *   *** Update File: path/to/file
 *   @@
 *    context
 *   -old
 *   +new
 *   *** End Patch
 */

import type { SrHunk } from './parseSr';

const UPDATE_FILE = /^\*\*\*\s+Update File:\s*(.+?)\s*$/i;
const BEGIN = /^\*\*\*\s+Begin Patch\s*$/i;
const END = /^\*\*\*\s+End Patch\s*$/i;
const HUNK_HDR = /^@@/;

export function pathFromCodexPatch(body: string): string {
  for (const line of (body || '').split(/\r?\n/)) {
    const m = line.match(UPDATE_FILE);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

export function looksLikeCodexPatch(body: string): boolean {
  const t = body || '';
  return (
    /^\*\*\*\s+Begin Patch\s*$/m.test(t) ||
    /^\*\*\*\s+Update File:/m.test(t)
  );
}

/** Convert Codex @@ hunks into SEARCH/REPLACE pairs. */
export function codexPatchToSrHunks(body: string): {
  hunks: SrHunk[];
  path: string;
  error?: string;
} {
  const lines = (body || '').replace(/\r\n/g, '\n').split('\n');
  const path = pathFromCodexPatch(body);
  const hunks: SrHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (BEGIN.test(line) || UPDATE_FILE.test(line) || END.test(line)) {
      i += 1;
      continue;
    }
    if (!HUNK_HDR.test(line)) {
      i += 1;
      continue;
    }
    i += 1;
    const searchLines: string[] = [];
    const replaceLines: string[] = [];
    while (i < lines.length) {
      const L = lines[i]!;
      if (HUNK_HDR.test(L) || BEGIN.test(L) || END.test(L) || UPDATE_FILE.test(L)) {
        break;
      }
      if (L.startsWith('+')) {
        replaceLines.push(L.slice(1));
      } else if (L.startsWith('-')) {
        searchLines.push(L.slice(1));
      } else if (L.startsWith(' ')) {
        searchLines.push(L.slice(1));
        replaceLines.push(L.slice(1));
      } else if (L.trim() === '') {
        // blank context line without prefix — treat as shared context
        searchLines.push('');
        replaceLines.push('');
      } else {
        // Unprefixed context (some models omit the leading space)
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
        path,
        error: 'Codex hunk has no SEARCH context (addition-only not supported)',
      };
    }
    hunks.push({ search, replace });
  }
  if (!hunks.length) {
    return { hunks: [], path, error: 'no Codex @@ hunks found' };
  }
  return { hunks, path };
}
