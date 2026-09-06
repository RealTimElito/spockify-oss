import * as cp from 'child_process';
import * as vscode from 'vscode';
import {
  shouldAutoApproveShell,
  shouldForceOsSandboxOff,
  shouldForceShellConfirm,
} from '../runtime/agentPermissionMode';

import { checkShellCommand } from './isShellCommand';
import {
  evaluateCommandPolicy,
  isDangerousCommand,
  loadTerminalAgentSettings,
} from './policy';
import { appendAuditLog } from './policy/audit';
import { planOsSandbox } from './policy/osSandbox';
import {
  deriveSessionAllowPattern,
  formatPolicyBadge,
} from './policy/sandbox';
import { execOnWorkspaceHost } from './remoteExec';
import { resolveLocalShell } from './resolveShell';
import {
  addSessionAllowPattern,
  getActiveSession,
} from './session/active';
import type {
  OsSandboxMode,
  TerminalToolRequest,
  TerminalToolResult,
} from './types';
import { requestToolConsent, type ToolConsentDecision } from '../runtime/toolConsent';

export function workspaceTerminalCwd(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  // Prefer fsPath for both local and SSH remote folders (Remote SSH).
  return folder?.uri.fsPath;
}

/** True when the UI extension must not child_process.spawn (wrong host). */
export function isRemoteWorkspace(): boolean {
  return Boolean(vscode.env.remoteName);
}

export interface RunTerminalToolOptions {
  output?: vscode.OutputChannel;
  /** When true, send to integrated terminal instead of capturing stdout. */
  integratedTerminal?: boolean;
  /** Optional abort signal for any UI gating (e.g. ESC reject). */
  signal?: AbortSignal;
}

/**
 * Execute a single shell command under terminal agent policy.
 * Intended for Composer/MCP — pass explicit `policy` or use workspace settings.
 */
export async function runTerminalTool(
  req: TerminalToolRequest,
  options: RunTerminalToolOptions = {},
): Promise<TerminalToolResult> {
  const settings = loadTerminalAgentSettings();
  const policy = req.policy ?? settings.policy;
  const cwd = req.cwd ?? workspaceTerminalCwd();
  const timeoutMs = req.timeoutMs ?? settings.timeoutMs;
  const output = options.output;
  const signal = options.signal;
  const session = req.sessionId ? getActiveSession(req.sessionId) : undefined;
  const sessionAllow = session?.sessionAllow;

  // Refuse markdown/prose before ask UI or auto-approve (model dumped a plan).
  const shellCheck = checkShellCommand(req.command);
  if (!shellCheck.ok) {
    output?.appendLine(
      `terminal-agent: DENIED (not shell): ${req.command.slice(0, 200)}\n  ${shellCheck.reason}`,
    );
    void appendAuditLog({
      at: new Date().toISOString(),
      action: 'deny',
      command: req.command,
      reason: shellCheck.reason,
      cwd,
    });
    return {
      exitCode: 1,
      stdout: '',
      stderr: shellCheck.reason,
      denied: true,
    };
  }

  let decision = evaluateCommandPolicy(
    req.command,
    policy,
    undefined,
    sessionAllow,
  );
  const autoShell = shouldAutoApproveShell();
  const forceSandboxOff = shouldForceOsSandboxOff();
  // Auto-run tools / allow-all: approve non-catastrophic commands (ALWAYS_DENY still wins).
  // Never auto-approve non-shell (already denied above).
  if (
    autoShell &&
    decision.action !== 'run' &&
    !isDangerousCommand(req.command)
  ) {
    decision = { action: 'run' };
    output?.appendLine(
      `terminal-agent: auto-approve shell — ${req.command}`,
    );
  }
  // Ask every time: confirm even when policy says run.
  if (
    shouldForceShellConfirm() &&
    decision.action === 'run' &&
    !isDangerousCommand(req.command)
  ) {
    decision = { action: 'ask', reason: 'permission mode: ask every time' };
  }
  if (decision.action === 'deny') {
    const msg = decision.reason ?? 'Command denied by policy.';
    output?.appendLine(`terminal-agent: DENIED: ${req.command}\n  ${msg}`);
    void appendAuditLog({
      at: new Date().toISOString(),
      action: 'deny',
      command: req.command,
      reason: msg,
      cwd,
    });
    return { exitCode: 1, stdout: '', stderr: msg, denied: true };
  }

  if (decision.action === 'ask') {
    const badge = settings.showPolicyBadge
      ? formatPolicyBadge(settings, {
          cwd,
          policy,
          allowlistTier: settings.allowlistTier,
          sessionId: req.sessionId,
          sessionAllowCount: sessionAllow?.length,
        })
      : '';
    const hint = decision.reason ? `\n(${decision.reason})` : '';

    const consentDecision: ToolConsentDecision = await requestToolConsent(
      req.sessionId || '',
      {
        title: 'Terminal Agent wants to run',
        hint: decision.reason ? decision.reason : undefined,
        commandPreview: req.command.slice(0, 400),
        badge,
        allowSessionEnabled: !!session,
        terminalRunEnabled: true,
      },
      signal,
    );

    if (!consentDecision || consentDecision === 'reject') {
      output?.appendLine(`terminal-agent: rejected: ${req.command}`);
      void appendAuditLog({
        at: new Date().toISOString(),
        action: 'reject',
        command: req.command,
        cwd,
      });
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'rejected by user',
        denied: true,
      };
    }
    if (consentDecision === 'allowSession' && req.sessionId) {
      const pattern = deriveSessionAllowPattern(req.command);
      if (pattern) {
        addSessionAllowPattern(req.sessionId, pattern);
        output?.appendLine(
          `terminal-agent: session allow += ${pattern}`,
        );
      }
    }
    if (consentDecision === 'terminalRun') {
      void appendAuditLog({
        at: new Date().toISOString(),
        action: 'ask',
        command: req.command,
        reason: 'integrated-terminal',
        cwd,
      });
      return runInIntegratedTerminal(req.command, cwd, output);
    }
  }

  const osSandbox: OsSandboxMode = forceSandboxOff ? 'off' : settings.osSandbox;
  const failClosed = forceSandboxOff ? false : settings.osSandboxFailClosed;
  const remote = isRemoteWorkspace();
  void appendAuditLog({
    at: new Date().toISOString(),
    action: decision.action === 'run' ? 'run' : 'ask',
    command: req.command,
    cwd,
    reason: remote
      ? 'remote-workspace-host'
      : forceSandboxOff
        ? 'allow-all-unsandboxed'
        : autoShell
          ? 'auto-run-tools'
          : osSandbox !== 'off'
            ? `osSandbox=${osSandbox}`
            : undefined,
  });

  // ui-kind + Remote SSH: never spawn /bin/bash on the laptop (ENOENT / wrong host).
  if (remote) {
    return execOnWorkspaceHost(req.command, {
      cwd,
      timeoutMs,
      output,
    });
  }

  return execCaptured(
    req.command,
    cwd,
    timeoutMs,
    output,
    osSandbox,
    failClosed,
  );
}

