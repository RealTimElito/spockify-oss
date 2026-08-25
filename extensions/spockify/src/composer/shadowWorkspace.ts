/**
 * Composer shadow bridge — durable under workspace `.spockify/shadow/<id>`.
 */

import * as vscode from 'vscode';
import { createShadowWorkspace } from '@spockify/shadow-workspace';
import type { ShadowWorkspaceHandle as PkgHandle } from '@spockify/shadow-workspace';
import type { ComposerSession, FilePatch } from './types';

export type ShadowWorkspaceHandle = PkgHandle;

export async function openShadowForSession(
  session: ComposerSession,
): Promise<ShadowWorkspaceHandle> {
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const handle = await createShadowWorkspace(session.id, {
    workspaceRoot,
    reuse: true,
  });
  session.shadowRoot = handle.root;
  await handle.writeManifest({
    surface: 'composer',
    turnCount: session.turns.length,
    touchList: session.fileTouchList,
  });
  return handle;
}

export async function stagePatchesInShadow(
  shadow: ShadowWorkspaceHandle,
  patches: FilePatch[],
): Promise<void> {
  for (const p of patches) {
    await shadow.writeProposed(p.path, p.content);
  }
  await shadow.writeManifest({ staged: patches.map((p) => p.path) });
}
