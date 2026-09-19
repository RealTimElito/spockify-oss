/**
 * Regression test for the "spawnFromPrompt failed: An object could not be
 * cloned." bug reported when spawning parallel agents (e.g. "have two
 * agents ping google.com, run in parallel").
 *
 * Root cause / fix, see extensions/spockify/src/agents/AgentsTreeProvider.ts
 * (spawnFromPrompt) and src/agents/agentRunLogic.ts (sanitizeAgentRun):
 *
 *  - `AgentRun`/`AgentWorker` both declare `[key: string]: unknown`, so
 *    anything the transport/router hands back (or a future code path
 *    attaches locally) can ride along uninspected into a
 *    `vscode.TreeItem`, `vscode.window.show*Message`, or a webview
 *    `postMessage` call. Those all cross the extension-host <-> renderer
 *    boundary, which uses the structured-clone algorithm: a non-plain
 *    value (class instance, function, Map/Set, circular ref, etc.)
 *    anywhere in that object graph throws exactly
 *    "An object could not be cloned."
 *  - Separately, `spawnFromPrompt` used to wrap BOTH the actual run
 *    creation AND best-effort UI polish (toast/tree-refresh/focus) in one
 *    try/catch, so *any* failure in the polish steps was misreported as
 *    "spawnFromPrompt failed" and discarded a run the router had already
 *    created (visible in the logs as a successful
 *    "status=pending" line immediately followed by "failed").
 *
 * This test proves, without needing a running Extension Host:
 *  1. `sanitizeAgentRun`/`sanitizeAgentRuns` turn a contaminated run/worker
 *     (functions, class instances, Maps, circular refs — the kinds of
 *     values that break structured clone) into something `structuredClone`
 *     (the same algorithm the extension host <-> renderer boundary uses)
 *     accepts, whereas the raw contaminated object is rejected by it.
 *  2. The request payload for spawning parallel agents is plain-JSON-safe.
 *  3. Spawning 2+ parallel agent runs concurrently (Promise.all) resolves
 *     cleanly with no error, and every response is safely cloneable after
 *     sanitizing — the concrete "two agents in parallel" scenario from the
 *     bug report.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  AgentRun,
  AgentRunEvent,
  AgentWorker,
  CreateAgentRunRequest,
} from '@spockify/ide-client';
import {
  sanitizeAgentRun,
  sanitizeAgentRunEvent,
  sanitizeAgentRuns,
  sanitizeAgentWorker,
} from '../src/agents/agentRunLogic';

function cloneable(value: unknown): boolean {
  try {
    structuredClone(value);
    return true;
  } catch {
    return false;
  }
}

/** A worker/run object contaminated the way a real bug would produce one:
 * a class instance, a bound function, a Map, and a circular reference. */
class FakeAbortController {
  aborted = false;
  abort(): void {
    this.aborted = true;
  }
}

function contaminatedWorker(id: string): AgentWorker {
  const worker: AgentWorker = {
    id,
    name: `agent-${id}`,
    state: 'running',
    result: 'pong',
  };
  // Simulate a live reference accidentally attached client-side (the
  // documented failure class: AbortController / EventEmitter / functions).
  (worker as Record<string, unknown>).controller = new FakeAbortController();
  (worker as Record<string, unknown>).onDone = () => undefined;
  (worker as Record<string, unknown>).seen = new Map([['a', 1]]);
  return worker;
}

function contaminatedRun(id: string, workerCount: number): AgentRun {
  const run: AgentRun = {
    id,
    status: 'pending',
    parent_prompt: 'ping google.com',
    model: 'spockify-agents',
    workers: Array.from({ length: workerCount }, (_, i) =>
      contaminatedWorker(`${id}-w${i}`),
    ),
  };
  const bag = run as Record<string, unknown>;
  bag.abortController = new FakeAbortController();
  bag.onProgress = function onProgress() {
    return undefined;
  };
  // circular reference
  bag.self = run;
  return run;
}

