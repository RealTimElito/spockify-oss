/**
 * Phase 5 — kernel-scored smoke WITHOUT stealing board LiteLLM/20b.
 * Uses a mock ModelTransport; proves runHarness + tools on a fixture repo.
 *
 * Scored SWE-Lite still uses mini-SWE until board completes; this card names
 * the harness commit SHA so BENCHMARK can distinguish kernel vs mini-SWE rows.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ToolRegistry,
  registerHarnessTools,
  runAgentTurn,
  parseToolFences,
} from '../src/index';
import type { ModelTransport } from '@spockify/ide-client';

function mockTransport(toolFence: string): ModelTransport {
  let calls = 0;
  return {
    async *streamChatCompletions() {
      calls++;
      if (calls === 1) {
        yield { content: toolFence };
      } else {
        yield { content: 'done after tools' };
      }
    },
  } as unknown as ModelTransport;
}

describe('phase5 kernel smoke (mock transport)', () => {
  it('plan mode cannot write; build applies patch via fence', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p5-'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'hello\n');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);

    const planBlocked = await reg.call(
      'apply_patch',
      { path: 'a.txt', search: 'hello', replace: 'world' },
      { cwd: dir, mode: 'plan', yolo: true },
    );
    assert.equal(planBlocked.ok, false);

    const fence =
      '```tool\n' +
      JSON.stringify({
        name: 'apply_patch',
        arguments: { path: 'a.txt', search: 'hello', replace: 'world' },
      }) +
      '\n```';
    assert.equal(parseToolFences(fence).length, 1);

    const messages = await runAgentTurn({
      transport: mockTransport(fence),
      registry: reg,
      model: 'mock',
      mode: 'build',
      messages: [{ role: 'user', content: 'fix greeting' }],
      cwd: dir,
      yolo: true,
      maxTurns: 4,
      parallelTools: true,
    });
    const body = await fs.readFile(path.join(dir, 'a.txt'), 'utf8');
    assert.match(body, /world/);
    assert.ok(messages.some((m) => m.role === 'tool'));
  });
});
