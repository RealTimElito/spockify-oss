/**
 * MCP server management — quick-pick UI (Cursor marketplace-lite).
 */

import * as vscode from 'vscode';
import type { McpServerConfig } from '@spockify/mcp';
import { MCP_CATALOG, expandCatalogConfig } from './catalog';

export type McpConfigStore = {
  load: () => McpServerConfig[];
  save: (configs: McpServerConfig[]) => Promise<void>;
};

async function editServer(existing?: McpServerConfig): Promise<McpServerConfig | undefined> {
  const name = await vscode.window.showInputBox({
    title: 'MCP server name',
    value: existing?.name ?? '',
    placeHolder: 'filesystem',
    ignoreFocusOut: true,
  });
  if (!name?.trim()) return undefined;

  const command = await vscode.window.showInputBox({
    title: 'MCP command',
    value: existing?.command ?? 'npx',
    placeHolder: 'npx',
    ignoreFocusOut: true,
  });
  if (!command?.trim()) return undefined;

  const argsRaw = await vscode.window.showInputBox({
    title: 'MCP args (space-separated)',
    value: (existing?.args ?? []).join(' '),
    placeHolder: '-y @modelcontextprotocol/server-fetch',
    ignoreFocusOut: true,
  });
  const args = (argsRaw ?? '')
    .split(/\s+/)
    .map((a) => a.trim())
    .filter(Boolean);

  const cfg: McpServerConfig = {
    name: name.trim(),
    command: command.trim(),
    args: args.length ? args : undefined,
    env: existing?.env,
    allowlist: existing?.allowlist,
  };
  return cfg;
}

export async function runMcpConfigureUi(store: McpConfigStore): Promise<void> {
  const configs = store.load();

  type PickItem = vscode.QuickPickItem & {
    action: 'add' | 'catalog' | 'edit' | 'remove' | 'json' | 'server';
    index?: number;
  };

  const items: PickItem[] = [
    {
      label: '$(add) Add custom server…',
      action: 'add',
    },
    {
      label: '$(library) Add from catalog…',
      action: 'catalog',
    },
    { label: '', kind: vscode.QuickPickItemKind.Separator, action: 'add' },
  ];

  configs.forEach((s, i) => {
    const argsHint = s.args?.length ? ` ${s.args.slice(0, 2).join(' ')}…` : '';
    items.push({
      label: `$(server) ${s.name}`,
      description: s.command,
      detail: `${s.command}${argsHint}`,
      action: 'server',
      index: i,
    });
  });

  if (configs.length) {
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, action: 'add' });
  }
  items.push({
    label: '$(json) Edit spockify.mcp.servers in Settings JSON',
    action: 'json',
  });

  const pick = await vscode.window.showQuickPick(items, {
    title: 'MCP servers',
    placeHolder: `${configs.length} configured · pick to manage`,
  });
  if (!pick) return;

  if (pick.action === 'json') {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      'spockify.mcp.servers',
    );
    return;
  }

  if (pick.action === 'catalog') {
    await vscode.commands.executeCommand('spockify.mcp.addFromCatalog');
    return;
  }

  if (pick.action === 'add') {
    const cfg = await editServer();
    if (!cfg) return;
    if (configs.some((s) => s.name === cfg.name)) {
      void vscode.window.showWarningMessage(`Server "${cfg.name}" already exists.`);
      return;
    }
    await store.save(configs.concat(cfg));
    await vscode.commands.executeCommand('spockify.mcp.refresh');
    void vscode.window.showInformationMessage(`MCP "${cfg.name}" added.`);
    return;
  }

  if (pick.action === 'server' && pick.index !== undefined) {
    const current = configs[pick.index];
    const action = await vscode.window.showQuickPick(
      [
        { label: '$(edit) Edit…', id: 'edit' },
        { label: '$(trash) Remove', id: 'remove' },
        { label: '$(refresh) Reconnect (refresh all)', id: 'refresh' },
      ],
      { title: current.name },
    );
    if (!action) return;
    if (action.id === 'refresh') {
      await vscode.commands.executeCommand('spockify.mcp.refresh');
      return;
    }
    if (action.id === 'remove') {
      const ok = await vscode.window.showWarningMessage(
        `Remove MCP server "${current.name}"?`,
        'Remove',
        'Cancel',
      );
      if (ok !== 'Remove') return;
      const next = configs.filter((_, i) => i !== pick.index);
      await store.save(next);
      await vscode.commands.executeCommand('spockify.mcp.refresh');
      return;
    }
    if (action.id === 'edit') {
      const updated = await editServer(current);
      if (!updated) return;
      const next = [...configs];
      next[pick.index] = updated;
      await store.save(next);
      await vscode.commands.executeCommand('spockify.mcp.refresh');
    }
  }
}

export async function addCatalogEntryInteractive(
  store: McpConfigStore,
): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    MCP_CATALOG.map((e) => ({
      label: e.label,
      description: e.id,
      detail: e.detail,
      entry: e,
    })),
    { title: 'Add MCP server from catalog', placeHolder: 'Filesystem, Fetch, Brave…' },
  );
  if (!pick) return;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let cfg = expandCatalogConfig(pick.entry, folder);
  if (pick.entry.id === 'brave-search') {
    const key = await vscode.window.showInputBox({
      title: 'Brave Search API key',
      password: true,
      ignoreFocusOut: true,
    });
    if (!key?.trim()) {
      void vscode.window.showWarningMessage('Brave MCP requires BRAVE_API_KEY.');
      return;
    }
    cfg = { ...cfg, env: { ...(cfg.env || {}), BRAVE_API_KEY: key.trim() } };
  }
  const existing = store.load();
  if (existing.some((s) => s.name === cfg.name)) {
    const replace = await vscode.window.showWarningMessage(
      `Replace existing MCP server "${cfg.name}"?`,
      'Replace',
      'Cancel',
    );
    if (replace !== 'Replace') return;
    const next = existing.filter((s) => s.name !== cfg.name).concat(cfg);
    await store.save(next);
  } else {
    await store.save(existing.concat(cfg));
  }
  await vscode.commands.executeCommand('spockify.mcp.refresh');
  void vscode.window.showInformationMessage(`MCP server "${cfg.name}" added.`);
}
