/**
 * Build in-place Ctrl+K / inline-diff preview content (Cursor-style).
 * Removed lines stay in the buffer (red); added lines follow (green).
 */

export type PreviewLineKind = 'context' | 'removed' | 'added';

export interface InlinePreviewLine {
  text: string;
  kind: PreviewLineKind;
}

export interface InlinePreviewDocument {
  /** Full preview text joined with \\n (no trailing newline unless inputs had one). */
  text: string;
  lines: InlinePreviewLine[];
  /** 0-based line indexes into `lines` / `text` split. */
  removedLineIndexes: number[];
  addedLineIndexes: number[];
}

/** Replace [startOff, endOff) in `full` with `replacement`. */
export function replaceRangeInText(
  full: string,
  startOff: number,
  endOff: number,
  replacement: string,
): string {
  const start = Math.max(0, Math.min(startOff, full.length));
  const end = Math.max(start, Math.min(endOff, full.length));
  return full.slice(0, start) + replacement + full.slice(end);
}

function splitPreserve(text: string): string[] {
  if (text === '') return [];
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

/**
 * Interleave original + proposed as a Cursor-like inline diff block:
 * deleted lines first (red), then added lines (green).
 * Identical line-prefix/suffix stays as context when both sides share it.
 */
export function buildInlinePreviewDocument(
  original: string,
  proposed: string,
): InlinePreviewDocument {
  const oldLines = splitPreserve(original);
  const newLines = splitPreserve(proposed);

  let prefix = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }
  let oldSuffix = 0;
  let newSuffix = 0;
  while (
    oldSuffix < oldLines.length - prefix &&
    newSuffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - oldSuffix] ===
      newLines[newLines.length - 1 - newSuffix]
  ) {
    oldSuffix++;
    newSuffix++;
  }

  const lines: InlinePreviewLine[] = [];
  for (let i = 0; i < prefix; i++) {
    lines.push({ text: oldLines[i]!, kind: 'context' });
  }
  for (let i = prefix; i < oldLines.length - oldSuffix; i++) {
    lines.push({ text: oldLines[i]!, kind: 'removed' });
  }
  for (let i = prefix; i < newLines.length - newSuffix; i++) {
    lines.push({ text: newLines[i]!, kind: 'added' });
  }
  for (let i = oldLines.length - oldSuffix; i < oldLines.length; i++) {
    lines.push({ text: oldLines[i]!, kind: 'context' });
  }

  // Empty both → one blank context line so the editor range stays valid.
  if (!lines.length) {
    lines.push({ text: '', kind: 'context' });
  }

  const removedLineIndexes: number[] = [];
  const addedLineIndexes: number[] = [];
  lines.forEach((l, i) => {
    if (l.kind === 'removed') removedLineIndexes.push(i);
    if (l.kind === 'added') addedLineIndexes.push(i);
  });

  return {
    text: lines.map((l) => l.text).join('\n'),
    lines,
    removedLineIndexes,
    addedLineIndexes,
  };
}

/** Map relative line indexes onto an absolute editor start line. */
export function absoluteRanges(
  startLine: number,
  relativeIndexes: number[],
  docLineCount: number,
): { startLine: number; endLine: number }[] {
  const out: { startLine: number; endLine: number }[] = [];
  for (const rel of relativeIndexes) {
    const ln = startLine + rel;
    if (ln < 0 || ln >= docLineCount) continue;
    out.push({ startLine: ln, endLine: ln });
  }
  return out;
}
