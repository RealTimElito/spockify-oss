import type * as vscode from 'vscode';

/** Stable id: `{workspaceRelativePath}#{hunkIndex}` */
export type HunkId = `${string}#${number}`;

export interface ApplyPatchFile {
  path: string;
  language?: string;
  nextContent?: string;
  unifiedDiff?: string;
}

export interface ApplyPatchRequest {
  files: ApplyPatchFile[];
  source: 'chat' | 'composer' | 'inline' | 'agent';
}

export interface ApplyResult {
  applied: string[];
  rejected: string[];
  checkpointId?: string;
}

export interface DiffHunk {
  id: HunkId;
  path: string;
  index: number;
  header: string;
  lines: string[];
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface FileDiffPreview {
  path: string;
  unifiedDiff: string;
  hunks: DiffHunk[];
  currentContent: string;
  nextContent: string;
}

export interface DiffPreview {
  files: FileDiffPreview[];
}

export interface ApplyServiceOptions {
  resolveUri?: (relPath: string) => Promise<vscode.Uri | undefined>;
  readFile?: (uri: vscode.Uri) => Promise<string>;
  writeFile?: (uri: vscode.Uri, content: string) => Promise<void>;
}

export interface ApplyUndoSnapshot {
  checkpointId: string;
  source: ApplyPatchRequest['source'];
  files: Array<{ path: string; uri: string; content: string }>;
}

export interface ApplyService {
  preview(req: ApplyPatchRequest): Promise<DiffPreview>;
  apply(
    req: ApplyPatchRequest,
    opts?: { hunks?: HunkId[] },
  ): Promise<ApplyResult>;
  /** Restore last apply; returns number of files written (0 if nothing to undo). */
  undoLast(): Promise<number>;
  /** True when a single-step undo is available. */
  canUndo(): boolean;
  /** Drop undo stack without writing files (e.g. after checkpoint restore). */
  clearUndo(): void;
  getLastUndoSnapshot?(): ApplyUndoSnapshot | undefined;
  onApplied(cb: (e: ApplyResult) => void): vscode.Disposable;
  onUndone?(cb: () => void): vscode.Disposable;
  parsePatchText(text: string, source?: ApplyPatchRequest['source']): ApplyPatchRequest;
}
