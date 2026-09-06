/**
 * Spockify Agents — live per-run webview panel (Cursor-style "click an
 * agent row to see its full transcript"). Consumes the router's SSE feed
 * (`/spockify/agents/runs/{id}/events`) for remote runs, or the in-memory
 * local store for `local-*` shell agent runs (never hits the remote API).
 *
 * Known, honest limits (see extensions/spockify/README or the 0.8.0
 * release notes for the full writeup):
 *  - No token-by-token "live thoughts": the router calls each worker's
 *    model non-streaming (see services/router/parallel_agents.py
 *    `_run_one_worker` / `_worker_chat`), so there is no partial text to
 *    show while a worker is generating — only "Generating…" until it
 *    transitions to done/failed. Only the shared search/browse tool calls
 *    are truly live (tool_start/tool_result).
 *  - No live terminal/stdout output: parallel agent workers run server-side
 *    and only call chat + search/browse — they do not execute shell
 *    commands. terminal_run streaming exists only for the single-agent
 *    Chat/Composer path (chatTabAgentHost.ts), which is unrelated to this
 *    panel and unaffected by it. Local shell parallel runs (`local-*`)
 *    surface worker output via the in-memory store instead of SSE.
 */

import * as vscode from 'vscode';
import type { AgentRun, AgentRunEvent } from '@spockify/ide-client';
import { asRemote, type AgentsTransportFactory } from './AgentsTreeProvider';
import { sanitizeAgentRun, sanitizeAgentRunEvent } from './agentRunUi';
import {
  getLocalAgentRun,
  isLocalAgentRunId,
  subscribeLocalAgentRun,
} from './localAgentRunStore';

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

type PanelToHost = { type: 'ready' } | { type: 'cancel' };
type HostToPanel =
  | { type: 'init'; run: AgentRun }
  | { type: 'event'; event: AgentRunEvent }
  | { type: 'streamError'; message: string };

/** One live panel per run id — re-focuses the existing panel instead of
 * opening duplicates if the same run is already open. */
const openPanels = new Map<string, vscode.WebviewPanel>();

export function openAgentRunPanel(
  context: vscode.ExtensionContext,
  getTransport: AgentsTransportFactory,
  output: vscode.OutputChannel,
  runId: string,
): void {
  const existing = openPanels.get(runId);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Beside);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'spockify.agentRunPanel',
    `Agent run ${runId.slice(0, 8)}`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'media', 'agents'),
        vscode.Uri.joinPath(context.extensionUri, 'media', 'chat'),
      ],
      retainContextWhenHidden: true,
    },
  );
  openPanels.set(runId, panel);

  const abort = new AbortController();
  let disposed = false;
  let unsubLocal: (() => void) | undefined;

  const post = (msg: HostToPanel): void => {
    if (!disposed) void panel.webview.postMessage(msg);
  };

  async function startLocalPanel(): Promise<void> {
    const run = getLocalAgentRun(runId);
    if (!run) {
      post({
        type: 'streamError',
        message:
          'Local agent run not found (may have expired). Updates stay in the chat card.',
      });
      return;
    }
    post({ type: 'init', run: sanitizeAgentRun(run) });
    unsubLocal = subscribeLocalAgentRun(runId, (next) => {
      post({
        type: 'event',
        event: sanitizeAgentRunEvent({
          type: 'run_status',
          run_id: runId,
          status: next.status,
          run: sanitizeAgentRun(next),
        }),
      });
    });
    output.appendLine(`agents: panel local run ${runId}`);
  }

  async function startStreaming(): Promise<void> {
    if (isLocalAgentRunId(runId)) {
      await startLocalPanel();
      return;
    }

    const transport = await getTransport();
    const remote = transport ? asRemote(transport) : undefined;
    if (!remote) {
      post({ type: 'streamError', message: 'Sign in to Spockify to view this run.' });
      return;
    }
    try {
      const run = await remote.getAgentRun(runId);
      post({ type: 'init', run: sanitizeAgentRun(run) });
    } catch (err) {
      post({
        type: 'streamError',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const streamFn = (
      transport as unknown as {
        streamAgentRunEvents?: (
          id: string,
          signal?: AbortSignal,
        ) => AsyncIterable<AgentRunEvent>;
      }
    ).streamAgentRunEvents;
    if (!streamFn) {
      output.appendLine(
        'agents: panel — transport has no streamAgentRunEvents; live updates unavailable (view is a one-time snapshot).',
      );
      return;
    }

    try {
      for await (const ev of streamFn.call(transport, runId, abort.signal)) {
        if (disposed) break;
        post({ type: 'event', event: sanitizeAgentRunEvent(ev) });
      }
    } catch (err) {
      if (!disposed && !abort.signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`agents: panel stream error (${runId}): ${msg}`);
        post({ type: 'streamError', message: msg });
      }
    }
  }

  panel.webview.onDidReceiveMessage(async (msg: PanelToHost) => {
    if (msg.type === 'ready') {
      void startStreaming();
      return;
    }
    if (msg.type === 'cancel') {
      if (isLocalAgentRunId(runId)) {
        void vscode.window.showInformationMessage(
          'Local shell agent runs finish when their terminal commands complete.',
        );
        return;
      }
      const transport = await getTransport();
      const remote = transport ? asRemote(transport) : undefined;
      if (!remote) return;
      try {
        await remote.cancelAgentRun(runId);
        output.appendLine(`agents: panel stop requested ${runId}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Stop failed: ${message}`);
        post({ type: 'streamError', message: `Stop failed: ${message}` });
      }
    }
  });

  panel.onDidDispose(() => {
    disposed = true;
    abort.abort();
    unsubLocal?.();
    openPanels.delete(runId);
  });

  panel.webview.html = getHtml(panel.webview, context.extensionUri);
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const chatStyleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'chat', 'chat.css'),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'agents', 'agents.css'),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'agents', 'agents.js'),
  );
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${chatStyleUri}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Spockify Agent Run</title>
</head>
<body>
  <div class="agents-panel" id="root">
    <header class="run-header">
      <div class="run-header-top">
        <span id="statusDot" class="run-status-dot pending">●</span>
        <span id="title" class="run-title">Loading…</span>
        <div class="run-actions">
          <button type="button" id="cancelBtn" class="ghost-btn stop-btn" hidden>Stop</button>
        </div>
      </div>
      <div id="meta" class="run-meta"></div>
      <div id="prompt" class="run-prompt"></div>
    </header>
    <main id="workers" class="workers"></main>
    <p id="empty" class="empty-state">Loading run…</p>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
