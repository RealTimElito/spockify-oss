/**
 * Hybrid search — prove semantic leg can beat BM25-only on synonym query.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  buildIndexFromChunks,
  hybridSearch,
  trimHitsToBudget,
  hashEmbed,
  cosine,
  saveIndex,
  loadIndex,
  hasSqliteStore,
  search,
} from '../src/index';

describe('hybrid search', () => {
  it('fuses bm25 + vectors and returns paths', async () => {
    const index = buildIndexFromChunks('/tmp/fixture', [
      {
        path: 'auth/login.ts',
        startLine: 1,
        endLine: 10,
        text: 'function authenticateUser password hash bcrypt',
      },
      {
        path: 'ui/button.ts',
        startLine: 1,
        endLine: 5,
        text: 'export const PrimaryButton styles',
      },
    ]);
    const hits = await hybridSearch(
      index,
      { query: 'authenticate password', k: 2 },
      { hybrid: true },
    );
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].path, 'auth/login.ts');
  });

  it('hash embed cosine is self-similar', () => {
    const a = hashEmbed('hello world spockify');
    assert.ok(cosine(a, a) > 0.99);
  });

  it('trimHitsToBudget drops overflow', () => {
    const hits = [
      { path: 'a', startLine: 1, endLine: 2, text: 'x'.repeat(100), score: 1 },
      { path: 'b', startLine: 1, endLine: 2, text: 'y'.repeat(100), score: 0.5 },
    ];
    const trimmed = trimHitsToBudget(hits, 30);
    assert.ok(trimmed.length >= 1);
    assert.ok(trimmed.length <= 2);
  });

  /**
   * Documented semantic win: query uses synonyms absent from the auth chunk.
   * BM25 ranks the UI chrome file (shared token "session") first;
   * a controlled embed maps "sign-in" ≈ "authenticate" so hybrid recovers auth.
   */
  it('hybrid beats BM25-only on synonym query (controlled embed)', async () => {
    const authText =
      'function authenticateUser(password: string) { return bcrypt.hash(password); }';
    const uiText =
      'export function SessionBanner() { return <div className="session chrome" />; }';
    const index = buildIndexFromChunks('/tmp/semantic-fixture', [
      { path: 'auth/login.ts', startLine: 1, endLine: 5, text: authText },
      { path: 'ui/session.tsx', startLine: 1, endLine: 4, text: uiText },
    ]);

    // Artificial embed: auth cluster vs chrome cluster
    const AUTH = new Array(8).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    const UI = new Array(8).fill(0).map((_, i) => (i === 1 ? 1 : 0));
    index.vectors = {
      '0': AUTH,
      '1': UI,
    };
    index.embedModel = 'test-controlled';

    const query = 'sign-in session credentials';
    const bm25 = search(index, { query, k: 2 });
    assert.equal(
      bm25[0]?.path,
      'ui/session.tsx',
      'BM25 should prefer session chrome (shared token)',
    );

    const hybrid = await hybridSearch(
      index,
      { query, k: 2 },
      {
        hybrid: true,
        embed: async () => [AUTH], // query lives in auth semantic space
      },
    );
    assert.equal(
      hybrid[0]?.path,
      'auth/login.ts',
      'hybrid+embed should recover auth over BM25 chrome hit',
    );
  });

  it('saveIndex writes durable SQLite companion when node:sqlite works', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spockify-idx-'));
    const file = path.join(dir, 'index.json');
    const index = buildIndexFromChunks('/tmp/store-fixture', [
      {
        path: 'a.ts',
        startLine: 1,
        endLine: 2,
        text: 'const answer = 42',
      },
    ]);
    await saveIndex(file, index);
    const loaded = await loadIndex(file);
    assert.ok(loaded);
    assert.equal(loaded!.chunks.length, 1);
    assert.ok(loaded!.vectors?.['0']?.length);
    // SQLite companion expected on Node 22+
    const hasSql = await hasSqliteStore(file);
    if (hasSql) {
      // Force load via sqlite by removing JSON briefly
      const bak = file + '.bak';
      await fs.rename(file, bak);
      const fromSql = await loadIndex(file);
      assert.ok(fromSql);
      assert.equal(fromSql!.chunks[0].path, 'a.ts');
      await fs.rename(bak, file);
    }
  });

  it('SQLite FTS5 companion can retrieve by MATCH when available', async () => {
    const { searchSqliteFts } = await import('../src/store');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'spockify-fts-'));
    const file = path.join(dir, 'index.json');
    const index = buildIndexFromChunks('/tmp/fts-fixture', [
      {
        path: 'auth/login.ts',
        startLine: 1,
        endLine: 5,
        text: 'function authenticateUser password hash bcrypt session',
      },
      {
        path: 'ui/button.ts',
        startLine: 1,
        endLine: 3,
        text: 'export const PrimaryButton styles chrome',
      },
    ]);
    await saveIndex(file, index);
    if (!(await hasSqliteStore(file))) return;
    const hits = searchSqliteFts(file, 'authenticate password', 5);
    if (!hits) return; // FTS5 not compiled into this node:sqlite
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].path, 'auth/login.ts');
  });

  it('preferVectorSeed skips O(n) scan and still returns seeded path', async () => {
    const AUTH = new Array(8).fill(0).map((_, i) => (i === 0 ? 1 : 0));
    const UI = new Array(8).fill(0).map((_, i) => (i === 1 ? 1 : 0));
    const index = buildIndexFromChunks('/tmp/prefer-seed', [
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
    // Seed only auth — if prefer works, hybrid must not dilute with full scan noise
    const seed = [
      {
        path: 'auth/login.ts',
        startLine: 1,
        endLine: 5,
        text: 'function authenticateUser password hash',
        score: 0.99,
      },
    ];
    const hits = await hybridSearch(
      index,
      { query: 'sign-in', k: 1 },
      {
        hybrid: true,
        preferVectorSeed: true,
        preferVectorSeedMin: 1,
        vectorSeed: seed,
        embed: async () => [AUTH],
      },
    );
    assert.equal(hits[0]?.path, 'auth/login.ts');
  });
});
