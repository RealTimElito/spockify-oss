/**
 * Offline 10-task kernel scorecard. No model, no GPU, not SWE/G2.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  IsolationRequiredError,
  assertIsolationReady,
  authorizeTool,
  bwrapArgv,
  doneReason,
  isVerifierCommand,
  loadSession,
  parseSrHunks,
  resolveIsolation,
  resolveSafe,
} from '../src/index';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, 'fixtures/scorecard10.json'), 'utf8'),
) as { tasks: Array<{ id: string }> };

const results: Array<{ id: string; ok: boolean }> = [];

async function task(id: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  results.push({ id, ok: true });
}

describe('offline kernel scorecard-10', () => {
  it('catalog lists 10 tasks and none need a model', () => {
    assert.equal(catalog.tasks.length, 10);
  });

  it('runs 10 deterministic kernel fixtures', async () => {
    await task('parse-sr', () => {
      const r = parseSrHunks('SEARCH\nold\nREPLACE\nnew\n');
      assert.equal(r.hunks.length, 1);
      assert.equal(r.hunks[0]!.replace.trim(), 'new');
    });

    await task('parse-sr-malformed', () => {
      const r = parseSrHunks('this is not a patch');
      assert.ok(r.error);
      assert.equal(r.hunks.length, 0);
    });

    await task('path-symlink', async () => {
      const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'sc10-'));
      const ws = path.join(dir, 'ws');
      await fsPromises.mkdir(ws);
      await fsPromises.writeFile(path.join(dir, 'secret.txt'), 'SECRET');
      await fsPromises.symlink(path.join(dir, 'secret.txt'), path.join(ws, 'leak'));
      await assert.rejects(() => resolveSafe(ws, 'leak'), /escapes workspace/);
    });

    await task('grant-host-only', () => {
      const d = authorizeTool({ tool: 'grant', args: { pattern: 'shell *' } });
      assert.equal(d.action, 'deny');
    });

    await task('run-tests-metachar', () => {
      assert.equal(isVerifierCommand('pytest -q; rm -rf /'), false);
      const d = authorizeTool({
        tool: 'run_tests',
        args: { command: 'pytest -q; id' },
      });
      assert.equal(d.action, 'deny');
    });

    await task('done-reason', () => {
      assert.equal(doneReason({}), 'unverified');
      assert.equal(doneReason({ cancelled: true }), 'cancelled');
      assert.equal(doneReason({ reason: 'verified' }), 'verified');
    });

    await task('isolate-workstation', () => {
      const e: NodeJS.ProcessEnv = { PATH: process.env.PATH };
      assert.equal(resolveIsolation(e).backend, 'none');
    });

    await task('isolate-production-fail-closed', () => {
      const e: NodeJS.ProcessEnv = {
        SPOCKIFY_PRODUCTION: '1',
        PATH: '/does-not-exist-for-which',
      };
      assert.throws(() => assertIsolationReady(e), IsolationRequiredError);
    });

    await task('bwrap-unshare-pid', () => {
      const args = bwrapArgv('true', '/work/ws', { PATH: process.env.PATH });
      assert.ok(args.includes('--unshare-pid'));
      assert.ok(args.includes('--unshare-net'));
      assert.ok(args.includes('--cap-drop'));
      assert.ok(!args.some((a) => a.includes('docker.sock')));
    });

    await task('session-corrupt', async () => {
      const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'sc10s-'));
      await fsPromises.writeFile(path.join(dir, 's.jsonl'), '{not json\n');
      assert.equal(await loadSession(dir, 's'), null);
    });

    assert.equal(results.length, 10);
    assert.ok(results.every((r) => r.ok));
    assert.deepEqual(
      results.map((r) => r.id),
      catalog.tasks.map((t) => t.id),
    );
    // Honest label for CI logs — not SWE, not G2.
    console.log(
      `SCORECARD-10 offline kernel ${results.filter((r) => r.ok).length}/10 (no model)`,
    );
  });

  it('l0-extra catalog stays offline and does not claim G2', () => {
    const extra = JSON.parse(
      fs.readFileSync(path.join(root, 'fixtures/scorecard-l0-extra.json'), 'utf8'),
    ) as { kind: string; note: string; tasks: unknown[] };
    assert.equal(extra.kind, 'offline-kernel-fixtures');
    assert.match(extra.note, /not G2/i);
    assert.match(extra.note, /Phase 5 stays Partial/);
    assert.ok(extra.tasks.length >= 8);
  });
});
