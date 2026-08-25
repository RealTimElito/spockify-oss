import * as vscode from 'vscode';
import {
  buildIndex,
  loadIndex,
  saveIndex,
  hybridSearch,
  upsertFileInIndex,
  trimHitsToBudget,
  searchSqliteFts,
  searchLanceAnn,
  readLanceMeta,
  hashEmbed,
  ANN_PREFER_MIN_ROWS,
  type CodebaseIndexData,
} from '@spockify/codebase';
import {
  uriKey,
  type CodebaseContextProvider,
  type CodebaseHit,
  type CodebaseQuery,
} from './types';
import { createWorkspaceFs, relativeUnderFolder } from './workspaceFs';

export type { CodebaseContextProvider, CodebaseHit, CodebaseQuery };

export type IndexStatus = 'idle' | 'indexing' | 'ready' | 'error';

function indexPath(context: vscode.ExtensionContext, root: vscode.Uri): vscode.Uri {
  const key = Buffer.from(uriKey(root)).toString('base64url');
  return vscode.Uri.joinPath(context.globalStorageUri, 'codebase', `${key}.json`);
}

function buildOptions(onProgress?: (info: {
  filesIndexed: number;
  relPath: string;
}) => void): {
  maxLines: number;
  overlapLines: number;
  maxFileBytes: number;
  onProgress?: (info: { filesIndexed: number; relPath: string }) => void;
} {
  const cfg = vscode.workspace.getConfiguration('spockify.codebase');
  return {
    maxLines: cfg.get<number>('chunkMaxLines', 60),
    overlapLines: cfg.get<number>('chunkOverlapLines', 8),
    maxFileBytes: cfg.get<number>('maxFileBytes', 512_000),
    onProgress,
  };
}

function uniqueFileCount(index: CodebaseIndexData | undefined): number | undefined {
  if (!index) return undefined;
  return new Set(index.chunks.map((c) => c.path)).size;
}

