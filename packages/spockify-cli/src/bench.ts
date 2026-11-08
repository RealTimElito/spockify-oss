import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { liteLlmBaseForApi } from './config';

function repoRootFromHere(): string {
  return path.resolve(__dirname, '../../..');
}

export interface BenchOpts {
  /** dry-run | smoke | swe | route | help */
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
  /** harness = @spockify/harness scored path; mini = mini-SWE legacy */
  driver?: string;
  /** route pack path for `bench route` */
  pack?: string;
  extraArgs?: string[];
}

function scriptPath(): string {
  return path.join(repoRootFromHere(), 'scripts', 'run-swebench.sh');
}

function routeScriptPath(): string {
  return path.join(repoRootFromHere(), 'scripts', 'bench', 'route_regret.py');
}

function cybergymScriptPath(): string {
  return path.join(repoRootFromHere(), 'scripts', 'run-cybergym.sh');
}

/** Spawn scripts/run-swebench.sh (or route_regret.py); inherits stdio. */
export function runBench(opts: BenchOpts): Promise<number> {
  if (opts.mode === 'kernel' || opts.mode === 'harness') {
    // Phase 5: kernel unit/smoke without touching board LiteLLM.
    const harnessPkg = path.join(repoRootFromHere(), 'packages', 'spockify-harness');
    return new Promise((resolve) => {
      const child = spawn('npm', ['test'], {
        stdio: 'inherit',
        cwd: harnessPkg,
        env: { ...process.env },
      });
      child.on('error', (err) => {
        console.error(`bench kernel failed: ${err.message}`);
        resolve(127);
      });
      child.on('close', (code) => resolve(code ?? 1));
    });
  }

  if (opts.mode === 'route') {
    const script = routeScriptPath();
    if (!fs.existsSync(script)) {
      console.error(`route script missing: ${script}`);
      return Promise.resolve(127);
    }
    const pack =
      opts.pack ||
      (opts.extraArgs?.find((_, i, a) => a[i - 1] === '--pack') ??
        path.join(repoRootFromHere(), 'packs', 'route-v1.json'));
    const args = [script, '--pack', pack];
    if (opts.output) args.push('--out', opts.output);
    return new Promise((resolve) => {
      const child = spawn('python3', args, {
        stdio: 'inherit',
        env: { ...process.env },
        cwd: repoRootFromHere(),
      });
      child.on('error', (err) => {
        console.error(`bench route failed to start: ${err.message}`);
        resolve(127);
      });
      child.on('close', (code) => resolve(code ?? 1));
    });
  }

  if (opts.mode === 'cybergym') {
    // Separate evaluation track (real-vulnerability reproduction, not
    // coding repair) — scripts/run-cybergym.sh, see docs/CYBERGYM.md.
    // The agent loop is runHarness plus an eval-only submit_poc tool.
    // It does not touch the SWE board.
    const script = cybergymScriptPath();
    if (!fs.existsSync(script)) {
      console.error(`cybergym script missing: ${script}`);
      return Promise.resolve(127);
    }
    const sub = opts.extraArgs?.[0] && !opts.extraArgs[0].startsWith('--') ? opts.extraArgs[0] : 'smoke';
    const rest = opts.extraArgs?.[0] && !opts.extraArgs[0].startsWith('--') ? opts.extraArgs.slice(1) : (opts.extraArgs ?? []);
    const base =
      opts.baseUrl != null && opts.baseUrl !== '' ? liteLlmBaseForApi(opts.baseUrl) : undefined;
    const args: string[] = [sub];
    if (base) args.push('--base-url', base);
    if (opts.apiKey) args.push('--api-key', opts.apiKey);
    if (opts.model) args.push('--model', opts.model);
    if (opts.output) args.push('--output', opts.output);
    args.push(...rest);
    return new Promise((resolve) => {
      const child = spawn(script, args, { stdio: 'inherit', env: { ...process.env } });
      child.on('error', (err) => {
        console.error(`bench cybergym failed to start: ${err.message}`);
        resolve(127);
      });
      child.on('close', (code) => resolve(code ?? 1));
    });
  }

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
  if (opts.driver) args.push('--driver', opts.driver);
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
                         [--driver harness|mini] [--output DIR]
                         [--dry-run] [--install]
  spockify bench route   [--pack packs/route-v1.json] [--output FILE]
                         Offline regret table vs always-20b / oracle
  spockify bench kernel  Run @spockify/harness test suite (no LiteLLM / no board steal)
  spockify bench cybergym [install|dry-run|smoke|task <id>] [--model ID] [--output DIR]
                         Real-vulnerability-reproduction eval (separate track from
                         SWE/pentest-eval). First run: 'spockify bench cybergym install'.
                         See docs/CYBERGYM.md.

Defaults: subset=lite, slice=0:1, workers=1, model=gpt-oss-20b,
          driver=harness (@spockify/harness scored path; mini = legacy mini-SWE)
Twin: SPOCKIFY_LAB_HOST=… or SPOCKIFY_BASE_URL=http://<host>:30400
Docs: docs/BENCH.md · docs/HARNESS.md
`);
}
