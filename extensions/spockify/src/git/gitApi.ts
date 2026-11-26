/**
 * Thin vscode.git API helpers for commit-message generation.
 *
 * Spockify is extensionKind:["ui"]. On Remote SSH, vscode.git runs in the
 * *workspace* host, so getExtension('vscode.git') is often undefined here.
 * We fall back to git CLI on the workspace host (local spawn or remoteExec).
 */

import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import { execOnWorkspaceHost } from '../terminal/remoteExec';
import { lastSignificantLine } from '../terminal/termOutput';
import { isRemoteWorkspace } from '../terminal/runTerminalTool';
import { formatCaughtError } from '../util/errors';
import {
  formatGitCliFailure,
  isGitDiffDirtyExit,
} from './gitCliErrors';

const execFileAsync = promisify(execFile);

/** Minimal Git extension API surface we need. */
export interface GitInputBox {
  value: string;
}

export interface GitChange {
  uri: vscode.Uri;
  status?: number;
}

export interface GitRepositoryState {
  HEAD?: { name?: string; commit?: string };
  indexChanges: GitChange[];
  workingTreeChanges: GitChange[];
  untrackedChanges?: GitChange[];
}

export interface GitRepository {
  rootUri: vscode.Uri;
  inputBox: GitInputBox;
  state: GitRepositoryState;
  status?(): Promise<void>;
  diff(cached?: boolean): Promise<string>;
}

export interface GitAPI {
  repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtensionExports {
  enabled: boolean;
  getAPI(version: number): GitAPI;
  onDidChangeEnablement?: vscode.Event<boolean>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Activate vscode.git when it is visible to this extension host.
 * Returns undefined on Remote SSH ui-host (git is workspace-only there).
 */
export async function getGitAPI(
  output?: vscode.OutputChannel,
): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!ext) {
    output?.appendLine(
      'git.commitMessage: vscode.git not visible in this host' +
        (vscode.env.remoteName
          ? ` (remote=${vscode.env.remoteName}; ui-kind cannot see workspace git)`
          : ''),
    );
    return undefined;
  }
  if (!ext.isActive) {
    try {
      await ext.activate();
    } catch (err) {
      output?.appendLine(
        `git.commitMessage: vscode.git activate failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
  }

  const exports = ext.exports;
  if (!exports) {
    return undefined;
  }

  if (!exports.enabled) {
    // Git may enable shortly after activate (model discovery).
    await Promise.race([
      new Promise<void>((resolve) => {
        const sub = exports.onDidChangeEnablement?.((on) => {
          if (on) {
            sub?.dispose();
            resolve();
          }
        });
        if (!sub) {
          resolve();
        }
      }),
      sleep(2500),
    ]);
  }

  if (!exports.enabled) {
    output?.appendLine('git.commitMessage: vscode.git present but disabled');
    return undefined;
  }

  try {
    return exports.getAPI(1);
  } catch (err) {
    output?.appendLine(
      `git.commitMessage: getAPI(1) failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return undefined;
  }
}

export function resolveRepository(
  api: GitAPI,
  rootUri?: vscode.Uri,
): GitRepository | undefined {
  if (rootUri) {
    const byUri = api.getRepository(rootUri);
    if (byUri) {
      return byUri;
    }
  }
  if (api.repositories.length === 1) {
    return api.repositories[0];
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active) {
    const byActive = api.getRepository(active);
    if (byActive) {
      return byActive;
    }
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (folder) {
    const byFolder = api.getRepository(folder);
    if (byFolder) {
      return byFolder;
    }
  }
  return api.repositories[0];
}

export interface GatheredDiff {
  diff: string;
  staged: boolean;
  branchName?: string;
  repoName?: string;
  recentSubjects: string[];
  /** When set without a GitRepository, message is applied via clipboard. */
  rootPath?: string;
}

async function gitExecLocal(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 8 * 1024 * 1024,
      encoding: 'utf8',
    });
    return typeof stdout === 'string' ? stdout : String(stdout);
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      message?: string;
    };
    const code = typeof e.code === 'number' ? e.code : Number(e.code);
    const stdout = typeof e.stdout === 'string' ? e.stdout : '';
    // git diff exits 1 when the tree is dirty — that is success for our purposes.
    if (Number.isFinite(code) && isGitDiffDirtyExit(args, code)) {
      return stdout;
    }
    throw new Error(
      formatGitCliFailure(args, {
        code: e.code,
        stdout,
        stderr: typeof e.stderr === 'string' ? e.stderr : '',
        message: e.message,
      }),
    );
  }
}

