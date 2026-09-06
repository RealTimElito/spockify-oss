/**
 * Status bar chrome — Phase 2 density (agent mode, index, sync, pause, terminal policy).
 */

import * as vscode from 'vscode';
import { tryGetCodebaseProvider } from '../codebase/provider';
import { getToolRegistry } from '../mcp/register';
import { getSessionManager } from '../runtime/sessionManager';
import { getLastSyncBlob } from '../sync';
import { loadTerminalAgentSettings } from '../terminal/policy';
import { formatPolicyBadge } from '../terminal/policy/sandbox';
import { listActiveSessions } from '../terminal/session/active';
import { workspaceTerminalCwd } from '../terminal/runTerminalTool';
import {
  getAgentPermissionModeMeta,
  isAllowAllActive,
  shouldAutoApproveShell,
} from '../runtime/agentPermissionMode';
import { getLastTabLatency, onTabLatency } from '../complete/latency';
import {
  formatRoutingHud,
  getLastTurnRouting,
  onTurnRouting,
} from '../util/routingHud';

export function registerChrome(context: vscode.ExtensionContext): void {
  const agentItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    99,
  );
  agentItem.command = 'spockify.agent.setMode';
  agentItem.tooltip = 'Spockify agent mode (ask / agent / strict)';
  context.subscriptions.push(agentItem);

  const indexItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    98,
  );
  indexItem.command = 'spockify.codebase.status';
  indexItem.tooltip = 'Spockify codebase index status';
  context.subscriptions.push(indexItem);

  const syncItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    97,
  );
  syncItem.command = 'spockify.sync.toggle';
  syncItem.tooltip = 'Spockify settings sync (spockify.eu)';
  context.subscriptions.push(syncItem);

  const termItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    96,
  );
  termItem.command = 'spockify.terminalAgent.policyStatus';
  termItem.tooltip = 'Terminal Agent policy (ask-default)';
  context.subscriptions.push(termItem);

  const sessionItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    95,
  );
  sessionItem.command = 'spockify.agent.cancel';
  sessionItem.tooltip = 'Active agent session — click to stop';
  context.subscriptions.push(sessionItem);

  const composerItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    94,
  );
  composerItem.command = 'spockify.composer.focus';
  composerItem.tooltip = 'Composer pending review — click to focus';
  context.subscriptions.push(composerItem);

  const tabItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    93,
  );
  tabItem.command = 'spockify.complete';
  tabItem.tooltip = 'Last Tab ghost latency — click for manual complete';
  context.subscriptions.push(tabItem);

  const routeItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    92.5,
  );
  routeItem.tooltip = 'Last chat/composer turn — routed via spockify';
  context.subscriptions.push(routeItem);

  const mcpItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    92,
  );
  mcpItem.command = 'spockify.mcp.configure';
  mcpItem.tooltip = 'MCP tools — click to configure servers';
  context.subscriptions.push(mcpItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.chrome.keybindings', async () => {
      const mediaUri = vscode.Uri.joinPath(
        context.extensionUri,
        'media',
        'KEYBINDINGS.md',
      );
      let doc: vscode.TextDocument;
      try {
        doc = await vscode.workspace.openTextDocument(mediaUri);
      } catch {
        doc = await vscode.workspace.openTextDocument({
          content: [
            '# Spockify shortcuts',
            '',
            '- Ctrl/Cmd+L — Chat',
            '- Ctrl/Cmd+K — Inline edit',
            '- Ctrl/Cmd+I — Composer',
            "- Ctrl/Cmd+Shift+' — Terminal Agent",
            '- Escape / Stop square — cancel in-flight turn',
          ].join('\n'),
          language: 'markdown',
        });
      }
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
  );

  const refresh = (): void => {
    const cfg = vscode.workspace.getConfiguration('spockify');
    const mode = cfg.get<string>('agent.mode', 'ask') || 'ask';
    agentItem.text = `$(hubot) ${mode}`;
    agentItem.show();

    const st = tryGetCodebaseProvider()?.getStatus();
    if (st) {
      const icon =
        st.status === 'indexing'
          ? '$(sync~spin)'
          : st.status === 'error'
            ? '$(warning)'
            : '$(database)';
      const modelHint =
        st.embedModel && st.embedModel !== 'hash-local' ? '·emb' : '';
      const lanceHint =
        st.lanceAnn && st.lanceAnn !== 'none'
          ? '·ivf'
          : st.lanceBackend
            ? '·lance'
            : '';
      const countLabel =
        st.status === 'indexing'
          ? `${st.filesIndexed ?? 0}f`
          : `${st.chunks ?? 0}`;
      const fileHint =
        st.status === 'ready' && st.files != null ? `/${st.files}f` : '';
      indexItem.text = `${icon} ${countLabel}${fileHint}${modelHint}${lanceHint}`;
      indexItem.tooltip = `Spockify codebase: ${st.status}${st.chunks != null ? ` · ${st.chunks} chunks` : ''}${st.files != null ? ` · ${st.files} files` : ''}${st.status === 'indexing' && st.progressPath ? ` · ${st.progressPath}` : ''}${st.embedModel ? ` (${st.embedModel})` : ''}${st.lanceBackend ? ` · ${st.lanceBackend}` : ''}${st.lanceAnn && st.lanceAnn !== 'none' ? `/${st.lanceAnn}` : ''}`;
      indexItem.show();
    } else {
      indexItem.hide();
    }

    const syncOn = cfg.get<boolean>('sync.enabled', true);
    syncItem.text = syncOn ? '$(cloud-upload) sync' : '$(cloud) sync off';
    const last = getLastSyncBlob(context)?.updatedAt;
    syncItem.tooltip = last
      ? `Spockify sync ${syncOn ? 'on' : 'off'} · last ${new Date(last).toLocaleString()}`
      : 'Spockify settings sync (spockify.eu)';
    syncItem.show();

    try {
      const tSettings = loadTerminalAgentSettings();
      const perm = getAgentPermissionModeMeta();
      const allowAll = isAllowAllActive();
      const autoShell = shouldAutoApproveShell();
      const running = listActiveSessions().filter(
        (s) =>
          s.status === 'running' ||
          s.status === 'planning' ||
          s.status === 'awaiting_plan',
      ).length;
      const permHint = allowAll
        ? 'allowAll'
        : autoShell
          ? 'reviewFiles'
          : tSettings.policy;
      termItem.text =
        running > 0
          ? `$(terminal) ${permHint}·${running}`
          : allowAll
            ? '$(terminal) allowAll'
            : tSettings.osSandbox !== 'off'
              ? `$(terminal) ${permHint}·os`
              : `$(terminal) ${permHint}`;
      termItem.tooltip =
        `Permissions: ${perm.label}. Ask mode stays read-only. ` +
        formatPolicyBadge(tSettings, {
          cwd: workspaceTerminalCwd(),
          policy: tSettings.policy,
          allowlistTier: tSettings.allowlistTier,
        }) +
        ' — click for sandbox check';
      termItem.command = 'spockify.terminalAgent.checkSandbox';
      termItem.show();
    } catch {
      termItem.hide();
    }

    const active = getSessionManager().getActive();
    if (active && (active.status === 'running' || active.status === 'paused')) {
      const elapsedSec = Math.max(
        0,
        Math.floor((Date.now() - active.startedAt) / 1000),
      );
      const clock =
        elapsedSec >= 60
          ? `${Math.floor(elapsedSec / 60)}m${elapsedSec % 60}s`
          : `${elapsedSec}s`;
      const activity = active.activityLabel?.trim();
      const activityShort =
        activity && activity.length > 28
          ? `${activity.slice(0, 25)}…`
          : activity;
      sessionItem.text = activityShort
        ? `$(sync~spin) ${activityShort}`
        : `$(sync~spin) ${active.surface} · ${clock}`;
      sessionItem.tooltip = [
        `Running ${active.surface} · ${clock}`,
        activity ? activity : undefined,
        'Click stops this turn only — parallel agents keep running (cancel from Agents HUD).',
      ]
        .filter(Boolean)
        .join('\n');
      sessionItem.command = 'spockify.agent.cancel';
      sessionItem.show();
    } else {
      sessionItem.hide();
    }

    try {
      // Lazy require avoids chrome↔composer cycle at module load
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getComposerTree } = require('../composer/composerView') as {
        getComposerTree: () => { getPending: () => unknown[] } | undefined;
      };
      const pending = getComposerTree()?.getPending()?.length ?? 0;
      if (pending > 0) {
        composerItem.text = `$(diff) ${pending}`;
        composerItem.tooltip = `${pending} Composer file(s) pending Accept — click to focus`;
        composerItem.show();
      } else {
        composerItem.hide();
      }
    } catch {
      composerItem.hide();
    }

    const tabMs = getLastTabLatency();
    if (tabMs !== undefined) {
      const tabModel =
        cfg.get<string>('defaultModel') || 'spockify-auto';
      const tabLabel =
        tabModel === 'spockify-auto' || tabModel.endsWith('-auto')
          ? 'Auto'
          : tabModel.split('/').pop() || tabModel;
      tabItem.text = `$(zap) ${tabMs}ms`;
      tabItem.tooltip = `Last Tab ${tabMs}ms · ${tabLabel} · routed via spockify — click for manual complete`;
      tabItem.show();
    } else {
      tabItem.hide();
    }

    const turn = getLastTurnRouting();
    if (turn) {
      const hud = formatRoutingHud(turn);
      routeItem.text = `$(circuit-board) ${hud}`;
      routeItem.tooltip = turn.attribution
        ? `${turn.attribution} · ${hud}`
        : `Last turn ${hud} · routed via spockify`;
      routeItem.show();
    } else {
      routeItem.hide();
    }

    try {
      const mcpTools = getToolRegistry().listTools().length;
      const mcpServers = vscode.workspace
        .getConfiguration('spockify')
        .get<unknown[]>('mcp.servers', []).length;
      if (mcpServers > 0 || mcpTools > 0) {
        mcpItem.text =
          mcpTools > 0 ? `$(plug) mcp ${mcpTools}` : `$(plug) mcp·${mcpServers}`;
        mcpItem.tooltip = `MCP: ${mcpTools} tool(s) from ${mcpServers} server(s) — configure`;
        mcpItem.show();
      } else {
        mcpItem.text = '$(plug) mcp';
        mcpItem.tooltip = 'No MCP servers — click to add from catalog';
        mcpItem.show();
      }
    } catch {
      mcpItem.hide();
    }
  };

  refresh();
  // 1s while a session is live (elapsed clock); else 4s.
  let timer = setInterval(refresh, 4000);
  const retuneTimer = (): void => {
    clearInterval(timer);
    const active = getSessionManager().getActive();
    const live =
      active &&
      (active.status === 'running' || active.status === 'paused');
    timer = setInterval(refresh, live ? 1000 : 4000);
  };
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  context.subscriptions.push(
    onTabLatency(() => refresh()),
    onTurnRouting(() => refresh()),
    getSessionManager().onDidChange(() => {
      refresh();
      retuneTimer();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('spockify.agent.mode') ||
        e.affectsConfiguration('spockify.sync.enabled') ||
        e.affectsConfiguration('spockify.terminalAgent') ||
        e.affectsConfiguration('spockify.mcp.servers')
      ) {
        refresh();
      }
    }),
  );
}
