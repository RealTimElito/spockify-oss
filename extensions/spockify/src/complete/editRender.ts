/**
 * Map a server line-range EDIT (protocol v2 `mode: "edit"`) onto what the
 * stable VS Code inline-completion API can actually render.
 *
 * Constraints of vscode.InlineCompletionItem.range (stable API):
 *   1. the replace range must start and end on a single line,
 *   2. it must contain the cursor position,
 *   3. the text between range.start and the cursor must be a prefix of
 *      insertText, otherwise the editor silently drops the ghost.
 *
 * So a multi-line edit is renderable only when it collapses to "replace the
 * cursor line with one or more lines whose first line preserves what's left
 * of the cursor". Everything else must fall back (see inlineCompletion.ts).
 * No vscode imports — pure and unit-testable.
 */

export interface ServerEdit {
  start_line: number;
  end_line: number;
  new_text: string;
}

export interface CollapsedEdit {
  /** The single document line the replace range spans. */
  line: number;
  /** Replacement text for that line (may itself be multi-line). */
  insertText: string;
}

/**
 * Try to collapse `edit` to a single-line replace at the cursor line.
 * Returns undefined when the stable inline-completion API cannot express
 * the edit (caller falls back to insert-only or drops it).
 */
export function collapseEditToCursorLine(
  docLines: readonly string[],
  edit: ServerEdit,
  cursorLine: number,
  cursorCol: number,
): CollapsedEdit | undefined {
  const { start_line: start, end_line: end } = edit;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= docLines.length ||
    cursorLine < start ||
    cursorLine > end
  ) {
    return undefined;
  }

  const oldLines = docLines.slice(start, end + 1);
  const newLines = edit.new_text.replace(/\r\n/g, '\n').split('\n');

  // Trim lines the edit doesn't actually change, so a "rewrite lines 10–14"
  // that only touches line 12 still renders.
  let head = 0;
  while (
    head < oldLines.length - 1 &&
    head < newLines.length &&
    oldLines[head] === newLines[head] &&
    start + head < cursorLine
  ) {
    head += 1;
  }
  let tailOld = oldLines.length;
  let tailNew = newLines.length;
  while (
    tailOld - 1 > head &&
    tailNew - 1 >= head &&
    oldLines[tailOld - 1] === newLines[tailNew - 1] &&
    start + tailOld - 1 > cursorLine
  ) {
    tailOld -= 1;
    tailNew -= 1;
  }

  // Renderable iff the remaining changed window is exactly the cursor line.
  if (start + head !== cursorLine || tailOld - head !== 1) {
    return undefined;
  }
  const replacement = newLines.slice(head, tailNew);
  if (replacement.length === 0) {
    // Pure line deletion — ghost text cannot express it.
    return undefined;
  }
  const insertText = replacement.join('\n');
  // Prefix rule (constraint 3): text left of the cursor must be preserved.
  const typedPrefix = (docLines[cursorLine] ?? '').slice(0, cursorCol);
  if (!insertText.startsWith(typedPrefix)) {
    return undefined;
  }
  // No-op edits waste a render slot.
  if (insertText === docLines[cursorLine]) {
    return undefined;
  }
  return { line: cursorLine, insertText };
}