async function gitExecRemote(
  cwd: string,
  args: string[],
  output?: vscode.OutputChannel,
): Promise<string> {
  // Avoid shell injection: quote each arg for a remote bash script.
  // cwd is applied inside execOnWorkspaceHost (cd … && …).
  // preferFsBridge: deterministic stderr/exit via bash (not fish/zsh / SI OSC).
  const quoted = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  const cmd = `git ${quoted}`;
  output?.appendLine(
    `git.commitMessage: remote git ${args[0] || 'command'} cwd=${cwd}`,
  );
  const res = await execOnWorkspaceHost(cmd, {
    cwd,
    timeoutMs: 60_000,
    output,
    preferFsBridge: true,
  });
  const code = res.exitCode ?? 1;
  const stdout = res.stdout || '';
  const stderr = (res.stderr || '').trim();
  if (code !== 0 && !isGitDiffDirtyExit(args, code)) {
    output?.appendLine(
      `git.commitMessage: remote git exit ${code}` +
        (stderr ? ` stderr=${stderr.slice(0, 400)}` : '') +
        (!stderr && stdout.trim()
          ? ` stdout=${stdout.trim().slice(0, 400)}`
          : ''),
    );
  }
  if (code === 0) {
    return stdout;
  }
  // git diff exits 1 when dirty — treat as success (stdout may be empty).
  if (isGitDiffDirtyExit(args, code)) {
    return stdout;
  }
  // Non-zero: always fail with a non-empty message.
  throw new Error(
    formatGitCliFailure(args, {
      code,
      stdout,
      stderr: res.stderr,
    }),
  );
}

async function gitExec(
  cwd: string,
  args: string[],
  output?: vscode.OutputChannel,
): Promise<string> {
  if (isRemoteWorkspace()) {
    return gitExecRemote(cwd, args, output);
  }
  return gitExecLocal(cwd, args);
}

