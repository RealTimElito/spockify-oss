/**
 * MCP registration — load servers from settings, expose commands.
 * WS-CLONE-J
 */

import * as vscode from 'vscode';
import { ToolRegistry, type McpServerConfig } from '@spockify/mcp';

let registry: ToolRegistry | undefined;

export function getToolRegistry(): ToolRegistry {
  if (!registry) {
    registry = new ToolRegistry();
  }
  return registry;
}

function loadConfigs(): McpServerConfig[] {
  const raw = vscode.workspace
    .getConfiguration('spockify')
    .get<McpServerConfig[]>('mcp.servers', []);
  return Array.isArray(raw) ? raw : [];
}

async function saveConfigs(configs: McpServerConfig[]): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('spockify');
  await cfg.update('mcp.servers', configs, vscode.ConfigurationTarget.Global);
}

export async function registerMcp(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<void> {
  const reg = getToolRegistry();

  const connectAll = async () => {
    const configs = loadConfigs();
    for (const cfg of configs) {
      if (!cfg?.name || !cfg?.command) {
        continue;
      }
      try {
        const tools = await reg.addServer(cfg);
        output.appendLine(
          `mcp: connected ${cfg.name} tools=${tools.map((t) => t.name).join(',') || '(none)'}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`mcp: failed ${cfg.name}: ${msg}`);
      }
    }
  };

  const store = {
    load: loadConfigs,
    save: saveConfigs,
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.mcp.configure', async () => {
      const { runMcpConfigureUi } = await import('./configureUi');
      await runMcpConfigureUi(store);
    }),
    vscode.commands.registerCommand('spockify.mcp.addFromCatalog', async () => {
      const { addCatalogEntryInteractive } = await import('./configureUi');
      await addCatalogEntryInteractive(store);
    }),
    vscode.commands.registerCommand('spockify.mcp.refresh', async () => {
      await reg.dispose();
      registry = new ToolRegistry();
      await connectAll();
      void vscode.window.showInformationMessage(
        `MCP tools: ${getToolRegistry().listTools().length}`,
      );
    }),
    vscode.commands.registerCommand('spockify.mcp.listTools', async () => {
      const tools = getToolRegistry().listTools();
      const doc = await vscode.workspace.openTextDocument({
        content: tools.length
          ? tools
              .map(
                (t) =>
                  `- **${t.server}/${t.name}**: ${t.description || '(no description)'}`,
              )
              .join('\n')
          : '(no MCP tools — configure spockify.mcp.servers)',
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('spockify.mcp.callTool', async () => {
      const tools = getToolRegistry().listTools();
      if (!tools.length) {
        void vscode.window.showWarningMessage(
          'No MCP tools. Set spockify.mcp.servers and run MCP: Refresh.',
        );
        return;
      }
      const pick = await vscode.window.showQuickPick(
        tools.map((t) => ({
          label: t.name,
          description: t.server,
          detail: t.description,
          tool: t,
        })),
        { title: 'Call MCP tool' },
      );
      if (!pick) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Call MCP tool ${pick.tool.server}/${pick.tool.name}?`,
        { modal: true },
        'Call',
      );
      if (confirm !== 'Call') {
        return;
      }
      const result = await getToolRegistry().callTool(
        pick.tool.server,
        pick.tool.name,
        {},
      );
      output.appendLine(
        `mcp call ${pick.tool.name}: ok=${result.ok} ${result.content.slice(0, 500) || result.error || ''}`,
      );
      const doc = await vscode.workspace.openTextDocument({
        content: result.ok
          ? result.content || '(empty)'
          : `Error: ${result.error}`,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    {
      dispose: () => {
        void reg.dispose();
      },
    },
  );

  // Soft-connect on activate (non-blocking)
  void connectAll();
}