export class WorkspaceCodebaseProvider implements CodebaseContextProvider {
  private indices = new Map<string, CodebaseIndexData>();
  private indexPromises = new Map<string, Promise<void>>();
  private status: IndexStatus = 'idle';
  private lastError?: string;
  private filesIndexed = 0;
  private lastProgressPath?: string;
  private lanceMeta?: { backend: string; annIndex: string };
  private getEmbed?: () => Promise<
    ((texts: string[]) => Promise<number[][]>) | undefined
  >;
  private getTransport?: () => Promise<
    import('@spockify/ide-client').ModelTransport | undefined
  >;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log?: vscode.OutputChannel,
  ) {}

  setEmbedFactory(
    factory: () => Promise<((texts: string[]) => Promise<number[][]>) | undefined>,
  ): void {
    this.getEmbed = factory;
  }

  setTransportFactory(
    factory: () => Promise<
      import('@spockify/ide-client').ModelTransport | undefined
    >,
  ): void {
    this.getTransport = factory;
  }

  getStatus(): {
    status: IndexStatus;
    error?: string;
    chunks?: number;
    files?: number;
    filesIndexed?: number;
    progressPath?: string;
    embedModel?: string;
    lanceBackend?: string;
    lanceAnn?: string;
  } {
    const folder = vscode.workspace.workspaceFolders?.[0];
    const index = folder
      ? this.indices.get(uriKey(folder.uri))
      : undefined;
    return {
      status: this.status,
      error: this.lastError,
      chunks: index?.chunks.length,
      files: uniqueFileCount(index),
      filesIndexed:
        this.status === 'indexing' ? this.filesIndexed : uniqueFileCount(index),
      progressPath:
        this.status === 'indexing' ? this.lastProgressPath : undefined,
      embedModel: index?.embedModel,
      lanceBackend: this.lanceMeta?.backend,
      lanceAnn: this.lanceMeta?.annIndex,
    };
  }

  getIndex(root: vscode.Uri): CodebaseIndexData | undefined {
    return this.indices.get(uriKey(root));
  }

  async ensureIndex(root: vscode.Uri): Promise<void> {
    const key = uriKey(root);
    const pending = this.indexPromises.get(key);
    if (pending) {
      return pending;
    }
    const job = this.ensureIndexInner(root);
    this.indexPromises.set(key, job);
    try {
      await job;
    } finally {
      this.indexPromises.delete(key);
    }
  }

  private async refreshLanceMeta(storeFsPath: string): Promise<void> {
    try {
      const meta = await readLanceMeta(storeFsPath);
      if (meta) {
        this.lanceMeta = {
          backend: meta.backend,
          annIndex: meta.annIndex,
        };
      }
    } catch {
      /* optional */
    }
  }

  private async ensureIndexInner(root: vscode.Uri): Promise<void> {
    const key = uriKey(root);
    const storeUri = indexPath(this.context, root);
    const cached = await loadIndex(storeUri.fsPath);
    // Empty cache is treated as miss — often a failed Remote SSH Uri.file crawl.
    if (cached && cached.root === key && cached.chunks.length > 0) {
      this.indices.set(key, cached);
      this.status = 'ready';
      await this.refreshLanceMeta(storeUri.fsPath);
      this.log?.appendLine(
        `Codebase: loaded ${cached.chunks.length} chunks · ${uniqueFileCount(cached)} files`,
      );
      return;
    }
    if (cached && cached.chunks.length === 0) {
      this.log?.appendLine(
        'Codebase: discarding empty cached index; rebuilding…',
      );
    }
    await this.reindexRoot(root);
  }

  async reindexRoot(root: vscode.Uri): Promise<CodebaseIndexData> {
    const key = uriKey(root);
    const fs = createWorkspaceFs(root);
    this.status = 'indexing';
    this.lastError = undefined;
    this.filesIndexed = 0;
    this.lastProgressPath = undefined;
    this.log?.appendLine(
      `Codebase: indexing ${key} (scheme=${root.scheme})…`,
    );
    const opts = buildOptions((info) => {
      this.filesIndexed = info.filesIndexed;
      this.lastProgressPath = info.relPath;
      if (info.filesIndexed === 1 || info.filesIndexed % 50 === 0) {
        this.log?.appendLine(
          `Codebase: … ${info.filesIndexed} files (last ${info.relPath})`,
        );
      }
    });
    try {
      let data = await buildIndex(root.fsPath, fs, opts);
      data = await this.maybeRemoteEmbedIndex(data);
      const storeUri = indexPath(this.context, root);
      await saveIndex(storeUri.fsPath, data);
      this.indices.set(key, data);
      this.status = 'ready';
      this.filesIndexed = uniqueFileCount(data) ?? 0;
      await this.refreshLanceMeta(storeUri.fsPath);
      this.log?.appendLine(
        `Codebase: ready · ${data.chunks.length} chunks · ${uniqueFileCount(data)} files · model=${data.embedModel || 'hash-local'} · vectors=${Object.keys(data.vectors || {}).length}${this.lanceMeta ? ` · lance=${this.lanceMeta.backend}` : ''} (${data.builtAt})`,
      );
      await this.maybePushRemoteMeta(root, data);
      return data;
    } catch (err) {
      this.status = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Batch-embed chunk texts via spockify.eu when auth + embed() available. */
  private async maybeRemoteEmbedIndex(
    data: import('@spockify/codebase').CodebaseIndexData,
  ): Promise<import('@spockify/codebase').CodebaseIndexData> {
    if (!this.getEmbed) return data;
    const cfg = vscode.workspace.getConfiguration('spockify.codebase');
    if (!cfg.get<boolean>('hybrid', true)) return data;
    const model = cfg.get<string>('embedModel', 'nomic-embed') || 'nomic-embed';
    try {
      const remote = await this.getEmbed();
      if (!remote) return data;
      const batchSize = 32;
      const vectors: Record<string, number[]> = { ...(data.vectors ?? {}) };
      for (let i = 0; i < data.chunks.length; i += batchSize) {
        const slice = data.chunks.slice(i, i + batchSize);
        const texts = slice.map((c) => c.text.slice(0, 8000));
        const embs = await remote(texts);
        slice.forEach((c, j) => {
          if (embs[j]?.length) {
            vectors[String(c.id)] = embs[j];
          }
        });
        this.log?.appendLine(
          `Codebase: remote embed ${Math.min(i + batchSize, data.chunks.length)}/${data.chunks.length} (${model})`,
        );
      }
      return {
        ...data,
        vectors,
        embedModel: model,
        builtAt: new Date().toISOString(),
      };
    } catch (err) {
      this.log?.appendLine(
        `Codebase: remote embed skipped — ${err instanceof Error ? err.message : String(err)} (hash vectors kept)`,
      );
      return data;
    }
  }

  /** Push fingerprint metadata to spockify.eu (never chunk text / vectors). */
  private async maybePushRemoteMeta(
    root: vscode.Uri,
    data: CodebaseIndexData,
  ): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('spockify.codebase');
    if (!cfg.get<boolean>('remoteIndexMeta', true)) return;
    if (!this.getTransport) return;
    try {
      const transport = await this.getTransport();
      if (!transport?.pushIdeIndex) return;
      const { pushIndexMetadata } = await import('./remoteMeta');
      await pushIndexMetadata(transport, this.context, data, root, this.log);
    } catch (err) {
      this.log?.appendLine(
        `Codebase: remote index meta skipped — ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async search(q: CodebaseQuery): Promise<CodebaseHit[]> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return [];
    }
    await this.ensureIndex(folder.uri);
    const index = this.indices.get(uriKey(folder.uri));
    if (!index || index.chunks.length === 0) {
      this.log?.appendLine('Codebase: search skipped — empty index');
      return [];
    }
    const cfg = vscode.workspace.getConfiguration('spockify.codebase');
    const hybrid = cfg.get<boolean>('hybrid', true);
    const budget = cfg.get<number>('contextBudgetTokens', 4000);
    const embedModel = cfg.get<string>('embedModel', 'nomic-embed');
    let embedFn: ((texts: string[]) => Promise<number[][]>) | undefined;
    if (hybrid && this.getEmbed) {
      try {
        const remote = await this.getEmbed();
        if (remote) {
          embedFn = async (texts) => remote(texts);
          this.log?.appendLine(`Codebase: remote embed model=${embedModel}`);
        }
      } catch {
        /* hash fallback inside hybridSearch */
      }
    }
    const storeUri = indexPath(this.context, folder.uri);
    let lexicalSeed: CodebaseHit[] | undefined;
    try {
      const fts = searchSqliteFts(
        storeUri.fsPath,
        q.query,
        Math.max((q.k ?? 10) * 3, 30),
      );
      if (fts?.length) {
        lexicalSeed = fts;
        this.log?.appendLine(`Codebase: FTS5 seed ${fts.length} hit(s)`);
      }
    } catch {
      /* optional accel */
    }
    let vectorSeed: CodebaseHit[] | undefined;
    try {
      let qVec: number[] | Float32Array | undefined;
      if (embedFn) {
        try {
          const [emb] = await embedFn([q.query]);
          if (emb?.length) qVec = emb;
        } catch {
          /* hash */
        }
      }
      if (!qVec) qVec = hashEmbed(q.query);
      const lanceHits = await searchLanceAnn(
        storeUri.fsPath,
        qVec,
        Math.max((q.k ?? 10) * 3, 30),
      );
      if (lanceHits?.length) {
        vectorSeed = lanceHits;
        this.log?.appendLine(`Codebase: Lance ANN seed ${lanceHits.length} hit(s)`);
      }
    } catch {
      /* optional accel */
    }
    const preferSeed =
      Boolean(vectorSeed?.length) &&
      index.chunks.length >= ANN_PREFER_MIN_ROWS;
    if (preferSeed) {
      this.log?.appendLine(
        `Codebase: prefer Lance ANN seed (${index.chunks.length} chunks ≥ ${ANN_PREFER_MIN_ROWS})`,
      );
    }
    const hits = await hybridSearch(index, q, {
      hybrid,
      lexicalSeed,
      vectorSeed,
      preferVectorSeed: preferSeed,
      preferVectorSeedMin: 8,
      embed: embedFn
        ? async (texts) => {
            try {
              return await embedFn!(texts);
            } catch {
              return texts.map(() => []);
            }
          }
        : undefined,
    });
    this.log?.appendLine(
      `Codebase: ${hits.length} hit(s) for q="${q.query.slice(0, 80)}"`,
    );
    return trimHitsToBudget(hits, budget);
  }

  /** Incremental reindex of a single saved file (local or remote URI). */
  async onFileSaved(doc: vscode.TextDocument): Promise<void> {
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    if (!folder) {
      return;
    }
    const rel = relativeUnderFolder(folder.uri, doc.uri);
    if (rel === undefined || rel.startsWith('..')) {
      return;
    }
    const key = uriKey(folder.uri);
    await this.ensureIndex(folder.uri);
    const index = this.indices.get(key);
    if (!index || index.chunks.length === 0) {
      await this.reindexRoot(folder.uri);
      return;
    }
    this.status = 'indexing';
    try {
      const fs = createWorkspaceFs(folder.uri);
      let next = await upsertFileInIndex(
        index,
        folder.uri.fsPath,
        rel.replace(/\\/g, '/'),
        fs,
        buildOptions(),
      );
      if (this.getEmbed) {
        try {
          const remote = await this.getEmbed();
          const model =
            vscode.workspace
              .getConfiguration('spockify.codebase')
              .get<string>('embedModel', 'nomic-embed') || 'nomic-embed';
          if (remote) {
            const pathNorm = rel.replace(/\\/g, '/');
            const touched = next.chunks.filter((c) => c.path === pathNorm);
            if (touched.length) {
              const embs = await remote(
                touched.map((c) => c.text.slice(0, 8000)),
              );
              const vectors = { ...(next.vectors ?? {}) };
              touched.forEach((c, i) => {
                if (embs[i]?.length) vectors[String(c.id)] = embs[i];
              });
              next = { ...next, vectors, embedModel: model };
            }
          }
        } catch {
          /* keep hash vectors from upsert */
        }
      }
      const storeUri = indexPath(this.context, folder.uri);
      await saveIndex(storeUri.fsPath, next);
      this.indices.set(key, next);
      this.status = 'ready';
      await this.refreshLanceMeta(storeUri.fsPath);
      this.log?.appendLine(`Codebase: incremental upsert ${rel}`);
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.log?.appendLine(
        `Codebase incremental failed, full reindex: ${this.lastError}`,
      );
      await this.reindexRoot(folder.uri);
    }
  }
}

let shared: WorkspaceCodebaseProvider | undefined;

/** Create or return the singleton provider (registerCodebase entry). */
export function getCodebaseProvider(
  context?: vscode.ExtensionContext,
  log?: vscode.OutputChannel,
): WorkspaceCodebaseProvider {
  if (!shared) {
    if (!context) {
      throw new Error('Codebase provider not initialized');
    }
    shared = new WorkspaceCodebaseProvider(context, log);
  }
  return shared;
}

export function setCodebaseProvider(p: WorkspaceCodebaseProvider): void {
  shared = p;
}

export function tryGetCodebaseProvider(): WorkspaceCodebaseProvider | undefined {
  return shared;
}
