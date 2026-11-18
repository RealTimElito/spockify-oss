import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  codexPatchToSrHunks,
  looksLikeCodexPatch,
  pathFromCodexPatch,
} from '../src/codexPatch';
import { ToolRegistry } from '../src/registry';
import { registerHarnessTools, resolveApplyPatchPath } from '../src/tools';

describe('codexPatch', () => {
  const sample = `*** Begin Patch
*** Update File: src/sqlfluff/rules/L031.py
@@
 def foo():
-    return 1
+    return 2
*** End Patch`;

  it('extracts Update File path', () => {
    assert.equal(pathFromCodexPatch(sample), 'src/sqlfluff/rules/L031.py');
    assert.equal(looksLikeCodexPatch(sample), true);
  });

  it('converts @@ hunks to SEARCH/REPLACE', () => {
    const r = codexPatchToSrHunks(sample);
    assert.equal(r.hunks.length, 1);
    assert.equal(r.hunks[0]!.search, 'def foo():\n    return 1');
    assert.equal(r.hunks[0]!.replace, 'def foo():\n    return 2');
  });

  it('apply_patch accepts Codex body without path arg', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harness-codex-'));
    const rel = 'src/a.py';
    await fs.mkdir(path.join(dir, 'src'), { recursive: true });
    await fs.writeFile(path.join(dir, rel), 'def foo():\n    return 1\n', 'utf8');
    assert.equal(
      resolveApplyPatchPath({
        patch: `*** Begin Patch\n*** Update File: ${rel}\n@@\n def foo():\n-    return 1\n+    return 2\n*** End Patch`,
      }),
      rel,
    );
    const reg = new ToolRegistry();
    registerHarnessTools(reg);
    const r = await reg.call(
      'apply_patch',
      {
        patch: `*** Begin Patch\n*** Update File: ${rel}\n@@\n def foo():\n-    return 1\n+    return 2\n*** End Patch`,
      },
      { cwd: dir, mode: 'agent', yolo: true },
    );
    assert.equal(r.ok, true, r.error);
    assert.equal(
      await fs.readFile(path.join(dir, rel), 'utf8'),
      'def foo():\n    return 2\n',
    );
  });
});
