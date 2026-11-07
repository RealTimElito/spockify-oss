/**
 * Shared retrieve-for-chat helper (Chat + Composer).
 */

import * as vscode from 'vscode';
import { tryGetCodebaseProvider } from './provider';
import type { CodebaseHit } from './types';

export interface RetrievedCodebaseHit {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score?: number;
}

export async function retrieveCodebaseHitsForQuery(
  query: string,
  opts?: {
    pathPrefix?: string;
    k?: number;
    log?: vscode.OutputChannel;
  },
): Promise<{
  hits: RetrievedCodebaseHit[];
  status: string;
  chunks?: number;
  files?: number;
}> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  const provider = tryGetCodebaseProvider();
  if (!folder) {
    return { hits: [], status: 'no-workspace' };
  }
  if (!provider) {
    return { hits: [], status: 'no-provider' };
  }

  const cfg = vscode.workspace.getConfiguration('spockify.codebase');
  const k =
    opts?.k ??
    cfg.get<number>('searchTopK', 8);

  try {
    await provider.ensureIndex(folder.uri);
    const st = provider.getStatus();
    if (st.status === 'error') {
      opts?.log?.appendLine(
        `codebase attach: index error — ${st.error || 'unknown'}`,
      );
      return {
        hits: [],
        status: 'index-error',
        chunks: st.chunks,
        files: st.files,
      };
    }
    const raw: CodebaseHit[] = await provider.search({
      query: query.trim() || '.',
      k,
      pathPrefix: opts?.pathPrefix,
    });
    const hits = raw.map((h) => ({
      path: h.path,
      startLine: h.startLine,
      endLine: h.endLine,
      text: h.text,
      score: h.score,
    }));
    opts?.log?.appendLine(
      `codebase attach: ${hits.length} hit(s) · chunks=${st.chunks ?? '?'} files=${st.files ?? '?'} q="${query.slice(0, 80)}"`,
    );
    return {
      hits,
      status: hits.length ? 'ok' : 'empty',
      chunks: st.chunks,
      files: st.files,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    opts?.log?.appendLine(`codebase attach failed: ${msg}`);
    return { hits: [], status: `error:${msg}` };
  }
}
