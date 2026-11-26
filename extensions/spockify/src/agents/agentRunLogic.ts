/** Pure agent-run helpers (no vscode) — tree UI wraps these in agentRunUi.ts. */

import type {
  AgentRun,
  AgentRunEvent,
  AgentWorker,
  AgentWorkerState,
} from '@spockify/ide-client';

export const AGENT_POLL_MS = 1500;
export const AGENT_POLL_SYNTH_MS = 2000;

function asPlainString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/**
 * Whitelist-copy a single worker into plain, structured-clone-safe data.
 *
 * `AgentWorker`/`AgentRun` both declare `[key: string]: unknown` so the
 * remote API can grow fields without a client release — but that same
 * escape hatch means anything the server (or a future client mutation)
 * attaches to these objects rides along uninspected. Any run/worker data
 * that crosses into a `vscode.TreeItem`, `vscode.window.show*Message`, or a
 * webview `postMessage` must be plain JSON-safe data, or the extension host
 * <-> renderer boundary throws "An object could not be cloned." This copy
 * guarantees that regardless of what the transport handed us.
 */
const WORKER_STATES = new Set<AgentWorkerState>([
  'pending',
  'running',
  'done',
  'failed',
  'cancelled',
]);

/**
 * Router `/spockify/agents/runs` workers use `status` + `output`/`preview`.
 * The IDE client type historically used `state` + `result`. Accept either so
 * sanitize never drops live progress (the 0.8.6 "forever queued" bug).
 */
export function coerceWorkerState(worker: AgentWorker): AgentWorkerState | undefined {
  const raw = worker as Record<string, unknown>;
  const candidates = [worker?.state, raw.status];
  for (const c of candidates) {
    if (typeof c === 'string' && WORKER_STATES.has(c as AgentWorkerState)) {
      return c as AgentWorkerState;
    }
  }
  return undefined;
}

export function coerceWorkerResult(worker: AgentWorker): string | undefined {
  const raw = worker as Record<string, unknown>;
  return (
    asPlainString(worker?.result) ??
    asPlainString(raw.output) ??
    asPlainString(raw.preview)
  );
}

export function sanitizeAgentWorker(worker: AgentWorker): AgentWorker {
  const safe: AgentWorker = {
    id: asPlainString(worker?.id) ?? '',
  };
  const name = asPlainString(worker?.name);
  if (name !== undefined) safe.name = name;
  const prompt = asPlainString(worker?.prompt);
  if (prompt !== undefined) safe.prompt = prompt;
  const model = asPlainString(worker?.model);
  if (model !== undefined) safe.model = model;
  const state = coerceWorkerState(worker);
  if (state !== undefined) safe.state = state;
  const result = coerceWorkerResult(worker);
  if (result !== undefined) safe.result = result;
  const error = asPlainString(worker?.error);
  if (error !== undefined) safe.error = error;
  // Preserve timestamps used by the Agents panel elapsed clock.
  const raw = worker as Record<string, unknown>;
  for (const key of ['started_at', 'finished_at', 'created_at', 'updated_at'] as const) {
    const v = asPlainString(raw[key]);
    if (v !== undefined) safe[key] = v;
  }
  return safe;
}

/**
 * Whitelist-copy an `AgentRun` into plain, structured-clone-safe data.
 * See {@link sanitizeAgentWorker} for why this exists.
 */
export function sanitizeAgentRun(run: AgentRun): AgentRun {
  const safe: AgentRun = {
    id: asPlainString(run?.id) ?? '',
    status:
      run?.status === 'pending' ||
      run?.status === 'running' ||
      run?.status === 'synthesizing' ||
      run?.status === 'done' ||
      run?.status === 'failed' ||
      run?.status === 'cancelled'
        ? run.status
        : 'pending',
  };
  const parentPrompt = asPlainString(run?.parent_prompt);
  if (parentPrompt !== undefined) safe.parent_prompt = parentPrompt;
  const model = asPlainString(run?.model);
  if (model !== undefined) safe.model = model;
  if (Array.isArray(run?.workers)) {
    safe.workers = run.workers.map(sanitizeAgentWorker);
  }
  const synthesis = asPlainString(run?.synthesis);
  if (synthesis !== undefined) safe.synthesis = synthesis;
  const createdAt = asPlainString(run?.created_at);
  if (createdAt !== undefined) safe.created_at = createdAt;
  const updatedAt = asPlainString(run?.updated_at);
  if (updatedAt !== undefined) safe.updated_at = updatedAt;
  const error = asPlainString(run?.error);
  if (error !== undefined) safe.error = error;
  return safe;
}

