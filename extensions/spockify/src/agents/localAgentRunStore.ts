/**
 * In-memory store for IDE-local agent runs (`local-*` ids).
 *
 * Shell-parallel runners (ping/curl/…) never hit the remote router — Open /
 * poll / SSE must not call `/spockify/agents/runs/{id}` for these ids.
 */

import type { AgentRun } from '@spockify/ide-client';

export function isLocalAgentRunId(runId: string | undefined | null): boolean {
  return typeof runId === 'string' && runId.startsWith('local-');
}

type Listener = (run: AgentRun) => void;

const runs = new Map<string, AgentRun>();
const listeners = new Map<string, Set<Listener>>();

/** Upsert a clone-safe snapshot; notifies per-run subscribers. */
export function upsertLocalAgentRun(run: AgentRun): AgentRun {
  const id = typeof run?.id === 'string' ? run.id : '';
  if (!id || !isLocalAgentRunId(id)) {
    throw new Error('upsertLocalAgentRun requires a local-* run id');
  }
  const next: AgentRun = { ...run, id };
  runs.set(id, next);
  const subs = listeners.get(id);
  if (subs) {
    for (const fn of [...subs]) {
      try {
        fn(next);
      } catch {
        /* ignore */
      }
    }
  }
  return next;
}

export function getLocalAgentRun(runId: string): AgentRun | undefined {
  if (!isLocalAgentRunId(runId)) return undefined;
  return runs.get(runId);
}

export function listLocalAgentRuns(): AgentRun[] {
  return [...runs.values()].sort((a, b) => {
    const ta = a.updated_at || a.created_at || '';
    const tb = b.updated_at || b.created_at || '';
    return tb.localeCompare(ta);
  });
}

/** Subscribe to updates for one local run. Returns unsubscribe. */
export function subscribeLocalAgentRun(
  runId: string,
  fn: Listener,
): () => void {
  if (!isLocalAgentRunId(runId)) {
    return () => undefined;
  }
  let set = listeners.get(runId);
  if (!set) {
    set = new Set();
    listeners.set(runId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(runId);
  };
}

/** Test helper — clear store between cases. */
export function clearLocalAgentRuns(): void {
  runs.clear();
  listeners.clear();
}
