/**
 * Lance-class durable vector store + ANN seed into hybrid.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildIndexFromChunks,
  saveIndex,
  loadIndex,
  hasLanceStore,
  searchLanceAnn,
  lanceDbAvailable,
  hybridSearch,
  companionLancePath,
} from '../src/index';

describe('lance store', () => {
  it('saveIndex writes flat Lance companion and ANN finds auth vector', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spockify-lance-'));
    const file = path.join(dir, 'index.json');
    const AUTH = new Array(8).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    const UI = new Array(8).fill(0).map((_, i) => (i === 1 ? 1 : 0));
    const index = buildIndexFromChunks('/tmp/lance-fixture', [
      {
        path: 'auth/login.ts',
        startLine: 1,
        endLine: 5,
        text: 'function authenticateUser password hash',
      },
      {
        path: 'ui/banner.tsx',
        startLine: 1,
        endLine: 4,
        text: 'export function SessionBanner chrome',
      },
    ]);
    index.vectors = { '0': AUTH, '1': UI };
    index.embedModel = 'test-controlled';

    await saveIndex(file, index);
    assert.equal(await hasLanceStore(file), true);
    const meta = JSON.parse(
      await fs.readFile(path.join(companionLancePath(file), 'meta.json'), 'utf8'),
    );
    assert.equal(meta.count, 2);
    assert.equal(meta.dim, 8);

    const hits = await searchLanceAnn(file, AUTH, 2);
    assert.ok(hits && hits.length >= 1);
    // Flat companion now ships chunks.json — real paths even without native Lance.
    assert.equal(hits![0].path, 'auth/login.ts');
    assert.ok(hits![0].text.includes('authenticate'));

    const metaChunks = JSON.parse(
      await fs.readFile(path.join(companionLancePath(file), 'chunks.json'), 'utf8'),
    );
    assert.equal(metaChunks.length, 2);
    assert.equal(meta.version, 3);
    assert.equal(meta.hasChunkMeta, true);

    const hybrid = await hybridSearch(
      index,
      { query: 'sign-in credentials', k: 2 },
      {
        hybrid: true,
        vectorSeed: hits!,
        embed: async () => [AUTH],
      },
    );
    assert.equal(hybrid[0]?.path, 'auth/login.ts');

    // Round-trip load still works with Lance present
    const loaded = await loadIndex(file);
    assert.ok(loaded);
    assert.equal(loaded!.chunks.length, 2);
    void lanceDbAvailable; // presence logged by meta.backend
    if (lanceDbAvailable()) {
      assert.match(String(meta.backend), /lancedb/);
    }
  });
});
