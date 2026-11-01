import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { applySearchReplace, rejectUnifiedDiff } from '../src/gitTxn';
import { ToolRegistry } from '../src/registry';
import {
  defaultRunTestsCommand,
  preferVenvTestCommand,
  registerHarnessTools,
  resolveApplyPatchPath,
} from '../src/tools';
import { authorizeTool } from '../src/policy';
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

  it('accepts file/filepath aliases for path', async () => {
    assert.equal(resolveApplyPatchPath({ file: 'a.txt' }), 'a.txt');
    assert.equal(resolveApplyPatchPath({ filepath: 'b.py' }), 'b.py');
    assert.equal(resolveApplyPatchPath({ file_path: 'c.py' }), 'c.py');
    assert.equal(resolveApplyPatchPath({ target: 'd.py' }), 'd.py');
    assert.equal(resolveApplyPatchPath({ path: 'p.py', file: 'x.py' }), 'p.py');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-ap-alias-'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'hello\n', 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const r = await reg.call(
      'apply_patch',
      { file: 'a.txt', search: 'hello', replace: 'world' },
      { cwd: dir, mode: 'agent', yolo: true },
    );
    assert.equal(r.ok, true);
    assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'world\n');
  });
});

describe('harness-unlock stub gate', () => {
  it('rejects _noop stub that only unlocks tests', async () => {
    const { spawnSync } = await import('node:child_process');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-stub-'));
    spawnSync('git', ['init'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    const src = path.join(dir, 'api.py');
    await fs.writeFile(src, 'x = 1\n\nclass E(Exception):\n    pass\n', 'utf8');
    spawnSync('git', ['add', '.'], { cwd: dir });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: dir });
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const writtenRelPaths = new Set<string>();
    const readSet = new Set<string>(['api.py']);
    const ctx = { cwd: dir, mode: 'agent' as const, yolo: true, writtenRelPaths, readSet };
    const stub = await reg.call(
      'apply_patch',
      {
        path: 'api.py',
        search: 'x = 1\n\nclass E(Exception):\n    pass\n',
        replace:
          'x = 1\n' +
          '# required by the testing harness before executing the test suite\n' +
          'def _noop():\n' +
          '    pass\n\n' +
          'class E(Exception):\n' +
          '    pass\n',
      },
      ctx,
    );
    assert.equal(stub.ok, false);
    assert.match(stub.error || '', /harness-unlock stub rejected/i);
    assert.equal(writtenRelPaths.size, 0);
    assert.equal(
      await fs.readFile(src, 'utf8'),
      'x = 1\n\nclass E(Exception):\n    pass\n',
    );
  });
});

describe('noop write gate', () => {
  it('identical SEARCH/REPLACE does not count as successful write', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-noop-'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'import sys\n', 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const writtenRelPaths = new Set<string>();
    const ctx = { cwd: dir, mode: 'agent' as const, yolo: true, writtenRelPaths };
    const noop = await reg.call(
      'apply_patch',
      { path: 'a.txt', patch: 'SEARCH\nimport sys\nREPLACE\nimport sys\n' },
      ctx,
    );
    assert.equal(noop.ok, false);
    assert.match(noop.error || '', /noop apply_patch|identical SEARCH\/REPLACE/i);
    assert.equal(writtenRelPaths.size, 0);
    assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'import sys\n');
    const blocked = await reg.call('run_tests', { command: 'true' }, ctx);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error || '', /run_tests blocked/i);
    const real = await reg.call(
      'apply_patch',
      { path: 'a.txt', search: 'import sys', replace: 'import os' },
      ctx,
    );
    assert.equal(real.ok, true);
    assert.equal(writtenRelPaths.size, 1);
    assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'import os\n');
  });
});

describe('tracked repo-diff write gate', () => {
  it('untracked write does not unlock run_tests; tracked edit does', async () => {
    const { spawnSync } = await import('node:child_process');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-tracked-'));
    spawnSync('git', ['init'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    await fs.mkdir(path.join(dir, 'pkg'), { recursive: true });
    await fs.writeFile(path.join(dir, 'pkg', 'mod.py'), 'x = 1\n', 'utf8');
    spawnSync('git', ['add', '.'], { cwd: dir });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: dir });
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const writtenRelPaths = new Set<string>();
    const readSet = new Set<string>();
    const ctx = { cwd: dir, mode: 'agent' as const, yolo: true, writtenRelPaths, readSet };
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    const untracked = await reg.call(
      'write_file',
      { path: 'tests/__init__.py', content: '' },
      ctx,
    );
    assert.equal(untracked.ok, true);
    assert.match(untracked.content || '', /untracked|does not unlock/i);
    assert.equal(writtenRelPaths.size, 0);
    const blocked = await reg.call('run_tests', { command: 'true' }, ctx);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error || '', /tracked\/repo-diff|run_tests blocked/i);
    readSet.add('pkg/mod.py');
    const tracked = await reg.call(
      'apply_patch',
      { path: 'pkg/mod.py', search: 'x = 1', replace: 'x = 2' },
      ctx,
    );
    assert.equal(tracked.ok, true);
    assert.equal(writtenRelPaths.size, 1);
    assert.equal(await fs.readFile(path.join(dir, 'pkg', 'mod.py'), 'utf8'), 'x = 2\n');
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

describe('venv-prefer run_tests defaults', () => {
  it('defaults to django runtests when .venv + tests/runtests.py exist', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-venv-'));
    await fs.mkdir(path.join(dir, '.venv', 'bin'), { recursive: true });
    await fs.writeFile(path.join(dir, '.venv', 'bin', 'python'), '#!/bin/true\n');
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tests', 'runtests.py'), '#\n');
    const cmd = defaultRunTestsCommand(dir);
    assert.match(cmd, /\.venv\/bin\/python/);
    assert.match(cmd, /tests\/runtests\.py/);
    assert.match(cmd, /test_sqlite/);
  });

  it('rewrites bare pytest onto .venv python', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-venv2-'));
    await fs.mkdir(path.join(dir, '.venv', 'bin'), { recursive: true });
    await fs.writeFile(path.join(dir, '.venv', 'bin', 'python'), '#!/bin/true\n');
    const cmd = preferVenvTestCommand(dir, 'pytest -q');
    assert.match(cmd, /\.venv\/bin\/python -m pytest -q/);
  });

  it('allows django runtests on the verifier allowlist', () => {
    const d = authorizeTool({
      tool: 'run_tests',
      args: {
        command:
          '.venv/bin/python tests/runtests.py --verbosity 1 --settings=test_sqlite --parallel 1 utils_tests.x',
      },
    });
    assert.notEqual(d.action, 'deny');
  });
});