describe('agent run clone-safety (spawnFromPrompt bug)', () => {
  it('a contaminated run/worker graph is NOT structured-clone-safe (reproduces the defect class)', () => {
    const bad = contaminatedRun('run-1', 2);
    assert.equal(
      cloneable(bad),
      false,
      'expected the contaminated run to fail structuredClone — if this now passes, ' +
        'Node/V8 semantics changed and this test needs revisiting',
    );
  });

  it('sanitizeAgentRun strips non-plain fields and keeps it structured-clone-safe', () => {
    const bad = contaminatedRun('run-2', 2);
    const safe = sanitizeAgentRun(bad);
    assert.equal(cloneable(safe), true);
    // Whitelisted data survives.
    assert.equal(safe.id, 'run-2');
    assert.equal(safe.status, 'pending');
    assert.equal(safe.parent_prompt, 'ping google.com');
    assert.equal(safe.model, 'spockify-agents');
    assert.equal(safe.workers?.length, 2);
    assert.equal(safe.workers?.[0].result, 'pong');
    // Contamination did not survive.
    assert.equal((safe as Record<string, unknown>).abortController, undefined);
    assert.equal((safe as Record<string, unknown>).onProgress, undefined);
    assert.equal((safe as Record<string, unknown>).self, undefined);
    assert.equal((safe.workers?.[0] as Record<string, unknown>).controller, undefined);
    assert.equal((safe.workers?.[0] as Record<string, unknown>).onDone, undefined);
    assert.equal((safe.workers?.[0] as Record<string, unknown>).seen, undefined);
  });

  it('sanitizeAgentRuns sanitizes a whole list (what reloadRuns()/getChildren() store)', () => {
    const list = [contaminatedRun('a', 1), contaminatedRun('b', 1)];
    const safe = sanitizeAgentRuns(list);
    assert.equal(safe.length, 2);
    for (const r of safe) {
      assert.equal(cloneable(r), true);
    }
  });

  it('does not choke on missing/malformed fields (defensive whitelist, not just JSON.parse(JSON.stringify()))', () => {
    const weird = { id: 42, status: 'bogus-status' } as unknown as AgentRun;
    const safe = sanitizeAgentRun(weird);
    assert.equal(safe.id, ''); // non-string id dropped, not coerced
    assert.equal(safe.status, 'pending'); // unknown status falls back safely
    assert.equal(cloneable(safe), true);
  });
  it('sanitizeAgentWorker maps router status/output onto state/result', () => {
    const safe = sanitizeAgentWorker({
      id: 'w1',
      name: 'Explorer',
      // Router wire shape (pre-0.8.7 client mismatch).
      status: 'running',
      output: 'partial thoughts…',
    } as unknown as AgentWorker);
    assert.equal(safe.state, 'running');
    assert.equal(safe.result, 'partial thoughts…');
    assert.equal(cloneable(safe), true);
  });

  it('sanitizeAgentRun preserves worker progress from status-only API payloads', () => {
    const safe = sanitizeAgentRun({
      id: 'run-status',
      status: 'running',
      workers: [
        {
          id: 'explorer',
          name: 'Explorer',
          status: 'running',
          output: 'mapping…',
        },
        {
          id: 'analyst',
          name: 'Analyst',
          status: 'pending',
        },
      ],
    } as unknown as AgentRun);
    assert.equal(safe.workers?.[0].state, 'running');
    assert.equal(safe.workers?.[0].result, 'mapping…');
    assert.equal(safe.workers?.[1].state, 'pending');
    assert.equal(cloneable(safe), true);
  });
});

