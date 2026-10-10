import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HookRegistry, loadSkills, writeNapkin, readNapkin } from '../src/skills';
import { compactSessionAtomic, persistSession } from '../src/session';
import type { HarnessSession } from '../src/types';
import { assertClientsOnKernel } from '../src/adapters';

describe('session compact rollback', () => {
  it('valid compact swaps; see session.test.ts for failure path', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sess-'));
    const session: HarnessSession = {
      messages: [],
      tick: 1,
      readSet: [],
      toolLog: [],
      todos: [],
      cwd: dir,
      model: 'gpt-oss-20b',
    };
    await persistSession(dir, 's', session);
    const ok = await compactSessionAtomic(dir, 's', { ...session, tick: 2 });
    assert.equal(ok.ok, true);
    const after = await fs.readFile(path.join(dir, 's.jsonl'), 'utf8');
    assert.ok(after.includes('"tick":2'));
  });
});

describe('skills + hooks + napkin', () => {
  it('loads markdown skills', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-'));
    await fs.writeFile(path.join(dir, 'foo.md'), '# Foo Skill\nDo foo.\n');
    const skills = await loadSkills(dir);
    assert.equal(skills.length, 1);
    assert.equal(skills[0]!.id, 'foo');
  });

  it('hooks emit', async () => {
    const h = new HookRegistry();
    let n = 0;
    h.on('beforeTool', () => {
      n++;
    });
    await h.emit('beforeTool', {});
    assert.equal(n, 1);
  });

  it('napkin write/read', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nap-'));
    await writeNapkin(dir, 'note');
    assert.equal(await readNapkin(dir), 'note');
  });
});

describe('phase4 kernel grep gate', () => {
  it('flags IDE async runAgentTurn as offender', () => {
    const r = assertClientsOnKernel([
      'packages/spockify-harness/src/loop.ts:export async function runAgentTurn',
      'packages/spockify-cli/src/agent/loop.ts:export async function runAgentTurn',
      'extensions/spockify/src/runtime/agentLoop.ts:export async function runAgentTurn',
    ]);
    assert.equal(r.ok, false);
    assert.ok(r.offenders.some((o) => o.includes('extensions/spockify')));
  });

  it('passes when IDE uses runIdeAgentTurn only', () => {
    const r = assertClientsOnKernel([
      'packages/spockify-harness/src/loop.ts:export async function runAgentTurn',
      'packages/spockify-cli/src/agent/loop.ts:export async function runAgentTurn',
      'extensions/spockify/src/runtime/agentLoop.ts:export async function runIdeAgentTurn',
    ]);
    assert.equal(r.ok, true);
  });

  it('IDE agentLoop imports runHarness', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const body = await fs.readFile(
      path.join(root, 'extensions/spockify/src/runtime/agentLoop.ts'),
      'utf8',
    );
    assert.match(body, /runHarness/);
    assert.match(body, /@spockify\/harness/);
    assert.doesNotMatch(body, /for \(let turn/);
    const lines = body.replace(/\n$/, '').split('\n').length;
    assert.ok(lines <= 300, `agentLoop.ts is ${lines} lines (cap 300)`);
  });
});
