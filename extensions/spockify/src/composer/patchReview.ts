import * as vscode from 'vscode';
import type { ShadowWorkspaceHandle } from './shadowWorkspace';
import {
  readWorkspaceText,
  resolveWorkspaceUri,
  writePatchToWorkspace,
} from './applyBridge';
import type { FilePatch } from './types';
import { openDiffReview } from '../apply/review/diffReview';
import type { ApplyPatchRequest } from '../apply/types';
import { getApplyService } from '../apply';

async function showDiffForPatch(
  patch: FilePatch,
  oldText: string,
): Promise<void> {
  const left = await vscode.workspace.openTextDocument({
    content: oldText,
    language: 'plaintext',
  });
  const right = await vscode.workspace.openTextDocument({
    content: patch.content,
    language: 'plaintext',
  });
  await vscode.commands.executeCommand(
    'vscode.diff',
    left.uri,
    right.uri,
    `Composer: ${patch.path}`,
  );
}

async function reviewOnePatch(
  patch: FilePatch,
  output: vscode.OutputChannel,
  shadow?: ShadowWorkspaceHandle,
): Promise<'applied' | 'skipped'> {
  const uri = await resolveWorkspaceUri(patch.path);
  if (!uri) {
    output.appendLine(`composer: skip unresolved ${patch.path}`);
    void vscode.window.showWarningMessage(
      `Composer: could not resolve ${patch.path}`,
    );
    return 'skipped';
  }

  const oldText = await readWorkspaceText(uri);
  const mode = oldText ? 'modify' : 'create';
  const shadowNote = shadow ? ' (shadow staged)' : '';

  const confirm = await vscode.window.showInformationMessage(
    `${patch.path} — ${mode}, ${patch.content.split('\n').length} lines${shadowNote}`,
    'Accept',
    'Diff',
    'Skip',
  );

  if (confirm === 'Diff') {
    await showDiffForPatch(patch, oldText);
    const again = await vscode.window.showInformationMessage(
      `Accept ${patch.path} after diff?`,
      'Accept',
      'Skip',
    );
    if (again !== 'Accept') {
      return 'skipped';
    }
  } else if (confirm !== 'Accept') {
    return 'skipped';
  }

  if (shadow) {
    const staged = (await shadow.readProposed(patch.path)) ?? patch.content;
    const ok = await writePatchToWorkspace(
      { path: patch.path, content: staged },
      uri,
      output,
    );
    return ok ? 'applied' : 'skipped';
  }

  const ok = await writePatchToWorkspace(patch, uri, output);
  return ok ? 'applied' : 'skipped';
}

function logProposedFiles(
  patches: FilePatch[],
  output: vscode.OutputChannel,
  shadowRoot?: string,
): void {
  output.appendLine('composer: proposed files:');
  for (const p of patches) {
    const lines = p.content.split('\n').length;
    output.appendLine(`  - ${p.path} (${lines} lines)`);
  }
  if (shadowRoot) {
    output.appendLine(`composer: shadow overlay at ${shadowRoot}`);
  }
}

async function patchesToApplyRequest(
  patches: FilePatch[],
  shadow?: ShadowWorkspaceHandle,
): Promise<ApplyPatchRequest> {
  const files = [];
  for (const p of patches) {
    const content =
      (shadow ? await shadow.readProposed(p.path) : undefined) ?? p.content;
    files.push({ path: p.path, nextContent: content });
  }
  return { files, source: 'composer' };
}

/**
 * Review pending patches with Diff Review panel / per-file Accept / Apply all.
 * Shadow overlay keeps the real workspace clean until Accept.
 */
export async function applyPatchesWithPreview(
  patches: FilePatch[],
  output: vscode.OutputChannel,
  options?: {
    shadow?: ShadowWorkspaceHandle;
    /** Skip the summary picker when called from Composer tree flow. */
    forceMode?: 'panel' | 'files' | 'all';
  },
): Promise<number> {
  if (!patches.length) {
    void vscode.window.showWarningMessage('No file patches found in the response.');
    return 0;
  }

  logProposedFiles(patches, output, options?.shadow?.root);

  const summary =
    options?.forceMode === 'panel'
      ? 'Diff review panel'
      : options?.forceMode === 'all'
        ? 'Apply all'
        : options?.forceMode === 'files'
          ? 'Review files'
          : await vscode.window.showInformationMessage(
              `Composer proposed ${patches.length} file(s). Review each file, or apply all.`,
              'Diff review panel',
              'Review files',
              'Apply all',
              'Dismiss',
            );

  if (summary === 'Dismiss' || !summary) {
    return 0;
  }

  if (summary === 'Diff review panel') {
    const request = await patchesToApplyRequest(patches, options?.shadow);
    // Prefer ApplyService path (checkpoints) via review panel
    try {
      getApplyService();
      const applied = await openDiffReview(request, output);
      return applied.length;
    } catch (err) {
      output.appendLine(
        `composer: diff panel failed, falling back: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const toReview =
    summary === 'Apply all'
      ? patches
      : await pickFilesToReview(patches);

  if (!toReview.length) {
    return 0;
  }

  let applied = 0;
  for (const patch of toReview) {
    const result = await reviewOnePatch(patch, output, options?.shadow);
    if (result === 'applied') {
      applied++;
    }
  }

  if (applied) {
    void vscode.window.showInformationMessage(
      `Spockify Composer applied ${applied} file(s)`,
    );
  }
  return applied;
}

async function pickFilesToReview(
  patches: FilePatch[],
): Promise<FilePatch[]> {
  const items = patches.map((p) => ({
    label: p.path,
    description: `${p.content.split('\n').length} lines`,
    picked: true,
    patch: p,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Spockify Composer — files to review',
    canPickMany: true,
    ignoreFocusOut: true,
    placeHolder: 'Select files (then Accept/Diff/Skip per file)',
  });
  return picked?.map((i) => i.patch) ?? [];
}
