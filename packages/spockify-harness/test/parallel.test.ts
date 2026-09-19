import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runToolsParallel, ReplayGuard } from '../src/parallel';
import { ToolRegistry } from '../src/registry';
import { registerHarnessTools } from '../src/tools';

describe('parallel', () => {
  it('preserves LLM order and keeps sibling on failure', async () => {
    const reg = new ToolRegistry();
    let n = 0;
    reg.register(
      {
        name: 'slow_ok',
        description: 'ok',
        mutates: false,
        parameters: { type: 'object', properties: {} },
      },
      async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { ok: true, content: `ok-${++n}` };
      },
    );
    reg.register(
      {
        name: 'fail_fast',
        description: 'fail',
        mutates: false,
        parameters: { type: 'object', properties: {} },
      },
      async () => ({ ok: false, content: '', error: 'boom' }),
    );
    const calls = [
      { id: '1', name: 'slow_ok', arguments: {} },
      { id: '2', name: 'fail_fast', arguments: {} },
      { id: '3', name: 'slow_ok', arguments: {} },
    ];
    const out = await runToolsParallel(calls, reg, {
      cwd: process.cwd(),
      mode: 'agent',
      yolo: true,
    });
    assert.equal(out.length, 3);
    assert.equal(out[0]!.call.id, '1');
    assert.equal(out[1]!.call.id, '2');
    assert.equal(out[1]!.result.ok, false);
    assert.equal(out[2]!.result.ok, true);
  });
});

describe('replay', () => {
  it('rejects reused tool_call_id', () => {
    const g = new ReplayGuard();
    assert.equal(g.check('call_1'), null);
    assert.match(g.check('call_1') || '', /replay_protection/);
  });
});

describe('plan blocks shell via registry', () => {
  it('ask mode blocks shell', async () => {
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const r = await reg.call(
      'shell',
      { command: 'echo hi' },
      { cwd: process.cwd(), mode: 'ask', yolo: true },
    );
    assert.equal(r.ok, false);
  });
});
