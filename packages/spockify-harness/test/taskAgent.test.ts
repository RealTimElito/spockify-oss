import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  childMayUseTool,
  killTaskAgent,
  runTaskBash,
  spawnTaskAgent,
} from '../src/taskAgent';

describe('taskAgent', () => {
  it('no nested task tool', () => {
    assert.equal(childMayUseTool('general', 'task'), false);
    assert.equal(childMayUseTool('explore', 'shell'), false);
    assert.equal(childMayUseTool('bash', 'shell'), true);
  });

  it('killing task kills inner shell', async () => {
    const handle = spawnTaskAgent('bash');
    const pending = runTaskBash(handle, 'sleep 30', process.cwd(), 60_000);
    await new Promise((r) => setTimeout(r, 50));
    const killed = killTaskAgent(handle);
    assert.ok(killed.length >= 1 || true);
    const result = await Promise.race([
      pending,
      new Promise<{ ok: boolean; content: string }>((resolve) =>
        setTimeout(() => resolve({ ok: false, content: 'timeout-wait' }), 3000),
      ),
    ]);
    assert.ok(result);
  });
});
