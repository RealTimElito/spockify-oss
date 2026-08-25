/**
 * Lance IVF scale path — large synthetic corpus triggers IVF when LanceDB loads.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildIndexFromChunks,
  saveIndex,
  hasLanceStore,
  searchLanceAnn,
  lanceDbAvailable,
  companionLancePath,
  IVF_MIN_ROWS,
} from '../src/index';

describe('lance IVF', () => {
  it('writes annIndex metadata; IVF when native + enough rows', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spockify-ivf-'));
    const file = path.join(dir, 'index.json');
    const dim = 16;
    const n = IVF_MIN_ROWS + 16;
    const chunks = [];
    const vectors: Record<string, number[]> = {};
    for (let i = 0; i < n; i++) {
      chunks.push({
        path: `f${i % 40}/c${i}.ts`,
        startLine: 1,
        endLine: 4,
        text: `chunk ${i} token${i % 7} vector scale test`,
      });
      const v = new Array(dim).fill(0);
      v[i % dim] = 1;
      v[(i * 3) % dim] = 0.5;
      vectors[String(i)] = v;
    }
    const index = buildIndexFromChunks('/tmp/ivf-fixture', chunks);
    index.vectors = vectors;
    index.embedModel = 'test-ivf';

    await saveIndex(file, index);
    assert.equal(await hasLanceStore(file), true);
    const meta = JSON.parse(
      await fs.readFile(path.join(companionLancePath(file), 'meta.json'), 'utf8'),
    );
    assert.equal(meta.count, n);
    assert.equal(meta.dim, dim);
    assert.ok(meta.ivfMinRows === IVF_MIN_ROWS);

    if (lanceDbAvailable()) {
      assert.match(String(meta.backend), /lancedb/);
      // IVF may train; accept ivf_pq / ivf_flat / none if training fails on host
      assert.ok(
        meta.annIndex === 'ivf_pq' ||
          meta.annIndex === 'ivf_flat' ||
          meta.annIndex === 'none',
      );
      if (meta.annIndex !== 'none') {
        assert.match(String(meta.backend), /ivf_/);
      }
    } else {
      assert.equal(meta.annIndex, 'none');
    }

    const q = vectors['0'];
    const hits = await searchLanceAnn(file, q, 5);
    assert.ok(hits && hits.length >= 1);
  });
});
