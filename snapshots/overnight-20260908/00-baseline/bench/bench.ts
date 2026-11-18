import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { liteLlmBaseForApi } from './config';

function repoRootFromHere(): string {
  return path.resolve(__dirname, '../../..');
}

export interface BenchOpts {
  /** dry-run | smoke | swe | help */
  mode: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  subset?: string;
  slice?: string;
  filter?: string;
  workers?: number;
  output?: string;
  dryRun?: boolean;
  install?: boolean;
  extraArgs?: string[];
}

function scriptPath(): string {
  return path.join(repoRootFromHere(), 'scripts', 'run-swebench.sh');
}

/** Spawn scripts/run-swebench.sh; inherits stdio. Returns exit code. */
export function runBench(opts: BenchOpts): Promise<number> {
  const script = scriptPath();
  if (!fs.existsSync(script)) {
    console.error(`bench script missing: ${script}`);
    return Promise.resolve(127);
  }

  const args: string[] = [opts.mode];
  const base =
    opts.baseUrl != null && opts.baseUrl !== ''
      ? liteLlmBaseForApi(opts.baseUrl)
      : undefined;
  if (base) args.push('--base-url', base);
  if (opts.apiKey) args.push('--api-key', opts.apiKey);
  if (opts.model) args.push('--model', opts.model);
  if (opts.subset) args.push('--subset', opts.subset);
  if (opts.slice) args.push('--slice', opts.slice);
  if (opts.filter) args.push('--filter', opts.filter);
  if (opts.workers != null) args.push('--workers', String(opts.workers));
  if (opts.output) args.push('--output', opts.output);
  if (opts.dryRun) args.push('--dry-run');
  if (opts.install) args.push('--install');
  if (opts.extraArgs?.length) args.push(...opts.extraArgs);

  return new Promise((resolve) => {
    const child = spawn(script, args, {
      stdio: 'inherit',
      env: { ...process.env },
    });
    child.on('error', (err) => {
      console.error(`bench failed to start: ${err.message}`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export function printBenchHelp(): void {
  console.log(`Spockify bench — coding evals against local LiteLLM

Usage:
  spockify bench dry-run [--model ID] [--base-url URL]
  spockify bench smoke   [--model ID] [--base-url URL]
  spockify bench swe     [--subset lite|verified] [--slice 0:1]
                         [--filter REGEX] [--workers 1] [--model ID]
                         [--output DIR] [--dry-run] [--install]

Defaults: subset=lite, slice=0:1, workers=1, model=gpt-oss-20b
Twin: SPOCKIFY_LAB_HOST=… or SPOCKIFY_BASE_URL=http://<host>:30400
Docs: docs/BENCH.md
`);
}
