/**
 * Read a workspace file slice for Cursor-style chat file cards.
 */

import * as vscode from 'vscode';
import { resolveWorkspaceUri } from './openWorkspaceFile';

export interface FileExcerptResult {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  truncated: boolean;
}

const MAX_EXCERPT_LINES = 80;

export async function readWorkspaceFileExcerpt(
  pathHint: string,
  startLine: number,
  endLine?: number,
): Promise<FileExcerptResult | undefined> {
  const uri = await resolveWorkspaceUri(pathHint);
  if (!uri) return undefined;
  let start = Math.max(1, Math.floor(startLine) || 1);
  let end = Math.max(start, Math.floor(endLine ?? startLine) || start);
  let truncated = false;
  if (end - start + 1 > MAX_EXCERPT_LINES) {
    end = start + MAX_EXCERPT_LINES - 1;
    truncated = true;
  }
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    const last = doc.lineCount;
    start = Math.min(start, last);
    end = Math.min(end, last);
    const lines: string[] = [];
    for (let i = start - 1; i < end; i++) {
      lines.push(doc.lineAt(i).text);
    }
    const rel = vscode.workspace.asRelativePath(uri, false);
    return {
      path: rel && rel !== uri.fsPath ? rel : pathHint,
      startLine: start,
      endLine: end,
      text: lines.join('\n'),
      truncated,
    };
  } catch {
    return undefined;
  }
}
