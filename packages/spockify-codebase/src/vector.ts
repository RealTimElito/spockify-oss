/**
 * Local hash embeddings + cosine similarity (offline fallback when remote embed fails).
 * Dimensionality fixed for stable RRF hybrid search.
 */

import { tokenize } from './tokenize';

export const HASH_EMBED_DIM = 256;

/** Deterministic bag-of-tokens → unit vector via feature hashing. */
export function hashEmbed(text: string, dim = HASH_EMBED_DIM): Float32Array {
  const v = new Float32Array(dim);
  const tokens = tokenize(text);
  if (!tokens.length) return v;
  for (const t of tokens) {
    let h = 2166136261;
    for (let i = 0; i < t.length; i++) {
      h ^= t.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    const sign = h & 1 ? 1 : -1;
    v[idx] += sign;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function float32ToArray(v: Float32Array): number[] {
  return Array.from(v);
}

export function arrayToFloat32(a: number[]): Float32Array {
  return Float32Array.from(a);
}
