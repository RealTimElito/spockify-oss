/**
 * Settings / rules / memories sync — Phase 6
 * Secrets never leave SecretStorage; sync payload is prefs + non-secret text only.
 */

import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import { getEffectiveRules } from '../rules/load';
import { formatMemoriesForPrompt } from '../rules/memories';

const ETAG_KEY = 'spockify.sync.etag';
const LOCAL_BLOB_KEY = 'spockify.sync.localBlob';

export function getLastSyncBlob(
  context: vscode.ExtensionContext,
): { updatedAt?: string } | undefined {
  return context.globalState.get<{ updatedAt?: string }>(LOCAL_BLOB_KEY);
}

export interface IdeSyncPayload {
  version: 1;
  updatedAt: string;
  /** Non-secret Spockify settings subset */
  settings: Record<string, unknown>;
  userRules?: string;
  memories?: string;
  /** Flag only — never the key itself */
  hasApiKey?: boolean;
}

export async function buildLocalSyncPayload(
  context: vscode.ExtensionContext,
): Promise<IdeSyncPayload> {
  const cfg = vscode.workspace.getConfiguration('spockify');
  const settings: Record<string, unknown> = {
    'spockify.agent.mode': cfg.get('agent.mode'),
    'spockify.agentPermissionMode': cfg.get('agentPermissionMode'),
    'spockify.runAllUnsandboxed': cfg.get('runAllUnsandboxed'),
    'spockify.defaultModel': cfg.get('defaultModel'),
    'spockify.composer.shadowWorkspace': cfg.get('composer.shadowWorkspace'),
    'spockify.terminalAgent.policy': cfg.get('terminalAgent.policy'),
    'spockify.terminalAgent.maxTurns': cfg.get('terminalAgent.maxTurns'),
    'spockify.codebase.hybrid': cfg.get('codebase.hybrid'),
    'spockify.sync.enabled': cfg.get('sync.enabled'),
  };
  const key = await context.secrets.get('spockify.apiKey');
  const rules = await getEffectiveRules(context);
  const memories = await formatMemoriesForPrompt(context);
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    settings,
    userRules: rules.text || undefined,
    memories: memories || undefined,
    hasApiKey: !!key,
  };
}

export async function syncNow(
  context: vscode.ExtensionContext,
  getTransport: () => Promise<ModelTransport | undefined>,
  output: vscode.OutputChannel,
  opts?: { quiet?: boolean },
): Promise<void> {
  const quiet = opts?.quiet === true;
  const enabled = vscode.workspace
    .getConfiguration('spockify')
    .get<boolean>('sync.enabled', true);
  if (!enabled) {
    if (!quiet) {
      void vscode.window.showInformationMessage(
        'Enable spockify.sync.enabled to sync prefs via spockify.eu',
      );
    }
    return;
  }
  const transport = await getTransport();
  if (!transport?.pullIdeSync || !transport.pushIdeSync) {
    if (!quiet) {
      void vscode.window.showWarningMessage('Sync requires remote Spockify provider.');
    }
    return;
  }
  const etag = context.globalState.get<string>(ETAG_KEY);
  try {
    const remote = await transport.pullIdeSync({ etag });
    if (remote.notModified) {
      output.appendLine('sync: remote not modified (ETag)');
    } else if (remote.payload) {
      output.appendLine('sync: pulled /api/v1/spockify/ide/sync');
      const localTs = context.globalState.get<{ updatedAt?: string }>(LOCAL_BLOB_KEY);
      const remotePayload = remote.payload as unknown as IdeSyncPayload;
      const remoteUpdated = String(remotePayload.updatedAt || '');
      if (!localTs?.updatedAt || remoteUpdated > localTs.updatedAt) {
        await applyRemotePayload(context, remotePayload);
      }
      if (remote.etag) {
        await context.globalState.update(ETAG_KEY, remote.etag);
      }
    }

    const payload = await buildLocalSyncPayload(context);
    await context.globalState.update(LOCAL_BLOB_KEY, payload);
    let push = await transport.pushIdeSync(
      payload as unknown as Record<string, unknown>,
      { etag: context.globalState.get<string>(ETAG_KEY) },
    );
    // 412 Precondition Failed — remote moved; offer merge strategy then retry.
    if (!push.ok && (push as { status?: number }).status === 412) {
      output.appendLine('sync: 412 conflict — offering merge');
      let strategy: 'merge' | 'local' | 'cancel' = 'merge';
      if (!quiet) {
        const pick = await vscode.window.showWarningMessage(
          'Sync conflict: remote prefs changed since last pull.',
          'Merge remote → push local',
          'Keep local only (no push)',
          'Cancel',
        );
        if (pick === 'Keep local only (no push)') strategy = 'local';
        else if (pick === 'Cancel' || !pick) strategy = 'cancel';
      }
      if (strategy === 'cancel') {
        output.appendLine('sync: conflict cancelled by user');
        return;
      }
      if (strategy === 'local') {
        output.appendLine('sync: keeping local blob; push skipped after 412');
        if (!quiet) {
          void vscode.window.showInformationMessage(
            'Local Spockify prefs kept; remote not overwritten.',
          );
        }
        return;
      }
      const again = await transport.pullIdeSync({});
      if (again.etag) {
        await context.globalState.update(ETAG_KEY, again.etag);
      }
      if (again.payload) {
        const remotePayload = again.payload as unknown as IdeSyncPayload;
        await applyRemotePayload(context, remotePayload);
      }
      const merged = await buildLocalSyncPayload(context);
      await context.globalState.update(LOCAL_BLOB_KEY, merged);
      push = await transport.pushIdeSync(
        merged as unknown as Record<string, unknown>,
        { etag: context.globalState.get<string>(ETAG_KEY) },
      );
      if (push.ok && !quiet) {
        void vscode.window.showInformationMessage(
          'Sync conflict resolved — remote applied, local merge pushed.',
        );
      }
    }
    if (!push.ok) {
      output.appendLine('sync: push failed — local blob kept');
      if (!quiet) {
        void vscode.window.showWarningMessage(
          'Sync push failed (check sign-in / If-Match). Local snapshot kept.',
        );
      }
      return;
    }
    if (push.etag) {
      await context.globalState.update(ETAG_KEY, push.etag);
    }
    output.appendLine('sync: push ok via /api/v1/spockify/ide/sync');
    if (!quiet) {
      void vscode.window.showInformationMessage('Spockify sync complete.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.appendLine(`sync error: ${msg}`);
    if (!quiet) {
      void vscode.window.showErrorMessage(
        `Sync failed: ${msg}. Sign in and check network.`,
      );
    }
  }
}

async function applyRemotePayload(
  context: vscode.ExtensionContext,
  payload: IdeSyncPayload,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('spockify');
  for (const [key, value] of Object.entries(payload.settings || {})) {
    const short = key.replace(/^spockify\./, '');
    try {
      await cfg.update(short, value, vscode.ConfigurationTarget.Global);
    } catch {
      /* ignore unknown keys */
    }
  }
  void context;
}

