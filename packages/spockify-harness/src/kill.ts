import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import {
  isolatedSpawn,
  isolationRequested,
  sanitizeIsolateEnv,
} from './isolate';
import { admitJob, releaseJob } from './job';

/**
 * Kill registry: track in-flight tool processes and cascade AbortSignal.
 * Phase 1 control plane — process-group SIGTERM then SIGKILL.
 */
export class KillRegistry {
  private readonly procs = new Map<string, ChildProcess>();
  private readonly children = new Map<string, Set<string>>();

  track(id: string, child: ChildProcess, parentId?: string): void {
    this.procs.set(id, child);
    if (parentId) {
      const set = this.children.get(parentId) || new Set<string>();
      set.add(id);
      this.children.set(parentId, set);
    }
  }

  untrack(id: string): void {
    this.procs.delete(id);
    this.children.delete(id);
    for (const set of this.children.values()) set.delete(id);
  }

  /** Kill tool + cascaded children. Returns killed ids. */
  kill(id: string, signal: NodeJS.Signals = 'SIGTERM'): string[] {
    const killed: string[] = [];
    const cascade = (tid: string) => {
      const kids = this.children.get(tid);
      if (kids) {
        for (const k of [...kids]) cascade(k);
      }
      const proc = this.procs.get(tid);
      if (proc && !proc.killed) {
        try {
          if (proc.pid) {
            try {
              process.kill(-proc.pid, signal);
            } catch {
              proc.kill(signal);
            }
          } else {
            proc.kill(signal);
          }
        } catch {
          /* already dead */
        }
        killed.push(tid);
      }
      this.untrack(tid);
    };
    cascade(id);
    return killed;
  }

  killAll(signal: NodeJS.Signals = 'SIGTERM'): string[] {
    const ids = [...this.procs.keys()];
    const out: string[] = [];
    for (const id of ids) out.push(...this.kill(id, signal));
    return out;
  }
}

/** Spawn bash with detached process group for kill-cascade. */
export function spawnBashGroup(
  command: string,
  cwd: string,
  env?: NodeJS.ProcessEnv,
): ChildProcess {
  const rawEnv: NodeJS.ProcessEnv = { ...(env || process.env) };
  const useEnv = isolationRequested(rawEnv)
    ? sanitizeIsolateEnv(rawEnv)
    : rawEnv;
  const job = admitJob(cwd, useEnv);
  useEnv.SPOCKIFY_JOB_ID = job.job_id;
  let wrap;
  try {
    wrap = isolatedSpawn(command, cwd, useEnv);
  } catch (err) {
    releaseJob(job.job_id, cwd, useEnv);
    throw err;
  }
  const stdio: StdioOptions = ['ignore', 'pipe', 'pipe'];
  let seccompFd: number | undefined;
  try {
    if (wrap.seccompPath) {
      seccompFd = openSync(wrap.seccompPath, 'r');
      stdio.push(seccompFd);
    }
    const child = spawn(wrap.file, wrap.args, {
      cwd,
      env: useEnv,
      stdio,
      detached: true,
    });
    if (seccompFd !== undefined) {
      try {
        closeSync(seccompFd);
      } catch {
        /* child holds the dup */
      }
    }
    const done = () => {
      try {
        releaseJob(job.job_id, cwd, useEnv);
      } catch {
        /* persist best-effort */
      }
    };
    child.on('close', done);
    child.on('error', done);
    return child;
  } catch (err) {
    if (seccompFd !== undefined) {
      try {
        closeSync(seccompFd);
      } catch {
        /* already closed */
      }
    }
    releaseJob(job.job_id, cwd, useEnv);
    throw err;
  }
}
