/**
 * Gather curated Spockify settings state from config / auth / rules / index.
 */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getAccount, getApiKey } from '../auth';
import { tryGetCodebaseProvider } from '../codebase/provider';
import { getEffectiveRules, userRulesStorageUri } from '../rules/load';
import { getMemories } from '../rules/memories';
import { resolveLocalVersion } from '../update';
import type {
  SettingsSnapshot,
  SettingsUsageSnapshot,
} from './protocol';

const RELEASES_URL = 'https://spockify.eu/ide/releases.html';
const SITE_URL = 'https://spockify.eu';

export function maskSecret(secret: string | undefined): string {
  if (!secret?.trim()) {
    return 'Not set';
  }
  const s = secret.trim();
  if (s.length <= 8) {
    return '••••••••';
  }
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export async function fetchUsageSnapshot(
  baseUrl: string,
  apiKey: string | undefined,
): Promise<SettingsUsageSnapshot> {
  const placeholder: SettingsUsageSnapshot = {
    available: false,
    message:
      'Account usage & quota will appear here when the spockify.eu usage API is available for your account. Admins can use the web Usage dashboard today.',
  };
  if (!apiKey?.trim()) {
    return {
      ...placeholder,
      message: 'Sign in to load usage when the account quota endpoint is ready.',
    };
  }

  const root = baseUrl.replace(/\/+$/, '') || 'https://spockify.eu';
  const url = `${root}/api/v1/spockify/usage`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    });
    if (!res.ok) {
      return placeholder;
    }
    const body = (await res.json()) as {
      totals?: {
        spend?: number;
        requests?: number;
        total_tokens?: number;
      };
      daily?: Array<{
        day?: string;
        spend?: number;
        requests?: number;
      }>;
      by_model?: Array<{
        model?: string;
        spend?: number;
        requests?: number;
      }>;
    };
    const totals = body.totals;
    if (!totals && !body.daily?.length) {
      return placeholder;
    }
    return {
      available: true,
      message: 'LiteLLM spend summary (admin / when permitted).',
      spend: totals?.spend,
      requests: totals?.requests,
      totalTokens: totals?.total_tokens,
      daily: (body.daily || []).slice(0, 14).map((d) => ({
        day: String(d.day || ''),
        spend: Number(d.spend || 0),
        requests: Number(d.requests || 0),
      })),
      byModel: (body.by_model || []).slice(0, 12).map((m) => ({
        model: String(m.model || 'unknown'),
        spend: Number(m.spend || 0),
        requests: Number(m.requests || 0),
      })),
    };
  } catch {
    return placeholder;
  }
}

