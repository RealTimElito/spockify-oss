import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';
import { chunkFile } from './chunker';
import { IgnoreMatcher, loadIgnoreFiles } from './ignore';
import { searchIndex } from './search';
import { docLength, termFreq, tokenize } from './tokenize';
import { hashEmbed } from './vector';
import type {
  CodebaseFs,
  CodebaseHit,
  CodebaseIndexData,
  CodebaseQuery,
  CrawlOptions,
  IndexBuildOptions,
  IndexedChunk,
  TextChunk,
} from './types';

const DEFAULT_MAX_BYTES = 512_000;

const DEFAULT_SKIP_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.pdf',
  '.wasm',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dat',
  '.sqlite',
  '.db',
]);

function shouldSkipFile(
  relPath: string,
  skipExtensions: Set<string>,
): boolean {
  const ext = path.extname(relPath).toLowerCase();
  return skipExtensions.has(ext);
}

async function walkFiles(
  root: string,
  fs: CodebaseFs,
  matcher: IgnoreMatcher,
  options: CrawlOptions,
  onFile: (absPath: string, relPath: string) => Promise<void>,
): Promise<void> {
  const maxBytes = options.maxFileBytes ?? DEFAULT_MAX_BYTES;
  const skipExt = options.skipExtensions ?? DEFAULT_SKIP_EXT;

  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fs.readDir(dir);
    entries.sort();
    for (const name of entries) {
      if (name === '.' || name === '..') {
        continue;
      }
      const abs = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const st = await fs.stat(abs);
      if (st.isDirectory) {
        if (matcher.ignores(relPath, true)) {
          continue;
        }
        await walk(abs, relPath);
      } else if (st.isFile) {
        if (matcher.ignores(relPath, false)) {
          continue;
        }
        if (shouldSkipFile(relPath, skipExt)) {
          continue;
        }
        if (st.size > maxBytes) {
          continue;
        }
        await onFile(abs, relPath.replace(/\\/g, '/'));
      }
    }
  }

  await walk(root, '');
}

export async function crawlAndChunk(
  root: string,
  fs: CodebaseFs,
  options: IndexBuildOptions = {},
): Promise<TextChunk[]> {
  const matcher = await loadIgnoreFiles(
    root,
    (p) => fs.readFile(p),
    (p) => fs.exists(p),
  );
  const chunks: TextChunk[] = [];
  let filesIndexed = 0;
  await walkFiles(root, fs, matcher, options, async (abs, rel) => {
    let content: string;
    try {
      content = await fs.readFile(abs);
    } catch {
      return;
    }
    if (content.includes('\0')) {
      return;
    }
    filesIndexed += 1;
    options.onProgress?.({ filesIndexed, relPath: rel });
    chunks.push(...chunkFile(rel, content, options));
  });
  return chunks;
}

export function buildIndexFromChunks(
  root: string,
  textChunks: TextChunk[],
): CodebaseIndexData {
  const df: Record<string, number> = {};
  const indexed: IndexedChunk[] = [];
  let totalLen = 0;
  const vectors: Record<string, number[]> = {};

  for (let i = 0; i < textChunks.length; i++) {
    const c = textChunks[i];
    const tf = termFreq(tokenize(c.text));
    const dl = docLength(tf);
    totalLen += dl;
    for (const term of Object.keys(tf)) {
      df[term] = (df[term] ?? 0) + 1;
    }
    indexed.push({
      id: i,
      path: c.path,
      startLine: c.startLine,
      endLine: c.endLine,
      text: c.text,
      tf,
      docLen: dl,
    });
    vectors[String(i)] = Array.from(hashEmbed(c.text));
  }

  return {
    version: 1,
    root: root.replace(/\\/g, '/'),
    builtAt: new Date().toISOString(),
    chunks: indexed,
    df,
    avgDocLen: indexed.length ? totalLen / indexed.length : 0,
    docCount: indexed.length,
    vectors,
    embedModel: 'hash-local',
  };
}

export async function buildIndex(
  root: string,
  fs: CodebaseFs,
  options: IndexBuildOptions = {},
): Promise<CodebaseIndexData> {
  const chunks = await crawlAndChunk(root, fs, options);
  return buildIndexFromChunks(root, chunks);
}

export function search(
  index: CodebaseIndexData,
  query: CodebaseQuery,
): CodebaseHit[] {
  return searchIndex(index, query);
}

export { chunkFile } from './chunker';
export { IgnoreMatcher, loadIgnoreFiles } from './ignore';
export { loadIndex, saveIndex, hasSqliteStore, searchSqliteFts, companionSqlitePath } from './store';
export {
  saveLanceStore,
  loadLanceVectors,
  searchLanceAnn,
  hasLanceStore,
  companionLancePath,
  lanceDbAvailable,
  IVF_MIN_ROWS,
  ANN_PREFER_MIN_ROWS,
  maybeCreateIvfIndex,
  readLanceMeta,
  type LanceBackend,
  type LanceAnnIndex,
  type FlatChunkMeta,
} from './lanceStore';
export {
  hybridSearch,
  attachHashVectors,
  trimHitsToBudget,
  type EmbedFn,
  type HybridSearchOptions,
} from './hybrid';
export { upsertFileInIndex, removePathFromIndex } from './incremental';
export { hashEmbed, cosine, HASH_EMBED_DIM } from './vector';
export type {
  CodebaseFs,
  CodebaseHit,
  CodebaseIndexData,
  CodebaseQuery,
  ChunkerOptions,
  CrawlOptions,
  FileStat,
  IndexBuildOptions,
  IndexedChunk,
  TextChunk,
} from './types';

export function createNodeFs(): CodebaseFs {
  return {
    async readFile(p: string): Promise<string> {
      return nodeFs.readFile(p, 'utf8');
    },
    async readDir(p: string): Promise<string[]> {
      return nodeFs.readdir(p);
    },
    async stat(p: string) {
      const s = await nodeFs.stat(p);
      return {
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        size: s.size,
      };
    },
    async exists(p: string): Promise<boolean> {
      try {
        await nodeFs.access(p);
        return true;
      } catch {
        return false;
      }
    },
  };
}
