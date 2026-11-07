import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { registerHarnessTools } from '../src/tools';
import { ToolRegistry } from '../src/registry';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe('apply_patch bare @@ hunk fallback', () => {
  it('applies a plain @@ hunk body with no SEARCH/REPLACE markers and no Codex wrapper', async () => {
    const dir = await tmpDir('bare-hunk-');
    const file = path.join(dir, 'api.py');
    await fs.writeFile(file, 'def foo():\n    return 1\n', 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const ctx = { cwd: dir, mode: 'agent' as const, yolo: true };
    const patch = `@@ -1,2 +1,2 @@
 def foo():
-    return 1
+    return 2
`;
    const r = await reg.call('apply_patch', { path: 'api.py', patch }, ctx);
    assert.equal(r.ok, true, r.error);
    assert.equal(await fs.readFile(file, 'utf8'), 'def foo():\n    return 2\n');
  });

  it('still rejects a real unified diff with --- a/ file headers', async () => {
    const dir = await tmpDir('bare-hunk-reject-');
    const file = path.join(dir, 'api.py');
    await fs.writeFile(file, 'x = 1\n', 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const ctx = { cwd: dir, mode: 'agent' as const, yolo: true };
    const patch = `diff --git a/api.py b/api.py
--- a/api.py
+++ b/api.py
@@ -1,1 +1,1 @@
-x = 1
+x = 2
`;
    const r = await reg.call('apply_patch', { path: 'api.py', patch }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.error || '', /unified diff rejected/i);
    assert.equal(await fs.readFile(file, 'utf8'), 'x = 1\n');
  });

  it('noop bare hunk (identical old/new) is still rejected as a noop', async () => {
    const dir = await tmpDir('bare-hunk-noop-');
    const file = path.join(dir, 'api.py');
    await fs.writeFile(file, 'x = 1\n', 'utf8');
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const ctx = { cwd: dir, mode: 'agent' as const, yolo: true };
    const patch = `@@ -1,1 +1,1 @@
 x = 1
`;
    const r = await reg.call('apply_patch', { path: 'api.py', patch }, ctx);
    assert.equal(r.ok, false);
    assert.equal(await fs.readFile(file, 'utf8'), 'x = 1\n');
  });
});
