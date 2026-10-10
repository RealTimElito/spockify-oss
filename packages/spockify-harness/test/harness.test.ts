import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { applySearchReplace, rejectUnifiedDiff } from '../src/gitTxn';
import { ToolRegistry } from '../src/registry';
import { registerHarnessTools } from '../src/tools';
import { persistSession, compactSessionAtomic } from '../src/session';
import { initAgentsMd } from '../src/agentsInit';
import { parseToolFences, maybeFenceRepairHint } from '../src/loop';
import type { HarnessSession } from '../src/types';

describe('apply_patch / reject-other', () => {
  it('rejects unified diffs', () => {
    const err = rejectUnifiedDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n');
    assert.ok(err);
  });

  it('exact then ws-norm layers', () => {
    const a = applySearchReplace('foo  \nbar', 'foo\nbar', 'baz');
    assert.equal(a.ok, true);
    if (a.ok) assert.equal(a.layer, 1);
  });

  it('rejects missing, empty, and whitespace path without writing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-ap-'));
    const file = path.join(dir, 'a.txt');
    const original = 'hello\n';
    await fs.writeFile(file, original, 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const ctx = { cwd: dir, mode: 'agent' as const, yolo: true };
    const cases: Array<Record<string, unknown>> = [
      { search: 'hello', replace: 'nope' },
      { path: '', search: 'hello', replace: 'nope' },
      { path: '   ', search: 'hello', replace: 'nope' },
      { path: '\n\t ', patch: 'SEARCH\nhello\nREPLACE\nnope\n' },
    ];
    for (const args of cases) {
      const r = await reg.call('apply_patch', args, ctx);
      assert.equal(r.ok, false);
      assert.equal(r.error, 'path required');
      assert.equal(await fs.readFile(file, 'utf8'), original);
    }
  });
});

describe('write guard', () => {
  it('write alone on existing path fails READ_REQUIRED', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-wg-'));
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, 'hi', 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const readSet = new Set<string>();
    const r = await reg.call(
      'write_file',
      { path: 'a.txt', content: 'bye' },
      { cwd: dir, mode: 'agent', yolo: true, readSet },
    );
    assert.equal(r.ok, false);
    assert.match(r.error || '', /READ_REQUIRED/);
  });

  it('read then write ok', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-wg-'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'hi', 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const readSet = new Set<string>();
    await reg.call('read_file', { path: 'a.txt' }, {
      cwd: dir,
      mode: 'agent',
      yolo: true,
      readSet,
    });
    const r = await reg.call(
      'write_file',
      { path: 'a.txt', content: 'bye' },
      { cwd: dir, mode: 'agent', yolo: true, readSet },
    );
    assert.equal(r.ok, true);
  });
});

describe('plan mode blocks writes', () => {
  it('apply_patch blocked in plan', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-plan-'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'hi', 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const r = await reg.call(
      'apply_patch',
      { path: 'a.txt', search: 'hi', replace: 'yo' },
      { cwd: dir, mode: 'plan', yolo: true },
    );
    assert.equal(r.ok, false);
    assert.match(r.error || '', /blocked/);
  });
});

describe('session atomic', () => {
  it('delegates crash/compact coverage to session.test.ts', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-sess-'));
    const session: HarnessSession = {
      messages: [],
      tick: 1,
      readSet: [],
      toolLog: [],
      todos: [],
      cwd: dir,
      model: 'gpt-oss-20b',
    };
    await persistSession(dir, 's1', session);
    const raw = await fs.readFile(path.join(dir, 's1.jsonl'), 'utf8');
    assert.match(raw, /"tick":1/);
    // Successful compact still swaps when payload is valid.
    const ok = await compactSessionAtomic(dir, 's1', { ...session, tick: 2 });
    assert.equal(ok.ok, true);
  });
});

describe('init AGENTS.md', () => {
  it('creates AGENTS.md once', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-init-'));
    const a = await initAgentsMd(dir);
    assert.equal(a.created, true);
    const b = await initAgentsMd(dir);
    assert.equal(b.created, false);
  });
});

describe('fence parse + repair', () => {
  it('parses tool fences', () => {
    const calls = parseToolFences('```tool\n{"name":"grep","arguments":{"pattern":"x"}}\n```');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.name, 'grep');
  });

  it('repair hint on bash fence', () => {
    const hint = maybeFenceRepairHint('```bash\necho hi\n```', []);
    assert.ok(hint);
  });
});
