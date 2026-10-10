import { spawn, type ChildProcess } from 'node:child_process';

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
  return spawn('bash', ['-lc', command], {
    cwd,
    env: env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
}
