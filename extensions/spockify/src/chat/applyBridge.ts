/**
 * Apply chat fences via Diff Review panel + ApplyService.
 */

import type * as vscode from 'vscode';
import { getApplyService } from '../apply';
import { openDiffReview } from '../apply/review/diffReview';
import type { ApplyPatchRequest } from '../apply/types';

export async function applyChatPatchesFromBridge(
  patches: { path: string; content: string }[],
  output: vscode.OutputChannel,
): Promise<void> {
  if (!patches.length) return;

  const request: ApplyPatchRequest = {
    source: 'chat',
    files: patches.map((p) => ({
      path: p.path,
      nextContent: p.content,
    })),
  };

  try {
    getApplyService();
    const applied = await openDiffReview(request, output);
    output.appendLine(
      `chat apply: diff review accepted ${applied.length}/${patches.length}`,
    );
    return;
  } catch (err) {
    output.appendLine(
      `chat apply: diff review failed — ${err instanceof Error ? err.message : String(err)}; falling back`,
    );
  }

  const { applyPatchesWithPreview } = await import('../composer/composer');
  await applyPatchesWithPreview(patches, output);
}
