/**
 * Public entry for composer/chat dynamic imports (`../apply/applyService`).
 */
import type * as vscode from 'vscode';
import {
  createApplyService,
  getApplyService,
  registerApplyCommands,
} from './serviceImpl';
import type { ApplyPatchRequest } from './types';

export { createApplyService, getApplyService, registerApplyCommands };

async function applyPatchesLegacy(
  patches: { path: string; content: string }[],
  output: vscode.OutputChannel,
): Promise<void> {
  const svc = createApplyService();
  const req: ApplyPatchRequest = {
    files: patches.map((p) => ({ path: p.path, nextContent: p.content })),
    source: 'chat',
  };
  const result = await svc.apply(req);
  output.appendLine(
    `apply: ${result.applied.length} applied, ${result.rejected.length} rejected`,
  );
}

export const ApplyService = {
  applyPatches: applyPatchesLegacy,
};

export default ApplyService;
