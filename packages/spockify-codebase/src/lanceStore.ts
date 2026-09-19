/**
 * Dedicated Lance-class vector store companion (beyond JSON/SQLite+FTS).
 *
 * Always writes a portable flat `*.lance/` directory (ids + float32 matrix).
 * When `@lancedb/lancedb` loads (native Node), also writes a real Lance table
 * and — for large repos — an IVF_PQ / IVF_FLAT ANN index.
 * Electron hosts fall back to flat cosine.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CodebaseHit, CodebaseIndexData } from './types';
import { cosine } from './vector';

const TABLE = 'chunks';
const FLAT_META = 'meta.json';
const FLAT_IDS = 'ids.bin';
const FLAT_VECS = 'vectors.bin';
/** Portable chunk sidecar so Electron (no native Lance) still resolves paths/text. */
const FLAT_CHUNKS = 'chunks.json';

/** Min rows before building IVF (below this, flat/brute ANN is fine). */
export const IVF_MIN_ROWS = 256;

/** Min chunks before hybrid prefers Lance ANN seed over O(n) in-memory scan. */
export const ANN_PREFER_MIN_ROWS = 128;

export type FlatChunkMeta = {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  /** Truncated text for seed hits (full text remains in JSON/SQLite index). */
  text: string;
};

export type LanceBackend = 'flat' | 'lancedb' | 'none';
export type LanceAnnIndex = 'none' | 'ivf_flat' | 'ivf_pq';

type LanceIndexFactory = {
  ivfPq: (opts?: {
    distanceType?: string;
    numPartitions?: number;
    numSubVectors?: number;
  }) => unknown;
  ivfFlat: (opts?: {
    distanceType?: string;
    numPartitions?: number;
  }) => unknown;
};

type LanceTable = {
  vectorSearch: (q: number[]) => {
    limit: (n: number) => { toArray: () => Promise<Record<string, unknown>[]> };
  };
  createIndex?: (
    column: string,
    opts?: { config?: unknown },
  ) => Promise<void>;
  countRows?: () => Promise<number>;
  listIndices?: () => Promise<unknown[]>;
};

type LanceDbModule = {
  connect: (uri: string) => Promise<{
    createTable: (
      name: string,
      data: Record<string, unknown>[],
      opts?: { mode?: string },
    ) => Promise<LanceTable>;
    openTable: (name: string) => Promise<LanceTable>;
    dropTable?: (name: string) => Promise<void>;
  }>;
  Index?: LanceIndexFactory;
};

let cachedLance: LanceDbModule | null | undefined;

function tryLoadLanceDb(): LanceDbModule | null {
  if (cachedLance !== undefined) return cachedLance;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedLance = require('@lancedb/lancedb') as LanceDbModule;
    return cachedLance;
  } catch {
    cachedLance = null;
    return null;
  }
}

/** Companion dir for a JSON index path: `foo.json` → `foo.lance/`. */
export function companionLancePath(jsonPath: string): string {
  return jsonPath.replace(/\.json$/i, '') + '.lance';
}

export async function hasLanceStore(jsonPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(companionLancePath(jsonPath), FLAT_META));
    return true;
  } catch {
    return false;
  }
}

function float32Matrix(vectors: number[][], dim: number): Buffer {
  const buf = Buffer.alloc(vectors.length * dim * 4);
  let o = 0;
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      buf.writeFloatLE(i < v.length ? v[i] : 0, o);
      o += 4;
    }
  }
  return buf;
}

function readFloat32Matrix(
  buf: Buffer,
  count: number,
  dim: number,
): number[][] {
  const out: number[][] = [];
  for (let r = 0; r < count; r++) {
    const row: number[] = [];
    for (let c = 0; c < dim; c++) {
      row.push(buf.readFloatLE((r * dim + c) * 4));
    }
    out.push(row);
  }
  return out;
}

function pickNumPartitions(count: number): number {
  // sqrt(n) is the usual heuristic; cap so small corpora still train cleanly.
  const ideal = Math.ceil(Math.sqrt(count));
  return Math.max(2, Math.min(64, ideal));
}

/**
 * Build IVF ANN index when row count warrants it.
 * Prefers IVF_PQ when dim is divisible by 8/16; else IVF_FLAT.
 */