export function sanitizeAgentRuns(runs: AgentRun[]): AgentRun[] {
  return Array.isArray(runs) ? runs.map(sanitizeAgentRun) : [];
}

const AGENT_RUN_EVENT_TYPES = new Set([
  'run_created',
  'run_status',
  'worker_status',
  'tool_start',
  'tool_result',
  'fork_created',
  'heartbeat',
  'error',
]);

/**
 * Whitelist-copy an `AgentRunEvent` (from the `/agents/runs/{id}/events` SSE
 * feed) before it crosses into the Agents webview via `postMessage` — same
 * rationale as {@link sanitizeAgentRun}: the wire payload is JSON (so
 * already plain), but this is the one place a hand-built event could pick
 * up something non-plain, and it's cheap insurance against the exact bug
 * class this module exists to close.
 */
export function sanitizeAgentRunEvent(ev: AgentRunEvent): AgentRunEvent {
  const safe: AgentRunEvent = {
    type: AGENT_RUN_EVENT_TYPES.has(ev?.type) ? ev.type : 'heartbeat',
  };
  const runId = asPlainString(ev?.run_id);
  if (runId !== undefined) safe.run_id = runId;
  const workerId = asPlainString(ev?.worker_id);
  if (workerId !== undefined) safe.worker_id = workerId;
  const childId = asPlainString(ev?.child_id);
  if (childId !== undefined) safe.child_id = childId;
  const status = asPlainString(ev?.status);
  if (status !== undefined) safe.status = status;
  if (ev?.run && typeof ev.run === 'object') {
    safe.run = sanitizeAgentRun(ev.run);
  }
  const tool = asPlainString(ev?.tool);
  if (tool !== undefined) safe.tool = tool;
  const query = asPlainString(ev?.query);
  if (query !== undefined) safe.query = query;
  const url = asPlainString(ev?.url);
  if (url !== undefined) safe.url = url;
  if (typeof ev?.ok === 'boolean') safe.ok = ev.ok;
  const preview = asPlainString(ev?.preview);
  if (preview !== undefined) safe.preview = preview;
  const error = asPlainString(ev?.error);
  if (error !== undefined) safe.error = error;
  const ts = asPlainString(ev?.ts);
  if (ts !== undefined) safe.ts = ts;
  return safe;
}

export function isRunBusy(status: AgentRun['status']): boolean {
  return (
    status === 'pending' ||
    status === 'running' ||
    status === 'synthesizing'
  );
}

export function anyRunBusy(runs: AgentRun[]): boolean {
  return runs.some((r) => isRunBusy(r.status));
}

export function pollIntervalForRuns(runs: AgentRun[]): number {
  const busy = runs.filter((r) => isRunBusy(r.status));
  if (!busy.length) {
    return AGENT_POLL_MS;
  }
  const onlySynth = busy.every((r) => r.status === 'synthesizing');
  return onlySynth ? AGENT_POLL_SYNTH_MS : AGENT_POLL_MS;
}

export function countWorkers(workers: AgentWorker[] | undefined): {
  done: number;
  failed: number;
  total: number;
  active: number;
  cancelled: number;
} {
  const list = workers ?? [];
  let done = 0;
  let failed = 0;
  let active = 0;
  let cancelled = 0;
  for (const w of list) {
    if (w.state === 'done') {
      done++;
    } else if (w.state === 'failed') {
      failed++;
    } else if (w.state === 'cancelled') {
      cancelled++;
    } else if (w.state === 'running' || w.state === 'pending') {
      active++;
    }
  }
  return { done, failed, total: list.length, active, cancelled };
}

