/**
 * GC old durable composer shadows under `.spockify/shadow`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { listDurableShadows } from '@spockify/shadow-workspace';

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_KEEP = 10;

export async function gcShadowWorkspaces(
  output?: vscode.OutputChannel,
): Promise<number> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return 0;
  const listed = await listDurableShadows(root);
  listed.sort((a, b) => {
    const ta = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const tb = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    return tb - ta;
  });
  const now = Date.now();
  let removed = 0;
  for (let i = 0; i < listed.length; i++) {
    const s = listed[i];
    const age = s.updatedAt ? now - Date.parse(s.updatedAt) : Number.MAX_SAFE_INTEGER;
    const tooOld = age > MAX_AGE_MS;
    const tooMany = i >= MAX_KEEP;
    if (tooOld || tooMany) {
      await fs.rm(s.root, { recursive: true, force: true }).catch(() => undefined);
      removed++;
      output?.appendLine(`shadow-gc: removed ${s.sessionId}`);
    }
  }
  return removed;
}

export function registerShadowGc(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.composer.gcShadows', async () => {
      const n = await gcShadowWorkspaces(output);
      void vscode.window.showInformationMessage(
        n
          ? `Removed ${n} old composer shadow workspace(s).`
          : 'No old composer shadows to remove.',
      );
    }),
  );
  // Quiet GC on activate
  void gcShadowWorkspaces(output).then((n) => {
    if (n) output.appendLine(`shadow-gc: cleaned ${n} on startup`);
  });
}