export async function buildSettingsSnapshot(
  context: vscode.ExtensionContext,
  opts: {
    getTransport?: () => Promise<
      import('@spockify/ide-client').ModelTransport | undefined
    >;
    usage?: SettingsUsageSnapshot;
  } = {},
): Promise<SettingsSnapshot> {
  const cfg = vscode.workspace.getConfiguration('spockify');
  const codebaseCfg = vscode.workspace.getConfiguration('spockify.codebase');
  const termCfg = vscode.workspace.getConfiguration('spockify.terminalAgent');

  const account = await getAccount(context);
  const apiKey = await getApiKey(context);
  const baseUrl = cfg.get<string>('baseUrl') || 'https://spockify.eu';

  let models: Array<{ id: string; label?: string }> = [];
  if (opts.getTransport) {
    try {
      const transport = await opts.getTransport();
      if (transport) {
        const ossOnly = cfg.get<boolean>('models.ossOnly', true);
        const listed = await transport.listModels({ ossOnly });
        models = listed.map((m) => ({ id: m.id, label: m.id }));
      }
    } catch {
      /* offline OK */
    }
  }

  const effective = await getEffectiveRules(context);
  const memories = await getMemories(context);
  const folder = vscode.workspace.workspaceFolders?.[0];
  const indexSt = tryGetCodebaseProvider()?.getStatus();

  // Prefer running AppImage/deb tree version over registry (can lag).
  const version = resolveLocalVersion(context);

  const usage =
    opts.usage ??
    ({
      available: false,
      message: 'Open Usage and refresh to load spend when available.',
    } satisfies SettingsUsageSnapshot);

  return {
    version: String(version),
    baseUrl,
    provider: cfg.get<string>('provider') || 'remote',
    defaultModel: cfg.get<string>('defaultModel') || 'spockify-auto',
    ossOnly: cfg.get<boolean>('models.ossOnly', true),
    agentMode: cfg.get<string>('agent.mode') || 'agent',
    runAllUnsandboxed: cfg.get<boolean>('runAllUnsandboxed', false),
    agentPermissionMode:
      cfg.get<string>('agentPermissionMode') ||
      (cfg.get<boolean>('runAllUnsandboxed', false)
        ? 'allowAll'
        : 'askEveryTime'),
    chatMaxMode: cfg.get<boolean>('chat.maxMode', false),
    chatAttachTerminal: cfg.get<boolean>('chat.attachTerminal', true),
    completionsEnabled: cfg.get<boolean>('completions.enabled', true),
    terminalPolicy: termCfg.get<string>('policy') || 'ask',
    terminalAllowlistTier: termCfg.get<string>('allowlistTier') || 'dev',
    terminalPlanApproval: termCfg.get<boolean>('planApproval', true),
    syncEnabled: cfg.get<boolean>('sync.enabled', true),
    updateCheckOnStartup: cfg.get<boolean>('update.checkOnStartup', true),
    account: {
      signedIn: !!apiKey,
      label: account?.label,
      kind: account?.kind,
      keyHint: maskSecret(apiKey),
      signedInAt: account?.signedInAt,
    },
    usage,
    models,
    rules: {
      layers: effective.layers.map((l) => ({
        layer: l.layer,
        source: l.source,
        chars: l.chars,
      })),
      memoriesCount: memories.length,
      projectRulesPath: folder
        ? path.join(folder.uri.fsPath, '.spockify', 'rules.md')
        : undefined,
      globalRulesPath: path.join(os.homedir(), '.spockify', 'rules.md'),
      userRulesPath: userRulesStorageUri(context).fsPath,
      skillsNote:
        'Slash skills (/) are not shipped yet. Put project guidance in .spockify/rules; memories act as light knowledge.',
    },
    indexing: {
      status: indexSt?.status ?? 'idle',
      chunks: indexSt?.chunks,
      files: indexSt?.files,
      embedModel: indexSt?.embedModel,
      error: indexSt?.error,
      indexOnStartup: codebaseCfg.get<boolean>('indexOnStartup', true),
      autoAttach: codebaseCfg.get<boolean>('autoAttach', true),
      autoAttachAsk: codebaseCfg.get<boolean>('autoAttachAsk', true),
      hybrid: codebaseCfg.get<boolean>('hybrid', true),
      reindexOnSave: codebaseCfg.get<boolean>('reindexOnSave', true),
      remoteIndexMeta: codebaseCfg.get<boolean>('remoteIndexMeta', true),
    },
    releasesUrl: RELEASES_URL,
    siteUrl: SITE_URL,
  };
}

/** Split `codebase.hybrid` → section `spockify.codebase`, key `hybrid`. */
export async function updateSpockifyConfig(
  dottedKey: string,
  value: string | boolean | number,
): Promise<void> {
  const parts = dottedKey.split('.');
  if (parts.length === 1) {
    await vscode.workspace
      .getConfiguration('spockify')
      .update(parts[0], value, vscode.ConfigurationTarget.Global);
    if (parts[0] === 'agentPermissionMode' && typeof value === 'string') {
      await vscode.workspace
        .getConfiguration('spockify')
        .update(
          'runAllUnsandboxed',
          value === 'allowAll',
          vscode.ConfigurationTarget.Global,
        );
    }
    return;
  }
  const section = `spockify.${parts.slice(0, -1).join('.')}`;
  const key = parts[parts.length - 1];
  await vscode.workspace
    .getConfiguration(section)
    .update(key, value, vscode.ConfigurationTarget.Global);
}
