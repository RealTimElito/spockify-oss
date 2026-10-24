/**
 * Open a workspace-relative (or absolute) path in the editor.
 * Uses vscode.Uri.joinPath / workspace.fs so Remote SSH URIs work from ui-kind.
 */

import * as vscode from 'vscode';
import {
  isAbsolutePath,
  normalizePathHint,
  scorePathMatch,
} from './pathResolve';

export { normalizePathHint, scorePathMatch } from './pathResolve';

function pickBestUri(
  candidates: readonly vscode.Uri[],
  hint: string,
): vscode.Uri | undefined {
  if (!candidates.length) return undefined;
  let best: vscode.Uri | undefined;
  let bestScore = 0;
  for (const u of candidates) {
    const score = scorePathMatch(u.path, hint);
    if (score > bestScore) {
      bestScore = score;
      best = u;
    }
  }
  if (best && bestScore > 0) return best;
  return candidates[0];
}

async function statOk(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve to a workspace URI. Prefer joinPath on folder roots (remote-safe).
 * Tries every workspace folder, absolute host paths, then findFiles by basename.
 */
export async function resolveWorkspaceUri(
  pathHint: string,
): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length || !pathHint.trim()) {
    return undefined;
  }
  const clean = normalizePathHint(pathHint);
  if (!clean) {
    return undefined;
  }

  // Absolute path on the workspace host — map onto matching folder scheme.
  if (isAbsolutePath(clean)) {
    for (const folder of folders) {
      const rootFs = folder.uri.fsPath.replace(/\\/g, '/');
      if (clean === rootFs || clean.startsWith(rootFs + '/')) {
        const rel = clean.slice(rootFs.length).replace(/^\/+/, '');
        const uri = rel
          ? vscode.Uri.joinPath(folder.uri, ...rel.split('/').filter(Boolean))
          : folder.uri;
        if (await statOk(uri)) return uri;
      }
    }
  }

  const rel = clean.replace(/^\/+/, '');
  const segments = rel.split('/').filter(Boolean);

  // Workspace-relative: try each root (multi-root / Remote-SSH).
  for (const folder of folders) {
    const joined = vscode.Uri.joinPath(folder.uri, ...segments);
    if (await statOk(joined)) return joined;
  }

  // findFiles by basename; prefer full relative suffix.
  const base = segments[segments.length - 1] || rel;
  if (!base) return undefined;
  const found = await vscode.workspace.findFiles(
    `**/${base}`,
    '**/node_modules/**',
    50,
  );
  if (!found.length) return undefined;

  const best = pickBestUri(found, rel);
  if (best && (await statOk(best))) return best;
  return undefined;
}

export async function openWorkspaceFile(
  pathHint: string,
  opts?: {
    line?: number;
    column?: number;
    endLine?: number;
    /** Keep chat/composer focus (mid-turn agent edits). */
    preserveFocus?: boolean;
    /** Skip warning toast when the path cannot be resolved yet. */
    quiet?: boolean;
  },
): Promise<void> {
  const uri = await resolveWorkspaceUri(pathHint);
  if (!uri) {
    if (!opts?.quiet) {
      void vscode.window.showWarningMessage(
        `Could not resolve file: ${pathHint}`,
      );
    }
    return;
  }
  const line = opts?.line && opts.line > 0 ? opts.line : undefined;
  const col = opts?.column && opts.column > 0 ? opts.column : 1;
  const endLine =
    opts?.endLine && opts.endLine > 0 ? opts.endLine : undefined;
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, {
    preview: true,
    preserveFocus: opts?.preserveFocus === true,
  });
  if (line != null) {
    const start = new vscode.Position(line - 1, Math.max(0, col - 1));
    const endRow = Math.min(
      doc.lineCount - 1,
      Math.max(line - 1, (endLine ?? line) - 1),
    );
    const end =
      endLine != null && endLine !== line
        ? new vscode.Position(endRow, doc.lineAt(endRow).text.length)
        : start;
    editor.selection = new vscode.Selection(start, end);
    editor.revealRange(
      new vscode.Range(start, end),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    );
  }
}

/** Reveal the first path a mutating tool is about to touch (editor presence). */
export function pathFromMutatingToolArgs(
  name: string,
  args: Record<string, unknown> | undefined,
): string | undefined {
  if (!args) return undefined;
  if (name === 'write_file' || name === 'read_file') {
    const p = args.path;
    return typeof p === 'string' && p.trim() ? p.trim() : undefined;
  }
  if (name === 'apply_patch') {
    const files = args.files;
    if (Array.isArray(files) && files.length) {
      const first = files[0] as { path?: unknown };
      if (typeof first?.path === 'string' && first.path.trim()) {
        return first.path.trim();
      }
    }
  }
  return undefined;
}
