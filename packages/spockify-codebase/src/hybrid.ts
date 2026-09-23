/**
 * Hybrid BM25 + vector search.
 * Uses min-max normalized score fusion (not pure RRF) so a strong
 * semantic hit can outrank an exclusive BM25 keyword match.
 */

import { searchIndex } from './search';
import type { CodebaseHit, CodebaseIndexData, CodebaseQuery } from './types';
import { cosine, hashEmbed } from './vector';

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export interface HybridSearchOptions {
  /** When true and vectors present, fuse BM25 + vector. */
  hybrid?: boolean;
  /** Optional remote embeddings for the query. */
  embed?: EmbedFn;
  bm25Pool?: number;
  vectorPool?: number;
  /** Lexical weight in [0,1]; vector gets (1 - bm25Weight). Default 0.4. */
  bm25Weight?: number;
  /** @deprecated kept for callers; score fusion no longer uses RRF k. */
  rrfK?: number;
  /** Extra lexical hits (e.g. SQLite FTS5) merged into the BM25 pool. */
  lexicalSeed?: CodebaseHit[];
  /**
   * Extra dense hits (e.g. Lance ANN) merged into the vector pool.
   * Paths may be `__chunk__:ID` stubs resolved against index.chunks.
   */
  vectorSeed?: CodebaseHit[];
  /**
   * When true and vectorSeed is large enough, skip O(n) in-memory vector scan
   * and use the seed as the dense pool (large-repo / Electron path).
   */
  preferVectorSeed?: boolean;
  /** Min seed hits required for preferVectorSeed (default 16). */
  preferVectorSeedMin?: number;
}

function minMaxNorm(values: number[]): number[] {
  if (!values.length) return [];
  let lo = values[0];
  let hi = values[0];
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo;
  if (span < 1e-12) return values.map(() => (hi > 0 ? 1 : 0));
  return values.map((v) => (v - lo) / span);
}

/**
 * Search with optional hybrid fusion. Falls back to BM25 if no vectors / embed.
 */
