import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  compactSessionAtomic,
  loadSession,
  persistSession,
} from '../src/session';
import type { HarnessSession } from '../src/types';

function baseSession(cwd: string, tick: number): HarnessSession {
  return {
    messages: [{ role: 'user', content: `tick-${tick}` }],
    tick,
    readSet: [],
    toolLog: [],
    todos: [],
    cwd,
    model: 'gpt-oss-20b',
  };
}

describe('session', () => {
  it('crash mid-write leaves old JSONL', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sess-crash-'));
    await persistSession(dir, 's1', baseSession(dir, 1));
    const target = path.join(dir, 's1.jsonl');
    const before = await fs.readFile(target, 'utf8');
    // Simulate crash: incomplete tmp never renamed over target.
    await fs.writeFile(`${target}.${process.pid}.crash.tmp`, '{"tick":99', 'utf8');
    const loaded = await loadSession(dir, 's1');
    assert.equal(loaded?.tick, 1);
    assert.equal(await fs.readFile(target, 'utf8'), before);
    assert.match(before, /"tick":1/);
  });

  it('compact failure does not swap', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sess-compact-'));
    await persistSession(dir, 's1', baseSession(dir, 1));
    const before = await fs.readFile(path.join(dir, 's1.jsonl'), 'utf8');

    const circular: Record<string, unknown> = { role: 'user', content: 'x' };
    circular.self = circular;
    const bad = await compactSessionAtomic(dir, 's1', {
      ...baseSession(dir, 2),
      // Force JSON.stringify throw before rename.
      messages: [circular as never],
    });
    assert.equal(bad.ok, false);
    assert.ok(bad.error);

    const after = await fs.readFile(path.join(dir, 's1.jsonl'), 'utf8');
    assert.equal(after, before);
    const loaded = await loadSession(dir, 's1');
    assert.equal(loaded?.tick, 1);
  });
});
