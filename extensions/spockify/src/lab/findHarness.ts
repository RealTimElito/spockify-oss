/**
 * Locate spockify-lab-agents the same way the CLI does (wrapper → package → PATH).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

export type LabHarnessLaunch =
  | { kind: 'wrapper'; path: string }
  | { kind: 'pythonModule'; python: string; pkgRoot: string }
  | { kind: 'pathBin'; bin: string };

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function hasPkg(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'spockify_lab_agents', '__main__.py'));
}

function fromRoot(root: string): LabHarnessLaunch | undefined {
  const wrapper = path.join(root, 'scripts', 'spockify-lab-agents');
  if (isExecutable(wrapper) || fs.existsSync(wrapper)) {
    return { kind: 'wrapper', path: wrapper };
  }
  const pkg = path.join(root, 'packages', 'spockify-lab-agents');
  if (hasPkg(pkg)) {
    return {
      kind: 'pythonModule',
      python: process.env.PYTHON || 'python3',
      pkgRoot: pkg,
    };
  }
  return undefined;
}

function walkUpForRepo(start: string, max = 8): LabHarnessLaunch | undefined {
  let cur = path.resolve(start);
  for (let i = 0; i < max; i++) {
    const hit = fromRoot(cur);
    if (hit) return hit;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

/**
 * Resolve harness entry for the current IDE session.
 * Prefer workspace / extension monorepo layout, then ~/agentHub twin paths.
 */
export function resolveLabHarness(
  extensionPath: string,
  cwd?: string,
): LabHarnessLaunch | undefined {
  const cfg = vscode.workspace.getConfiguration('spockify');
  const override = (cfg.get<string>('lab.harnessRoot') || '').trim();
  if (override) {
    const hit = fromRoot(override);
    if (hit) return hit;
  }

  if (cwd) {
    const hit = walkUpForRepo(cwd);
    if (hit) return hit;
  }

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const hit = walkUpForRepo(folder.uri.fsPath);
    if (hit) return hit;
  }

  // extensions/spockify → repo root when running from the monorepo / VSIX built in-tree
  const fromExt = walkUpForRepo(extensionPath);
  if (fromExt) return fromExt;

  for (const cand of [
    path.join(os.homedir(), 'agentHub'),
    '/home/lab/agentHub',
    '/workspace/spockify',
  ]) {
    const hit = fromRoot(cand);
    if (hit) return hit;
  }

  // Last resort: installed console scripts
  return { kind: 'pathBin', bin: 'spockify-lab-agents' };
}

export function buildLabHarnessArgv(
  launch: LabHarnessLaunch,
  harnessArgs: string[],
): { command: string; args: string[]; envExtra: Record<string, string> } {
  if (launch.kind === 'wrapper') {
    return { command: launch.path, args: harnessArgs, envExtra: {} };
  }
  if (launch.kind === 'pythonModule') {
    return {
      command: launch.python,
      args: ['-m', 'spockify_lab_agents', ...harnessArgs],
      envExtra: {
        PYTHONPATH:
          launch.pkgRoot +
          (process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ''),
      },
    };
  }
  return { command: launch.bin, args: harnessArgs, envExtra: {} };
}
