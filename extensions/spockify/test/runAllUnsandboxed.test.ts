/**
 * agentPermissionMode gating — pure helpers (no vscode).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

type Mode = 'allowAll' | 'askEveryTime' | 'autoRunReviewFiles';

function isAllowAllActive(mode: Mode, agentMode: string): boolean {
  return mode === 'allowAll' && agentMode !== 'ask';
}

function shouldAutoApproveShell(mode: Mode, agentMode: string): boolean {
  if (agentMode === 'ask') return false;
  return mode === 'allowAll' || mode === 'autoRunReviewFiles';
}

function shouldForceOsSandboxOff(mode: Mode, agentMode: string): boolean {
  return isAllowAllActive(mode, agentMode);
}

function shouldForceShellConfirm(mode: Mode, agentMode: string): boolean {
  if (agentMode === 'ask') return false;
  return mode === 'askEveryTime';
}

function shouldAutoApplyFilePatches(mode: Mode, agentMode: string): boolean {
  return isAllowAllActive(mode, agentMode);
}

function shouldAutoRun(
  mode: Mode,
  agentMode: string,
  decision: 'run' | 'ask' | 'deny',
  dangerous: boolean,
): boolean {
  if (!shouldAutoApproveShell(mode, agentMode)) return decision === 'run';
  if (dangerous) return false;
  return true;
}

describe('agentPermissionMode gating', () => {
  it('allowAll inactive in Ask', () => {
    assert.equal(isAllowAllActive('allowAll', 'ask'), false);
    assert.equal(isAllowAllActive('allowAll', 'agent'), true);
    assert.equal(shouldAutoApplyFilePatches('allowAll', 'ask'), false);
    assert.equal(shouldAutoApplyFilePatches('allowAll', 'agent'), true);
  });

  it('autoRunReviewFiles auto-runs shell but not file apply', () => {
    assert.equal(shouldAutoApproveShell('autoRunReviewFiles', 'agent'), true);
    assert.equal(shouldForceOsSandboxOff('autoRunReviewFiles', 'agent'), false);
    assert.equal(shouldAutoApplyFilePatches('autoRunReviewFiles', 'agent'), false);
    assert.equal(shouldForceShellConfirm('autoRunReviewFiles', 'agent'), false);
  });

  it('askEveryTime forces shell confirm', () => {
    assert.equal(shouldForceShellConfirm('askEveryTime', 'agent'), true);
    assert.equal(shouldAutoApproveShell('askEveryTime', 'agent'), false);
    assert.equal(shouldAutoApplyFilePatches('askEveryTime', 'agent'), false);
  });

  it('auto-runs ask/deny when allowAll unless dangerous', () => {
    assert.equal(shouldAutoRun('allowAll', 'agent', 'ask', false), true);
    assert.equal(shouldAutoRun('allowAll', 'agent', 'deny', false), true);
    assert.equal(shouldAutoRun('allowAll', 'agent', 'deny', true), false);
    assert.equal(shouldAutoRun('allowAll', 'ask', 'ask', false), false);
    assert.equal(shouldAutoRun('askEveryTime', 'agent', 'ask', false), false);
  });
});
