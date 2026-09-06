/**
 * Background retrieval cache for Tab completions (protocol v2 context_items).
 *
 * The local LanceDB/hybrid index (packages/spockify-codebase via the shared
 * WorkspaceCodebaseProvider) can take tens to hundreds of ms per query —
 * far too slow for the Tab critical path. So results are cached per cursor
 * region and refreshed in the background: snapshot() answers from cache
 * instantly, and only when the cache is cold does it wait up to ~50ms for
 * an in-flight refresh before giving up (never longer).
 */

import * as vscode from 'vscode';
import type { GhostContextItem } from '@spockify/ide-client';
import { tryGetCodebaseProvider } from '../codebase/provider';

const REGION_LINES = 25;
const CACHE_TTL_MS = 45_000;
/** Min gap between background refreshes (per region misses may burst). */
const REFRESH_MIN_GAP_MS = 1500;
/** Cold-cache grace: wait this long for an in-flight refresh, then skip. */
export const RETRIEVAL_WAIT_BUDGET_MS = 50;

const MAX_ITEMS = 3;
const ITEMS_CHAR_BUDGET = 1500;
/** Don't attach same-file chunks near the cursor — prefix/suffix has them. */
const SAME_FILE_EXCLUDE_LINES = 40;

interface CacheState {
  key: string;
  items: GhostContextItem[];
  fetchedAt: number;
}

function regionKey(rel: string, line: number): string {
  return `${rel}:${Math.floor(line / REGION_LINES)}`;
}

/** Compact query: up to 3 trailing non-empty lines ending at the cursor. */
export function queryForCursor(
  document: vscode.TextDocument,
  position: vscode.Position,
): string {
  const lines: string[] = [];
  for (let l = position.line; l >= 0 && lines.length < 3; l--) {
    const text = document.lineAt(l).text.trim();
    if (text) {
      lines.unshift(text.slice(0, 120));
    }
  }
  return lines.join('\n');
}

export class TabRetrievalCache implements vscode.Disposable {
  private cache?: CacheState;
  private inflight?: Promise<void>;
  private inflightKey?: string;
  private lastKickAt = 0;
  private disposed = false;

  constructor(private readonly log?: vscode.OutputChannel) {}

  /**
   * Return context items for the cursor region. Warm cache: instant.
   * Cold cache: kick a background refresh and wait at most `budgetMs`
   * for it — if the index can't answer in time, return [] and let the
   * refresh land for the next request.
   */
  async snapshot(
    document: vscode.TextDocument,
    position: vscode.Position,
    budgetMs = RETRIEVAL_WAIT_BUDGET_MS,
  ): Promise<GhostContextItem[]> {
    const rel = vscode.workspace.asRelativePath(document.uri, false);
    if (!rel) {
      return [];
    }
    const key = regionKey(rel, position.line);
    const fresh =
      this.cache &&
      this.cache.key === key &&
      Date.now() - this.cache.fetchedAt < CACHE_TTL_MS;
    if (fresh) {
      return this.cache!.items;
    }
    this.kickRefresh(document, position, rel, key);
    if (budgetMs > 0 && this.inflight && this.inflightKey === key) {
      await Promise.race([
        this.inflight,
        new Promise((r) => setTimeout(r, budgetMs)),
      ]);
      if (this.cache?.key === key) {
        return this.cache.items;
      }
    }
    return [];
  }

  private kickRefresh(
    document: vscode.TextDocument,
    position: vscode.Position,
    rel: string,
    key: string,
  ): void {
    if (this.inflight) {
      return;
    }
    const now = Date.now();
    if (now - this.lastKickAt < REFRESH_MIN_GAP_MS) {
      return;
    }
    this.lastKickAt = now;
    const query = queryForCursor(document, position);
    if (!query.trim()) {
      return;
    }
    this.inflightKey = key;
    this.inflight = this.refresh(query, rel, position.line, key)
      .catch((err) => {
        this.log?.appendLine(
          `tab-retrieval failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        this.inflight = undefined;
        this.inflightKey = undefined;
      });
  }

  private async refresh(
    query: string,
    rel: string,
    cursorLine: number,
    key: string,
  ): Promise<void> {
    const provider = tryGetCodebaseProvider();
    if (!provider || this.disposed) {
      return;
    }
    const hits = await provider.search({ query, k: MAX_ITEMS * 2 });
    if (this.disposed) {
      return;
    }
    const relNorm = rel.replace(/\\/g, '/');
    const items: GhostContextItem[] = [];
    let chars = 0;
    for (const hit of hits) {
      if (items.length >= MAX_ITEMS) {
        break;
      }
      const sameFileNearCursor =
        hit.path === relNorm &&
        Math.abs(hit.startLine - cursorLine) < SAME_FILE_EXCLUDE_LINES;
      if (sameFileNearCursor) {
        continue;
      }
      const remaining = ITEMS_CHAR_BUDGET - chars;
      if (remaining < 80) {
        break;
      }
      const contents = hit.text.slice(0, Math.min(remaining, 800));
      chars += contents.length;
      items.push({
        path: hit.path,
        symbol: null,
        contents,
        score: Number(hit.score?.toFixed(4) ?? 0),
      });
    }
    this.cache = { key, items, fetchedAt: Date.now() };
  }

  dispose(): void {
    this.disposed = true;
  }
}
