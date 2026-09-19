/**
 * Unit tests for local agent-run store (`local-*` ids).
 */
import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import type { AgentRun } from '@spockify/ide-client';
import {
  clearLocalAgentRuns,
  getLocalAgentRun,
  isLocalAgentRunId,
  listLocalAgentRuns,
  subscribeLocalAgentRun,
  upsertLocalAgentRun,
} from '../src/agents/localAgentRunStore';

describe('localAgentRunStore', () => {
  beforeEach(() => {
    clearLocalAgentRuns();
  });

  it('isLocalAgentRunId detects local- prefix', () => {
    assert.equal(isLocalAgentRunId('local-mrz9k165'), true);
    assert.equal(isLocalAgentRunId('abc-123'), false);
    assert.equal(isLocalAgentRunId(''), false);
    assert.equal(isLocalAgentRunId(undefined), false);
  });

  it('upsert + get round-trip and notifies subscribers', () => {
    const seen: string[] = [];
    const unsub = subscribeLocalAgentRun('local-abc', (r) => {
      seen.push(r.status);
    });
    const run: AgentRun = {
      id: 'local-abc',
      status: 'running',
      parent_prompt: 'ping -c 20 google.com',
      model: 'terminal_run',
      workers: [
        { id: 'w1', name: 'Runner 1', state: 'running', prompt: 'ping -c 20 google.com' },
        { id: 'w2', name: 'Runner 2', state: 'running', prompt: 'ping -c 20 google.com' },
      ],
    };
    upsertLocalAgentRun(run);
    assert.equal(getLocalAgentRun('local-abc')?.status, 'running');
    assert.equal(seen.join(','), 'running');

    upsertLocalAgentRun({ ...run, status: 'done' });
    assert.equal(getLocalAgentRun('local-abc')?.status, 'done');
    assert.equal(seen.join(','), 'running,done');
    assert.equal(listLocalAgentRuns().length, 1);
    unsub();
  });

  it('rejects non-local ids', () => {
    assert.throws(() =>
      upsertLocalAgentRun({ id: 'remote-xyz', status: 'running' }),
    );
  });
});
