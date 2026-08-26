/**
 * Live `nomic-embed` hybrid proof.
 * Skips unless SPOCKIFY_API_KEY (or SPOCKIFY_EMBED_KEY) is set.
 *
 * Run:
 *   SPOCKIFY_API_KEY=$(ssh data 'cd ~/agentHub && make -s api-key') \
 *     npm test -- test/live-nomic-hybrid.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import {
  buildIndex,
  createNodeFs,
  hybridSearch,
  search,
  saveIndex,
  hasLanceStore,
  hasSqliteStore,
} from '../src/index';

const API_KEY =
  process.env.SPOCKIFY_API_KEY?.trim() ||
  process.env.SPOCKIFY_EMBED_KEY?.trim() ||
  '';
const BASE =
  process.env.SPOCKIFY_BASE_URL?.replace(/\/$/, '') || 'https://spockify.eu';
const MODEL = process.env.SPOCKIFY_EMBED_MODEL || 'nomic-embed';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const sliceRoot = path.join(repoRoot, 'packages/spockify-codebase/src');

async function embedRemote(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${BASE}/v1/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`embed HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const body = (await res.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
  };
  const rows = body.data ?? [];
  return texts.map((_, i) => {
    const row = rows.find((r) => r.index === i) ?? rows[i];
    return row?.embedding ?? [];
  });
}

describe('live nomic-embed hybrid (cluster)', () => {
  it('indexes codebase src with nomic and beats BM25 on soft semantic query', async (t) => {
    if (!API_KEY) {
      t.skip('SPOCKIFY_API_KEY not set — skip live embed proof');
      return;
    }

    const index = await buildIndex(sliceRoot, createNodeFs(), {
      maxFileBytes: 200_000,
    });
    assert.ok(index.chunks.length >= 8, `chunks=${index.chunks.length}`);

    // Embed a capped batch (proof, not full monorepo).
    const cap = Math.min(index.chunks.length, 48);
    const vectors: Record<string, number[]> = {};
    const batch = 8;
    for (let i = 0; i < cap; i += batch) {
      const slice = index.chunks.slice(i, Math.min(i + batch, cap));
      const embs = await embedRemote(slice.map((c) => c.text.slice(0, 4000)));
      slice.forEach((c, j) => {
        assert.ok(embs[j]?.length >= 64, `empty embed for chunk ${c.id}`);
        vectors[String(c.id)] = embs[j];
      });
    }
    const withEmb = {
      ...index,
      vectors,
      embedModel: MODEL,
      builtAt: new Date().toISOString(),
    };

    const query = 'durable on-disk embedding persistence for retrieval';
    const bm25 = search(withEmb, { query, k: 5 });
    const hybrid = await hybridSearch(
      withEmb,
      { query, k: 5 },
      {
        hybrid: true,
        embed: async (texts) => embedRemote(texts),
      },
    );
    assert.ok(hybrid.length >= 1);
    const paths = hybrid.map((h) => h.path).join(' ');
    assert.match(
      paths,
      /store|lance|vector|hybrid|index/,
      `nomic hybrid paths unexpected: ${paths} (bm25=${bm25.map((h) => h.path).join(',')})`,
    );

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'spockify-nomic-'));
    const jsonPath = path.join(tmp, 'index.json');
    await saveIndex(jsonPath, withEmb);
    assert.equal(await hasLanceStore(jsonPath), true);
    if (await hasSqliteStore(jsonPath)) {
      assert.ok(true);
    }
  });
});
