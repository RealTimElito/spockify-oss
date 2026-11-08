/**
 * tool_choice stays 'auto' for coding unless a caller passes an override.
 * CyberGym uses the override to force submit_poc after a short explore budget.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModelTransport } from '@spockify/ide-client';
import { ToolRegistry, runHarness } from '../src/index';
import type { HarnessSession } from '../src/types';

describe('runHarness toolChoice', () => {
  it('sends auto by default and a per-turn override when provided', async () => {
    const seen: unknown[] = [];
    let n = 0;
    const transport = {
      async *streamChatCompletions(req: { tool_choice?: unknown }) {
        seen.push(req.tool_choice);
        n += 1;
        if (n === 1) {
          yield {
            content: '',
            done: true,
            toolCalls: [
              {
                id: 'c1',
                name: 'submit_poc',
                arguments: { path: 'poc.bin' },
              },
            ],
          };
          return;
        }
        yield { content: 'stopped', done: true };
      },
    } as unknown as ModelTransport;

    const reg = new ToolRegistry();
    reg.register(
      {
        name: 'submit_poc',
        description: 'submit',
        mutates: true,
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
      async () => ({ ok: true, content: 'submitted' }),
    );
    const session: HarnessSession = {
      messages: [{ role: 'user', content: 'Write a candidate input and submit it.' }],
      tick: 0,
      readSet: [],
      toolLog: [],
      todos: [],
      cwd: process.cwd(),
      model: 'gpt-oss-20b',
    };
    const gen = runHarness({
      transport,
      session,
      registry: reg,
      policy: {
        mode: 'agent',
        yolo: true,
        maxTurns: 2,
        codingSpawn: false,
        repoRepairNudges: false,
      },
      continueOnProse: false,
      toolChoice: (turn) =>
        turn === 0
          ? { type: 'function', function: { name: 'submit_poc' } }
          : 'auto',
    });
    for await (const _ev of gen) {
      /* drain */
    }
    assert.equal(seen.length >= 1, true);
    assert.deepEqual(seen[0], {
      type: 'function',
      function: { name: 'submit_poc' },
    });
  });
});
