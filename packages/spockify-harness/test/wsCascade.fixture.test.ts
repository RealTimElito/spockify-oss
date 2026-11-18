/**
 * ws_cascade fixture proof: content ≠ exact SEARCH; L1 must fire; pytest flips red→green.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyEditCascade } from '../src/editCascade';
import { ToolRegistry } from '../src/registry';
import { registerHarnessTools } from '../src/tools';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FIX = path.join(
  ROOT,
  'snapshots/harness-20b-card-20260919/fixtures/ws_cascade',
);

const SEARCH_NO_TRAIL =
  'def greet(name):\n    return f"hi {name}"\n';
const REPLACE =
  'def greet(name):\n    return f"hello {name}"\n';

function pytestStatus(cwd: string): number {
  return spawnSync('python3', ['-m', 'pytest', '-q'], {
    cwd,
    encoding: 'utf8',
  }).status ?? 1;
}

describe('ws_cascade fixture', () => {
  it('file has trailing-space drift vs SEARCH (exact miss)', async () => {
    const body = await fs.readFile(path.join(FIX, 'greet.py'), 'utf8');
    assert.ok(body.includes('hi {name}"  '), 'expected trailing spaces on return');
    assert.equal(body.includes(SEARCH_NO_TRAIL), false);
    const r0 = applyEditCascade(body, SEARCH_NO_TRAIL, REPLACE);
    assert.equal(r0.ok, true);
    if (r0.ok) assert.equal(r0.layer, 1);
  });

  it('scripted edit_file fires L1 and turns pytest green', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-casc-'));
    await fs.copyFile(path.join(FIX, 'greet.py'), path.join(tmp, 'greet.py'));
    await fs.copyFile(
      path.join(FIX, 'test_greet.py'),
      path.join(tmp, 'test_greet.py'),
    );
    assert.notEqual(pytestStatus(tmp), 0, 'must be red before edit');

    const registry = new ToolRegistry();
    registerHarnessTools(registry);
    const result = await registry.call(
      'edit_file',
      {
        path: 'greet.py',
        old_string: SEARCH_NO_TRAIL.trimEnd() + '\n',
        new_string: REPLACE,
      },
      {
        cwd: tmp,
        mode: 'build',
        yolo: true,
        readSet: new Set(['greet.py']),
      },
    );
    assert.equal(result.ok, true, result.error || result.content);
    assert.match(result.content, /cascade L1/);
    assert.equal(pytestStatus(tmp), 0, 'must be green after L1');
  });

  it('apply_patch path also reports cascade L1', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ws-casc-ap-'));
    await fs.copyFile(path.join(FIX, 'greet.py'), path.join(tmp, 'greet.py'));
    const registry = new ToolRegistry();
    registerHarnessTools(registry);
    const result = await registry.call(
      'apply_patch',
      { path: 'greet.py', search: SEARCH_NO_TRAIL, replace: REPLACE },
      { cwd: tmp, mode: 'build', yolo: true },
    );
    assert.equal(result.ok, true, result.error || result.content);
    assert.match(result.content, /cascade L1/);
  });
});