async function recentSubjects(
  cwd: string,
  limit = 8,
  output?: vscode.OutputChannel,
): Promise<string[]> {
  try {
    const out = await gitExec(cwd, ['log', `-${limit}`, '--pretty=format:%s'], output);
    return out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * SCM spark passes (rootUri, context, token). Title menu may forward a repo
 * object. Coerce anything Uri-like into a workspace path.
 */
export function coerceGitRootUri(input?: unknown): vscode.Uri | undefined {
  if (!input) {
    return undefined;
  }
  if (input instanceof vscode.Uri) {
    return input;
  }
  if (typeof input === 'string' && input.trim()) {
    try {
      return vscode.Uri.parse(input);
    } catch {
      return undefined;
    }
  }
  if (typeof input === 'object') {
    const obj = input as {
      fsPath?: unknown;
      scheme?: unknown;
      path?: unknown;
      rootUri?: unknown;
      provider?: { rootUri?: unknown };
    };
    if (obj.rootUri) {
      return coerceGitRootUri(obj.rootUri);
    }
    if (obj.provider?.rootUri) {
      return coerceGitRootUri(obj.provider.rootUri);
    }
    if (typeof obj.scheme === 'string' && typeof obj.path === 'string') {
      try {
        return vscode.Uri.from({
          scheme: obj.scheme,
          path: obj.path,
          authority:
            typeof (obj as { authority?: unknown }).authority === 'string'
              ? ((obj as { authority: string }).authority)
              : undefined,
        });
      } catch {
        /* fall through */
      }
    }
    if (typeof obj.fsPath === 'string' && obj.fsPath.trim()) {
      return vscode.Uri.file(obj.fsPath);
    }
  }
  return undefined;
}

function resolveWorkspaceGitRoot(
  rootUri?: unknown,
): { cwd: string; repoName: string } | undefined {
  const uri =
    coerceGitRootUri(rootUri) ||
    vscode.window.activeTextEditor?.document.uri ||
    vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!uri) {
    return undefined;
  }
  // Prefer the workspace folder that owns this URI (Remote SSH safe).
  let folder: vscode.Uri = uri;
  try {
    folder = vscode.workspace.getWorkspaceFolder(uri)?.uri || uri;
  } catch {
    folder = uri;
  }
  const cwd = folder.fsPath;
  if (!cwd) {
    return undefined;
  }
  return { cwd, repoName: basename(cwd) };
}

/**
 * Prefer staged diff; fall back to unstaged (+ untracked names).
 */
export async function gatherCommitDiff(
  repo: GitRepository,
  output?: vscode.OutputChannel,
): Promise<GatheredDiff | undefined> {
  try {
    await repo.status?.();
  } catch {
    /* best effort */
  }

  const cwd = repo.rootUri.fsPath;
  const repoName = basename(cwd);
  const branchName = repo.state.HEAD?.name;
  const subjects = await recentSubjects(cwd, 8, output);

  const indexCount = repo.state.indexChanges?.length ?? 0;
  const workCount =
    (repo.state.workingTreeChanges?.length ?? 0) +
    (repo.state.untrackedChanges?.length ?? 0);

  if (indexCount === 0 && workCount === 0) {
    // API state can lag — double-check via porcelain
    try {
      const status = await gitExec(cwd, ['status', '--porcelain'], output);
      if (!status.trim()) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }

  let staged = indexCount > 0;
  let diff = '';

  try {
    if (typeof repo.diff === 'function') {
      diff = staged ? await repo.diff(true) : await repo.diff(false);
    }
  } catch {
    diff = '';
  }

  if (!diff.trim()) {
    try {
      if (staged) {
        diff = await gitExec(cwd, ['diff', '--cached'], output);
      } else {
        diff = await gitExec(cwd, ['diff'], output);
      }
      // If we thought staged but empty, try unstaged
      if (staged && !diff.trim()) {
        staged = false;
        diff = await gitExec(cwd, ['diff'], output);
      }
    } catch {
      diff = '';
    }
  }

  // Append untracked file paths when using working tree
  if (!staged) {
    try {
      const untracked = await gitExec(
        cwd,
        ['ls-files', '--others', '--exclude-standard'],
        output,
      );
      const names = untracked
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length) {
        const listing =
          '\n\n# Untracked files:\n' +
          names.map((n) => `+ ${n}`).join('\n');
        diff = (diff || '') + listing;
      }
    } catch {
      /* ignore */
    }
  }

  if (!diff.trim()) {
    return undefined;
  }

  return {
    diff,
    staged,
    branchName,
    repoName,
    recentSubjects: subjects,
    rootPath: cwd,
  };
}

/**
 * Gather a commit diff without vscode.git (ui-kind Remote SSH fallback).
 */
export async function gatherCommitDiffFallback(
  rootUri?: unknown,
  output?: vscode.OutputChannel,
): Promise<GatheredDiff | undefined> {
  try {
    const root = resolveWorkspaceGitRoot(rootUri);
    if (!root) {
      output?.appendLine(
        'git.commitMessage: fallback could not resolve workspace git root',
      );
      return undefined;
    }
    const { cwd, repoName } = root;
    output?.appendLine(`git.commitMessage: fallback cwd=${cwd}`);

    try {
      const inside = lastSignificantLine(
        await gitExec(cwd, ['rev-parse', '--is-inside-work-tree'], output),
      );
      if (inside !== 'true') {
        output?.appendLine(
          `git.commitMessage: not a git work tree at ${cwd} (rev-parse=${JSON.stringify(inside)})`,
        );
        return undefined;
      }
    } catch (err) {
      const msg = formatCaughtError(err);
      output?.appendLine(
        `git.commitMessage: not a git work tree at ${cwd}: ${msg}`,
      );
      // Surface real remote-exec failures to the toast (not a soft "no changes").
      throw new Error(`workspace-host git failed: ${msg}`);
    }

    let branchName: string | undefined;
    try {
      branchName = lastSignificantLine(
        await gitExec(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], output),
      );
    } catch {
      branchName = undefined;
    }

    const subjects = await recentSubjects(cwd, 8, output);

    let staged = false;
    let diff = '';
    try {
      diff = await gitExec(cwd, ['diff', '--cached'], output);
      if (diff.trim()) {
        staged = true;
      } else {
        diff = await gitExec(cwd, ['diff'], output);
      }
    } catch (err) {
      const msg = formatCaughtError(err);
      output?.appendLine(`git.commitMessage: fallback diff failed: ${msg}`);
      throw new Error(`workspace-host git diff failed: ${msg}`);
    }

    if (!staged) {
      try {
        const untracked = await gitExec(
          cwd,
          ['ls-files', '--others', '--exclude-standard'],
          output,
        );
        const names = untracked
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (names.length) {
          diff =
            (diff || '') +
            '\n\n# Untracked files:\n' +
            names.map((n) => `+ ${n}`).join('\n');
        }
      } catch {
        /* ignore */
      }
    }

    if (!diff.trim()) {
      return undefined;
    }

    return {
      diff,
      staged,
      branchName,
      repoName,
      recentSubjects: subjects,
      rootPath: cwd,
    };
  } catch (err) {
    // Re-throw Errors we already formatted; wrap anything else.
    if (err instanceof Error && (err.message || '').trim()) {
      throw err;
    }
    throw new Error(
      `workspace-host git CLI fallback failed: ${formatCaughtError(err)}`,
    );
  }
}

/**
 * Fill the SCM commit message input. Never runs `git commit`.
 *
 * 1. vscode.git `repo.inputBox` when visible (local / workspace host)
 * 2. Workbench command `spockify.scm.setInputBoxValue` (Remote SSH ui-kind)
 * 3. Clipboard last resort
 */
export async function applyCommitMessage(
  message: string,
  repo?: GitRepository,
  rootUri?: vscode.Uri,
): Promise<'scm' | 'clipboard'> {
  const showScm = async () => {
    try {
      await vscode.commands.executeCommand('workbench.view.scm');
    } catch {
      /* ignore */
    }
  };

  if (repo?.inputBox) {
    repo.inputBox.value = message;
    await showScm();
    return 'scm';
  }

  // Workbench owns the SCM input even when vscode.git is invisible to ui-kind.
  try {
    const ok = await vscode.commands.executeCommand<boolean>(
      'spockify.scm.setInputBoxValue',
      message,
      rootUri ?? repo?.rootUri,
    );
    if (ok) {
      await showScm();
      return 'scm';
    }
  } catch {
    /* command missing on non-Spockify hosts */
  }

  await vscode.env.clipboard.writeText(message);
  await showScm();
  return 'clipboard';
}
