import type { ChunkerOptions, TextChunk } from './types';

const DEFAULT_MAX_LINES = 60;
const DEFAULT_OVERLAP = 8;

/**
 * Splits file content into line-bounded chunks with overlap.
 */
export function chunkFile(
  path: string,
  content: string,
  options: ChunkerOptions = {},
): TextChunk[] {
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const overlapLines = Math.min(
    options.overlapLines ?? DEFAULT_OVERLAP,
    maxLines - 1,
  );
  const lines = content.split(/\r?\n/);
  if (lines.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < lines.length) {
    const end = Math.min(start + maxLines, lines.length);
    const slice = lines.slice(start, end);
    const text = slice.join('\n');
    if (text.trim().length > 0) {
      chunks.push({
        path,
        startLine: start + 1,
        endLine: end,
        text,
      });
    }
    if (end >= lines.length) {
      break;
    }
    start += maxLines - overlapLines;
  }
  return chunks;
}
