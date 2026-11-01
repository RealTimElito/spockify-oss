/**
 * Plain, structured-clone-safe snapshots of agent runs for Chat UI cards.
 * Never pass TreeItems, class instances, or unsanitized API objects across
 * postMessage / executeCommand boundaries.
 */

export type AgentRunCardWorker = {
  id: string;
  name?: string;
  state?: string;
  prompt?: string;
};

export type AgentRunCardPayload = {
  runId: string;
  status: string;
  prompt?: string;
  model?: string;
  workers?: AgentRunCardWorker[];
  description?: string;
};

type Listener = (payload: AgentRunCardPayload) => void;
type TrackFn = (runId: string) => void;

let listener: Listener | undefined;
let trackFn: TrackFn | undefined;

export function setAgentRunChatListener(next: Listener | undefined): void {
  listener = next;
}

export function setAgentRunTrackListener(next: TrackFn | undefined): void {
  trackFn = next;
}

/** Publish a clone-safe card update to Chat (no-op if Chat not registered). */
export function publishAgentRunToChat(payload: AgentRunCardPayload): void {
  if (payload?.runId) {
    try {
      trackFn?.(payload.runId);
    } catch {
      /* ignore */
    }
  }
  if (!listener) return;
  try {
    listener(payload);
  } catch {
    /* chat listener must not break spawn */
  }
}

function workerStateOf(w: {
  state?: string;
  status?: string;
}): string | undefined {
  const s = w.state || w.status;
  return typeof s === 'string' ? s : undefined;
}

/** Build a whitelist payload from a sanitized AgentRun-like object. */
export function agentRunToCardPayload(run: {
  id?: string;
  status?: string;
  parent_prompt?: string;
  model?: string;
  synthesis?: string;
  error?: string;
  workers?: Array<{
    id?: string;
    name?: string;
    state?: string;
    status?: string;
    prompt?: string;
    result?: string;
  }>;
}): AgentRunCardPayload | undefined {
  const runId = typeof run?.id === 'string' ? run.id : '';
  if (!runId) return undefined;
  const workers = Array.isArray(run.workers)
    ? run.workers
        .filter((w) => typeof w?.id === 'string' && w.id)
        .map((w) => {
          const card: AgentRunCardWorker = { id: w.id as string };
          if (typeof w.name === 'string') card.name = w.name;
          const state = workerStateOf(w);
          if (state) card.state = state;
          if (typeof w.prompt === 'string') {
            card.prompt = w.prompt.trim().slice(0, 200);
          }
          return card;
        })
    : undefined;
  const payload: AgentRunCardPayload = {
    runId,
    status: typeof run.status === 'string' ? run.status : 'pending',
  };
  if (typeof run.parent_prompt === 'string' && run.parent_prompt.trim()) {
    payload.prompt = run.parent_prompt.trim().slice(0, 240);
  }
  if (typeof run.model === 'string') payload.model = run.model;
  if (workers?.length) payload.workers = workers;
  const active =
    workers?.filter((w) => w.state === 'running' || w.state === 'pending')
      .length ?? 0;
  const done = workers?.filter((w) => w.state === 'done').length ?? 0;
  const total = workers?.length ?? 0;
  const synth =
    typeof run.synthesis === 'string' ? run.synthesis.trim() : '';
  const err = typeof run.error === 'string' ? run.error.trim() : '';

  if (payload.status === 'done' && synth) {
    const first =
      synth.split(/\r?\n/).find((l) => l.trim())?.trim() || synth;
    payload.description =
      first.length > 140 ? `${first.slice(0, 137)}…` : first;
  } else if (
    (payload.status === 'failed' || payload.status === 'cancelled') &&
    (err || synth)
  ) {
    const bit = (err || synth).split(/\r?\n/).find((l) => l.trim())?.trim() || '';
    payload.description =
      bit.length > 140 ? `${bit.slice(0, 137)}…` : bit || payload.status;
  } else if (total > 0) {
    payload.description =
      active > 0
        ? `${active} worker${active === 1 ? '' : 's'} live · ${done}/${total} done`
        : `${done}/${total} workers done`;
  }
  return payload;
}
