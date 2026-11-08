/**
 * Run shell on the *workspace* host from a ui-kind extension.
 *
 * Spockify stays extensionKind:["ui"] so Chat/agents activate under Remote SSH
 * (see apps/spockify-ide/docs/REMOTE_SSH.md). Local child_process.spawn would
 * hit the laptop (often spawn /bin/bash ENOENT) — never do that when remote.
 *
 * Strategy:
 * 1) Prefer Terminal.shellIntegration.executeCommand (runs on remote PTY),
 *    unless preferFsBridge (git commit-message uses this — deterministic
 *    stdout/stderr/exit via a bash script file).
 * 2) Fallback: write a bash runner under .spockify/run/ and sendText it on a
 *    remote-integrated terminal (works even when user shell is fish/zsh).
 */

import * as vscode from 'vscode';
import { formatCaughtError } from '../util/errors';
import { shSingleQuote, stripTermSequences } from './termOutput';
import type { TerminalToolResult } from './types';

const AGENT_TERM_NAME = 'Spockify Agent';
const SHELL_INTEGRATION_WAIT_MS = 8_000;
const POLL_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { shSingleQuote } from './termOutput';

function getOrCreateAgentTerminal(cwd: string | undefined): vscode.Terminal {
  const existing = vscode.window.terminals.find(
    (t) => t.name === AGENT_TERM_NAME && t.exitStatus === undefined,
  );
  if (existing) {
    return existing;
  }
  return vscode.window.createTerminal({
    name: AGENT_TERM_NAME,
    cwd,
    hideFromUser: true,
  });
}

async function waitForShellIntegration(
  terminal: vscode.Terminal,
  timeoutMs: number,
): Promise<vscode.TerminalShellIntegration | undefined> {
  if (terminal.shellIntegration) {
    return terminal.shellIntegration;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(terminal.shellIntegration);
    }, timeoutMs);
    const sub = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal === terminal && e.shellIntegration) {
        clearTimeout(timer);
        sub.dispose();
        resolve(e.shellIntegration);
      }
    });
  });
}

async function execViaShellIntegration(
  command: string,
  cwd: string | undefined,
  timeoutMs: number,
  output: vscode.OutputChannel | undefined,
): Promise<TerminalToolResult | undefined> {
  const term = getOrCreateAgentTerminal(cwd);
  const integration = await waitForShellIntegration(
    term,
    SHELL_INTEGRATION_WAIT_MS,
  );
  if (!integration) {
    return undefined;
  }

  output?.appendLine(
    `terminal-agent: remote shellIntegration: ${command.slice(0, 200)}`,
  );

  // Subscribe before executeCommand — a fast exit is otherwise missed.
  let execution: vscode.TerminalShellExecution | undefined;
  let resolveExit!: (code: number | undefined) => void;
  const exitPromise = new Promise<number | undefined>((resolve) => {
    resolveExit = resolve;
  });
  const exitSub = vscode.window.onDidEndTerminalShellExecution((e) => {
    if (e.terminal !== term) {
      return;
    }
    if (execution && e.execution !== execution) {
      return;
    }
    exitSub.dispose();
    resolveExit(e.exitCode);
  });

  try {
    execution = integration.executeCommand(command);
  } catch (err) {
    exitSub.dispose();
    output?.appendLine(
      `terminal-agent: shellIntegration executeCommand failed: ${formatCaughtError(err)}`,
    );
    return undefined;
  }

  let stdout = '';

  const readPromise = (async () => {
    try {
      for await (const chunk of execution!.read()) {
        stdout += chunk;
        output?.append(chunk);
      }
    } catch {
      /* stream closed */
    }
  })();

  const timer = sleep(timeoutMs).then(() => 'timeout' as const);

  const winner = await Promise.race([
    Promise.all([readPromise, exitPromise]).then(([, code]) => ({
      kind: 'done' as const,
      code,
    })),
    timer,
  ]);

  exitSub.dispose();

  if (winner === 'timeout') {
    try {
      term.sendText('\x03', false); // Ctrl+C
    } catch {
      /* ignore */
    }
    return {
      exitCode: 124,
      stdout: stripTermSequences(stdout).slice(0, 50_000),
      stderr: `(timeout after ${timeoutMs}ms)`,
      sandboxNote: 'remote shellIntegration',
    };
  }

  return {
    exitCode: winner.code ?? 1,
    stdout: stripTermSequences(stdout).slice(0, 50_000),
    stderr: '',
    sandboxNote: 'remote shellIntegration',
  };
}

