/**
 * Active Ctrl+K inline edit session.
 * Preview applies interleaved red/green lines in-place; Accept keeps proposed, Reject restores.
 */

import * as vscode from 'vscode';

export interface InlineEditSession {
  readonly editor: vscode.TextEditor;
  /** Selection/line range at prompt time (before in-place preview rewrite). */
  readonly range: vscode.Range;
  /** Text in the document at range when the edit was requested. */
  readonly originalText: string;
  /** Latest model proposal. */
  proposedText: string;
  lastInstruction: string;
  disposePreview: () => void;
  /** Active interleaved preview range in the buffer (Cursor-style). */
  getPreviewRange?: () => vscode.Range;
}

let active: InlineEditSession | undefined;

export function getActiveInlineEditSession(): InlineEditSession | undefined {
  return active;
}

export function setActiveInlineEditSession(session: InlineEditSession | undefined): void {
  active = session;
}

export async function setPreviewActiveContext(activePreview: boolean): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    'spockify.inlineEditPreviewActive',
    activePreview,
  );
}

export function endSession(session: InlineEditSession): void {
  session.disposePreview();
  if (active === session) {
    active = undefined;
    void setPreviewActiveContext(false);
  }
}

/** Selection or current line when selection is empty (Cursor-style). */
export function resolveEditRange(editor: vscode.TextEditor): {
  range: vscode.Range;
  text: string;
} {
  let range: vscode.Range = editor.selection;
  let text = editor.document.getText(range);
  if (!text.trim()) {
    const line = editor.document.lineAt(range.start.line);
    range = line.range;
    text = line.text;
  }
  return { range, text };
}
