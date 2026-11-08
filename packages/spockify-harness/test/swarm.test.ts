import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModelTransport } from '@spockify/ide-client';
import {
  CODING_SPAWN_DEFAULT,
  PermissionMemory,
  SwarmRunControl,
  ToolRegistry,
  capSwarmItems,
  clampSwarmThinking,
  parseSwarmPlan,
  runSwarm,
  swarmWorkerPolicy,
} from '../src/index';
import type { HarnessEvent } from '../src/types';

function blob(req: { messages?: unknown }): string {
  return JSON.stringify(req.messages || []);
}

const FIVE = [
  '{"title":"W1","prompt":"Add greet() in greet.py and keep the signature stable."}',
  '{"title":"W2","prompt":"Add a pytest that imports greet from greet.py."}',
  '{"title":"W3","prompt":"Update the README usage example for greet()."}',
  '{"title":"W4","prompt":"Run the greet unit test and report the result."}',
  '{"title":"W5","prompt":"This fifth worker must be dropped by the cap."}',
].join(',');

function planTransport(
  handler: (msg: string, signal?: AbortSignal) => AsyncGenerator<
    { content?: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown>; argumentsRaw?: string }> },
    void,
    void
  >,
): ModelTransport {
  return {
    async *streamChatCompletions(req, signal) {
      yield* handler(blob(req), signal);
    },
  } as unknown as ModelTransport;
}

describe('swarm plan', () => {
  it('splits a plan into at most 4 items', () => {
    const text = `notes\nSWARM_PLAN:[${FIVE}]`;
    const items = parseSwarmPlan(text);
    assert.equal(items.length, 4);
    assert.equal(items[0]?.title, 'W1');
    assert.equal(items[3]?.title, 'W4');
    assert.equal(capSwarmItems(items, 99).length, 4);
    assert.equal(CODING_SPAWN_DEFAULT, 1);
    assert.equal(swarmWorkerPolicy().codingSpawn, false);
    assert.equal(clampSwarmThinking('heavy'), 'medium');
  });

  it('asks instead of launching on a vague prompt', async () => {
    let calls = 0;
    const transport = planTransport(async function* () {
      calls += 1;
      yield { content: 'should not run' };
    });
    const result = await runSwarm({
      transport,
      registry: new ToolRegistry(),
      model: 'mock',
      cwd: process.cwd(),
      userPrompt: 'fix it',
    });
    assert.equal(calls, 0);
    assert.equal(result.kind, 'ask');
    assert.equal(result.workers.length, 0);
    assert.match(result.transcript, /which files or tests/i);
  });

  it('waits for an answer and sends it to the planner once', async () => {
    const seen: string[] = [];
    let asks = 0;
    const transport = planTransport(async function* (msg) {
      seen.push(msg);
      yield {
        content: msg.includes('Clarification from the user')
          ? 'SWARM_ASK: Which file should each worker edit?'
          : 'SWARM_ASK: Which files should the workers edit?',
      };
    });
    const result = await runSwarm({
      transport,
      registry: new ToolRegistry(),
      model: 'mock',
      cwd: process.cwd(),
      userPrompt:
        'Please update the README install section and the unit tests for greet.',
      askUser: async (prompt) => {
        asks += 1;
        assert.match(prompt, /which files/i);
        return 'README.md and test/greet.test.ts';
      },
    });
    assert.equal(asks, 1);
    assert.equal(result.kind, 'ask');
    assert.match(seen.join('\n'), /Clarification from the user/);
    assert.equal(result.workers.length, 0);
  });
});

