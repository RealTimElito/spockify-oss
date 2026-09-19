/**
 * List / open durable composer shadows for the current workspace.
 */

import * as vscode from 'vscode';
import { listDurableShadows } from '@spockify/shadow-workspace';

export async function browseComposerShadows(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    void vscode.window.showWarningMessage('Open a workspace folder first.');
    return;
  }
  const listed = await listDurableShadows(root);
  if (!listed.length) {
    void vscode.window.showInformationMessage(
      'No durable composer shadows under .spockify/shadow/',
    );
    return;
  }
  const pick = await vscode.window.showQuickPick(
    listed.map((s) => ({
      label: s.sessionId,
      description: s.updatedAt
        ? new Date(s.updatedAt).toLocaleString()
        : undefined,
      detail: s.root,
      shadow: s,
    })),
    { title: 'Composer durable shadows' },
  );
  if (!pick) return;
  const uri = vscode.Uri.file(pick.shadow.root);
  await vscode.commands.executeCommand('revealFileInOS', uri);
}
