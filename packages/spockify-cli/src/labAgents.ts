import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

/**
 * Resolve the private lab closed-loop harness entry (spockify-lab-agents).
 * Prefer repo wrapper, then PYTHONPATH package, then PATH.
 */
function repoRootFromHere(): string {
  // packages/spockify-cli/src|dist → repo root
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
  /** When true, run `models` subcommand. */
  modelsOnly?: boolean;
  extraArgs?: string[];
  /** Called with the spawned child so callers can SIGINT it. */
  onChild?: (child: ChildProcess) => void;
  /**
   * When set, tee stdout/stderr lines (inherit still prints) for live chrome.
   * Implies pipe+tee instead of raw inherit.
   */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  /** Extra env for the harness child (e.g. SPOCKIFY_LAB_*_THINK). */
  env?: Record<string, string | undefined>;
}

/**
 * Spawn lab-agents; inherits or tees stdio. Returns exit code.
 *
 * Phase 4: lab/IDE/CLI default tools via `@spockify/harness` / `runHarness`
 * (lab: lab-kernel-stdio / kernel_bridge). Tip-50 apply_writes/run_shell only
 * with SPOCKIFY_LAB_LEGACY_PYTHON_TOOLS=1 (`_archive/tip50/`).
 * Do not add a second TypeScript agent loop here.
 */
export function runLabAgents(opts: LabAgentsOpts): Promise<number> {
  const args: string[] = [];
  if (opts.modelsOnly) {
    args.push('models');
  } else if (opts.task) {
    args.push(opts.task);
  }
  // else: no positional → interactive lab-mode REPL (Python fallback)
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Live progress / SSE chunks must not sit in a pipe buffer.
    PYTHONUNBUFFERED: '1',
    ...opts.env,
  };
  for (const [k, v] of Object.entries(opts.env || {})) {
    if (v === undefined) delete env[k];
  }

  const tee = Boolean(opts.onLine);
  const spawnOpts = {
    stdio: (tee
      ? ['inherit', 'pipe', 'pipe']
      : 'inherit') as 'inherit' | ['inherit', 'pipe', 'pipe'],
    env,
  };

  return new Promise((resolve) => {
    let child: ChildProcess;
    if (fs.existsSync(wrapper)) {
      child = spawn(wrapper, args, spawnOpts);
    } else if (fs.existsSync(pkg)) {
      child = spawn(
        process.env.PYTHON || 'python3',
        ['-m', 'spockify_lab_agents', ...args],
        {
          ...spawnOpts,
          env: {
            ...env,
            PYTHONPATH:
              pkg + (process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ''),
          },
        },
      );
    } else {
      child = spawn('spockify-lab-agents', args, spawnOpts);
    }

    opts.onChild?.(child);

    if (tee && opts.onLine) {
      const wire = (
        stream: NodeJS.ReadableStream | null | undefined,
        which: 'stdout' | 'stderr',
      ) => {
        if (!stream) return;
        const dest = which === 'stdout' ? process.stdout : process.stderr;
        const rl = createInterface({ input: stream, crlfDelay: Infinity });
        rl.on('line', (line) => {
          dest.write(`${line}\n`);
          opts.onLine?.(line, which);
        });
      };
      wire(child.stdout, 'stdout');
      wire(child.stderr, 'stderr');
    }

    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      process.off('SIGINT', onSigInt);
      process.off('SIGTERM', onSigTerm);
      resolve(code);
    };

    const killChild = (sig: NodeJS.Signals) => {
      try {
        child.kill(sig);
      } catch {
        /* ignore */
      }
    };

    const onSigInt = () => {
      killChild('SIGINT');
      setTimeout(() => {
        killChild('SIGTERM');
        finish(130);
      }, 1500).unref?.();
    };
    const onSigTerm = () => {
      killChild('SIGTERM');
      finish(143);
    };

    // Top-level one-shot: forward Ctrl+C to the harness.
    // Lab REPL owns SIGINT and kills via onChild.
    if (!opts.onChild) {
      process.on('SIGINT', onSigInt);
      process.on('SIGTERM', onSigTerm);
    }

    child.on('error', (err) => {
      console.error(
        `lab-agents unavailable (${err.message}). ` +
          `Use ./scripts/spockify-lab-agents or: pip install -e packages/spockify-lab-agents`,
      );
      finish(127);
    });
    child.on('close', (code, signal) => {
      if (signal === 'SIGINT' || signal === 'SIGTERM') {
        finish(signal === 'SIGINT' ? 130 : 143);
        return;
      }
      finish(code ?? 1);
    });
  });
}
