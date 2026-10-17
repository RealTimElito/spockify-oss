/**
 * P0 reproducers from the production-readiness plan (SEC-01..04, REL-01..03, EDIT-01..02).
 * Each case failed on the pre-fix kernel; keep the names stable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import type { ModelTransport } from '@spockify/ide-client';
import {
  PermissionMemory,
  ToolRegistry,
  authorizeTool,
  classifyBash,
  parseSrHunks,
  registerHarnessTools,
  runHarness,
  runToolsParallel,
} from '../src/index';
import type { HarnessEvent, HarnessSession } from '../src/types';

function ctx(cwd: string, extra?: Record<string, unknown>) {
  return {
    cwd,
    mode: 'agent' as const,
    yolo: true,
    ...extra,
  };
}

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('SEC-01 agent-issued grant escalation', () => {
  it('plan/build/yolo cannot self-grant via the grant tool', async () => {
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const perms = new PermissionMemory();
    for (const mode of ['plan', 'build', 'agent'] as const) {
      const r = await reg.call(
        'grant',
        { pattern: 'shell *' },
        { cwd: process.cwd(), mode, yolo: true, permissions: perms },
      );
      assert.equal(r.ok, false, `mode=${mode}`);
      assert.match(r.error || '', /host-only/i);
      assert.equal(perms.allows('shell', { command: 'curl http://x' }), false);
    }
    const listed = reg.listForMode('agent').map((t) => t.name);
    assert.equal(listed.includes('grant'), false);
    assert.equal(listed.includes('revoke'), false);
  });

  it('hostPrivileged grant still works for the controller plane', async () => {
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const perms = new PermissionMemory();
    const r = await reg.call(
      'grant',
      { pattern: 'shell npm *' },
      {
        cwd: process.cwd(),
        mode: 'agent',
        yolo: false,
        permissions: perms,
        hostPrivileged: true,
      },
    );
    assert.equal(r.ok, true);
    assert.equal(perms.allows('shell', { command: 'npm test' }), true);
  });
});

describe('SEC-02 run_tests shell bypass', () => {
  it('denies metacharacters and non-allowlisted commands', async () => {
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const dir = await tmpDir('p0-tests-');
    const evil = await reg.call(
      'run_tests',
      { command: 'pytest -q; curl http://127.0.0.1:1' },
      ctx(dir),
    );
    assert.equal(evil.ok, false);
    assert.match(evil.error || '', /metacharacter|allowlist|denied/i);

    const rm = await reg.call(
      'run_tests',
      { command: 'rm -rf /' },
      ctx(dir),
    );
    assert.equal(rm.ok, false);

    const policy = authorizeTool({
      tool: 'run_tests',
      args: { command: 'python -c "import os; os.system(\\"id\\")"' },
    });
    assert.equal(policy.action, 'deny');
  });

  it('task bash goes through the same broker', async () => {
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const r = await reg.call(
      'task',
      { kind: 'bash', command: 'rm -rf /' },
      ctx(process.cwd()),
    );
    assert.equal(r.ok, false);
  });
});

describe('SEC-03 symlink workspace escape', () => {
  it('read/write through a symlink out of cwd is denied', async () => {
    const root = await tmpDir('p0-sym-');
    const ws = path.join(root, 'ws');
    const outside = path.join(root, 'outside');
    await fs.mkdir(ws);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'secret.txt'), 'SECRET', 'utf8');
    await fs.symlink(outside, path.join(ws, 'escape'));
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const read = await reg.call(
      'read_file',
      { path: 'escape/secret.txt' },
      ctx(ws),
    );
    assert.equal(read.ok, false);
    assert.match(read.error || '', /escapes workspace/i);

    const write = await reg.call(
      'write_file',
      { path: 'escape/pwned.txt', content: 'pwn' },
      ctx(ws, { readSet: new Set() }),
    );
    assert.equal(write.ok, false);
    assert.match(write.error || '', /escapes workspace/i);
    await assert.rejects(fs.readFile(path.join(outside, 'pwned.txt')));
  });
});

describe('SEC-04 command classifier encodings', () => {
  it('compound commands take the worst segment', () => {
    assert.equal(classifyBash('rm -rf /'), 'deny');
    assert.equal(classifyBash('pytest -q; rm -rf /'), 'deny');
    assert.equal(classifyBash('pytest -q; curl http://x'), 'ask');
    assert.equal(classifyBash('$(curl http://x)'), 'ask');
    assert.equal(classifyBash('pytest -q'), 'auto');
    assert.equal(classifyBash('/bin/rm -rf /'), 'deny');
    assert.equal(classifyBash('git push origin main'), 'ask');
    assert.equal(classifyBash('git status'), 'auto');
  });
});

describe('REL-01 generator rejection hang', () => {
  it('provider throw settles runHarness with reason=failed', async () => {
    const transport = {
      async *streamChatCompletions() {
        throw new Error('provider down');
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const session: HarnessSession = {
      messages: [{ role: 'user', content: 'hi' }],
      tick: 0,
      readSet: [],
      toolLog: [],
      todos: [],
      cwd: process.cwd(),
      model: 'mock',
    };
    const events: HarnessEvent[] = [];
    const started = Date.now();
    const gen = runHarness({
      transport,
      session,
      registry: reg,
      policy: { mode: 'build', maxTurns: 3, yolo: true },
    });
    const watchdog = setTimeout(() => {
      assert.fail('runHarness hung after provider rejection');
    }, 3000);
    for await (const ev of gen) {
      events.push(ev);
    }
    clearTimeout(watchdog);
    assert.ok(Date.now() - started < 2500);
    const done = events.find((e) => e.type === 'done');
    assert.ok(done);
    if (done && done.type === 'done') {
      assert.equal(done.reason, 'failed');
    }
  });
});

describe('EDIT-01 SEARCH/REPLACE parser', () => {
  it('parses single and multi-hunk patches; rejects malformed', async () => {
    const one = parseSrHunks('SEARCH\nfoo\nREPLACE\nbar\n');
    assert.equal(one.error, undefined);
    assert.equal(one.hunks.length, 1);
    assert.equal(one.hunks[0]!.search, 'foo');
    assert.equal(one.hunks[0]!.replace, 'bar');

    const two = parseSrHunks(
      'SEARCH\none\nREPLACE\nONE\nSEARCH\ntwo\nREPLACE\nTWO\n',
    );
    assert.equal(two.hunks.length, 2);
    assert.equal(two.hunks[1]!.replace, 'TWO');

    const missing = parseSrHunks('SEARCH\nfoo\n');
    assert.match(missing.error || '', /missing REPLACE/i);

    const dir = await tmpDir('p0-sr-');
    await fs.writeFile(path.join(dir, 'a.txt'), 'alpha\nbeta\n', 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const okPatch = await reg.call(
      'apply_patch',
      {
        path: 'a.txt',
        patch: 'SEARCH\nalpha\nREPLACE\nALPHA\nSEARCH\nbeta\nREPLACE\nBETA\n',
      },
      ctx(dir),
    );
    assert.equal(okPatch.ok, true);
    assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'ALPHA\nBETA\n');

    const bad = await reg.call(
      'apply_patch',
      { path: 'a.txt', patch: 'SEARCH\nnope' },
      ctx(dir),
    );
    assert.equal(bad.ok, false);
    assert.match(bad.error || '', /REPLACE|SEARCH/i);
    assert.equal(await fs.readFile(path.join(dir, 'a.txt'), 'utf8'), 'ALPHA\nBETA\n');
  });
});

describe('EDIT-02 concurrent same-file writes', () => {
  it('serializes mutators so the second cannot silently overwrite', async () => {
    const dir = await tmpDir('p0-par-');
    const file = path.join(dir, 'f.txt');
    await fs.writeFile(file, 'A', 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const readSet = new Set<string>(['f.txt']);
    const out = await runToolsParallel(
      [
        {
          id: '1',
          name: 'edit_file',
          arguments: { path: 'f.txt', old_string: 'A', new_string: 'B' },
        },
        {
          id: '2',
          name: 'edit_file',
          arguments: { path: 'f.txt', old_string: 'A', new_string: 'C' },
        },
      ],
      reg,
      { cwd: dir, mode: 'agent', yolo: true, readSet },
      { parallel: true },
    );
    assert.equal(out[0]!.result.ok, true);
    assert.equal(out[1]!.result.ok, false);
    assert.equal(await fs.readFile(file, 'utf8'), 'B');
  });
});

describe('REL-02 completion honesty', () => {
  it('prose done without a verifier is unverified, not verified', async () => {
    const transport = {
      async *streamChatCompletions() {
        yield { content: 'All tests passed.\ndone' };
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const session: HarnessSession = {
      messages: [{ role: 'user', content: 'fix it' }],
      tick: 0,
      readSet: [],
      toolLog: [],
      todos: [],
      cwd: process.cwd(),
      model: 'mock',
    };
    const events: HarnessEvent[] = [];
    for await (const ev of runHarness({
      transport,
      session,
      registry: reg,
      policy: { mode: 'build', maxTurns: 4, yolo: true },
    })) {
      events.push(ev);
    }
    const done = events.filter((e) => e.type === 'done').pop();
    assert.ok(done && done.type === 'done');
    assert.equal(done.reason, 'unverified');
  });

  it('max turns emits exhausted', async () => {
    const transport = {
      async *streamChatCompletions() {
        yield {
          toolCalls: [
            { id: 'c1', name: 'glob', arguments: { pattern: '*.md' } },
          ],
        };
      },
    } as unknown as ModelTransport;
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const dir = await tmpDir('p0-exh-');
    const session: HarnessSession = {
      messages: [{ role: 'user', content: 'loop' }],
      tick: 0,
      readSet: [],
      toolLog: [],
      todos: [],
      cwd: dir,
      model: 'mock',
    };
    const events: HarnessEvent[] = [];
    for await (const ev of runHarness({
      transport,
      session,
      registry: reg,
      policy: { mode: 'build', maxTurns: 2, yolo: true },
    })) {
      events.push(ev);
    }
    const done = events.filter((e) => e.type === 'done').pop();
    assert.ok(done && done.type === 'done');
    assert.equal(done.reason, 'exhausted');
  });
});

describe('REL-03 rollback safety', () => {
  it('git_reset refuses to clobber unrelated user edits', async () => {
    const dir = await tmpDir('p0-git-');
    spawnSync('git', ['init'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    await fs.writeFile(path.join(dir, 'ours.txt'), 'o1', 'utf8');
    await fs.writeFile(path.join(dir, 'user.txt'), 'u1', 'utf8');
    spawnSync('git', ['add', '.'], { cwd: dir });
    spawnSync('git', ['commit', '-m', 'init'], { cwd: dir });
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const c = ctx(dir, { writtenRelPaths: new Set<string>() });
    const snap = await reg.call('git_snapshot', {}, c);
    assert.equal(snap.ok, true);
    const readSet = new Set(['ours.txt']);
    await reg.call(
      'write_file',
      { path: 'ours.txt', content: 'o2' },
      { ...c, readSet, writtenRelPaths: c.writtenRelPaths as Set<string> },
    );
    await fs.writeFile(path.join(dir, 'user.txt'), 'user-keep', 'utf8');
    const reset = await reg.call('git_reset', {}, {
      ...c,
      writtenRelPaths: c.writtenRelPaths as Set<string>,
    });
    assert.equal(reset.ok, false);
    assert.match(reset.error || '', /unrelated/i);
    assert.equal(await fs.readFile(path.join(dir, 'user.txt'), 'utf8'), 'user-keep');
  });
});
