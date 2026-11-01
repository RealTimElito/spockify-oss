/**
 * Unit tests for SpawnQueue — the FIFO used to serialize the agent-run
 * create call so overlapping "spawn agents" triggers queue instead of
 * racing (or silently dropping).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SpawnQueue } from '../src/agents/spawnQueue';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('SpawnQueue', () => {
  it('runs a single task immediately with no "queued" callback', async () => {
    const q = new SpawnQueue();
    let onQueuedCalls = 0;
    const result = await q.run(async () => 'ok', () => {
      onQueuedCalls += 1;
    });
    assert.equal(result, 'ok');
    assert.equal(onQueuedCalls, 0);
    assert.equal(q.aheadCount, 0);
  });

  it('serializes overlapping tasks strictly in submission order (none run concurrently)', async () => {
    const q = new SpawnQueue();
    const started: string[] = [];
    const finished: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    function makeTask(label: string, ms: number) {
      return async () => {
        started.push(label);
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await delay(ms);
        concurrent -= 1;
        finished.push(label);
        return label;
      };
    }

    // Fire 3 "spawn" triggers back to back — simulates double-click / the
    // AI calling spawn twice in a row before the first create() settles.
    const p1 = q.run(makeTask('a', 30));
    const p2 = q.run(makeTask('b', 10));
    const p3 = q.run(makeTask('c', 5));

    const results = await Promise.all([p1, p2, p3]);

    assert.equal(maxConcurrent, 1, 'no two tasks should run concurrently');
    assert.deepEqual(started, ['a', 'b', 'c'], 'must start in submission order');
    assert.deepEqual(finished, ['a', 'b', 'c'], 'must finish in submission order (serialized)');
    assert.deepEqual(results, ['a', 'b', 'c']);
  });

  it('reports "ahead" count to onQueued for tasks that have to wait', async () => {
    const q = new SpawnQueue();
    const aheadSeen: number[] = [];

    const p1 = q.run(() => delay(20), (ahead) => aheadSeen.push(ahead));
    const p2 = q.run(() => delay(5), (ahead) => aheadSeen.push(ahead));
    const p3 = q.run(() => delay(5), (ahead) => aheadSeen.push(ahead));

    await Promise.all([p1, p2, p3]);

    // p1 ran immediately (no callback); p2 queued behind 1; p3 queued behind 2.
    assert.deepEqual(aheadSeen, [1, 2]);
  });

  it('a failing task does not break the chain — later tasks still run', async () => {
    const q = new SpawnQueue();
    const p1 = q.run(async () => {
      throw new Error('boom');
    });
    const p2 = q.run(async () => 'still works');

    await assert.rejects(p1, /boom/);
    assert.equal(await p2, 'still works');
  });

  it('aheadCount reflects in-flight + queued tasks and returns to 0 when idle', async () => {
    const q = new SpawnQueue();
    assert.equal(q.aheadCount, 0);
    const p1 = q.run(() => delay(15));
    assert.equal(q.aheadCount, 1);
    const p2 = q.run(() => delay(5));
    assert.equal(q.aheadCount, 2);
    await Promise.all([p1, p2]);
    assert.equal(q.aheadCount, 0);
  });
});
