/** Editor state captured at Ctrl+L (before chat steals focus). */
export type EditorContextSnapshot = {
  fileName: string;
  filePath: string;
  selectionText: string;
  fileText: string;
  hasNonemptySelection: boolean;
  /** 1-based inclusive display lines (Cursor-style chip label). */
  startLine?: number;
  endLine?: number;
};

/** Removable Ctrl+L selection chip shown in chat composer chrome. */
export type SelectionContextChip = {
  id: string;
  /** Basename for chip label (e.g. docker-compose.yml). */
  fileName: string;
  filePath: string;
  /** 1-based inclusive. */
  startLine: number;
  endLine: number;
  text: string;
};

/**
 * VS Code selections that end at column 0 of the next line are exclusive at
 * that line — display the last fully/partially included line instead.
 */
export function selectionDisplayRange(
  startLine0: number,
  startChar: number,
  endLine0: number,
  endChar: number,
): { startLine: number; endLine: number } {
  void startChar;
  const startLine = startLine0 + 1;
  let endLine = endLine0 + 1;
  if (endChar === 0 && endLine0 > startLine0) {
    endLine = endLine0;
  }
  if (endLine < startLine) {
    endLine = startLine;
  }
  return { startLine, endLine };
}

export function basenameFromPath(filePath: string): string {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath || 'file';
}

export function selectionChipId(
  filePath: string,
  startLine: number,
  endLine: number,
): string {
  return `${filePath}:${startLine}-${endLine}`;
}

/** Build a chip from a snapshot when selection is non-empty. */
export function selectionChipFromSnapshot(
  snap: EditorContextSnapshot | undefined,
): SelectionContextChip | undefined {
  if (!snap?.hasNonemptySelection || !snap.filePath) {
    return undefined;
  }
  const startLine = snap.startLine ?? 1;
  const endLine = snap.endLine ?? startLine;
  const fileName = basenameFromPath(snap.fileName || snap.filePath);
  return {
    id: selectionChipId(snap.filePath, startLine, endLine),
    fileName,
    filePath: snap.filePath,
    startLine,
    endLine,
    text: snap.selectionText,
  };
}

/** Upsert by id (same file+range replaces text / moves to end). */
export function upsertSelectionChip(
  chips: SelectionContextChip[],
  chip: SelectionContextChip,
): SelectionContextChip[] {
  const rest = chips.filter((c) => c.id !== chip.id);
  return [...rest, chip];
}

/** Cursor Ctrl+L: selection if non-empty, else active file. */
export function editorAttachFlagsFromSnapshot(
  snap: EditorContextSnapshot | undefined,
): { includeSelection: boolean; includeActiveFile: boolean } {
  if (!snap?.filePath) {
    return { includeSelection: false, includeActiveFile: false };
  }
  if (snap.hasNonemptySelection) {
    return { includeSelection: true, includeActiveFile: false };
  }
  return { includeSelection: false, includeActiveFile: true };
}