export async function hybridSearch(
  index: CodebaseIndexData,
  query: CodebaseQuery,
  opts: HybridSearchOptions = {},
): Promise<CodebaseHit[]> {
  const k = query.k ?? 10;
  const hybrid = opts.hybrid !== false;
  const bm25Pool = opts.bm25Pool ?? Math.max(k * 3, 30);
  const vectorPool = opts.vectorPool ?? Math.max(k * 3, 30);
  const bm25Weight = Math.min(1, Math.max(0, opts.bm25Weight ?? 0.4));
  const vecWeight = 1 - bm25Weight;

  const bm25Hits = searchIndex(index, { ...query, k: bm25Pool });
  if (opts.lexicalSeed?.length) {
    const seen = new Set(bm25Hits.map((h) => `${h.path}:${h.startLine}`));
    for (const h of opts.lexicalSeed) {
      const key = `${h.path}:${h.startLine}`;
      if (!seen.has(key)) {
        bm25Hits.push(h);
        seen.add(key);
      }
    }
    bm25Hits.sort((a, b) => b.score - a.score);
  }
  if (!hybrid) {
    return bm25Hits.slice(0, k);
  }

  const vectors = index.vectors;
  let queryVec: Float32Array | undefined;

  if (opts.embed) {
    try {
      const [emb] = await opts.embed([query.query]);
      if (emb?.length) queryVec = Float32Array.from(emb);
    } catch {
      // fall through to hash
    }
  }
  if (!queryVec) {
    queryVec = hashEmbed(query.query);
  }

  const preferSeed =
    opts.preferVectorSeed === true &&
    (opts.vectorSeed?.length ?? 0) >= (opts.preferVectorSeedMin ?? 16);

  const vecList: Array<{ id: number; score: number }> = [];
  if (!preferSeed && vectors && Object.keys(vectors).length) {
    for (const chunk of index.chunks) {
      const raw = vectors[String(chunk.id)];
      if (!raw?.length) continue;
      if (query.pathPrefix && !chunk.path.startsWith(query.pathPrefix)) continue;
      const score = cosine(queryVec, Float32Array.from(raw));
      vecList.push({ id: chunk.id, score });
    }
    vecList.sort((a, b) => b.score - a.score);
  } else if (!preferSeed) {
    for (const chunk of index.chunks) {
      if (query.pathPrefix && !chunk.path.startsWith(query.pathPrefix)) continue;
      const score = cosine(queryVec, hashEmbed(chunk.text));
      vecList.push({ id: chunk.id, score });
    }
    vecList.sort((a, b) => b.score - a.score);
  }

  if (opts.vectorSeed?.length) {
    const byId = new Map(index.chunks.map((c) => [c.id, c]));
    const seen = new Set(vecList.map((v) => v.id));
    for (const h of opts.vectorSeed) {
      let id: number | undefined;
      const stub = h.path.match(/^__chunk__:(\d+)$/);
      if (stub) {
        id = Number(stub[1]);
      } else {
        const chunk = index.chunks.find(
          (c) =>
            c.path === h.path &&
            c.startLine === h.startLine &&
            c.endLine === h.endLine,
        );
        id = chunk?.id;
      }
      if (id === undefined || !byId.has(id) || seen.has(id)) continue;
      vecList.push({ id, score: h.score });
      seen.add(id);
    }
    vecList.sort((a, b) => b.score - a.score);
  }

  const bm25ById = new Map<number, number>();
  bm25Hits.forEach((h, i) => {
    const chunk = index.chunks.find(
      (c) =>
        c.path === h.path &&
        c.startLine === h.startLine &&
        c.endLine === h.endLine,
    );
    const id = chunk?.id ?? i;
    bm25ById.set(id, h.score);
  });

  const vecTop = vecList.slice(0, vectorPool);
  const candidateIds = new Set<number>([
    ...bm25ById.keys(),
    ...vecTop.map((v) => v.id),
  ]);

  const bm25Raw: number[] = [];
  const vecRaw: number[] = [];
  const idOrder: number[] = [];
  const vecScore = new Map(vecTop.map((v) => [v.id, v.score]));
  for (const id of candidateIds) {
    idOrder.push(id);
    bm25Raw.push(bm25ById.get(id) ?? 0);
    vecRaw.push(vecScore.get(id) ?? 0);
  }

  const bm25N = minMaxNorm(bm25Raw);
  const vecN = minMaxNorm(vecRaw);
  const fused: Array<{ id: number; score: number }> = [];
  for (let i = 0; i < idOrder.length; i++) {
    fused.push({
      id: idOrder[i],
      score: bm25Weight * bm25N[i] + vecWeight * vecN[i],
    });
  }
  fused.sort((a, b) => b.score - a.score);

  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  const out: CodebaseHit[] = [];
  for (const { id, score } of fused.slice(0, k)) {
    const c = byId.get(id);
    if (!c) continue;
    out.push({
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      text: c.text,
      score,
    });
  }
  return out.length ? out : bm25Hits.slice(0, k);
}

/** Attach hash vectors to index (local-only embed path). */
export function attachHashVectors(index: CodebaseIndexData): CodebaseIndexData {
  const vectors: Record<string, number[]> = { ...(index.vectors ?? {}) };
  for (const c of index.chunks) {
    vectors[String(c.id)] = Array.from(hashEmbed(c.text));
  }
  return { ...index, vectors, embedModel: index.embedModel ?? 'hash-local' };
}

/** Trim hits to approximate token budget (~4 chars/token). */
export function trimHitsToBudget(
  hits: CodebaseHit[],
  budgetTokens: number,
): CodebaseHit[] {
  const maxChars = Math.max(500, budgetTokens * 4);
  const out: CodebaseHit[] = [];
  let used = 0;
  for (const h of hits) {
    const cost = h.text.length + h.path.length + 16;
    if (used + cost > maxChars && out.length) break;
    out.push(h);
    used += cost;
  }
  return out;
}
