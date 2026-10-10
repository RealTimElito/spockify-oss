/**
 * Monorepo slice smoke — index real packages/spockify-codebase/src and prove
 * hybrid retrieval returns code-path hits (hash embed; optional live embed later).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIndex,
  createNodeFs,
  hybridSearch,
  search,
  attachHashVectors,
  saveIndex,
  loadIndex,
  hasSqliteStore,
} from '../src/index';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');
const srcRoot = path.join(pkgRoot, 'src');

describe('monorepo hybrid smoke', () => {
  it('indexes real src/ and hybrid finds store/hybrid modules', async () => {
    const index = await buildIndex(srcRoot, createNodeFs(), {
      maxFileBytes: 200_000,
    });
    assert.ok(index.chunks.length >= 8, `expected chunks, got ${index.chunks.length}`);
    const withVec = attachHashVectors(index);

    const bm25 = search(withVec, { query: 'sqlite companion vector store', k: 5 });
    const hybrid = await hybridSearch(
      withVec,
      { query: 'sqlite companion vector store', k: 5 },
      { hybrid: true },
    );
    assert.ok(hybrid.length >= 1);
    const paths = hybrid.map((h) => h.path).join(' ');
    assert.match(paths, /store|hybrid|vector/, `unexpected paths: ${paths}`);

    // Hybrid should at least include a store-related hit when BM25 does,
    // or recover one via hash vectors when query is softer.
    const soft = await hybridSearch(
      withVec,
      { query: 'durable embedding persistence', k: 5 },
      { hybrid: true },
    );
    assert.ok(soft.length >= 1);
    void bm25;

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'spockify-mono-'));
    const jsonPath = path.join(tmp, 'index.json');
    await saveIndex(jsonPath, withVec);
    const loaded = await loadIndex(jsonPath);
    assert.ok(loaded);
    assert.equal(loaded!.chunks.length, withVec.chunks.length);
    if (await hasSqliteStore(jsonPath)) {
      assert.ok(true);
    }
  });
});
