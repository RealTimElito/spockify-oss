import { KillRegistry, spawnBashGroup } from './kill';
import { ToolRegistry } from './registry';
import type { ToolCallResult } from './types';

export type TaskKind = 'explore' | 'bash' | 'general';

const TOOL_SUBSETS: Record<TaskKind, Set<string>> = {
  explore: new Set(['read_file', 'read', 'grep', 'glob', 'glob_file_search']),
  bash: new Set(['shell', 'bash', 'run_tests']),
  general: new Set([
    'read_file',
    'read',
    'grep',
    'glob',
    'glob_file_search',
    'shell',
    'bash',
    'run_tests',
    'apply_patch',
    'edit_file',
    'write_file',
    'git_snapshot',
    'git_reset',
    'todowrite',
  ]),
};

/** Task tool is stripped from children — no recurse. */
export function childMayUseTool(kind: TaskKind, toolName: string): boolean {
  if (toolName === 'task') return false;
  return TOOL_SUBSETS[kind]?.has(toolName) ?? false;
}

export function filterChildRegistry(
  parent: ToolRegistry,
  kind: TaskKind,
): ToolRegistry {
  const out = new ToolRegistry();
  for (const t of parent.listAll()) {
    if (!childMayUseTool(kind, t.name)) continue;
    out.register(t, (args, ctx) => t.execute(args, ctx));
  }
  return out;
}

export type TaskAgentHandle = {
  id: string;
  kind: TaskKind;
  killRegistry: KillRegistry;
  abort: AbortController;
};

export function spawnTaskAgent(
  kind: TaskKind,
  parentKill?: KillRegistry,
): TaskAgentHandle {
  const id = `task_${kind}_${Date.now().toString(36)}`;
  const killRegistry = new KillRegistry();
  const abort = new AbortController();
  return { id, kind, killRegistry, abort };
}

/** Run a bash sub-task under the task kill registry (cascade test target). */
export function runTaskBash(
  handle: TaskAgentHandle,
  command: string,
  cwd: string,
  timeoutMs = 30_000,
): Promise<ToolCallResult> {
  return new Promise((resolve) => {
    const child = spawnBashGroup(command, cwd);
    const toolId = `${handle.id}_shell`;
    handle.killRegistry.track(toolId, child);
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      handle.killRegistry.kill(toolId, 'SIGKILL');
    }, timeoutMs);
    const onAbort = () => handle.killRegistry.kill(toolId, 'SIGTERM');
    handle.abort.signal.addEventListener('abort', onAbort);
    child.stdout?.on('data', (b: Buffer) => {
      out += b.toString('utf8');
    });
    child.stderr?.on('data', (b: Buffer) => {
      err += b.toString('utf8');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      handle.abort.signal.removeEventListener('abort', onAbort);
      handle.killRegistry.untrack(toolId);
      resolve({
        ok: !timedOut && (code ?? 1) === 0,
        content: timedOut
          ? 'blocked:timeout'
          : [`exit ${code ?? '?'}`, out, err].filter(Boolean).join('\n'),
        error: timedOut ? 'blocked:timeout' : code ? `exit ${code}` : undefined,
      });
    });
  });
}

/** Kill task → cascade inner shells (registry first so ids are still tracked). */
export function killTaskAgent(handle: TaskAgentHandle): string[] {
  const killed = handle.killRegistry.killAll('SIGKILL');
  if (!handle.abort.signal.aborted) handle.abort.abort();
  return killed;
}