export async function maybeCreateIvfIndex(
  table: LanceTable,
  lance: LanceDbModule,
  dim: number,
  count: number,
): Promise<LanceAnnIndex> {
  if (count < IVF_MIN_ROWS || !table.createIndex || !lance.Index) {
    return 'none';
  }
  const numPartitions = pickNumPartitions(count);
  try {
    if (dim % 8 === 0) {
      const numSubVectors =
        dim % 16 === 0 ? Math.max(1, dim / 16) : Math.max(1, dim / 8);
      await table.createIndex('vector', {
        config: lance.Index.ivfPq({
          distanceType: 'cosine',
          numPartitions,
          numSubVectors,
        }),
      });
      return 'ivf_pq';
    }
    await table.createIndex('vector', {
      config: lance.Index.ivfFlat({
        distanceType: 'cosine',
        numPartitions,
      }),
    });
    return 'ivf_flat';
  } catch {
    return 'none';
  }
}

/**
 * Persist vectors to a dedicated Lance-class directory.
 * Returns which backends succeeded.
 */
export async function saveLanceStore(
  jsonPath: string,
  data: CodebaseIndexData,
): Promise<{ flat: boolean; lancedb: boolean; annIndex: LanceAnnIndex }> {
  const vectors = data.vectors || {};
  const ids = data.chunks
    .map((c) => c.id)
    .filter((id) => vectors[String(id)]?.length);
  if (!ids.length) {
    return { flat: false, lancedb: false, annIndex: 'none' };
  }

  const dim = vectors[String(ids[0])].length;
  const matrix = ids.map((id) => vectors[String(id)]);
  const dir = companionLancePath(jsonPath);
  await fs.mkdir(dir, { recursive: true });

  const meta: {
    version: number;
    format: string;
    root: string;
    builtAt: string;
    embedModel: string;
    dim: number;
    count: number;
    backend: string;
    annIndex: LanceAnnIndex;
    ivfMinRows: number;
    hasChunkMeta: boolean;
  } = {
    version: 3,
    format: 'spockify-lance-flat',
    root: data.root,
    builtAt: data.builtAt,
    embedModel: data.embedModel || 'hash-local',
    dim,
    count: ids.length,
    backend: 'flat',
    annIndex: 'none',
    ivfMinRows: IVF_MIN_ROWS,
    hasChunkMeta: true,
  };

  const idsBuf = Buffer.alloc(ids.length * 4);
  ids.forEach((id, i) => idsBuf.writeUInt32LE(id >>> 0, i * 4));
  await fs.writeFile(path.join(dir, FLAT_IDS), idsBuf);
  await fs.writeFile(path.join(dir, FLAT_VECS), float32Matrix(matrix, dim));

  const chunkMeta: FlatChunkMeta[] = ids.map((id) => {
    const chunk = data.chunks.find((c) => c.id === id)!;
    return {
      id,
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text.slice(0, 4000),
    };
  });
  await fs.writeFile(
    path.join(dir, FLAT_CHUNKS),
    JSON.stringify(chunkMeta),
  );

  let lancedbOk = false;
  const lance = tryLoadLanceDb();
  if (lance) {
    try {
      const db = await lance.connect(dir);
      const rows = ids.map((id, i) => {
        const chunk = data.chunks.find((c) => c.id === id)!;
        return {
          id,
          path: chunk.path,
          start_line: chunk.startLine,
          end_line: chunk.endLine,
          text: chunk.text.slice(0, 4000),
          vector: matrix[i],
        };
      });
      const table = await db.createTable(TABLE, rows, { mode: 'overwrite' });
      lancedbOk = true;
      meta.backend = 'lancedb+flat';
      meta.annIndex = await maybeCreateIvfIndex(table, lance, dim, ids.length);
      if (meta.annIndex !== 'none') {
        meta.backend = `lancedb+${meta.annIndex}`;
      }
    } catch {
      /* native Lance unavailable — flat still durable */
    }
  }

  await fs.writeFile(path.join(dir, FLAT_META), JSON.stringify(meta, null, 2));
  return { flat: true, lancedb: lancedbOk, annIndex: meta.annIndex };
}

/** Load vectors from flat Lance companion into a Record (for index hydrate). */
export async function loadLanceVectors(
  jsonPath: string,
): Promise<{
  vectors: Record<string, number[]>;
  embedModel?: string;
  backend: LanceBackend;
  annIndex?: LanceAnnIndex;
} | null> {
  const dir = companionLancePath(jsonPath);
  try {
    const metaRaw = await fs.readFile(path.join(dir, FLAT_META), 'utf8');
    const meta = JSON.parse(metaRaw) as {
      dim: number;
      count: number;
      embedModel?: string;
      backend?: string;
      annIndex?: LanceAnnIndex;
    };
    const idsBuf = await fs.readFile(path.join(dir, FLAT_IDS));
    const vecBuf = await fs.readFile(path.join(dir, FLAT_VECS));
    const ids: number[] = [];
    for (let i = 0; i + 4 <= idsBuf.length; i += 4) {
      ids.push(idsBuf.readUInt32LE(i));
    }
    const matrix = readFloat32Matrix(vecBuf, meta.count, meta.dim);
    const vectors: Record<string, number[]> = {};
    for (let i = 0; i < ids.length && i < matrix.length; i++) {
      vectors[String(ids[i])] = matrix[i];
    }
    const backend: LanceBackend =
      meta.backend?.includes('lancedb') && tryLoadLanceDb()
        ? 'lancedb'
        : 'flat';
    return {
      vectors,
      embedModel: meta.embedModel,
      backend,
      annIndex: meta.annIndex ?? 'none',
    };
  } catch {
    return null;
  }
}

