/**
 * Phase 6 remote index metadata — fingerprint only (no chunk text / vectors).
 */

import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type { CodebaseIndexData } from '@spockify/codebase';
import type { ModelTransport } from '@spockify/ide-client';
import type * as vscode from 'vscode';

export interface IdeIndexMetaPayload {
  version: 1;
  workspaceKey: string;
  rootLabel: string;
  fingerprint: string;
  chunkCount: number;
  vectorCount: number;
  embedModel?: string;
  builtAt: string;
  hybrid?: boolean;
  updatedAt?: string;
}

/** Stable workspace key for remote storage (uri → short hash). */
export function workspaceKeyFromUri(uri: { toString(): string }): string {
  return crypto
    .createHash('sha256')
    .update(uri.toString())
    .digest('hex')
    .slice(0, 32);
}

/** Content fingerprint from local index (paths + ranges + model; not full text). */
export function fingerprintIndex(data: CodebaseIndexData): string {
  const lines = data.chunks
    .map((c) => `${c.path}:${c.startLine}-${c.endLine}:${c.docLen}`)
    .sort();
  const h = crypto.createHash('sha256');
  h.update(data.root || '');
  h.update('\n');
  h.update(data.embedModel || '');
  h.update('\n');
  h.update(String(Object.keys(data.vectors || {}).length));
  h.update('\n');
  // Cap sample so huge repos stay cheap
  const sample = lines.slice(0, 5000).join('\n');
  h.update(sample);
  h.update(`\ncount=${lines.length}`);
  return h.digest('hex').slice(0, 40);
}

export function buildIndexMeta(
  data: CodebaseIndexData,
  workspaceKey: string,
  hybrid?: boolean,
): IdeIndexMetaPayload {
  const rootLabel = path.basename(data.root || '') || data.root || 'workspace';
  return {
    version: 1,
    workspaceKey,
    rootLabel,
    fingerprint: fingerprintIndex(data),
    chunkCount: data.chunks.length,
    vectorCount: Object.keys(data.vectors || {}).length,
    embedModel: data.embedModel,
    builtAt: data.builtAt,
    hybrid,
  };
}

const ETAG_PREFIX = 'spockify.index.etag.';

export async function pushIndexMetadata(
  transport: ModelTransport,
  context: vscode.ExtensionContext,
  data: CodebaseIndexData,
  rootUri: { toString(): string },
  log?: { appendLine(s: string): void },
): Promise<void> {
  if (!transport.pushIdeIndex) return;
  const workspaceKey = workspaceKeyFromUri(rootUri);
  const hybrid = true;
  const payload = buildIndexMeta(data, workspaceKey, hybrid);
  const etagKey = ETAG_PREFIX + workspaceKey;
  const etag = context.globalState.get<string>(etagKey);
  try {
    const res = await transport.pushIdeIndex(
      workspaceKey,
      payload as unknown as Record<string, unknown>,
      { etag },
    );
    if (res.ok && res.etag) {
      await context.globalState.update(etagKey, res.etag);
      log?.appendLine(
        `Codebase: remote index meta pushed fp=${payload.fingerprint.slice(0, 12)}… chunks=${payload.chunkCount}`,
      );
    } else if (!res.ok) {
      // 412: pull and retry once without force overwrite of newer remote
      if (res.status === 412 && transport.pullIdeIndex) {
        const remote = await transport.pullIdeIndex({ workspaceKey });
        if (remote.etag) {
          await context.globalState.update(etagKey, remote.etag);
        }
        const again = await transport.pushIdeIndex(
          workspaceKey,
          payload as unknown as Record<string, unknown>,
          { etag: remote.etag },
        );
        if (again.ok && again.etag) {
          await context.globalState.update(etagKey, again.etag);
          log?.appendLine('Codebase: remote index meta pushed after 412 retry');
        } else {
          log?.appendLine(
            `Codebase: remote index meta push skipped (status=${again.status ?? res.status})`,
          );
        }
      } else {
        log?.appendLine(
          `Codebase: remote index meta push skipped (status=${res.status ?? 'err'})`,
        );
      }
    }
  } catch (err) {
    log?.appendLine(
      `Codebase: remote index meta push failed — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export async function pullIndexMetadata(
  transport: ModelTransport,
  workspaceKey: string,
): Promise<IdeIndexMetaPayload | undefined> {
  if (!transport.pullIdeIndex) return undefined;
  try {
    const remote = await transport.pullIdeIndex({ workspaceKey });
    if (!remote.payload) return undefined;
    return remote.payload as unknown as IdeIndexMetaPayload;
  } catch {
    return undefined;
  }
}