describe('agent run SSE event clone-safety (Agents webview)', () => {
  it('sanitizeAgentRunEvent strips non-plain fields (including a nested contaminated run) and stays clone-safe', () => {
    const bad: AgentRunEvent = {
      type: 'worker_status',
      run_id: 'run-3',
      worker_id: 'run-3-w0',
      status: 'running',
      run: contaminatedRun('run-3', 1),
    };
    (bad as Record<string, unknown>).onDone = () => undefined;
    (bad as Record<string, unknown>).socket = new FakeAbortController();

    const safe = sanitizeAgentRunEvent(bad);
    assert.equal(cloneable(safe), true);
    assert.equal(safe.type, 'worker_status');
    assert.equal(safe.run_id, 'run-3');
    assert.equal(safe.worker_id, 'run-3-w0');
    assert.equal(safe.run?.id, 'run-3');
    assert.equal(cloneable(safe.run), true);
    assert.equal((safe as Record<string, unknown>).onDone, undefined);
    assert.equal((safe as Record<string, unknown>).socket, undefined);
  });

  it('falls back to a safe "heartbeat" type for an unrecognized/malformed event type', () => {
    const weird = { type: 'not_a_real_type' } as unknown as AgentRunEvent;
    const safe = sanitizeAgentRunEvent(weird);
    assert.equal(safe.type, 'heartbeat');
    assert.equal(cloneable(safe), true);
  });

  it('tool_start/tool_result shaped events survive sanitizing intact', () => {
    const ev: AgentRunEvent = {
      type: 'tool_start',
      run_id: 'run-4',
      worker_id: 'run-4-w0',
      tool: 'search',
      query: 'ping google.com',
    };
    const safe = sanitizeAgentRunEvent(ev);
    assert.deepEqual(safe, ev);
    assert.equal(cloneable(safe), true);
  });
});

describe('parallel agent spawn request payload', () => {
  function buildCreateRunRequest(prompt: string, model: string): CreateAgentRunRequest {
    return { parent_prompt: prompt.trim(), model, synthesize: true };
  }

  it('request body is plain-JSON-safe (round-trips through JSON unchanged)', () => {
    const req = buildCreateRunRequest('ping google.com 20 times', 'spockify-agents');
    const roundTripped = JSON.parse(JSON.stringify(req));
    assert.deepEqual(roundTripped, req);
    assert.equal(cloneable(req), true);
  });

  it('spawning 2 parallel agents resolves with no clone/serialization error end to end', async () => {
    // Fake transport standing in for RemoteSpockifyProvider.createAgentRun —
    // returns a *contaminated* AgentRun the way a buggy client-side
    // augmentation (or an unexpected transport implementation) might, to
    // prove the full spawn path is robust to it once responses are
    // sanitized before being stored/rendered (mirrors what
    // AgentsTreeProvider.spawnFromPrompt now does).
    let calls = 0;
    const fakeTransport = {
      createAgentRun: async (request: CreateAgentRunRequest): Promise<AgentRun> => {
        calls += 1;
        assert.equal(cloneable(request), true, 'outgoing request must be clone-safe');
        return contaminatedRun(`parallel-${calls}`, 1);
      },
    };

    const prompts = [
      'agent 1: ping google.com 10 times',
      'agent 2: ping google.com 10 times',
    ];

    const runs = await Promise.all(
      prompts.map((p) =>
        fakeTransport
          .createAgentRun({ parent_prompt: p, model: 'spockify-agents', synthesize: true })
          .then(sanitizeAgentRun),
      ),
    );

    assert.equal(calls, 2);
    assert.equal(runs.length, 2);
    for (const run of runs) {
      assert.equal(cloneable(run), true, 'sanitized run must be clone-safe');
      assert.equal(run.status, 'pending');
    }
    // The two runs are independent (distinct ids) — no cross-contamination
    // from running them concurrently.
    assert.notEqual(runs[0].id, runs[1].id);
  });
});

describe('agent run chat card payload', () => {
  it('agentRunToCardPayload is structured-clone-safe and drops contamination', async () => {
    const { agentRunToCardPayload } = await import(
      '../src/agents/agentRunChatBridge'
    );
    const bad = contaminatedRun('card-1', 2);
    const card = agentRunToCardPayload(sanitizeAgentRun(bad));
    assert.ok(card);
    assert.equal(card!.runId, 'card-1');
    assert.equal(cloneable(card), true);
    assert.equal(card!.workers?.length, 2);
  });
});
