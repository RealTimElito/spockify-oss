/**
 * Spockify Settings — full editor webview (Cursor-like left nav).
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { getApiKey, signIn, clearAuth } from '../auth';
import type {
  HostToSettings,
  SettingsSectionId,
  SettingsToHost,
} from './protocol';
import {
  buildSettingsSnapshot,
  fetchUsageSnapshot,
  updateSpockifyConfig,
} from './snapshot';

const VIEW_TYPE = 'spockify.settings';

export type SettingsPanelDeps = {
  context: vscode.ExtensionContext;
  output: vscode.OutputChannel;
  refreshAuthUi: () => Promise<void>;
  getTransport: () => Promise<
    import('@spockify/ide-client').ModelTransport | undefined
  >;
};

let activePanel: vscode.WebviewPanel | undefined;
let activeDeps: SettingsPanelDeps | undefined;

export async function refreshOpenSettingsPanel(): Promise<void> {
  if (!activePanel || !activeDeps) {
    return;
  }
  await postSnapshot(activePanel.webview, activeDeps);
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

async function ensureFile(
  uri: vscode.Uri,
  seed: string,
): Promise<void> {
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    const dir = vscode.Uri.joinPath(uri, '..');
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(seed, 'utf8'));
  }
}

async function openPathKind(
  context: vscode.ExtensionContext,
  kind: 'projectRules' | 'userRules' | 'globalRules' | 'skillsDir',
): Promise<void> {
  if (kind === 'userRules') {
    const uri = vscode.Uri.joinPath(context.globalStorageUri, 'user-rules.md');
    await ensureFile(uri, '# User rules\n\n');
    await vscode.window.showTextDocument(uri);
    return;
  }
  if (kind === 'globalRules') {
    const p = path.join(os.homedir(), '.spockify', 'rules.md');
    await fs.mkdir(path.dirname(p), { recursive: true });
    try {
      await fs.access(p);
    } catch {
      await fs.writeFile(p, '# Global Spockify rules\n\n', 'utf8');
    }
    const doc = await vscode.workspace.openTextDocument(p);
    await vscode.window.showTextDocument(doc);
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage(
      'Open a workspace folder to edit project rules or skills.',
    );
    return;
  }
  if (kind === 'skillsDir') {
    const dir = vscode.Uri.joinPath(folder.uri, '.spockify', 'skills');
    await vscode.workspace.fs.createDirectory(dir);
    const readme = vscode.Uri.joinPath(dir, 'README.md');
    await ensureFile(
      readme,
      '# Spockify skills\n\nSlash skills are coming soon. Keep project guidance in `.spockify/rules` for now.\n',
    );
    await vscode.window.showTextDocument(readme);
    return;
  }
  const uri = vscode.Uri.joinPath(folder.uri, '.spockify', 'rules.md');
  await ensureFile(uri, '# Project rules\n\n');
  await vscode.window.showTextDocument(uri);
}

export async function openSettingsPanel(
  deps: SettingsPanelDeps,
  section?: SettingsSectionId,
): Promise<void> {
  const { context, output } = deps;
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

  if (activePanel) {
    activePanel.reveal(column);
    await postSnapshot(activePanel.webview, deps, section);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    'Spockify Settings',
    column,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'media'),
      ],
    },
  );
  activePanel = panel;
  activeDeps = deps;
  panel.iconPath = {
    light: vscode.Uri.joinPath(context.extensionUri, 'media', 'spockify-activity.svg'),
    dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'spockify-activity.svg'),
  };

  panel.webview.html = getHtml(panel.webview, context.extensionUri);
  panel.webview.onDidReceiveMessage(async (raw: SettingsToHost) => {
    try {
      await handleMessage(panel.webview, deps, raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.appendLine(`settings: ${msg}`);
      post(panel.webview, { type: 'toast', message: msg, level: 'error' });
    }
  });

  panel.onDidDispose(() => {
    if (activePanel === panel) {
      activePanel = undefined;
      activeDeps = undefined;
    }
  });

  await postSnapshot(panel.webview, deps, section);
}

async function handleMessage(
  webview: vscode.Webview,
  deps: SettingsPanelDeps,
  msg: SettingsToHost,
): Promise<void> {
  const { context, refreshAuthUi } = deps;

  switch (msg.type) {
    case 'ready':
    case 'refresh':
      await postSnapshot(webview, deps, msg.type === 'ready' ? msg.section : undefined);
      return;
    case 'setConfig':
      await updateSpockifyConfig(msg.key, msg.value);
      await postSnapshot(webview, deps);
      return;
    case 'runCommand':
      await vscode.commands.executeCommand(msg.command);
      await postSnapshot(webview, deps);
      return;
    case 'openExternal':
      await vscode.env.openExternal(vscode.Uri.parse(msg.url));
      return;
    case 'openPath':
      await openPathKind(context, msg.kind);
      return;
    case 'signIn': {
      const ok = await signIn(context);
      if (ok) {
        await refreshAuthUi();
      }
      await postSnapshot(webview, deps);
      return;
    }
    case 'signOut':
      await clearAuth(context);
      await refreshAuthUi();
      await postSnapshot(webview, deps);
      return;
    case 'fetchUsage': {
      const cfg = vscode.workspace.getConfiguration('spockify');
      const baseUrl = cfg.get<string>('baseUrl') || 'https://spockify.eu';
      const apiKey = await getApiKey(context);
      const usage = await fetchUsageSnapshot(baseUrl, apiKey);
      post(webview, { type: 'usage', data: usage });
      return;
    }
    case 'openStockSettings':
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        msg.query || 'spockify',
      );
      return;
  }
}

async function postSnapshot(
  webview: vscode.Webview,
  deps: SettingsPanelDeps,
  section?: SettingsSectionId,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('spockify');
  const baseUrl = cfg.get<string>('baseUrl') || 'https://spockify.eu';
  const apiKey = await getApiKey(deps.context);
  // Soft-load usage when signed in; placeholder if endpoint denies/unavailable.
  const usage = await fetchUsageSnapshot(baseUrl, apiKey);
  const data = await buildSettingsSnapshot(deps.context, {
    getTransport: deps.getTransport,
    usage,
  });
  if (section) {
    data.section = section;
  }
  post(webview, { type: 'snapshot', data });
}

function post(webview: vscode.Webview, msg: HostToSettings): void {
  void webview.postMessage(msg);
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'settings', 'settings.css'),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'settings', 'settings.js'),
  );
  const tokensUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'spockify-tokens.css'),
  );
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${tokensUri}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Spockify Settings</title>
</head>
<body>
  <div class="settings-shell">
    <aside class="nav" aria-label="Settings categories">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true"></span>
        <div class="brand-copy">
          <div class="brand-name">Spockify</div>
          <div class="brand-sub">Settings</div>
        </div>
      </div>
      <nav class="nav-list" id="navList"></nav>
      <div class="nav-foot">
        <button type="button" class="linkish" id="openStock">All spockify.* settings</button>
      </div>
    </aside>
    <main class="content" id="content" tabindex="-1"></main>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
