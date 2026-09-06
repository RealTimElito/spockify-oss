import type { DiffHunk, HunkId } from './types';

export function hunkId(path: string, index: number): HunkId {
  return `${path}#${index}`;
}

const HUNK_HEADER =
  /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)$/;

export function parseHunksFromUnifiedDiff(
  path: string,
  unifiedDiff: string,
): DiffHunk[] {
  const lines = unifiedDiff.replace(/\r\n/g, '\n').split('\n');
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(HUNK_HEADER);
    if (!match) {
      i++;
      continue;
    }
    const oldStart = parseInt(match[1], 10);
    const oldLines = match[2] ? parseInt(match[2], 10) : 1;
    const newStart = parseInt(match[3], 10);
    const newLines = match[4] ? parseInt(match[4], 10) : 1;
    const header = lines[i];
    i++;
    const body: string[] = [];
    while (i < lines.length) {
      const line = lines[i];
      if (line.match(HUNK_HEADER)) {
        break;
      }
      if (line.startsWith('---') || line.startsWith('+++')) {
        i++;
        continue;
      }
      if (
        line.startsWith(' ') ||
        line.startsWith('+') ||
        line.startsWith('-') ||
        line.startsWith('\\')
      ) {
        body.push(line);
        i++;
        continue;
      }
      if (line === '') {
        // Bare empty line in a hunk is treated as empty context (" ").
        body.push(' ');
        i++;
        continue;
      }
      break;
    }
    const index = hunks.length;
    hunks.push({
      id: hunkId(path, index),
      path,
      index,
      header,
      lines: body,
      oldStart,
      oldLines,
      newStart,
      newLines,
    });
  }
  return hunks;
}

function oldBlockFromHunk(hunk: DiffHunk): string[] {
  const block: string[] = [];
  for (const hl of hunk.lines) {
    const prefix = hl[0];
    if (prefix === '-' || prefix === ' ') {
      block.push(hl.slice(1));
    }
  }
  return block;
}

function matchesAt(lines: string[], startIdx: number, block: string[]): boolean {
  if (startIdx < 0 || startIdx + block.length > lines.length) return false;
  for (let i = 0; i < block.length; i++) {
    if (lines[startIdx + i] !== block[i]) return false;
  }
  return true;
}

/**
 * Locate where a hunk's old block sits in the file. Prefer @@ oldStart; if
 * context does not match, search for a unique occurrence (or closest hit).
 * Returns undefined when the old block cannot be found — skip that hunk.
 */
export function locateHunkStart(
  lines: string[],
  hunk: DiffHunk,
  lineOffset: number,
): number | undefined {
  const oldBlock = oldBlockFromHunk(hunk);
  const hint = Math.max(0, hunk.oldStart - 1 + lineOffset);
  if (!oldBlock.length) {
    // Pure addition — insert at hinted line (clamped).
    return Math.min(hint, lines.length);
  }
  if (matchesAt(lines, hint, oldBlock)) return hint;

  const hits: number[] = [];
  for (let i = 0; i <= lines.length - oldBlock.length; i++) {
    if (matchesAt(lines, i, oldBlock)) hits.push(i);
  }
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    return hits.reduce((best, h) =>
      Math.abs(h - hint) < Math.abs(best - hint) ? h : best,
    );
  }
  return undefined;
}

/**
 * Apply selected hunks to content. If acceptedHunkIds is undefined, apply all hunks.
 * Hunks not listed in acceptedHunkIds are skipped (rejected).
 * Hunks whose old context cannot be located are skipped (avoids wipe/mangle).
 */
export function applyHunksToContent(
  original: string,
  hunks: DiffHunk[],
  acceptedHunkIds: HunkId[] | undefined,
): string {
  if (!hunks.length) {
    return original;
  }
  const acceptAll = acceptedHunkIds === undefined;
  const accept = new Set(acceptedHunkIds ?? []);
  let lines = original.split('\n');
  let lineOffset = 0;

  for (const hunk of hunks) {
    const take =
      acceptAll || accept.has(hunk.id) || accept.has(hunkId(hunk.path, hunk.index));
    if (!take) {
      continue;
    }
    const startIdx = locateHunkStart(lines, hunk, lineOffset);
    if (startIdx === undefined) {
      continue;
    }
    const newSegment: string[] = [];
    for (const hl of hunk.lines) {
      const prefix = hl[0];
      const text = hl.slice(1);
      if (prefix === '+') {
        newSegment.push(text);
      } else if (prefix === ' ') {
        newSegment.push(text);
      }
    }
    let removeCount = 0;
    for (const hl of hunk.lines) {
      if (hl[0] === '-' || hl[0] === ' ') {
        removeCount++;
      }
    }
    const before = lines.slice(0, startIdx);
    const after = lines.slice(startIdx + removeCount);
    lines = [...before, ...newSegment, ...after];
    lineOffset += newSegment.length - removeCount;
  }
  return lines.join('\n');
}

/** Which hunk ids would change content when applied alone against current. */
export function listHunkIds(hunks: DiffHunk[]): HunkId[] {
  return hunks.map((h) => h.id);
}
