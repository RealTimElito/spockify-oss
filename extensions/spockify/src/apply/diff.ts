import type { FileDiffPreview } from './types';
import {
  applyHunksToContent,
  hunkId,
  parseHunksFromUnifiedDiff,
} from './hunks';

/** Build a unified diff string from old and new file contents. */
export function buildUnifiedDiff(
  path: string,
  oldContent: string,
  newContent: string,
): string {
  if (oldContent === newContent) {
    return '';
  }
  const oldLines = oldContent.length ? oldContent.split('\n') : [];
  const newLines = newContent.length ? newContent.split('\n') : [];
  // Drop a trailing empty element from a final newline so hunks stay tight.
  if (oldLines.length && oldLines[oldLines.length - 1] === '') oldLines.pop();
  if (newLines.length && newLines[newLines.length - 1] === '') newLines.pop();
  const hunks = computeLineHunks(oldLines, newLines);
  if (!hunks.length) {
    return '';
  }
  const parts = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    parts.push(h.header);
    parts.push(...h.lines);
  }
  return parts.join('\n');
}

interface RawHunk {
  header: string;
  lines: string[];
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

type DiffOp = { type: 'equal' | 'del' | 'add'; line: string };

/**
 * LCS-based line diff. The previous greedy "prefer delete" walk produced
 * wipe-looking hunks (delete-rest + add-rest) for mid-file inserts/edits.
 */
function diffLinesLcs(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  // For large files, fall back to a prefix/suffix Myers-lite to avoid O(n*m).
  if (n * m > 400_000) {
    return diffLinesPrefixSuffix(oldLines, newLines);
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () =>
    new Uint32Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (oldLines[i] === newLines[j]) dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      else dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'equal', line: oldLines[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: 'del', line: oldLines[i]! });
      i++;
    } else {
      ops.push({ type: 'add', line: newLines[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', line: oldLines[i]! });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', line: newLines[j]! });
    j++;
  }
  return ops;
}

/** Common-prefix / common-suffix fallback for huge files. */
function diffLinesPrefixSuffix(
  oldLines: string[],
  newLines: string[],
): DiffOp[] {
  let start = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (start < minLen && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (
    oldEnd >= start &&
    newEnd >= start &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd--;
    newEnd--;
  }
  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++) {
    ops.push({ type: 'equal', line: oldLines[i]! });
  }
  for (let i = start; i <= oldEnd; i++) {
    ops.push({ type: 'del', line: oldLines[i]! });
  }
  for (let j = start; j <= newEnd; j++) {
    ops.push({ type: 'add', line: newLines[j]! });
  }
  for (let i = oldEnd + 1; i < oldLines.length; i++) {
    ops.push({ type: 'equal', line: oldLines[i]! });
  }
  return ops;
}

/** Group LCS ops into unified hunks with a little context. */
function computeLineHunks(oldLines: string[], newLines: string[]): RawHunk[] {
  const ops = diffLinesLcs(oldLines, newLines);
  if (!ops.some((o) => o.type !== 'equal')) return [];

  const CONTEXT = 3;
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (ops[i]!.type === 'equal') continue;
    for (
      let k = Math.max(0, i - CONTEXT);
      k <= Math.min(ops.length - 1, i + CONTEXT);
      k++
    ) {
      keep[k] = true;
    }
  }

  // Precompute 1-based line numbers for each op (old/new).
  const oldAt = new Array<number>(ops.length);
  const newAt = new Array<number>(ops.length);
  let o = 1;
  let n = 1;
  for (let i = 0; i < ops.length; i++) {
    oldAt[i] = o;
    newAt[i] = n;
    const t = ops[i]!.type;
    if (t === 'equal') {
      o++;
      n++;
    } else if (t === 'del') o++;
    else n++;
  }

  const hunks: RawHunk[] = [];
  let i = 0;
  while (i < ops.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    const start = i;
    while (i < ops.length && keep[i]) i++;
    const slice = ops.slice(start, i);
    const oldStart = oldAt[start]!;
    const newStart = newAt[start]!;
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    for (const op of slice) {
      if (op.type === 'equal') {
        body.push(' ' + op.line);
        oldCount++;
        newCount++;
      } else if (op.type === 'del') {
        body.push('-' + op.line);
        oldCount++;
      } else {
        body.push('+' + op.line);
        newCount++;
      }
    }
    if (!body.length) continue;
    hunks.push({
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      lines: body,
      oldStart,
      oldLines: oldCount,
      newStart,
      newLines: newCount,
    });
  }
  return hunks;
}

export { hunkId };

/** Build DiffPreview for one file from current content and patch fields. */
export function buildFileDiffPreview(
  path: string,
  currentContent: string,
  nextContent?: string,
  unifiedDiff?: string,
): FileDiffPreview {
  let resolvedNext = nextContent;
  let unified = unifiedDiff ?? '';

  if (unifiedDiff?.trim()) {
    const hunks = parseHunksFromUnifiedDiff(path, unifiedDiff);
    resolvedNext = applyHunksToContent(currentContent, hunks, undefined);
    if (!unified.trim()) {
      unified = buildUnifiedDiff(path, currentContent, resolvedNext);
    }
  } else if (nextContent !== undefined) {
    unified = buildUnifiedDiff(path, currentContent, nextContent);
    resolvedNext = nextContent;
  } else {
    resolvedNext = currentContent;
  }

  const hunks = parseHunksFromUnifiedDiff(
    path,
    unified || buildUnifiedDiff(path, currentContent, resolvedNext),
  );

  return {
    path,
    unifiedDiff: unified || buildUnifiedDiff(path, currentContent, resolvedNext),
    hunks,
    currentContent,
    nextContent: resolvedNext,
  };
}

/** Re-parse unified diff from parse module into preview hunks (multi-file body). */
export function previewFromUnifiedDiffOnly(
  path: string,
  unifiedDiff: string,
  currentContent: string,
): FileDiffPreview {
  return buildFileDiffPreview(path, currentContent, undefined, unifiedDiff);
}

export { parseHunksFromUnifiedDiff };
