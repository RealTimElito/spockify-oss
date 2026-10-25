/**
 * Agents Window rail: open tabs (including empty "New chat") then history.
 * Pure so the webview can render host-built rows without a second session store.
 */

export type AgentsRailSession = {
  id: string;
  title?: string;
};

export type SwarmRailState = 'running' | 'done' | 'failed' | 'cancelled';

/** One harness swarm worker already stored for a parent chat tab. */
export type SwarmRailWorker = {
  id: string;
  title: string;
  state: SwarmRailState;
  prompt?: string;
  error?: string;
  transcript?: string;
};

export type AgentsRailEntry = {
  id: string;
  title: string;
  active: boolean;
  streaming: boolean;
  kind?: 'chat' | 'swarm';
  state?: SwarmRailState;
  prompt?: string;
  error?: string;
  transcript?: string;
  parentId?: string;
  workerId?: string;
  cancellable?: boolean;
  statusLabel?: string;
};

/** Empty rail copy. A filter with no hits is not the same as a new window. */
export function agentsRailEmptyLabel(query: string, visible: number): string {
  if (visible > 0) return '';
  return query.trim() ? 'No matching chats.' : 'No chats yet.';
}

/** Cancel is shown as stopped. Failures keep the error text. */
export function swarmStatusLabel(
  state: SwarmRailState | undefined,
  error?: string,
): string {
  if (state === 'cancelled') return 'stopped';
  if (state === 'failed') return error?.trim() || 'failed';
  if (state === 'done') return 'done';
  if (state === 'running') return 'running';
  return 'running';
}

export function buildAgentsRail(input: {
  openTabIds: readonly string[];
  sessions: readonly AgentsRailSession[];
  currentSessionId: string;
  streamingTabIds: readonly string[];
  swarmByParent?: Readonly<Record<string, readonly SwarmRailWorker[]>>;
}): AgentsRailEntry[] {
  const byId = new Map<string, AgentsRailSession>();
  for (const row of input.sessions) {
    if (row?.id) byId.set(row.id, row);
  }
  const streaming = new Set(input.streamingTabIds);
  const seen = new Set<string>();
  const out: AgentsRailEntry[] = [];

  const pushSwarm = (parentId: string): void => {
    const list = input.swarmByParent?.[parentId] || [];
    for (const worker of list) {
      if (!worker?.id) continue;
      const id = `${parentId}::${worker.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        title: (worker.title || '').trim() || worker.id,
        active: false,
        streaming: worker.state === 'running',
        kind: 'swarm',
        state: worker.state,
        prompt: worker.prompt,
        error:
          worker.state === 'cancelled'
            ? worker.error?.trim() || 'stopped'
            : worker.error,
        transcript: worker.transcript,
        parentId,
        workerId: worker.id,
        cancellable: worker.state === 'running',
        statusLabel: swarmStatusLabel(worker.state, worker.error),
      });
    }
  };

  const push = (id: string): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const title = (byId.get(id)?.title || '').trim() || 'New chat';
    out.push({
      id,
      title,
      active: id === input.currentSessionId,
      streaming: streaming.has(id),
      kind: 'chat',
    });
    pushSwarm(id);
  };

  const open = input.openTabIds.length
    ? input.openTabIds
    : input.currentSessionId
      ? [input.currentSessionId]
      : [];
  for (const id of open) push(id);
  for (const row of input.sessions) push(row.id);
  if (input.currentSessionId) push(input.currentSessionId);
  return out;
}
