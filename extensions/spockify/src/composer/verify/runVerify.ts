/**
 * Composer verify hook — Phase 4 WS-P4-V
 * Calls terminal_run protocol; does not own terminal policy.
 */

import type { TerminalToolResult } from '../../terminal/types';
import { runTerminalTool } from '../../terminal/runTerminalTool';
import type * as vscode from 'vscode';

export interface VerifyRequest {
  command: string;
  cwd?: string;
}

export async function runComposerVerify(
  req: VerifyRequest,
  output?: vscode.OutputChannel,
): Promise<TerminalToolResult> {
  output?.appendLine(`composer-verify: ${req.command}`);
  // Prefer allowlist tier so seeded `npm test*` / `pytest*` auto-run;
  // dangerous patterns still always denied.
  return runTerminalTool(
    { command: req.command, cwd: req.cwd, policy: 'allowlist' },
    { output },
  );
}
