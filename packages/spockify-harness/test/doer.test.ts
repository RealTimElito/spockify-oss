import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModelTransport } from '@spockify/ide-client';
import {
  DOER_CONTINUE_INJECT,
  ToolRegistry,
  isStructuredDoneOrBlocked,
  registerHarnessTools,
  runAgentTurn,
} from '../src/index';
import type { HarnessEvent } from '../src/types';

function scripted(replies: string[]): ModelTransport {
  let i = 0;
  return {
    async *streamChatCompletions() {
      const text = replies[Math.min(i, replies.length - 1)] || '';
      i += 1;
      yield { content: text };
    },
  } as unknown as ModelTransport;
}

describe('doer continue-on-prose', () => {
  it('isStructuredDoneOrBlocked matches last-line markers only', () => {
    assert.equal(isStructuredDoneOrBlocked('done'), true);
    assert.equal(isStructuredDoneOrBlocked('blocked:policy'), true);
    assert.equal(
      isStructuredDoneOrBlocked(
        'Here is a tutorial.\nWhen you are done, ship it.',
      ),
      false,
    );
    assert.equal(isStructuredDoneOrBlocked('{"status":"done"}'), true);
  });

  it('build: zero tools and no done|blocked → one continue inject, then stop', async () => {
    const replies = [
      'Here is a long tutorial on how you might fix greet().',
      'Still explaining instead of using tools.',
      'this third reply must not run',
    ];
    let calls = 0;
    const transport: ModelTransport = {
      async *streamChatCompletions() {
        const text = replies[calls] || '';
        calls += 1;
        yield { content: text };
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const events: HarnessEvent[] = [];
    const messages = await runAgentTurn({
      transport,
      registry: reg,
      model: 'mock',
      mode: 'build',
      messages: [{ role: 'user', content: 'fix greet' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 6,
      onEvent: (e) => events.push(e),
    });
    assert.equal(calls, 2);
    assert.ok(
      messages.some(
        (m) => m.role === 'user' && m.content === DOER_CONTINUE_INJECT,
      ),
    );
    assert.equal(
      messages.filter((m) => m.content === DOER_CONTINUE_INJECT).length,
      1,
    );
    assert.ok(events.some((e) => e.type === 'done'));
    assert.ok(
      !messages.some((m) =>
        String(m.content || '').includes('this third reply must not run'),
      ),
    );
  });

  it('structured done skips the continue inject', async () => {
    let calls = 0;
    const transport = {
      async *streamChatCompletions() {
        calls += 1;
        yield { content: 'Fixed greet.\ndone' };
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    await runAgentTurn({
      transport,
      registry: reg,
      model: 'mock',
      mode: 'agent',
      messages: [{ role: 'user', content: 'fix greet' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 4,
    });
    assert.equal(calls, 1);
  });

  it('continueOnProse false skips the coding done-nudge', async () => {
    let calls = 0;
    const transport = scripted(['Listed the directory.\nNo more tools.']);
    const wrapped: ModelTransport = {
      async *streamChatCompletions(req, signal) {
        calls += 1;
        yield* transport.streamChatCompletions(req, signal);
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const messages = await runAgentTurn({
      transport: wrapped,
      registry: reg,
      model: 'mock',
      mode: 'agent',
      messages: [{ role: 'user', content: 'run ls then stop' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 4,
      continueOnProse: false,
    });
    assert.equal(calls, 1);
    assert.ok(!messages.some((m) => m.content === DOER_CONTINUE_INJECT));
  });

  it('ask mode does not inject continue', async () => {
    let calls = 0;
    const transport = scripted(['A tutorial with no tools.']);
    const wrapped: ModelTransport = {
      async *streamChatCompletions(req, signal) {
        calls += 1;
        yield* transport.streamChatCompletions(req, signal);
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const messages = await runAgentTurn({
      transport: wrapped,
      registry: reg,
      model: 'mock',
      mode: 'ask',
      messages: [{ role: 'user', content: 'explain' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 4,
    });
    assert.equal(calls, 1);
    assert.ok(!messages.some((m) => m.content === DOER_CONTINUE_INJECT));
  });
});
