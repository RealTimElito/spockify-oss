/**
 * Composer permission modes (Cursor-like).
 * Ask agent mode stays read-only regardless of this setting.
 */

import * as vscode from 'vscode';

export type AgentPermissionMode =
  | 'allowAll'
  | 'askEveryTime'
  | 'autoRunReviewFiles';

export interface AgentPermissionModeMeta {
  id: AgentPermissionMode;
  /** Short label for the composer chrome chip. */
  shortLabel: string;
  /** Menu title. */
  label: string;
  /** One-line description. */
  description: string;
}

export const AGENT_PERMISSION_MODE_META: AgentPermissionModeMeta[] = [
  {
    id: 'allowAll',
    shortLabel: 'Allow all',
    label: 'Allow all (unsandboxed)',
    description:
      'Auto-approve shell and file edits — full filesystem access (dangerous)',
  },
  {
    id: 'askEveryTime',
    shortLabel: 'Ask',
    label: 'Ask every time',
    description: 'Confirm shell commands and review every file edit',
  },
  {
    id: 'autoRunReviewFiles',
    shortLabel: 'Review files',
    label: 'Auto-run tools, review file edits',
    description:
      'Auto-run shell tools; stage file patches for inline Accept / Reject',
  },
];

const VALID = new Set<string>(AGENT_PERMISSION_MODE_META.map((m) => m.id));

export function isAgentPermissionMode(v: unknown): v is AgentPermissionMode {
  return typeof v === 'string' && VALID.has(v);
}

/** Raw setting + migration from legacy `runAllUnsandboxed`. */
export function getAgentPermissionMode(): AgentPermissionMode {
  const cfg = vscode.workspace.getConfiguration('spockify');
  const raw = cfg.get<string>('agentPermissionMode');
  if (isAgentPermissionMode(raw)) {
    return raw;
  }
  // Legacy boolean → mode
  if (cfg.get<boolean>('runAllUnsandboxed') === true) {
    return 'allowAll';
  }
  return 'askEveryTime';
}

export function getAgentPermissionModeMeta(
  mode = getAgentPermissionMode(),
): AgentPermissionModeMeta {
  return (
    AGENT_PERMISSION_MODE_META.find((m) => m.id === mode) ??
    AGENT_PERMISSION_MODE_META[1]
  );
}

function agentMode(): string {
  return (
    vscode.workspace.getConfiguration('spockify').get<string>('agent.mode') ||
    'agent'
  );
}

/** True when Ask (read-only) — permission dropdown is ignored for mutating tools. */
export function isAskModeReadOnly(): boolean {
  return agentMode() === 'ask';
}

/**
 * Allow-all YOLO: auto shell + auto file apply + OS sandbox off.
 * Inactive in Ask.
 */
export function isAllowAllActive(): boolean {
  return getAgentPermissionMode() === 'allowAll' && !isAskModeReadOnly();
}

/**
 * Auto-approve non-catastrophic shell (skip confirm / plan gate).
 * Active for allowAll and autoRunReviewFiles; inactive in Ask.
 */
export function shouldAutoApproveShell(): boolean {
  if (isAskModeReadOnly()) return false;
  const mode = getAgentPermissionMode();
  return mode === 'allowAll' || mode === 'autoRunReviewFiles';
}

/** Force `osSandbox=off` — only allowAll (true unsandboxed). */
export function shouldForceOsSandboxOff(): boolean {
  return isAllowAllActive();
}

/** Force a confirm prompt even when terminal policy says `run`. */
export function shouldForceShellConfirm(): boolean {
  if (isAskModeReadOnly()) return false;
  return getAgentPermissionMode() === 'askEveryTime';
}

/**
 * Cursor ask_every_time for files: confirm before staging/writing.
 * autoRunReviewFiles stages silently; allowAll writes directly.
 */
export function shouldConfirmFileEdits(): boolean {
  if (isAskModeReadOnly()) return false;
  return getAgentPermissionMode() === 'askEveryTime';
}

/** Auto-write file patches without review. */
export function shouldAutoApplyFilePatches(): boolean {
  return isAllowAllActive();
}

/** Stage patches for Composer tree + inline Accept / Reject. */
export function shouldReviewFileEdits(): boolean {
  if (isAskModeReadOnly()) return true;
  return !shouldAutoApplyFilePatches();
}

/** Persist mode and keep legacy boolean in sync. */
export async function setAgentPermissionMode(
  mode: AgentPermissionMode,
): Promise<void> {
  if (!isAgentPermissionMode(mode)) return;
  const cfg = vscode.workspace.getConfiguration('spockify');
  await cfg.update(
    'agentPermissionMode',
    mode,
    vscode.ConfigurationTarget.Global,
  );
  await cfg.update(
    'runAllUnsandboxed',
    mode === 'allowAll',
    vscode.ConfigurationTarget.Global,
  );
}
