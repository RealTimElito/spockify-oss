/**
 * Shadow workspace package tests — Phase 4
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createShadowWorkspace,
  listDurableShadows,
  unifiedDiffForFile,
} from '../src/index';

describe('shadow workspace', () => {
  it('stages proposals without touching real files until promote', async () => {
    const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'spockify-ws-'));
    await fs.writeFile(path.join(ws, 'a.ts'), 'const x = 1;\n', 'utf8');

    const shadow = await createShadowWorkspace('test-sess', {
      workspaceRoot: ws,
    });
    assert.ok(shadow.root.includes(path.join('.spockify', 'shadow')));
    await shadow.writeProposed('a.ts', 'const x = 2;\n');
    await shadow.writeProposed('b.ts', 'export const y = 3;\n');

    const realA = await fs.readFile(path.join(ws, 'a.ts'), 'utf8');
    assert.equal(realA, 'const x = 1;\n');

    const diffs = await shadow.diffAgainstReal(ws);
    assert.equal(diffs.length, 2);
    assert.ok(diffs.every((d) => d.changed));
    assert.ok(diffs.find((d) => d.path === 'a.ts')?.unifiedDiff?.includes('-const x = 1'));

    const listed = await listDurableShadows(ws);
    assert.ok(listed.some((s) => s.sessionId === 'test-sess'));

    await shadow.dispose();
  });

  it('unifiedDiffForFile marks adds', () => {
    const d = unifiedDiffForFile('f.ts', undefined, 'hi\n');
    assert.ok(d.includes('+hi'));
    assert.ok(d.includes('--- a/f.ts'));
  });
});
