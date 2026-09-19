/**
 * Sanity checks for chat/agent file patches.
 * Prevents classic "delete entire file + paste a snippet" staging.
 */

import {
  findChangedLineSpan,
  type LineEditSpan,
} from '../apply/lineSpan';

export type { LineEditSpan };
export { findChangedLineSpan };

/** Reject full replaces that keep less than this fraction of original non-empty lines. */
export const DESTRUCTIVE_KEEP_RATIO = 0.5;

/** Only run wipe checks on files at least this many lines. */
export const MIN_LINES_FOR_SANITY = 5;

/** Proposed body is "tiny" vs current when below this fraction of line count. */
export const SNIPPET_SIZE_RATIO = 0.35;

/**
 * Max lines a surgical mid-file recover may delete below the first diff
 * (diagnostic-style wraps should stay tiny).
 */
export const MAX_SURGICAL_DELETE_BELOW = 20;

export function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\n$/, '').split('\n').length;
}

function nonEmptyTrimmedLines(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Fraction of original non-empty lines that still appear (trimmed) in next.
 * 1 = all kept; 0 = none kept.
 */
export function retainedLineRatio(current: string, next: string): number {
  const cur = nonEmptyTrimmedLines(current);
  if (!cur.length) return 1;
  const nextSet = new Set(nonEmptyTrimmedLines(next));
  let kept = 0;
  for (const line of cur) {
    if (nextSet.has(line)) kept++;
  }
  return kept / cur.length;
}

/**
 * True when proposed nextContent looks like a wipe: most of the file gone,
 * replaced by a much smaller body (snippet / one long line / raw diff text).
 */
export function isDestructiveFullReplace(
  current: string,
  next: string,
  opts?: { keepRatio?: number; minLines?: number; snippetRatio?: number },
): boolean {
  if (!current.trim()) return false;
  if (current === next) return false;

  const minLines = opts?.minLines ?? MIN_LINES_FOR_SANITY;
  const keepRatio = opts?.keepRatio ?? DESTRUCTIVE_KEEP_RATIO;
  const snippetRatio = opts?.snippetRatio ?? SNIPPET_SIZE_RATIO;

  const curN = countLines(current);
  const nextN = countLines(next);
  if (curN < minLines) return false;

  const retained = retainedLineRatio(current, next);
  const muchSmaller = nextN < Math.max(2, Math.floor(curN * snippetRatio));

  // Classic: whole file deleted, one/few lines added.
  if (muchSmaller && retained < keepRatio) return true;

  // Large file rewritten with almost no shared lines (even if sizes similar).
  if (curN >= 20 && retained < 0.2 && nextN < curN * 0.8) return true;

  // Prefix kept, rest of file dropped (Fix-with-agent truncated "complete" file).
  if (isMidFileSuffixWipe(current, next)) return true;

  return false;
}

/**
 * True when proposed keeps a shared prefix but drops the file suffix
 * (classic "edit from error line to EOF" wipe in the diff UI).
 */
export function isMidFileSuffixWipe(current: string, next: string): boolean {
  if (!current.trim() || !next.trim() || current === next) return false;
  const curN = countLines(current);
  const nextN = countLines(next);
  if (curN < MIN_LINES_FOR_SANITY) return false;
  if (nextN >= curN) return false;

  const span = findChangedLineSpan(current, next);
  if (!span) return false;

  // Shared some prefix, nothing (or almost nothing) of the original suffix,
  // and a large chunk from mid-file to EOF was dropped.
  const deleted = span.oldEnd - span.start;
  const inserted = span.newEnd - span.start;
  if (span.start === 0 && span.suffixKept === 0 && deleted >= curN * 0.5) {
    // Whole-file rewrite without shared ends — other checks handle this.
    return false;
  }
  if (span.suffixKept > 0) return false;
  if (span.start <= 0 && inserted >= deleted) return false;
  // Truncation: ends at the edit, no trailing match with original EOF.
  return deleted > Math.max(inserted, 1) && deleted >= 2;
}

/**
 * Recover a mid-file suffix wipe by splicing only the new mid segment into
 * the original, preserving the file suffix.
 *
 * On suffix wipe, "deleted" spans to EOF — only replace the first differing
 * line (diagnostic line) with the proposed mid segment.
 */
export function recoverSurgicalEdit(
  current: string,
  proposed: string,
): string | undefined {
  const span = findChangedLineSpan(current, proposed);
  if (!span) return undefined;

  const cur = current.replace(/\r\n/g, '\n').split('\n');
  const prop = proposed.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');

  // Pure prefix truncate (no new mid content) — refuse.
  if (span.newEnd <= span.start) return undefined;

  const deleted = span.oldEnd - span.start;
  const newSeg = prop.slice(span.start, span.newEnd);
  const wipe = isMidFileSuffixWipe(current, proposed);

  // Complete mid-file edit that already kept the suffix in proposed.
  if (!wipe && span.suffixKept > 0 && deleted <= MAX_SURGICAL_DELETE_BELOW) {
    return undefined; // accept as full — already surgical enough
  }
  if (!wipe && deleted <= MAX_SURGICAL_DELETE_BELOW) {
    return undefined;
  }

  // Suffix wipe: replace only the first differing line with the new mid body.
  // Otherwise cap deletes below the diagnostic.
  const surgicalCount = wipe
    ? 1
    : Math.min(Math.max(1, deleted), MAX_SURGICAL_DELETE_BELOW);

  const next = spliceLines(
    cur,
    span.start,
    span.start + surgicalCount,
    newSeg.join('\n'),
  );
  if (next === current) return undefined;
  // Check wipe/destructive without re-entering surgical recover.
  if (isMidFileSuffixWipe(current, next)) return undefined;
  const retained = retainedLineRatio(current, next);
  if (retained < DESTRUCTIVE_KEEP_RATIO && countLines(next) < countLines(current) * SNIPPET_SIZE_RATIO) {
    return undefined;
  }
  return next;
}

/**
 * Proposed fence body looks like a snippet, not a full-file rewrite.
 */
export function looksLikeSnippetVsFile(
  current: string,
  proposed: string,
): boolean {
  if (!current.trim() || !proposed.trim()) return false;
  const curN = countLines(current);
  const propN = countLines(proposed);
  if (curN < MIN_LINES_FOR_SANITY) return false;
  if (propN >= Math.max(8, Math.floor(curN * 0.5))) return false;
  return true;
}

/**
 * If snippet's first significant line uniquely appears in current, replace
 * from that line through a span matching snippet line count.
 * Also handles E501-style wraps: locate the unique long line that contains
 * the snippet's significant tokens, then replace that one line with the wrap.
 */
export function trySnippetReplace(
  current: string,
  snippet: string,
): string | undefined {
  const snip = snippet.replace(/\n$/, '');
  if (!snip.trim() || !current) return undefined;
  if (snip === current) return undefined;

  // Already present uniquely — nothing to stage
  if (current.includes(snip) && current.split(snip).length === 2) {
    return undefined;
  }

  const curLines = current.split('\n');
  const snipLines = snip.split('\n');
  if (snipLines.length < 1) return undefined;

  // Body large enough to be the whole file → allow as full replace signal.
  // Never treat a mid-file suffix wipe (shared prefix, dropped EOF) as complete.
  if (snipLines.length >= curLines.length) {
    if (
      snipLines.length >= curLines.length * 0.5 &&
      !isMidFileSuffixWipe(current, snip)
    ) {
      return snip;
    }
    return undefined;
  }
  if (
    snipLines.length >= Math.max(8, Math.floor(curLines.length * 0.5)) &&
    !looksLikeSnippetVsFile(current, snip) &&
    !isMidFileSuffixWipe(current, snip)
  ) {
    return snip;
  }

  const byAnchor = replaceByUniqueAnchor(curLines, snipLines, snip);
  if (byAnchor != null) return byAnchor;

  const byWrap = replaceByWrapTarget(curLines, snipLines, snip);
  if (byWrap != null) return byWrap;

  // Truncated "complete file" (prefix + edit, no suffix): splice mid segment only.
  return recoverSurgicalEdit(current, snip);
}

function replaceByUniqueAnchor(
  curLines: string[],
  snipLines: string[],
  snip: string,
): string | undefined {
  const anchor = snipLines.find((l) => l.trim().length >= 8)?.trim();
  if (!anchor) return undefined;
  const hits: number[] = [];
  for (let i = 0; i < curLines.length; i++) {
    if (curLines[i].includes(anchor)) hits.push(i);
  }
  if (hits.length !== 1) return undefined;
  const start = hits[0];
  let end = Math.min(curLines.length, start + snipLines.length);
  const lastAnchor = [...snipLines]
    .reverse()
    .find((l) => l.trim().length >= 6)
    ?.trim();
  if (lastAnchor) {
    for (
      let j = start;
      j < Math.min(curLines.length, start + snipLines.length + 8);
      j++
    ) {
      if (curLines[j].includes(lastAnchor)) {
        end = j + 1;
        break;
      }
    }
  }
  return spliceLines(curLines, start, end, snip);
}

/**
 * E501 wrap: snippet is several short lines; target is one long line sharing
 * a long unique token (string literal / identifier run).
 */
function replaceByWrapTarget(
  curLines: string[],
  snipLines: string[],
  snip: string,
): string | undefined {
  if (snipLines.length < 2 || snipLines.length > 12) return undefined;

  const tokens = collectSignificantTokens(snipLines);
  if (!tokens.length) return undefined;

  const hits: number[] = [];
  for (let i = 0; i < curLines.length; i++) {
    const line = curLines[i];
    if (tokens.every((t) => line.includes(t))) hits.push(i);
  }
  if (hits.length !== 1) {
    // Fall back: unique longest token
    const longest = tokens[0];
    const single: number[] = [];
    for (let i = 0; i < curLines.length; i++) {
      if (curLines[i].includes(longest)) single.push(i);
    }
    if (single.length !== 1) return undefined;
    return spliceLines(curLines, single[0], single[0] + 1, snip);
  }
  return spliceLines(curLines, hits[0], hits[0] + 1, snip);
}

function collectSignificantTokens(snipLines: string[]): string[] {
  const raw: string[] = [];
  for (const line of snipLines) {
    for (const m of line.matchAll(/["'`][^"'`]{12,}["'`]/g)) {
      raw.push(m[0]);
    }
    for (const m of line.matchAll(/[A-Za-z_][A-Za-z0-9_]{11,}/g)) {
      raw.push(m[0]);
    }
    const trimmed = line.trim();
    if (trimmed.length >= 16 && !/^[()\[\]{},]+$/.test(trimmed)) {
      raw.push(trimmed);
    }
  }
  // Longest first, unique
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw.sort((a, b) => b.length - a.length)) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 4) break;
  }
  return out;
}

function spliceLines(
  curLines: string[],
  startIdx: number,
  endIdx: number,
  replacement: string,
): string {
  const repl = replacement.replace(/\n$/, '').split('\n');
  return [
    ...curLines.slice(0, startIdx),
    ...repl,
    ...curLines.slice(endIdx),
  ].join('\n');
}

/**
 * Resolve proposed nextContent safely: accept full-file updates that keep
 * enough of the original; if proposed looks like a snippet/wipe, try unique
 * locate + splice (E501 wraps etc.) before refusing.
 * Mid-file suffix truncations are recovered surgically (preserve EOF).
 */
export function resolveNonDestructiveNext(
  current: string,
  proposed: string,
): { next: string; via: 'full' | 'snippet' } | undefined {
  if (!proposed.trim()) return undefined;
  if (!current.trim()) return { next: proposed, via: 'full' };
  if (current === proposed) return undefined;

  // Prefer surgical recover before accepting a truncated "full" file.
  if (isMidFileSuffixWipe(current, proposed)) {
    const recovered = recoverSurgicalEdit(current, proposed);
    if (
      recovered != null &&
      recovered !== current &&
      !isDestructiveFullReplace(current, recovered)
    ) {
      return { next: recovered, via: 'snippet' };
    }
  }

  if (!isDestructiveFullReplace(current, proposed)) {
    return { next: proposed, via: 'full' };
  }

  const spliced = trySnippetReplace(current, proposed);
  if (
    spliced != null &&
    spliced !== current &&
    !isDestructiveFullReplace(current, spliced)
  ) {
    return { next: spliced, via: 'snippet' };
  }

  const recovered = recoverSurgicalEdit(current, proposed);
  if (
    recovered != null &&
    recovered !== current &&
    !isDestructiveFullReplace(current, recovered)
  ) {
    return { next: recovered, via: 'snippet' };
  }
  return undefined;
}
