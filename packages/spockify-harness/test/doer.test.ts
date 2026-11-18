import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ModelTransport } from '@spockify/ide-client';
import {
  DOER_CONTINUE_INJECT,
  ToolRegistry,
  isSocialTurn,
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
  it('treats a greeting as social and a fix request as work', () => {
    assert.equal(isSocialTurn('Hey there! How are ya?'), true);
    assert.equal(isSocialTurn('thanks!'), true);
    assert.equal(isSocialTurn('Hey, can you fix the login bug'), false);
    assert.equal(isSocialTurn('where is runHarness defined'), false);
  });

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
    const sent: string[] = [];
    const transport: ModelTransport = {
      async *streamChatCompletions(req: { messages?: { content?: string }[] }) {
        sent.push(
          (req.messages || []).map((m) => m.content || '').join('\n'),
        );
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
    assert.ok(sent[1]?.includes(DOER_CONTINUE_INJECT));
    assert.ok(
      !messages.some(
        (m) => m.role === 'user' && m.content === DOER_CONTINUE_INJECT,
      ),
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

  it('a greeting is sent with no tools and a tool call is ignored', async () => {
    const seen: unknown[] = [];
    const transport = {
      async *streamChatCompletions(req: { tools?: unknown }) {
        seen.push(req.tools);
        yield {
          content: 'Hey!',
          toolCalls: [
            {
              id: 'c1',
              name: 'read_file',
              arguments: { path: 'scripts/upload_custom_data.py' },
            },
          ],
        };
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const messages = await runAgentTurn({
      transport,
      registry: reg,
      model: 'mock',
      mode: 'agent',
      messages: [{ role: 'user', content: 'Hey there!' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 4,
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0], undefined);
    assert.ok(!messages.some((m) => m.toolCalls?.length || m.role === 'tool'));
    assert.ok(messages.some((m) => String(m.content).includes('Hey!')));
  });

  it('a greeting stops after the answer', async () => {
    let calls = 0;
    const transport = scripted([
      'Hey! All good on my end.',
      'blocked:policy',
    ]);
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
      messages: [{ role: 'user', content: 'Hey there! How are ya?' }],
      cwd: process.cwd(),
      yolo: true,
      maxTurns: 4,
    });
    assert.equal(calls, 1);
    assert.ok(!messages.some((m) => m.content === DOER_CONTINUE_INJECT));
    assert.ok(!messages.some((m) => String(m.content).includes('blocked:policy')));
    assert.ok(
      messages.some((m) => String(m.content).includes('All good on my end')),
    );
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
