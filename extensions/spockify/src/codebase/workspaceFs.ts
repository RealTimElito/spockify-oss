/**
 * Map workspace absolute paths → vscode.Uri preserving scheme/authority.
 * Required for ui-kind extension on Remote SSH (Uri.file would hit local disk).
 */

import * as vscode from 'vscode';
import type { CodebaseFs, FileStat } from '@spockify/codebase';
import { normFsPath, relSegmentsUnderRoot } from './pathUtils';

export { normFsPath, relSegmentsUnderRoot } from './pathUtils';

/**
 * Resolve an absolute workspace path under `root` to a Uri with the same
 * scheme/authority as the folder (file:// or vscode-remote://…).
 */
export function absPathToWorkspaceUri(root: vscode.Uri, absPath: string): vscode.Uri {
  const parts = relSegmentsUnderRoot(root.fsPath, absPath);
  if (parts) {
    return parts.length ? vscode.Uri.joinPath(root, ...parts) : root;
  }

  // Fallback: same scheme/authority, absolute path (rare paths outside root).
  if (root.scheme === 'file') {
    return vscode.Uri.file(absPath);
  }
  const abs = normFsPath(absPath);
  const pathPart = abs.startsWith('/') ? abs : `/${abs}`;
  return root.with({ path: pathPart });
}

/** Relative path of a document URI under a workspace folder, or undefined. */
export function relativeUnderFolder(
  folder: vscode.Uri,
  docUri: vscode.Uri,
): string | undefined {
  const parts = relSegmentsUnderRoot(folder.fsPath, docUri.fsPath);
  if (parts === null) {
    return undefined;
  }
  return parts.join('/');
}

export function createWorkspaceFs(root: vscode.Uri): CodebaseFs {
  const toUri = (absPath: string) => absPathToWorkspaceUri(root, absPath);
  return {
    async readFile(absPath: string): Promise<string> {
      const buf = await vscode.workspace.fs.readFile(toUri(absPath));
      return Buffer.from(buf).toString('utf8');
    },
    async readDir(absPath: string): Promise<string[]> {
      const entries = await vscode.workspace.fs.readDirectory(toUri(absPath));
      return entries.map(([name]) => name);
    },
    async stat(absPath: string): Promise<FileStat> {
      const st = await vscode.workspace.fs.stat(toUri(absPath));
      return {
        isFile: st.type === vscode.FileType.File,
        isDirectory: st.type === vscode.FileType.Directory,
        size: st.size,
      };
    },
    async exists(absPath: string): Promise<boolean> {
      try {
        await vscode.workspace.fs.stat(toUri(absPath));
        return true;
      } catch {
        return false;
      }
    },
  };
}
