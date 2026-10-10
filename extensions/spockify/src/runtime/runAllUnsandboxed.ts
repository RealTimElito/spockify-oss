/**
 * Legacy "Run all unsandboxed" helpers — now backed by agentPermissionMode.
 * Prefer importing from agentPermissionMode for new code.
 * Ask mode stays read-only: allow-all is ignored while agent.mode === ask.
 */

export {
  isAllowAllActive as isRunAllUnsandboxedActive,
  isAllowAllActive as isRunAllUnsandboxedEnabled,
  getAgentPermissionMode,
  shouldAutoApproveShell,
  shouldAutoApplyFilePatches,
  shouldForceOsSandboxOff,
  shouldForceShellConfirm,
  shouldReviewFileEdits,
} from './agentPermissionMode';
