import type { CodebaseHit, CodebaseIndexData, CodebaseQuery, IndexedChunk } from './types';
import { tokenize } from './tokenize';

const K1 = 1.2;
const B = 0.75;

function idf(term: string, data: CodebaseIndexData): number {
  const df = data.df[term] ?? 0;
  if (df === 0 || data.docCount === 0) {
    return 0;
  }
  return Math.log(1 + (data.docCount - df + 0.5) / (df + 0.5));
}

function scoreChunk(
  queryTerms: string[],
  chunk: IndexedChunk,
  data: CodebaseIndexData,
): number {
  let score = 0;
  const dl = chunk.docLen || 1;
  const avg = data.avgDocLen || 1;
  for (const term of queryTerms) {
    const tf = chunk.tf[term];
    if (!tf) {
      continue;
    }
    const idfVal = idf(term, data);
    const num = tf * (K1 + 1);
    const den = tf + K1 * (1 - B + (B * dl) / avg);
    score += idfVal * (num / den);
  }
  return score;
}

function normalizePrefix(prefix: string | undefined): string | undefined {
  if (!prefix) {
    return undefined;
  }
  let p = prefix.replace(/\\/g, '/');
  if (p.startsWith('./')) {
    p = p.slice(2);
  }
  if (p.endsWith('/')) {
    return p;
  }
  return `${p}/`;
}

/**
 * BM25 search over a built index.
 */
export function searchIndex(
  data: CodebaseIndexData,
  query: CodebaseQuery,
): CodebaseHit[] {
  const k = query.k ?? 10;
  const terms = tokenize(query.query);
  if (terms.length === 0 || data.chunks.length === 0) {
    return [];
  }
  const prefix = normalizePrefix(query.pathPrefix);

  const scored: CodebaseHit[] = [];
  for (const chunk of data.chunks) {
    if (prefix && !chunk.path.replace(/\\/g, '/').startsWith(prefix)) {
      continue;
    }
    const score = scoreChunk(terms, chunk, data);
    if (score <= 0) {
      continue;
    }
    scored.push({
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