async function readUriText(uri: vscode.Uri): Promise<string> {
  try {
    const raw = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(raw).toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Deterministic remote exec: write a bash script via workspace.fs, run it with
 * `bash /path`, capture stdout/stderr/exit via sibling files.
 * Avoids fish/zsh login-shell syntax and shellIntegration OSC noise.
 */
async function execViaWorkspaceFsBridge(
  command: string,
  cwd: string | undefined,
  timeoutMs: number,
  output: vscode.OutputChannel | undefined,
): Promise<TerminalToolResult> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'No workspace folder open for remote exec',
      denied: true,
    };
  }

  const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = vscode.Uri.joinPath(folder.uri, '.spockify', 'run');
  try {
    await vscode.workspace.fs.createDirectory(tmpDir);
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `remote fs-bridge mkdir failed: ${formatCaughtError(err)}`,
      sandboxNote: 'remote fs-bridge',
    };
  }

  const stdoutUri = vscode.Uri.joinPath(tmpDir, `${id}.stdout`);
  const stderrUri = vscode.Uri.joinPath(tmpDir, `${id}.stderr`);
  const exitUri = vscode.Uri.joinPath(tmpDir, `${id}.exit`);
  const doneUri = vscode.Uri.joinPath(tmpDir, `${id}.done`);
  const scriptUri = vscode.Uri.joinPath(tmpDir, `${id}.sh`);

  const outP = shSingleQuote(stdoutUri.fsPath);
  const errP = shSingleQuote(stderrUri.fsPath);
  const exitP = shSingleQuote(exitUri.fsPath);
  const doneP = shSingleQuote(doneUri.fsPath);

  // Bash (not user fish/zsh): $? and : redirection are reliable.
  const script = [
    '#!/usr/bin/env bash',
    'set +e',
    `(${command}) >${outP} 2>${errP}`,
    'ec=$?',
    `printf '%s' "$ec" >${exitP}`,
    `: >${doneP}`,
    'exit "$ec"',
    '',
  ].join('\n');

  try {
    await vscode.workspace.fs.writeFile(scriptUri, Buffer.from(script, 'utf8'));
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `remote fs-bridge write script failed: ${formatCaughtError(err)}`,
      sandboxNote: 'remote fs-bridge',
    };
  }

  output?.appendLine(
    `terminal-agent: remote fs-bridge: ${command.slice(0, 200)}`,
  );

  let term: vscode.Terminal;
  try {
    term = getOrCreateAgentTerminal(cwd ?? folder.uri.fsPath);
    term.sendText(`bash ${shSingleQuote(scriptUri.fsPath)}`, true);
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `remote fs-bridge terminal failed: ${formatCaughtError(err)}`,
      sandboxNote: 'remote fs-bridge',
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await vscode.workspace.fs.stat(doneUri);
      break;
    } catch {
      await sleep(POLL_MS);
    }
  }

  let timedOut = false;
  try {
    await vscode.workspace.fs.stat(doneUri);
  } catch {
    timedOut = true;
  }

  const stdout = (await readUriText(stdoutUri)).slice(0, 50_000);
  const stderr = (await readUriText(stderrUri)).slice(0, 20_000);
  const exitRaw = (await readUriText(exitUri)).trim();
  const exitCode = timedOut
    ? 124
    : exitRaw !== '' && !Number.isNaN(Number(exitRaw))
      ? Number(exitRaw)
      : 1;

  // Best-effort cleanup of bridge artifacts.
  for (const uri of [stdoutUri, stderrUri, exitUri, doneUri, scriptUri]) {
    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      /* ignore */
    }
  }

  return {
    exitCode,
    stdout,
    stderr: timedOut
      ? `${stderr}\n(timeout after ${timeoutMs}ms)`.slice(0, 20_000)
      : stderr,
    sandboxNote: 'remote fs-bridge (bash script; ui-kind; no local spawn)',
  };
}

export interface ExecOnWorkspaceHostOptions {
  cwd?: string;
  timeoutMs: number;
  output?: vscode.OutputChannel;
  /**
   * Skip shellIntegration and use the bash script fs-bridge.
   * Prefer for git CLI (need real stderr + exit; avoid OSC / fish).
   */
  preferFsBridge?: boolean;
}

/**
 * Execute `command` on the Remote SSH (or other remote) workspace host.
 * Never throws — failures become exitCode/stderr on the result.
 */
export async function execOnWorkspaceHost(
  command: string,
  opts: ExecOnWorkspaceHostOptions,
): Promise<TerminalToolResult> {
  try {
    // Always cd in the command string: reused "Spockify Agent" terminals may
    // still be in $HOME / another folder, and shellIntegration does not reset cwd.
    const cwd = (opts.cwd || '').trim();
    const effective =
      cwd.length > 0 ? `cd ${shSingleQuote(cwd)} && (${command})` : command;

    if (!opts.preferFsBridge) {
      const viaSi = await execViaShellIntegration(
        effective,
        opts.cwd,
        opts.timeoutMs,
        opts.output,
      );
      if (viaSi) {
        return viaSi;
      }
    }

    return await execViaWorkspaceFsBridge(
      effective,
      opts.cwd,
      opts.timeoutMs,
      opts.output,
    );
  } catch (err) {
    const msg = formatCaughtError(err, 'remote exec failed');
    opts.output?.appendLine(`terminal-agent: remote exec error: ${msg}`);
    return {
      exitCode: 1,
      stdout: '',
      stderr: msg,
      sandboxNote: 'remote exec error',
    };
  }
}
