/** Agent run types — Wave 7 `/spockify/agents/runs` (via spockify.eu). */

export type AgentWorkerState =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'cancelled';

export type AgentRunStatus =
  | 'pending'
  | 'running'
  | 'synthesizing'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface AgentWorker {
  id: string;
  name?: string;
  prompt?: string;
  model?: string;
  state?: AgentWorkerState;
  result?: string;
  error?: string;
  [key: string]: unknown;
}

export interface AgentRun {
  id: string;
  status: AgentRunStatus;
  parent_prompt?: string;
  model?: string;
  workers?: AgentWorker[];
  synthesis?: string;
  created_at?: string;
  updated_at?: string;
  error?: string;
  [key: string]: unknown;
}

export interface CreateAgentRunRequest {
  parent_prompt: string;
  model?: string;
  workers?: Array<{
    id?: string;
    name?: string;
    prompt?: string;
    model?: string;
  }>;
  synthesize?: boolean;
}

export interface ListAgentRunsResponse {
  runs?: AgentRun[];
  items?: AgentRun[];
  [key: string]: unknown;
}

/**
 * One event from `/spockify/agents/runs/{id}/events` (SSE). Coarse-grained
 * today: `run_created`/`run_status`/`worker_status` are full-run/worker
 * snapshots at status transitions (pending → running → done, etc.), not
 * token-by-token deltas — the router calls the worker's model
 * non-streaming, so per-token "live thoughts" aren't available yet without
 * a deeper backend change. `tool_start`/`tool_result` ARE real, live
 * events around the shared search/browse tools a worker uses.
 */
export interface AgentRunEvent {
  type:
    | 'run_created'
    | 'run_status'
    | 'worker_status'
    | 'tool_start'
    | 'tool_result'
    | 'fork_created'
    | 'heartbeat'
    | 'error';
  run_id?: string;
  worker_id?: string;
  child_id?: string;
  status?: string;
  run?: AgentRun;
  tool?: string;
  query?: string;
  url?: string;
  ok?: boolean;
  preview?: string;
  error?: string;
  ts?: string;
  [key: string]: unknown;
}
