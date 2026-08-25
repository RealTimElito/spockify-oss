/**
 * Phase 1 agent runtime — register builtins, MCP bridge, exports.
 */

import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import { getApplyService } from '../apply';
import { getToolRegistry as getMcpToolRegistry } from '../mcp';
import {
  AgentRuntime,
  runAgentTurn,
  type AgentRuntimeDeps,
} from './agentLoop';
import {
  loadAgentModeFromConfig,
  loadStrictAllowlist,
} from './modes';
import { getSessionManager } from './sessionManager';
import { getChatTabAgentHost } from './chatTabAgentHost';
import {
  registerBuiltinTools,
  syncMcpToolsIntoUnified,
} from './tools/builtins';
import {
  getUnifiedToolRegistry,
  type UnifiedToolRegistry,
} from './unifiedRegistry';
import type { AgentMode } from './types';

export type TransportFactory = () => Promise<ModelTransport | undefined>;

export interface RuntimeHandle {
  registry: UnifiedToolRegistry;
  getMode: () => AgentMode;
  getStrictAllowlist: () => string[];
  refreshMcpBridge: () => void;
  createRuntime: (transport: ModelTransport) => AgentRuntime;
  buildDeps: (transport: ModelTransport) => AgentRuntimeDeps;
  sessions: ReturnType<typeof getSessionManager>;
}

let handle: RuntimeHandle | undefined;

export function getRuntimeHandle(): RuntimeHandle | undefined {
  return handle;
}

export function registerAgentRuntime(
  context: vscode.ExtensionContext,
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
): RuntimeHandle {
  const registry = getUnifiedToolRegistry();
  const sessions = getSessionManager();

  registerBuiltinTools(registry, {
    getApplyService: () => getApplyService(context),
    getTransport,
    output,
    extensionContext: context,
  });

  const refreshMcpBridge = (): void => {
    try {
      syncMcpToolsIntoUnified(registry, getMcpToolRegistry());
      output.appendLine(
        `runtime: tools=${registry.listAll().length} (mcp bridged)`,
      );
    } catch (err) {
      output.appendLine(
        `runtime: mcp bridge failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  // Soft bridge after MCP connect settles
  setTimeout(refreshMcpBridge, 1500);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('spockify.mcp.servers')) {
        setTimeout(refreshMcpBridge, 500);
      }
    }),
  );

  const getMode = (): AgentMode => {
    const cfg = vscode.workspace.getConfiguration('spockify');
    return loadAgentModeFromConfig((key, def) => {
      const v = cfg.get<AgentMode>(key, def);
      return v;
    });
  };

  const getStrictAllowlist = (): string[] => {
    const cfg = vscode.workspace.getConfiguration('spockify');
    return loadStrictAllowlist((key, def) => cfg.get<string[]>(key, def));
  };

  const buildDeps = (transport: ModelTransport): AgentRuntimeDeps => ({
    transport,
    registry,
    strictAllowlist: getStrictAllowlist(),
    output,
  });

  const createRuntime = (transport: ModelTransport): AgentRuntime =>
    new AgentRuntime(buildDeps(transport));

  handle = {
    registry,
    getMode,
    getStrictAllowlist,
    refreshMcpBridge,
    createRuntime,
    buildDeps,
    sessions,
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.agent.listTools', async () => {
      refreshMcpBridge();
      const mode = getMode();
      const tools = registry.listForMode(mode, getStrictAllowlist());
      const doc = await vscode.workspace.openTextDocument({
        content: [
          `# Agent runtime tools (mode=${mode})`,
          '',
          ...tools.map(
            (t) =>
              `- **${t.name}** (${t.source}${t.mutates ? ', mutates' : ''}): ${t.description}`,
          ),
        ].join('\n'),
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
    vscode.commands.registerCommand('spockify.agent.cancel', () => {
      const ok = sessions.cancelActive();
      void vscode.window.showInformationMessage(
        ok ? 'Agent session cancelled.' : 'No active agent session.',
      );
    }),
    vscode.commands.registerCommand('spockify.agent.pause', () => {
      const ok = sessions.cancelActive();
      void vscode.window.showInformationMessage(
        ok
          ? 'Stopped (pause removed — use the Stop square in chat).'
          : 'No running agent session.',
      );
    }),
    vscode.commands.registerCommand('spockify.agent.resume', () => {
      void vscode.window.showInformationMessage(
        'Pause/resume removed — use Stop, then send again.',
      );
    }),
    vscode.commands.registerCommand('spockify.agent.setMode', async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'ask', description: 'Read-only — no mutating tools' },
          { label: 'agent', description: 'Full tools (default for Composer/Terminal)' },
          { label: 'strict', description: 'Allowlist only (spockify.agent.strictAllowlist)' },
        ],
        { title: 'Spockify agent mode' },
      );
      if (!pick) return;
      await vscode.workspace
        .getConfiguration('spockify')
        .update('agent.mode', pick.label, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(
        `Agent mode → ${pick.label}`,
      );
    }),
    {
      dispose: () => {
        getChatTabAgentHost().setSink(undefined);
        sessions.dispose();
        handle = undefined;
      },
    },
  );

  output.appendLine(
    `runtime: registered builtins; mode=${getMode()}; use AgentRuntime for Chat/Composer/Terminal`,
  );
  return handle;
}

export { AgentRuntime, runAgentTurn };
export type { AgentRuntimeDeps };
