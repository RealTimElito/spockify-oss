/**
 * Shared Apply / checkpoint toast + context helpers.
 */

import * as vscode from 'vscode';
import type { ApplyResult, ApplyService } from './types';

const CAN_UNDO_CTX = 'spockify.apply.canUndo';

export async function refreshApplyUndoContext(
  apply: ApplyService,
): Promise<void> {
  const can = Boolean(apply.canUndo?.() ?? apply.getLastUndoSnapshot?.());
  await vscode.commands.executeCommand('setContext', CAN_UNDO_CTX, can);
}

/** Toast after a successful apply with Undo / Checkpoints actions. */
export async function notifyApplySuccess(
  result: ApplyResult,
  opts?: { label?: string },
): Promise<void> {
  if (!result.applied.length) {
    return;
  }
  const n = result.applied.length;
  const label = opts?.label ?? 'Spockify';
  const ckpt = result.checkpointId
    ? ` · ckpt ${result.checkpointId.slice(0, 8)}`
    : '';
  const pick = await vscode.window.showInformationMessage(
    `${label}: applied ${n} file(s)${ckpt}.`,
    'Undo',
    'Checkpoints',
  );
  if (pick === 'Undo') {
    await vscode.commands.executeCommand('spockify.applyUndo');
  } else if (pick === 'Checkpoints') {
    await vscode.commands.executeCommand('spockify.checkpoints.list');
  }
}
