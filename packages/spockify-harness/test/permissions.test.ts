import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyBash,
  confirmOnce,
  grantKey,
  normalizeGrantTool,
  PermissionMemory,
} from '../src/permissions';
import { ToolRegistry } from '../src/registry';
import { noteReadPath, READ_SET_K, registerHarnessTools } from '../src/tools';
import { isReadOnlyMode } from '../src/types';

describe('permissions', () => {
  it('grant persists two shells; /revoke clears', () => {
    const p = new PermissionMemory();
    p.grant('shell *npm*');
    assert.equal(p.allows('shell', { command: 'npm test' }), true);
    assert.equal(p.allows('shell', { command: 'npm run build' }), true);
    p.revokeAll();
    assert.equal(p.allows('shell', { command: 'npm test' }), false);
    assert.equal(p.allows('shell', { command: 'npm run build' }), false);
  });

  it('bash and shell share one grant key', () => {
    assert.equal(normalizeGrantTool('bash'), 'shell');
    assert.equal(normalizeGrantTool('shell'), 'shell');
    const argv = { command: 'echo hi' };
    assert.equal(grantKey('bash', argv), grantKey('shell', argv));
    const p = new PermissionMemory();
    p.remember('bash', argv);
    assert.equal(p.allows('shell', argv), true);
    assert.equal(p.allows('bash', argv), true);
    assert.equal(p.allows('shell', { command: 'echo bye' }), false);
    p.grant('bash npm *');
    assert.equal(p.allows('shell', { command: 'npm test' }), true);
  });

  it('two tool calls with the same argv do not askUser', async () => {
    const p = new PermissionMemory();
    let asks = 0;
    const askUser = async () => {
      asks += 1;
      return true;
    };
    const argv = { command: 'echo hi' };
    assert.equal(await confirmOnce(p, 'bash', argv, askUser), true);
    assert.equal(await confirmOnce(p, 'shell', argv, askUser), true);
    assert.equal(asks, 1);
    assert.equal(await confirmOnce(p, 'shell', { command: 'echo bye' }, askUser), true);
    assert.equal(asks, 2);
    p.revokeAll();
    assert.equal(await confirmOnce(p, 'bash', argv, askUser), true);
    assert.equal(asks, 3);
  });

  it('registry: same argv does not confirm twice (bash then shell)', async () => {
    const p = new PermissionMemory();
    let asks = 0;
    const confirm = async () => {
      asks += 1;
      return true;
    };
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const ctx = {
      cwd: process.cwd(),
      mode: 'agent' as const,
      yolo: false,
      confirm,
      permissions: p,
    };
    const argv = { command: 'echo grant-once' };
    const a = await reg.call('bash', argv, ctx);
    const b = await reg.call('shell', argv, ctx);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(asks, 1);
  });

  it('classifier deny/ask/auto', () => {
    assert.equal(classifyBash('rm -rf /'), 'deny');
    assert.equal(classifyBash('curl http://x'), 'ask');
    assert.equal(classifyBash('pytest -q'), 'auto');
  });

  it('Ask blocks shell', async () => {
    assert.equal(isReadOnlyMode('ask'), true);
    assert.equal(isReadOnlyMode('plan'), true);
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const r = await reg.call(
      'shell',
      { command: 'echo hi' },
      { cwd: process.cwd(), mode: 'ask', yolo: true },
    );
    assert.equal(r.ok, false);
    assert.match(r.error || r.content || '', /block|plan|ask|read-only|denied/i);
  });
});

describe('writeGuard', () => {
  it('write_file without path in readSet (last K=3) → READ_REQUIRED', async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wg-k3-'));
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
      await fs.writeFile(path.join(dir, name), 'hi');
    }
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const readSet = new Set<string>();

    // Read four paths; only last K=3 remain.
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
      await reg.call('read_file', { path: name }, {
        cwd: dir,
        mode: 'agent',
        yolo: true,
        readSet,
      });
    }
    assert.equal(readSet.size, READ_SET_K);
    assert.equal(readSet.has('a.txt'), false);

    const bad = await reg.call(
      'write_file',
      { path: 'a.txt', content: 'x' },
      { cwd: dir, mode: 'agent', yolo: true, readSet },
    );
    assert.equal(bad.ok, false);
    assert.match(bad.error || '', /READ_REQUIRED/);

    const good = await reg.call(
      'write_file',
      { path: 'd.txt', content: 'x' },
      { cwd: dir, mode: 'agent', yolo: true, readSet },
    );
    assert.equal(good.ok, true);
  });

  it('noteReadPath evicts oldest beyond K', () => {
    const s = new Set<string>();
    noteReadPath(s, 'a');
    noteReadPath(s, 'b');
    noteReadPath(s, 'c');
    noteReadPath(s, 'd');
    assert.equal(s.size, 3);
    assert.equal(s.has('a'), false);
    assert.equal(s.has('d'), true);
  });
});
