/**
 * Apply nextContent as a minimal ranged TextEdit when possible.
 * Full-buffer writeFile makes SCM/File changes look like wipe+paste.
 */

import * as vscode from 'vscode';
import {
  findChangedLineSpan,
  replacementForSpan,
  type LineEditSpan,
} from './lineSpan';

function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function rangeForSpan(
  doc: vscode.TextDocument,
  span: LineEditSpan,
): vscode.Range {
  const start = Math.max(0, Math.min(span.start, doc.lineCount));
  const oldEnd = Math.max(start, Math.min(span.oldEnd, doc.lineCount));
  const startPos = new vscode.Position(start, 0);
  if (oldEnd <= start) {
    // Pure insertion at `start` (may be EOF → append after last line).
    if (start >= doc.lineCount) {
      const last = doc.lineAt(doc.lineCount - 1);
      return new vscode.Range(last.range.end, last.range.end);
    }
    return new vscode.Range(startPos, startPos);
  }
  if (oldEnd >= doc.lineCount) {
    const last = doc.lineAt(doc.lineCount - 1);
    return new vscode.Range(startPos, last.rangeIncludingLineBreak.end);
  }
  return new vscode.Range(startPos, new vscode.Position(oldEnd, 0));
}

function buildReplacementText(
  proposed: string,
  span: LineEditSpan,
  insertAtEof: boolean,
  docEndsWithNewline: boolean,
): string {
  let text = replacementForSpan(proposed, span);
  if (span.oldEnd > span.start || span.newEnd > span.start) {
    // When replacing/inserting mid-file, keep a trailing newline so the
    // following line stays on its own row (range ends at column 0 of oldEnd).
    if (!insertAtEof && span.newEnd > span.start && !text.endsWith('\n')) {
      text += '\n';
    }
  }
  if (insertAtEof && docEndsWithNewline && text && !text.endsWith('\n')) {
    // Document previously ended with \n; appending lines should preserve that
    // only if proposed also wants a trailing newline — leave as-is.
  }
  void docEndsWithNewline;
  return text;
}

/**
 * Try WorkspaceEdit replace on the changed span. Returns true when applied.
 * Caller should fall back to full writeFile on false.
 */
export async function tryApplyRangedEdit(
  uri: vscode.Uri,
  current: string,
  next: string,
): Promise<boolean> {
  if (current === next) return false;
  if (!current) return false; // new file — full write is correct

  const span = findChangedLineSpan(current, next);
  if (!span) return false;

  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    return false;
  }

  const live = normalizeEol(doc.getText());
  const expect = normalizeEol(current);
  // Allow trailing-newline-only drift.
  if (live !== expect && live.replace(/\n$/, '') !== expect.replace(/\n$/, '')) {
    return false;
  }

  const insertAtEof = span.start >= doc.lineCount;
  const range = rangeForSpan(doc, span);
  let replacement = buildReplacementText(
    next,
    span,
    insertAtEof,
    doc.getText().endsWith('\n'),
  );

  // EOF append: if we are inserting after last char and need a newline before.
  if (insertAtEof && doc.lineCount > 0) {
    const last = doc.lineAt(doc.lineCount - 1);
    if (last.text.length > 0 && !doc.getText().endsWith('\n')) {
      replacement = '\n' + replacement;
    } else if (doc.getText().endsWith('\n') === false && span.start === doc.lineCount) {
      /* already handled */
    }
  }

  const we = new vscode.WorkspaceEdit();
  we.replace(uri, range, replacement);
  const ok = await vscode.workspace.applyEdit(we);
  if (!ok) return false;

  // Persist so SCM sees the edit; ignore failure (untitled / readonly).
  try {
    if (doc.isDirty) await doc.save();
  } catch {
    /* ignore */
  }
  return true;
}
