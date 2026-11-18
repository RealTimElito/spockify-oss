/**
 * Cursor-style Ctrl+K preview: apply interleaved red/green lines in-place
 * in the same editor (no side-by-side vscode.diff tab).
 */

import * as vscode from 'vscode';
import {
  absoluteRanges,
  buildInlinePreviewDocument,
} from './proposedContent';

const REMOVED = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(248, 81, 73, 0.28)',
  borderColor: 'rgba(248, 81, 73, 0.85)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  isWholeLine: true,
  textDecoration: 'line-through solid rgba(248, 81, 73, 0.7)',
  overviewRulerColor: 'rgba(248, 81, 73, 0.9)',
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

const ADDED = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(46, 160, 67, 0.28)',
  borderColor: 'rgba(46, 160, 67, 0.85)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  isWholeLine: true,
  overviewRulerColor: 'rgba(46, 160, 67, 0.9)',
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

export interface InlineEditPreviewHandle {
  dispose: () => void;
  refresh: (
    editor: vscode.TextEditor,
    range: vscode.Range,
    proposed: string,
  ) => void;
  /** Document range covering the interleaved preview (for Accept / Reject). */
  getPreviewRange: () => vscode.Range;
  /** True once the buffer has been rewritten with the preview document. */
  isApplied: () => boolean;
}

export async function showInlineEditPreview(
  editor: vscode.TextEditor,
  range: vscode.Range,
  original: string,
  proposed: string,
  _languageId: string,
): Promise<InlineEditPreviewHandle> {
  let previewStartLine = range.start.line;
  let previewLineCount = 0;
  let applied = false;
  let lastProposed = proposed;
  // Anchor column for empty-end ranges after edits.
  const startCharacter = range.start.character;

  const clearDecorations = (ed: vscode.TextEditor) => {
    ed.setDecorations(REMOVED, []);
    ed.setDecorations(ADDED, []);
  };

  const paintDecorations = (ed: vscode.TextEditor, prop: string) => {
    const doc = buildInlinePreviewDocument(original, prop);
    const removed = absoluteRanges(
      previewStartLine,
      doc.removedLineIndexes,
      ed.document.lineCount,
    ).map(
      (r) =>
        new vscode.Range(
          r.startLine,
          0,
          r.endLine,
          ed.document.lineAt(r.endLine).text.length,
        ),
    );
    const added = absoluteRanges(
      previewStartLine,
      doc.addedLineIndexes,
      ed.document.lineCount,
    ).map(
      (r) =>
        new vscode.Range(
          r.startLine,
          0,
          r.endLine,
          ed.document.lineAt(r.endLine).text.length,
        ),
    );
    ed.setDecorations(REMOVED, removed);
    ed.setDecorations(ADDED, added);
  };

  const applyPreview = async (
    ed: vscode.TextEditor,
    baseRange: vscode.Range,
    prop: string,
  ): Promise<vscode.Range> => {
    const doc = buildInlinePreviewDocument(original, prop);
    const ok = await ed.edit(
      (eb) => {
        eb.replace(baseRange, doc.text);
      },
      { undoStopBefore: !applied, undoStopAfter: true },
    );
    if (!ok) {
      return baseRange;
    }
    applied = true;
    lastProposed = prop;
    previewStartLine = baseRange.start.line;
    previewLineCount = Math.max(1, doc.lines.length);
    const endLine = Math.min(
      ed.document.lineCount - 1,
      previewStartLine + previewLineCount - 1,
    );
    const endCol = ed.document.lineAt(endLine).text.length;
    const next = new vscode.Range(
      previewStartLine,
      startCharacter,
      endLine,
      endCol,
    );
    paintDecorations(ed, prop);
    ed.revealRange(next, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    return next;
  };

  let liveRange = await applyPreview(editor, range, proposed);

  return {
    isApplied: () => applied,
    getPreviewRange: () => liveRange,
    refresh(ed, _rng, prop) {
      if (prop === lastProposed && applied) {
        paintDecorations(ed, prop);
        return;
      }
      void applyPreview(ed, liveRange, prop).then((r) => {
        liveRange = r;
      });
    },
    dispose() {
      clearDecorations(editor);
    },
  };
}

/** Restore original selection text after Reject (preview already in buffer). */
export async function restoreInlineEditOriginal(
  editor: vscode.TextEditor,
  previewRange: vscode.Range,
  original: string,
): Promise<void> {
  await editor.edit((eb) => {
    eb.replace(previewRange, original);
  });
  editor.setDecorations(REMOVED, []);
  editor.setDecorations(ADDED, []);
}

/** Keep proposed text only (strip interleaved red lines) on Accept. */
export async function commitInlineEditProposed(
  editor: vscode.TextEditor,
  previewRange: vscode.Range,
  proposed: string,
): Promise<void> {
  await editor.edit((eb) => {
    eb.replace(previewRange, proposed);
  });
  editor.setDecorations(REMOVED, []);
  editor.setDecorations(ADDED, []);
}
