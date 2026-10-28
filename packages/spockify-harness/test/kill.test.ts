import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModelTransport } from '@spockify/ide-client';
import { KillRegistry, spawnBashGroup } from '../src/kill';
import {
  runAgentTurn,
  ToolRegistry,
  registerHarnessTools,
  ReplayGuard,
} from '../src/index';
import {
  killTaskAgent,
  runTaskBash,
  spawnTaskAgent,
} from '../src/taskAgent';
import type { HarnessEvent } from '../src/types';

function shellSleepTransport(id = 'sleep1'): ModelTransport {
  let calls = 0;
  return {
    async *streamChatCompletions() {
      calls++;
      if (calls === 1) {
        yield {
          toolCalls: [
            {
              id,
              name: 'shell',
              arguments: { command: 'sleep 30' },
            },
          ],
        };
      } else {
        yield { content: 'parent continued after kill' };
      }
    },
  } as unknown as ModelTransport;
}

describe('kill', () => {
  it('kills sleep via process group and returns id', async () => {
    const reg = new KillRegistry();
    const child = spawnBashGroup('sleep 30', process.cwd());
    reg.track('sleep1', child);
    await new Promise((r) => setTimeout(r, 50));
    const killed = reg.kill('sleep1', 'SIGTERM');
    assert.ok(killed.includes('sleep1'));
    await new Promise<void>((resolve) => {
      child.on('close', () => resolve());
      setTimeout(resolve, 2000);
    });
  });

  it('cascades parent → child tool ids', () => {
    const reg = new KillRegistry();
    const parent = spawnBashGroup('sleep 30', process.cwd());
    const child = spawnBashGroup('sleep 30', process.cwd());
    reg.track('p', parent);
    reg.track('c', child, 'p');
    const killed = reg.kill('p', 'SIGKILL');
    assert.ok(killed.includes('c'));
    assert.ok(killed.includes('p'));
  });

  it('sleep 30 + abort → toolKilled; parent continues', async () => {
    const tools = new ToolRegistry();
    registerHarnessTools(tools);
    const events: HarnessEvent[] = [];
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 80);

    await runAgentTurn({
      transport: shellSleepTransport('sleep_abort'),
      registry: tools,
      model: 'mock',
      mode: 'agent',
      messages: [{ role: 'user', content: 'sleep' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 4,
      signal: ac.signal,
      onEvent: (e) => events.push(e),
    });

    assert.ok(
      events.some((e) => e.type === 'toolKilled'),
      `expected toolKilled, got ${events.map((e) => e.type).join(',')}`,
    );

    // Parent continues: a fresh turn after abort still runs.
    const cont: HarnessEvent[] = [];
    let n = 0;
    const echo: ModelTransport = {
      async *streamChatCompletions() {
        n++;
        yield { content: n === 1 ? 'ok-continued' : 'done' };
      },
    } as unknown as ModelTransport;
    await runAgentTurn({
      transport: echo,
      registry: tools,
      model: 'mock',
      mode: 'ask',
      messages: [{ role: 'user', content: 'ping' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 2,
      onEvent: (e) => cont.push(e),
    });
    assert.ok(cont.some((e) => e.type === 'text' && e.content.includes('ok-continued')));
    assert.ok(cont.some((e) => e.type === 'done'));
  });

  it('killing a task kills the inner shell', async () => {
    const handle = spawnTaskAgent('bash');
    const pending = runTaskBash(handle, 'sleep 30', process.cwd(), 60_000);
    await new Promise((r) => setTimeout(r, 80));
    const killed = killTaskAgent(handle);
    assert.ok(killed.length >= 1, 'expected at least one killed tool id');
    const result = await Promise.race([
      pending,
      new Promise<{ ok: boolean; content: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, content: 'timeout-wait' }), 4000),
      ),
    ]);
    assert.notEqual(result.content, 'timeout-wait');
    assert.equal(result.ok, false);
  });

  it('reused tool_call_id does not false-kill', async () => {
    const g = new ReplayGuard();
    assert.equal(g.check('call_dup'), null);
    assert.match(g.check('call_dup') || '', /replay_protection/);

    const tools = new ToolRegistry();
    registerHarnessTools(tools);
    const events: HarnessEvent[] = [];
    let calls = 0;
    const transport: ModelTransport = {
      async *streamChatCompletions() {
        calls++;
        if (calls === 1) {
          yield {
            toolCalls: [
              {
                id: 'dup',
                name: 'shell',
                arguments: { command: 'echo one' },
              },
              {
                id: 'dup',
                name: 'shell',
                arguments: { command: 'echo two' },
              },
            ],
          };
        } else {
          yield { content: 'finished' };
        }
      },
    } as unknown as ModelTransport;

    await runAgentTurn({
      transport,
      registry: tools,
      model: 'mock',
      mode: 'agent',
      messages: [{ role: 'user', content: 'dup' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 4,
      onEvent: (e) => events.push(e),
    });

    assert.ok(!events.some((e) => e.type === 'toolKilled'));
    const replay = events.find(
      (e) =>
        e.type === 'toolResult' &&
        typeof e.error === 'string' &&
        /replay_protection/.test(e.error),
    );
    assert.ok(replay, 'expected replay_protection toolResult, not toolKilled');
  });
});
