import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  buildIndex,
  createNodeFs,
  search,
  saveIndex,
  loadIndex,
} from '../src/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, 'fixtures', 'sample');

describe('codebase index + search', () => {
  it('respects gitignore and returns top hits', async () => {
    const fs = createNodeFs();
    const index = await buildIndex(fixtureRoot, fs);
    assert.ok(index.chunks.length > 0);
    const paths = new Set(index.chunks.map((c) => c.path));
    assert.ok(paths.has('src/alpha.ts'));
    assert.ok(paths.has('docs/readme.md'));
    assert.ok(!paths.has('dist/bundle.js'));
    assert.ok(!paths.has('node_modules/pkg/index.js'));
    assert.ok(!paths.has('secrets/key.txt'), '.spockifyignore should skip secrets/');
    assert.ok(!paths.has('foo.secret'), '.spockifyignore should skip *.secret');

    const hits = search(index, {
      query: 'xyzzy_spockify_fixture_marker_42',
      k: 5,
    });
    assert.ok(hits.length >= 1);
    assert.ok(hits[0].score > 0);
    assert.ok(
      hits.some((h) => h.path === 'src/alpha.ts' || h.path === 'docs/readme.md'),
    );

    const prefixHits = search(index, {
      query: 'xyzzy_spockify_fixture_marker_42',
      k: 5,
      pathPrefix: 'src',
    });
    assert.ok(prefixHits.every((h) => h.path.startsWith('src/')));
  });

  it('persists index to JSON', async () => {
    const fs = createNodeFs();
    const index = await buildIndex(fixtureRoot, fs);
    const tmp = path.join(__dirname, '.tmp-index.json');
    await saveIndex(tmp, index);
    const loaded = await loadIndex(tmp);
    assert.ok(loaded);
    assert.equal(loaded!.chunks.length, index.chunks.length);
    const hits = search(loaded!, { query: 'helper', k: 3 });
    assert.ok(hits.some((h) => h.path === 'src/alpha.ts'));
    await unlink(tmp).catch(() => {});
  });
});