describe('swarm loop', () => {
  it('runs at most 4 workers and treats DONE as completed work', async () => {
    const transport = planTransport(async function* (msg) {
      if (msg.includes('swarm planner')) {
        yield { content: `SWARM_PLAN:[${FIVE}]` };
        return;
      }
      if (msg.includes('You are one swarm worker')) {
        const title = /Title: (W\d)/.exec(msg)?.[1] || 'worker';
        yield {
          content:
            `DONE — ${title} finished the assigned edit\n` +
            `ASK_USER: ["Which port should ${title} bind?"]\n` +
            'LAST_ERROR: (none)\n' +
            'done',
        };
      }
    });
    const events: HarnessEvent[] = [];
    const result = await runSwarm({
      transport,
      registry: new ToolRegistry(),
      model: 'mock',
      cwd: process.cwd(),
      userPrompt: 'Add greet() to greet.py and cover it with pytest plus a short README note.',
      onEvent: (event) => events.push(event),
    });
    assert.equal(result.items.length, 4);
    assert.equal(result.workers.length, 4);
    assert.equal(result.workers.some((w) => w.title === 'W5'), false);
    assert.equal(result.fixRounds, 0);
    assert.match(result.transcript, /## Completed work/);
    assert.match(result.transcript, /completed work, not a new plan/);
    assert.match(result.transcript, /### DONE — W1/);
    assert.doesNotMatch(result.transcript, /SWARM_PLAN/);
    assert.match(result.transcript, /Need from you:/);
    assert.match(result.transcript, /Which port should W1 bind/);
    assert.equal(events.some((e) => e.type === 'taskSpawn'), false);
  });

  it('does not let a worker nest SPAWN_CODING', async () => {
    const events: HarnessEvent[] = [];
    const transport = planTransport(async function* (msg) {
      if (msg.includes('swarm planner')) {
        yield {
          content:
            'SWARM_PLAN:[{"title":"Nest","prompt":"Look at greet.py and report FINDINGS only."}]',
        };
        return;
      }
      if (msg.includes('Do not write another tutorial')) {
        yield {
          content: 'DONE — inspected greet.py\nLAST_ERROR: (none)\ndone',
        };
        return;
      }
      if (msg.includes('You are one swarm worker')) {
        yield {
          content:
            'SPAWN_CODING:[{"kind":"explore","prompt":"grandchild must not run at all"}]',
        };
      }
    });
    const result = await runSwarm({
      transport,
      registry: new ToolRegistry(),
      model: 'mock',
      cwd: process.cwd(),
      userPrompt: 'Inspect greet.py and summarize the greet function for the parent.',
      onEvent: (event) => events.push(event),
    });
    assert.equal(result.workers.length, 1);
    assert.equal(events.filter((e) => e.type === 'taskSpawn').length, 0);
    assert.match(result.transcript, /### DONE — Nest/);
    assert.doesNotMatch(result.workers[0]?.digest || '', /grandchild must not run/);
  });

  it('runs one repair after a failed test, then stops', async () => {
    let repairs = 0;
    const transport = planTransport(async function* (msg) {
      if (msg.includes('swarm planner')) {
        yield {
          content:
            'SWARM_PLAN:[' +
            '{"title":"Add greet","prompt":"Add greet() in greet.py and export it."},' +
            '{"title":"Pytest","prompt":"Run pytest for greet and fix a red test."}' +
            ']',
        };
        return;
      }
      if (msg.includes('SWARM_REPAIR_ROUND')) {
        repairs += 1;
        yield {
          content: 'DONE — pytest still red\nLAST_ERROR: assertion failed\ndone',
        };
        return;
      }
      if (msg.includes('Run pytest')) {
        yield {
          content: 'DONE — pytest failed\nLAST_ERROR: assertion failed\ndone',
        };
        return;
      }
      if (msg.includes('You are one swarm worker')) {
        yield {
          content: 'DONE — added greet()\nLAST_ERROR: (none)\ndone',
        };
      }
    });
    const result = await runSwarm({
      transport,
      registry: new ToolRegistry(),
      model: 'mock',
      cwd: process.cwd(),
      userPrompt: 'Add greet() in greet.py and make pytest pass for that function.',
    });
    assert.equal(repairs, 1);
    assert.equal(result.fixRounds, 1);
    const failed = result.workers.find((w) => w.title === 'Pytest');
    const ok = result.workers.find((w) => w.title === 'Add greet');
    assert.equal(failed?.state, 'failed');
    assert.match(failed?.error || '', /assertion failed/);
    assert.equal(ok?.state, 'done');
    assert.match(result.transcript, /Repair rounds used: 1/);
    assert.match(result.transcript, /completed work, not a new plan/);
  });

  it('cancel marks that worker stopped and skips its repair', async () => {
    const control = new SwarmRunControl();
    let sawHang = 0;
    const transport = planTransport(async function* (msg, signal) {
      if (msg.includes('swarm planner')) {
        yield {
          content:
            'SWARM_PLAN:[' +
            '{"title":"Hang","prompt":"CANCEL_ME touch a file that must not be repaired."},' +
            '{"title":"Ok","prompt":"Update the comment in greet.py only."}' +
            ']',
        };
        return;
      }
      if (msg.includes('SWARM_REPAIR_ROUND')) {
        throw new Error('repair should not run');
      }
      if (msg.includes('CANCEL_ME')) {
        sawHang += 1;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 2000);
          const stop = () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          };
          if (signal?.aborted) {
            stop();
            return;
          }
          signal?.addEventListener('abort', stop, { once: true });
        });
        yield { content: 'DONE — should not finish\nLAST_ERROR: (none)\ndone' };
        return;
      }
      yield { content: 'DONE — comment updated\nLAST_ERROR: (none)\ndone' };
    });
    const result = await runSwarm({
      transport,
      registry: new ToolRegistry(),
      model: 'mock',
      cwd: process.cwd(),
      userPrompt: 'Update greet.py and stop the worker that is still running.',
      control,
      onWorker: (row) => {
        if (row.state === 'running' && row.prompt.includes('CANCEL_ME')) {
          setTimeout(() => control.cancel(row.id), 15);
        }
      },
    });
    const hang = result.workers.find((w) => w.title === 'Hang');
    const ok = result.workers.find((w) => w.title === 'Ok');
    assert.equal(hang?.state, 'cancelled');
    assert.equal(hang?.statusLabel, 'stopped');
    assert.equal(hang?.error, 'stopped');
    assert.equal(ok?.state, 'done');
    assert.equal(result.fixRounds, 0);
    assert.ok(sawHang >= 1);
  });

  it('shares one permission memory across workers', async () => {
    const permissions = new PermissionMemory();
    const seen = new Set<PermissionMemory>();
    const registry = new ToolRegistry();
    registry.register(
      {
        name: 'shell',
        description: 'run a command',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
        mutates: true,
      },
      async (_args, ctx) => {
        if (ctx.permissions) seen.add(ctx.permissions);
        return { ok: true, content: 'shell ok' };
      },
    );
    const transport = planTransport(async function* (msg) {
      if (msg.includes('swarm planner')) {
        yield {
          content:
            'SWARM_PLAN:[' +
            '{"title":"A","prompt":"Run pytest -q in the greet package."},' +
            '{"title":"B","prompt":"Run pytest -q for the farewell helper."}' +
            ']',
        };
        return;
      }
      if (msg.includes('shell ok')) {
        yield { content: 'DONE — pytest finished\nLAST_ERROR: (none)\ndone' };
        return;
      }
      if (msg.includes('You are one swarm worker')) {
        yield {
          content: '',
          toolCalls: [
            {
              id: 'call_shell',
              name: 'shell',
              arguments: { command: 'pytest -q' },
              argumentsRaw: '{"command":"pytest -q"}',
            },
          ],
        };
      }
    });
    const result = await runSwarm({
      transport,
      registry,
      permissions,
      model: 'mock',
      cwd: process.cwd(),
      userPrompt: 'Run pytest for greet and farewell and report both results.',
    });
    assert.equal(result.workers.length, 2);
    assert.equal(seen.size, 1);
    assert.equal([...seen][0], permissions);
  });
});
