/**
 * Agents Window rail: open tabs (including empty "New chat") then history.
 * Pure so the webview can render host-built rows without a second session store.
 */

export type AgentsRailSession = {
  id: string;
  title?: string;
};

export type AgentsRailEntry = {
  id: string;
  title: string;
  active: boolean;
  streaming: boolean;
};

export function buildAgentsRail(input: {
  openTabIds: readonly string[];
  sessions: readonly AgentsRailSession[];
  currentSessionId: string;
  streamingTabIds: readonly string[];
}): AgentsRailEntry[] {
  const byId = new Map<string, AgentsRailSession>();
  for (const row of input.sessions) {
    if (row?.id) byId.set(row.id, row);
  }
  const streaming = new Set(input.streamingTabIds);
  const seen = new Set<string>();
  const out: AgentsRailEntry[] = [];

  const push = (id: string): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const title = (byId.get(id)?.title || '').trim() || 'New chat';
    out.push({
      id,
      title,
      active: id === input.currentSessionId,
      streaming: streaming.has(id),
    });
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
