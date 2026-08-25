/**
 * Incremental single-file reindex into an existing BM25 index.
 */

import { chunkFile } from './chunker';
import { docLength, termFreq, tokenize } from './tokenize';
import type { CodebaseFs, CodebaseIndexData, IndexBuildOptions } from './types';
import { hashEmbed } from './vector';
import * as path from 'node:path';

/** Remove all chunks for a relative path and rebuild df stats. */
export function removePathFromIndex(
  index: CodebaseIndexData,
  relPath: string,
): CodebaseIndexData {
  const norm = relPath.replace(/\\/g, '/');
  const chunks = index.chunks.filter((c) => c.path !== norm);
  return rebuildStats(index.root, chunks, index.vectors, index.embedModel);
}

export async function upsertFileInIndex(
  index: CodebaseIndexData,
  root: string,
  relPath: string,
  fs: CodebaseFs,
  options: IndexBuildOptions = {},
): Promise<CodebaseIndexData> {
  const norm = relPath.replace(/\\/g, '/');
  let next = removePathFromIndex(index, norm);
  const abs = path.join(root, norm);
  let content: string;
  try {
    content = await fs.readFile(abs);
  } catch {
    return next;
  }
  if (content.includes('\0')) {
    return next;
  }
  const textChunks = chunkFile(norm, content, options);
  const startId =
    next.chunks.reduce((m, c) => Math.max(m, c.id), -1) + 1;
  const vectors = { ...(next.vectors ?? {}) };
  const added = textChunks.map((c, i) => {
    const tf = termFreq(tokenize(c.text));
    const id = startId + i;
    vectors[String(id)] = Array.from(hashEmbed(c.text));
    return {
      id,
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      text: c.text,
      tf,
      docLen: docLength(tf),
    };
  });
  return rebuildStats(
    next.root,
    [...next.chunks, ...added],
    vectors,
    next.embedModel ?? 'hash-local',
  );
}

function rebuildStats(
  root: string,
  chunks: CodebaseIndexData['chunks'],
  vectors: Record<string, number[]> | undefined,
  embedModel: string | undefined,
): CodebaseIndexData {
  const df: Record<string, number> = {};
  let totalLen = 0;
  for (const c of chunks) {
    totalLen += c.docLen;
    for (const term of Object.keys(c.tf)) {
      df[term] = (df[term] ?? 0) + 1;
    }
  }
  // Drop orphan vectors
  const kept: Record<string, number[]> = {};
  if (vectors) {
    for (const c of chunks) {
      const v = vectors[String(c.id)];
      if (v) kept[String(c.id)] = v;
    }
  }
  return {
    version: 1,
    root,
    builtAt: new Date().toISOString(),
    chunks,
    df,
    avgDocLen: chunks.length ? totalLen / chunks.length : 0,
    docCount: chunks.length,
    vectors: Object.keys(kept).length ? kept : undefined,
    embedModel,
  };
}
