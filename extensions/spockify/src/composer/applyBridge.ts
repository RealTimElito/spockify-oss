import * as vscode from 'vscode';
import type { ApplyService } from '../apply/types';
import type { FilePatch } from './types';

let cachedApplyService: ApplyService | undefined | null = null;

/** ApplyService when WS-CLONE-K module is present; otherwise undefined. */
export async function getApplyService(): Promise<ApplyService | undefined> {
  if (cachedApplyService !== null) {
    return cachedApplyService ?? undefined;
  }
  try {
    const modPath = '../apply/applyService';
    const mod = require(modPath) as {
      createApplyService?: () => ApplyService;
    };
    cachedApplyService = mod.createApplyService?.() ?? undefined;
  } catch {
    cachedApplyService = undefined;
  }
  return cachedApplyService ?? undefined;
}

export async function resolveWorkspaceUri(
  relPath: string,
): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    return undefined;
  }
  const clean = relPath.replace(/^\.\//, '').replace(/^\/+/, '');
  const found = await vscode.workspace.findFiles(
    `**/${clean.split('/').pop()}`,
    '**/node_modules/**',
    20,
  );
  const exact = found.find(
    (u) => u.path.endsWith('/' + clean) || u.path.endsWith(clean),
  );
  if (exact) {
    return exact;
  }
  return vscode.Uri.joinPath(folders[0].uri, clean);
}

export async function readWorkspaceText(uri: vscode.Uri): Promise<string> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
  } catch {
    return '';
  }
}

export async function writePatchToWorkspace(
  patch: FilePatch,
  uri: vscode.Uri,
  output: vscode.OutputChannel,
): Promise<boolean> {
  const applySvc = await getApplyService();
  if (applySvc) {
    const result = await applySvc.apply({
      files: [{ path: patch.path, nextContent: patch.content }],
      source: 'composer',
    });
    if (result.applied.includes(patch.path)) {
      output.appendLine(`composer: applied ${patch.path} via ApplyService`);
      return true;
    }
    output.appendLine(`composer: ApplyService rejected ${patch.path}`);
    return false;
  }

  await vscode.workspace.fs.writeFile(
    uri,
    Buffer.from(patch.content, 'utf8'),
  );
  output.appendLine(`composer: wrote ${uri.toString()}`);
  return true;
}