/**
 * ANN / dense search over the Lance companion.
 * Prefers native LanceDB vectorSearch (IVF when present); falls back to flat cosine.
 */
export async function searchLanceAnn(
  jsonPath: string,
  queryVec: number[] | Float32Array,
  k = 10,
): Promise<CodebaseHit[] | null> {
  const dir = companionLancePath(jsonPath);
  const q = Array.from(queryVec);

  const lance = tryLoadLanceDb();
  if (lance) {
    try {
      const db = await lance.connect(dir);
      const table = await db.openTable(TABLE);
      const rows = await table.vectorSearch(q).limit(k).toArray();
      if (rows.length) {
        return rows.map((r) => {
          const dist = Number(r._distance ?? 0);
          // Lance L2/cosine distance → higher-is-better score
          const score = 1 / (1 + dist);
          return {
            path: String(r.path ?? ''),
            startLine: Number(r.start_line ?? 1),
            endLine: Number(r.end_line ?? 1),
            text: String(r.text ?? ''),
            score,
          };
        });
      }
    } catch {
      /* fall through to flat */
    }
  }

  try {
    const metaRaw = await fs.readFile(path.join(dir, FLAT_META), 'utf8');
    const meta = JSON.parse(metaRaw) as { dim: number; count: number };
    const idsBuf = await fs.readFile(path.join(dir, FLAT_IDS));
    const vecBuf = await fs.readFile(path.join(dir, FLAT_VECS));
    let byId = new Map<number, FlatChunkMeta>();
    try {
      const raw = await fs.readFile(path.join(dir, FLAT_CHUNKS), 'utf8');
      const list = JSON.parse(raw) as FlatChunkMeta[];
      byId = new Map(list.map((c) => [c.id, c]));
    } catch {
      /* v2 companions without chunks.json — stub paths */
    }
    const qf = Float32Array.from(q);
    const scored: Array<{
      id: number;
      score: number;
      offset: number;
    }> = [];
    for (let i = 0; i < meta.count; i++) {
      const id = idsBuf.readUInt32LE(i * 4);
      const row = new Float32Array(meta.dim);
      for (let c = 0; c < meta.dim; c++) {
        row[c] = vecBuf.readFloatLE((i * meta.dim + c) * 4);
      }
      scored.push({ id, score: cosine(qf, row), offset: i });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => {
      const metaHit = byId.get(s.id);
      if (metaHit) {
        return {
          path: metaHit.path,
          startLine: metaHit.startLine,
          endLine: metaHit.endLine,
          text: metaHit.text,
          score: s.score,
        };
      }
      return {
        path: `__chunk__:${s.id}`,
        startLine: 0,
        endLine: 0,
        text: '',
        score: s.score,
      };
    });
  } catch {
    return null;
  }
}

/** Read flat companion meta (backend / annIndex) without loading vectors. */
export async function readLanceMeta(
  jsonPath: string,
): Promise<{
  backend: string;
  annIndex: LanceAnnIndex;
  count: number;
  embedModel?: string;
  hasChunkMeta?: boolean;
} | null> {
  try {
    const raw = await fs.readFile(
      path.join(companionLancePath(jsonPath), FLAT_META),
      'utf8',
    );
    const meta = JSON.parse(raw) as {
      backend?: string;
      annIndex?: LanceAnnIndex;
      count?: number;
      embedModel?: string;
      hasChunkMeta?: boolean;
    };
    return {
      backend: meta.backend || 'flat',
      annIndex: meta.annIndex ?? 'none',
      count: meta.count ?? 0,
      embedModel: meta.embedModel,
      hasChunkMeta: meta.hasChunkMeta,
    };
  } catch {
    return null;
  }
}

/** True when @lancedb/lancedb native module loads in this process. */
export function lanceDbAvailable(): boolean {
  return tryLoadLanceDb() !== null;
}