function runInIntegratedTerminal(
  command: string,
  cwd: string | undefined,
  output: vscode.OutputChannel | undefined,
): TerminalToolResult {
  const term =
    vscode.window.activeTerminal ||
    vscode.window.createTerminal({
      name: 'Spockify Agent',
      cwd,
    });
  term.show();
  term.sendText(command);
  output?.appendLine(`terminal-agent: sent to terminal: ${command}`);
  return {
    exitCode: 0,
    stdout: '(running in integrated terminal — output not captured)',
    stderr: '',
  };
}

function execCaptured(
  command: string,
  cwd: string | undefined,
  timeoutMs: number,
  output: vscode.OutputChannel | undefined,
  osSandbox: OsSandboxMode = 'off',
  failClosed = false,
): Promise<TerminalToolResult & { sandboxNote?: string }> {
  return new Promise((resolve) => {
    // Local workspace only — callers must route Remote SSH via execOnWorkspaceHost.
    const plan = planOsSandbox({
      mode: osSandbox,
      cwd,
      command,
      enabled: process.platform === 'linux',
      failClosed,
    });
    if (plan.blocked) {
      output?.appendLine(`terminal-agent: blocked [${plan.note}]`);
      resolve({
        exitCode: 1,
        stdout: '',
        stderr: plan.note,
        denied: true,
        sandboxNote: plan.note,
      });
      return;
    }
    output?.appendLine(
      `terminal-agent: exec: ${command}${plan.note !== 'unsandboxed' ? ` [${plan.note}]` : ''}`,
    );
    const shell = resolveLocalShell();
    const usePlainShell =
      plan.mode === 'off' && !plan.file.includes('bwrap');
    const spawnFile = usePlainShell ? shell : plan.file;
    const spawnArgs = usePlainShell ? ['-lc', command] : plan.args;
    const child = cp.spawn(spawnFile, spawnArgs, {
      cwd: plan.mode === 'workspace' ? undefined : cwd,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: TerminalToolResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
      finish({
        exitCode: 124,
        stdout: stdout.slice(0, 50_000),
        stderr: `${stderr}\n(timeout after ${timeoutMs}ms)`.slice(0, 20_000),
      });
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      output?.append(s);
    });
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      output?.append(s);
    });
    child.on('close', (code) => {
      finish({
        exitCode: code ?? 1,
        stdout: stdout.slice(0, 50_000),
        stderr: stderr.slice(0, 20_000),
        sandboxNote: plan.note !== 'unsandboxed' ? plan.note : undefined,
      });
    });
    child.on('error', (err) => {
      const hint =
        /ENOENT/i.test(err.message) && /bash|spawn/i.test(err.message)
          ? ' — shell missing on this host; set SHELL or install bash/sh'
          : '';
      finish({
        exitCode: 127,
        stdout,
        stderr: `${err.message}${hint}`,
        sandboxNote: plan.note !== 'unsandboxed' ? plan.note : undefined,
      });
    });
  });
}
