import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve the private lab closed-loop harness entry (spockify-lab-agents).
 * Prefer repo wrapper, then PYTHONPATH package, then PATH.
 */
function repoRootFromHere(): string {
  // packages/spockify-cli/src → repo root
  return path.resolve(__dirname, '../../..');
}

export interface LabAgentsOpts {
  task?: string;
  orch?: string;
  execModel?: string;
  workers?: number;
  maxRounds?: number;
  cwd?: string;
  baseUrl?: string;
  apiKey?: string;
  dryRun?: boolean;
  modelsOnly?: boolean;
  extraArgs?: string[];
}

/** Spawn lab-agents; inherits stdio. Returns exit code. */
export function runLabAgents(opts: LabAgentsOpts): Promise<number> {
  const args: string[] = [];
  if (opts.modelsOnly || !opts.task) {
    args.push('models');
  } else {
    args.push(opts.task);
  }
  if (opts.orch) args.push('--orch', opts.orch);
  if (opts.execModel) args.push('--exec', opts.execModel);
  if (opts.workers != null) args.push('--workers', String(opts.workers));
  if (opts.maxRounds != null) args.push('--max-rounds', String(opts.maxRounds));
  if (opts.cwd) args.push('--cwd', opts.cwd);
  if (opts.baseUrl) args.push('--base-url', opts.baseUrl);
  if (opts.apiKey) args.push('--api-key', opts.apiKey);
  if (opts.dryRun) args.push('--dry-run');
  if (opts.extraArgs?.length) args.push(...opts.extraArgs);

  const root = repoRootFromHere();
  const wrapper = path.join(root, 'scripts', 'spockify-lab-agents');
  const pkg = path.join(root, 'packages', 'spockify-lab-agents');

  return new Promise((resolve) => {
    let child;
    if (fs.existsSync(wrapper)) {
      child = spawn(wrapper, args, { stdio: 'inherit', env: process.env });
    } else if (fs.existsSync(pkg)) {
      child = spawn(
        process.env.PYTHON || 'python3',
        ['-m', 'spockify_lab_agents', ...args],
        {
          stdio: 'inherit',
          env: {
            ...process.env,
            PYTHONPATH:
              pkg + (process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ''),
          },
        },
      );
    } else {
      child = spawn('spockify-lab-agents', args, {
        stdio: 'inherit',
        env: process.env,
      });
    }
    child.on('error', (err) => {
      console.error(
        `lab-agents unavailable (${err.message}). ` +
          `Use ./scripts/spockify-lab-agents or: pip install -e packages/spockify-lab-agents`,
      );
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}
