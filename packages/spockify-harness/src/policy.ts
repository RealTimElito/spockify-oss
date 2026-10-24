/** Host-owned policy decision point. Precedence: deny > ask > allow. */

import { classifyBash, type GrantAction } from './permissions';

export type PolicyDecision = {
  action: GrantAction;
  reason: string;
};

export type PolicyRequest = {
  tool: string;
  args: Record<string, unknown>;
};

const SHELL_TOOLS = new Set(['shell', 'bash', 'run_tests']);

/** Shell metacharacters that turn run_tests into arbitrary execution. */
export const TEST_METACHAR = /[;&|`$()<>\n\\]/;

const TEST_ALLOW =
  /^(pytest\b|python[0-9.]*\s+-m\s+pytest\b|npm\s+(test|run\s+test)\b|yarn\s+test\b|pnpm\s+test\b|make\s+test\b|cargo\s+test\b|go\s+test\b|npx\s+(vitest|jest|pytest)\b|vitest\b|jest\b)/i;

export function isVerifierCommand(command: string): boolean {
  const cmd = command.trim();
  return TEST_ALLOW.test(cmd) && !TEST_METACHAR.test(cmd);
}

export function authorizeTool(req: PolicyRequest): PolicyDecision {
  const tool = (req.tool || '').trim().toLowerCase();
  if (tool === 'grant' || tool === 'revoke') {
    return {
      action: 'deny',
      reason: 'grant/revoke is host-only; model cannot change policy',
    };
  }
  if (SHELL_TOOLS.has(tool)) {
    const command = String(
      req.args.command || (tool === 'run_tests' ? 'pytest -q' : ''),
    );
    return authorizeCommand(tool, command);
  }
  return { action: 'auto', reason: 'non-shell tool' };
}

export function authorizeCommand(tool: string, command: string): PolicyDecision {
  const cmd = command.trim();
  if (!cmd) return { action: 'deny', reason: 'empty command' };
  const classified = classifyBash(cmd);
  if (tool === 'run_tests') {
    if (TEST_METACHAR.test(cmd)) {
      return {
        action: 'deny',
        reason: 'run_tests denies shell metacharacters',
      };
    }
    if (!TEST_ALLOW.test(cmd)) {
      return {
        action: 'deny',
        reason: 'run_tests command not on verification allowlist',
      };
    }
  }
  return { action: classified, reason: `classifier:${classified}` };
}
