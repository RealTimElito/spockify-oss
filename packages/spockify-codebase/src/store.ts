/**
 * Durable vector + BM25 index store.
 * Prefers Node 22+ `node:sqlite` when available; falls back to JSON.
 * Also writes a Lance-class companion via `saveLanceStore` (see lanceStore.ts).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { CodebaseIndexData, IndexedChunk } from './types';
import { saveLanceStore } from './lanceStore';

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  text TEXT NOT NULL,
  tf_json TEXT NOT NULL,
  doc_len REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS vectors (
  chunk_id INTEGER PRIMARY KEY,
  dim INTEGER NOT NULL,
  embedding BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
`;

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  path,
  text,
  content='chunks',
  content_rowid='id'
);
`;

type SqliteDb = {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Array<Record<string, unknown>>;
  };
  close(): void;
};

function tryOpenSqlite(filePath: string): SqliteDb | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (path: string) => SqliteDb;
    };
    const db = new DatabaseSync(filePath);
    db.exec(SQLITE_SCHEMA);
    return db;
  } catch {
    return null;
  }
}

function float32ToBuffer(v: number[]): Buffer {
  const buf = Buffer.alloc(v.length * 4);
  for (let i = 0; i < v.length; i++) buf.writeFloatLE(v[i], i * 4);
  return buf;
}

function bufferToFloat32(buf: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    out.push(buf.readFloatLE(i));
  }
  return out;
}

function sqlitePath(jsonPath: string): string {
  return jsonPath.replace(/\.json$/i, '') + '.sqlite';
}

/** Load index from SQLite if present+valid, else JSON. */
export async function loadIndex(
  filePath: string,
): Promise<CodebaseIndexData | null> {
  const sq = sqlitePath(filePath);
  try {
    await fs.access(sq);
    const fromSql = loadFromSqlite(sq);
    if (fromSql) return fromSql;
  } catch {
    /* try JSON */
  }
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as CodebaseIndexData;
    if (parsed?.version !== 1 || !Array.isArray(parsed.chunks)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function loadFromSqlite(filePath: string): CodebaseIndexData | null {
  const db = tryOpenSqlite(filePath);
  if (!db) return null;
  try {
    const metaRows = db.prepare('SELECT key, value FROM meta').all();
    const meta: Record<string, string> = {};
    for (const r of metaRows) {
      meta[String(r.key)] = String(r.value);
    }
    if (meta.version !== '1') return null;

    const chunkRows = db
      .prepare(
        'SELECT id, path, start_line, end_line, text, tf_json, doc_len FROM chunks ORDER BY id',
      )
      .all();
    const chunks: IndexedChunk[] = chunkRows.map((r) => ({
      id: Number(r.id),
      path: String(r.path),
      startLine: Number(r.start_line),
      endLine: Number(r.end_line),
      text: String(r.text),
      tf: JSON.parse(String(r.tf_json)) as Record<string, number>,
      docLen: Number(r.doc_len),
    }));

    const vectors: Record<string, number[]> = {};
    const vecRows = db
      .prepare('SELECT chunk_id, embedding FROM vectors')
      .all();
    for (const r of vecRows) {
      const blob = r.embedding as Buffer;
      vectors[String(r.chunk_id)] = bufferToFloat32(
        Buffer.isBuffer(blob) ? blob : Buffer.from(blob as ArrayBuffer),
      );
    }

    return {
      version: 1,
      root: meta.root || '',
      builtAt: meta.builtAt || new Date().toISOString(),
      chunks,
      df: JSON.parse(meta.df || '{}') as Record<string, number>,
      avgDocLen: Number(meta.avgDocLen || 0),
      docCount: Number(meta.docCount || chunks.length),
      vectors,
      embedModel: meta.embedModel,
    };
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Persist index: always write JSON (portable); also write SQLite when node:sqlite works.
 */
export async function saveIndex(
  filePath: string,
  data: CodebaseIndexData,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data), 'utf8');

  const sq = sqlitePath(filePath);
  const db = tryOpenSqlite(sq);
  if (!db) return;
  try {
    db.exec('DELETE FROM meta; DELETE FROM chunks; DELETE FROM vectors;');
    const putMeta = db.prepare(
      'INSERT INTO meta(key, value) VALUES (?, ?)',
    );
    putMeta.run('version', '1');
    putMeta.run('root', data.root);
    putMeta.run('builtAt', data.builtAt);
    putMeta.run('df', JSON.stringify(data.df));
    putMeta.run('avgDocLen', String(data.avgDocLen));
    putMeta.run('docCount', String(data.docCount));
    putMeta.run('embedModel', data.embedModel || 'hash-local');

    const putChunk = db.prepare(
      `INSERT INTO chunks(id, path, start_line, end_line, text, tf_json, doc_len)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of data.chunks) {
      putChunk.run(
        c.id,
        c.path,
        c.startLine,
        c.endLine,
        c.text,
        JSON.stringify(c.tf),
        c.docLen,
      );
    }

    const putVec = db.prepare(
      'INSERT INTO vectors(chunk_id, dim, embedding) VALUES (?, ?, ?)',
    );
    const vectors = data.vectors || {};
    for (const [id, vec] of Object.entries(vectors)) {
      putVec.run(Number(id), vec.length, float32ToBuffer(vec));
    }

    // Optional FTS5 for large-repo candidate retrieval (Lance-class accel path).
    try {
      db.exec('DROP TABLE IF EXISTS chunks_fts;');
      db.exec(FTS_SCHEMA);
      db.exec(
        `INSERT INTO chunks_fts(rowid, path, text)
         SELECT id, path, text FROM chunks`,
      );
      putMeta.run('fts', '1');
    } catch {
      /* FTS5 unavailable — JSON/BM25 still work */
    }
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }

  // Dedicated Lance-class vector companion (flat always; LanceDB when native loads).
  try {
    await saveLanceStore(filePath, data);
  } catch {
    /* optional accel — JSON/SQLite still work */
  }
}

/** True when the companion SQLite file exists for a JSON index path. */
export async function hasSqliteStore(jsonPath: string): Promise<boolean> {
  try {
    await fs.access(sqlitePath(jsonPath));
    return true;
  } catch {
    return false;
  }
}

/**
 * FTS5 candidate search over the SQLite companion (when built with FTS).
 * Returns null if SQLite/FTS unavailable — caller should fall back to in-memory BM25.
 */
export function searchSqliteFts(
  jsonPath: string,
  query: string,
  k = 10,
): Array<{
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}> | null {
  const sq = sqlitePath(jsonPath);
  const db = tryOpenSqlite(sq);
  if (!db) return null;
  try {
    const ftsFlag = db.prepare(`SELECT value FROM meta WHERE key = 'fts'`).get();
    if (!ftsFlag || String(ftsFlag.value) !== '1') return null;

    // Sanitize: FTS5 MATCH needs quoted tokens for special chars.
    const tokens = query
      .toLowerCase()
      .replace(/[^a-z0-9_\s-]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .slice(0, 12);
    if (!tokens.length) return null;
    const match = tokens.map((t) => `"${t}"`).join(' OR ');

    const rows = db
      .prepare(
        `SELECT c.id, c.path, c.start_line, c.end_line, c.text,
                bm25(chunks_fts) AS score
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ?
         ORDER BY score
         LIMIT ?`,
      )
      .all(match, k);

    return rows.map((r) => ({
      path: String(r.path),
      startLine: Number(r.start_line),
      endLine: Number(r.end_line),
      text: String(r.text),
      // bm25() is lower-is-better; invert for CodebaseHit (higher better).
      score: -Number(r.score),
    }));
  } catch {
    return null;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

export function companionSqlitePath(jsonPath: string): string {
  return sqlitePath(jsonPath);
}
