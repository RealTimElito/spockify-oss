import type * as vscode from 'vscode';

/** BUILD_PLAN §6.6 — consumed by chat/composer without editing their internals. */
export interface CodebaseQuery {
  query: string;
  k?: number;
  pathPrefix?: string;
}

export interface CodebaseHit {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

export interface CodebaseContextProvider {
  ensureIndex(root: vscode.Uri): Promise<void>;
  search(q: CodebaseQuery): Promise<CodebaseHit[]>;
}

export function uriKey(root: vscode.Uri): string {
  return root.fsPath.replace(/\\/g, '/');
}
