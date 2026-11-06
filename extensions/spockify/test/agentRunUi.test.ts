/**
 * Unit tests for agent run UI helpers + Ctrl+K fence stripping.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  anyRunBusy,
  buildRunMarkdown,
  isRunBusy,
  pollIntervalForRuns,
  runProgressDescription,
  synthesisHeadingLine,
  synthesisTeaser,
  workerProgressDescription,
  AGENT_POLL_MS,
  AGENT_POLL_SYNTH_MS,
} from '../src/agents/agentRunLogic';
import type { AgentRun } from '@spockify/ide-client';
import { stripEditFences } from '../src/inlineEdit/streamEdit';

function run(partial: Partial<AgentRun> & { id: string; status: AgentRun['status'] }): AgentRun {
  return partial as AgentRun;
}

describe('agentRunUi', () => {
  it('isRunBusy covers pending/running/synthesizing', () => {
    assert.equal(isRunBusy('pending'), true);
    assert.equal(isRunBusy('running'), true);
    assert.equal(isRunBusy('synthesizing'), true);
    assert.equal(isRunBusy('done'), false);
    assert.equal(isRunBusy('cancelled'), false);
  });

  it('pollIntervalForRuns prefers faster while workers live', () => {
    assert.equal(
      pollIntervalForRuns([
        run({
          id: 'a',
          status: 'running',
          workers: [{ id: 'w1', state: 'running' }],
        }),
      ]),
      AGENT_POLL_MS,
    );
    assert.equal(
      pollIntervalForRuns([
        run({ id: 'a', status: 'synthesizing', workers: [{ id: 'w1', state: 'done' }] }),
      ]),
      AGENT_POLL_SYNTH_MS,
    );
    assert.equal(pollIntervalForRuns([run({ id: 'a', status: 'done' })]), AGENT_POLL_MS);
  });

  it('runProgressDescription shows live + synthesis teaser', () => {
    const d = runProgressDescription(
      run({
        id: 'r1',
        status: 'running',
        workers: [
          { id: '1', state: 'done' },
          { id: '2', state: 'running', result: 'partial…' },
        ],
      }),
    );
    assert.match(d, /1\/2/);
    assert.match(d, /1 live/);

    const synth = runProgressDescription(
      run({
        id: 'r2',
        status: 'synthesizing',
        synthesis: 'Use Redis for the cache layer',
        workers: [{ id: '1', state: 'done' }],
      }),
    );
    assert.match(synth, /synthesis/);
    assert.match(synth, /Redis/);

    const stopping = runProgressDescription(
      run({ id: 'r3', status: 'running' }),
      { cancelling: true },
    );
    assert.equal(stopping, 'stopping…');
  });

  it('synthesisTeaser truncates first line', () => {
    assert.equal(synthesisTeaser(undefined), undefined);
    assert.equal(synthesisTeaser('short'), 'short');
    const long = 'x'.repeat(80);
    assert.equal(synthesisTeaser(long, 20)?.endsWith('…'), true);
  });

  it('workerProgressDescription streaming chars', () => {
    assert.equal(
      workerProgressDescription({ id: 'w', state: 'running', result: 'hello world' }),
      'streaming · 11 chars',
    );
    assert.equal(
      workerProgressDescription({ id: 'w', state: 'cancelled' }),
      'stopped',
    );
  });

  it('buildRunMarkdown + synthesisHeadingLine (0-based)', () => {
    const md = buildRunMarkdown(
      run({
        id: 'abc',
        status: 'done',
        parent_prompt: 'Do the thing',
        synthesis: 'Final answer',
        workers: [{ id: 'w1', name: 'Worker A', state: 'done', result: 'ok' }],
      }),
    );
    assert.match(md, /## Synthesis/);
    assert.match(md, /Final answer/);
    const line = synthesisHeadingLine(md);
    assert.notEqual(line, undefined);
    const lines = md.split(/\r?\n/);
    assert.equal(lines[line!].trim(), '## Synthesis');
  });

  it('anyRunBusy', () => {
    assert.equal(anyRunBusy([run({ id: 'a', status: 'done' })]), false);
    assert.equal(
      anyRunBusy([
        run({ id: 'a', status: 'done' }),
        run({ id: 'b', status: 'pending' }),
      ]),
      true,
    );
  });
});

describe('stripEditFences', () => {
  it('passes through bare code', () => {
    assert.equal(stripEditFences('const x = 1;'), 'const x = 1;');
  });

  it('strips complete fences', () => {
    assert.equal(
      stripEditFences('```ts\nconst x = 1;\n```'),
      'const x = 1;',
    );
  });

  it('strips incomplete opening fence mid-stream', () => {
    assert.equal(stripEditFences('```ts\nconst x = '), 'const x =');
  });
});
