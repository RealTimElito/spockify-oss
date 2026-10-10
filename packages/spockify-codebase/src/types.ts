export interface CodebaseQuery {
  query: string;
  k?: number;
  pathPrefix?: string;
}

export interface CodebaseHit {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

export interface TextChunk {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface ChunkerOptions {
  /** Max lines per chunk (default 60). */
  maxLines?: number;
  /** Overlap between consecutive chunks (default 8). */
  overlapLines?: number;
}

export interface CrawlOptions {
  maxFileBytes?: number;
  /** Extra basename patterns always skipped (e.g. binary extensions). */
  skipExtensions?: Set<string>;
  /** Called after each file is accepted into the crawl (pre-chunk). */
  onProgress?: (info: { filesIndexed: number; relPath: string }) => void;
}

export interface IndexBuildOptions extends ChunkerOptions, CrawlOptions {}

export interface CodebaseIndexData {
  version: 1;
  root: string;
  builtAt: string;
  chunks: IndexedChunk[];
  /** document frequency per term */
  df: Record<string, number>;
  avgDocLen: number;
  docCount: number;
  /** Optional dense vectors keyed by chunk id (Phase 3 hybrid). */
  vectors?: Record<string, number[]>;
  embedModel?: string;
}

export interface IndexedChunk {
  id: number;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  /** term → term frequency in this chunk */
  tf: Record<string, number>;
  docLen: number;
}

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
}

/** Minimal async FS for crawl/index (Node or VS Code adapter). */
export interface CodebaseFs {
  readFile(path: string): Promise<string>;
  readDir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  exists(path: string): Promise<boolean>;
}