export function synthesisTeaser(
  text: string | undefined,
  maxLen = 48,
): string | undefined {
  const t = text?.trim();
  if (!t) {
    return undefined;
  }
  const first = t.split(/\r?\n/).find((l) => l.trim())?.trim() || t;
  return first.length > maxLen ? `${first.slice(0, maxLen - 1)}…` : first;
}

export function runProgressDescription(
  run: AgentRun,
  opts?: { cancelling?: boolean },
): string {
  if (opts?.cancelling) {
    return 'stopping…';
  }
  const { done, failed, total, active } = countWorkers(run.workers);
  const parts: string[] = [];
  if (total > 0) {
    parts.push(`${done}/${total}`);
    if (failed > 0) {
      parts.push(`${failed}✗`);
    }
    if (active > 0 && isRunBusy(run.status)) {
      parts.push(`${active} live`);
    }
  }
  if (run.status === 'synthesizing') {
    parts.push('synthesis…');
    const teaser = synthesisTeaser(run.synthesis, 36);
    if (teaser) {
      parts.push(teaser);
    }
  } else if (run.status === 'done') {
    parts.push('done');
    const teaser = synthesisTeaser(run.synthesis, 40);
    if (teaser) {
      parts.push(teaser);
    }
  } else if (run.status === 'cancelled') {
    parts.push('stopped');
  } else if (run.status === 'failed') {
    parts.push('failed');
    const err = synthesisTeaser(run.error, 36);
    if (err) {
      parts.push(err);
    }
  } else {
    parts.push(run.status);
  }
  return parts.join(' · ');
}

export function workerProgressDescription(worker: AgentWorker): string {
  const state: AgentWorkerState | 'pending' = worker.state || 'pending';
  if (state === 'failed') {
    const err = worker.error?.trim();
    return err
      ? err.length > 48
        ? `${err.slice(0, 45)}…`
        : err
      : 'failed';
  }
  if (state === 'done') {
    const text = worker.result?.trim();
    if (!text) {
      return 'done';
    }
    const first = text.split(/\r?\n/).find((l) => l.trim())?.trim();
    if (first) {
      return first.length > 56 ? `${first.slice(0, 53)}…` : first;
    }
    return `${text.length} chars`;
  }
  if (state === 'running') {
    const partial = worker.result?.trim();
    if (partial) {
      return `streaming · ${partial.length} chars`;
    }
    return 'running…';
  }
  if (state === 'cancelled') {
    return 'stopped';
  }
  return 'queued';
}

export function buildRunMarkdown(run: AgentRun): string {
  const workers = (run.workers || [])
    .map((w) => {
      const body = w.result || w.error || w.prompt || '_empty_';
      return `### ${w.name || w.id} (\`${w.state || 'pending'}\`)\n\n${body}`;
    })
    .join('\n\n');
  const sections = [
    `# Agent run \`${run.id}\``,
    '',
    `| | |`,
    `|--|--|`,
    `| **Status** | ${run.status} |`,
    run.model ? `| **Model** | \`${run.model}\` |` : '',
    run.created_at ? `| **Created** | ${run.created_at} |` : '',
    run.error ? `| **Error** | ${run.error} |` : '',
    '',
    '## Parent prompt',
    '',
    run.parent_prompt?.trim() || '_none_',
    '',
    '## Workers',
    '',
    workers || '_none_',
    '',
    '## Synthesis',
    '',
    run.synthesis?.trim() || '_pending or none_',
  ].filter((line) => line !== '');
  return sections.join('\n');
}

/** 0-based line index of the `## Synthesis` heading. */
export function synthesisHeadingLine(markdown: string): number | undefined {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '## Synthesis') {
      return i;
    }
  }
  return undefined;
}

export function shouldExpandRun(run: AgentRun): boolean {
  return (run.workers?.length ?? 0) > 0 && isRunBusy(run.status);
}
