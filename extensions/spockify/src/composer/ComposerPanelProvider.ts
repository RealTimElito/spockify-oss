/**
 * Composer secondary-sidebar webview — Cursor-like multi-file input + pending review.
 * Pending Accept/Diff/Discard still backed by ComposerTreeProvider store.
 */

import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import { getComposerTree } from './composerView';
import {
  resetComposerPanelSession,
  runComposerInstruction,
} from './composerSession';
import { toolArgsSummary } from './toolSummary';
import {
  formatModelAttribution,
  pickResolvedModel,
} from '../util/modelAttribution';
import {
  costUsdFromUsage,
  formatRoutingHud,
  recordTurnRouting,
} from '../util/routingHud';
import { mergePickerModels } from '../chat/modelCatalog';
import {
  readIdeThinkingMode,
  writeIdeThinkingMode,
} from '../chat/thinkingPrefs';
import { normalizeThinkingMode } from '../chat/thinkingModes';

const COMPOSER_BUSY_CTX = 'spockify.composer.busy';

const VIEW_TYPE = 'spockify.composerPanel';

export type TransportFactory = () => Promise<ModelTransport | undefined>;

type HostMsg =
  | { type: 'ready'; status?: string; pending?: PendingFileUi[]; models?: Array<{ id: string; label?: string }>; selectedModel?: string; agentMode?: string; thinking?: string }
  | { type: 'status'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'streamStart'; model?: string }
  | { type: 'streamDelta'; content: string }
  | { type: 'streamDone'; model?: string; attribution?: string; routingHud?: string }
  | { type: 'streamModel'; model: string; attribution: string }
  | {
      type: 'toolActivity';
      id: string;
      name: string;
      phase: 'start' | 'done' | 'fail';
      detail?: string;
      arguments?: Record<string, unknown>;
    }
  | { type: 'system'; text: string }
  | { type: 'clear' }
  | { type: 'busy'; value: boolean }
  | { type: 'pending'; files: PendingFileUi[] }
  | { type: 'focusInput' }
  | { type: 'done'; text?: string }
  | { type: 'error'; message: string }
  | { type: 'thinking'; mode: string };

type WebMsg =
  | { type: 'ready' }
  | { type: 'send'; text: string; contextTags?: string[]; model?: string; agentMode?: string }
  | { type: 'stop' }
  | { type: 'newSession' }
  | { type: 'acceptFile'; path: string }
  | { type: 'discardFile'; path: string }
  | { type: 'diffFile'; path: string }
  | { type: 'acceptAll' }
  | { type: 'discardAll' }
  | { type: 'diffReview' }
  | { type: 'setThinkingMode'; mode: string };

export interface PendingFileUi {
  path: string;
  lines?: number;
}

export class ComposerPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = VIEW_TYPE;

  private view?: vscode.WebviewView;
  private busy = false;
  private abort?: AbortController;
  private selectedModel = '';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly getTransport: TransportFactory,
    private readonly output: vscode.OutputChannel,
    private readonly extContext: vscode.ExtensionContext,
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'media', 'composer'),
      ],
    };
    webview.html = this.getHtml(webview);
    webview.onDidReceiveMessage((raw: WebMsg) => {
      void this.onMessage(raw);
    });
  }

  async focusInput(): Promise<void> {
    await vscode.commands.executeCommand(`${VIEW_TYPE}.focus`);
    this.post({ type: 'focusInput' });
    setTimeout(() => this.post({ type: 'focusInput' }), 80);
  }

  /** Palette / Ctrl+Shift+Backspace — abort in-flight Composer generation. */
  stopGeneration(): void {
    if (!this.busy && !this.abort) {
      return;
    }
    this.abort?.abort();
    void (async () => {
      try {
        const { getRuntimeHandle } = await import('../runtime');
        getRuntimeHandle()?.sessions.cancelActive();
      } catch {
        /* soft */
      }
    })();
    this.busy = false;
    void this.setBusyContext(false);
    this.post({ type: 'busy', value: false });
    this.post({ type: 'done', text: 'Stopped' });
  }

  private async setBusyContext(active: boolean): Promise<void> {
    await vscode.commands.executeCommand('setContext', COMPOSER_BUSY_CTX, active);
  }

  /** Sync pending list from tree store into the webview. */
  refreshPending(): void {
    this.post({ type: 'pending', files: this.pendingUi() });
  }

  private pendingUi(): PendingFileUi[] {
    const tree = getComposerTree();
    return (tree?.getPending() ?? []).map((p) => ({
      path: p.path,
      lines: p.content.split('\n').length,
    }));
  }

  private post(msg: HostMsg): void {
    void this.view?.webview.postMessage(msg);
  }

  private async onMessage(msg: WebMsg): Promise<void> {
    switch (msg.type) {
      case 'ready':
        void this.pushReady();
        break;
      case 'send':
        await this.handleSend(msg.text, msg.contextTags, msg.model, msg.agentMode);
        break;
      case 'stop':
        this.stopGeneration();
        break;
      case 'setThinkingMode': {
        const mode = normalizeThinkingMode(msg.mode);
        await writeIdeThinkingMode(mode);
        this.post({ type: 'thinking', mode });
        break;
      }
      case 'newSession':
        this.abort?.abort();
        resetComposerPanelSession();
        this.post({ type: 'clear' });
        getComposerTree()?.clearPending();
        this.refreshPending();
        this.post({ type: 'system', text: 'New Composer session' });
        this.post({ type: 'done', text: 'Ready' });
        this.post({ type: 'focusInput' });
        break;
      case 'acceptFile':
        await vscode.commands.executeCommand(
          'spockify.composer.acceptPending',
          msg.path,
        );
        this.refreshPending();
        break;
      case 'discardFile':
        await vscode.commands.executeCommand(
          'spockify.composer.discardPending',
          msg.path,
        );
        this.refreshPending();
        break;
      case 'diffFile':
        await vscode.commands.executeCommand(
          'spockify.composer.diffPending',
          msg.path,
        );
        break;
      case 'acceptAll':
        await vscode.commands.executeCommand('spockify.composer.acceptAllPending');
        this.refreshPending();
        break;
      case 'discardAll':
        await vscode.commands.executeCommand(
          'spockify.composer.discardAllPending',
        );
        this.refreshPending();
        break;
      case 'diffReview':
        await vscode.commands.executeCommand(
          'spockify.composer.diffReviewPending',
        );
        this.refreshPending();
        break;
      default:
        break;
    }
  }

  private async pushReady(): Promise<void> {
    const transport = await this.getTransport();
    let models: Array<{ id: string; label?: string }> = [];
    if (transport) {
      try {
        models = mergePickerModels(
          (await transport.listModels({ ossOnly: true })).map((m) => ({
            id: m.id,
            label: m.name || m.id,
          })),
        );
      } catch {
        models = mergePickerModels([]);
      }
    } else {
      models = mergePickerModels([]);
    }
    if (!this.selectedModel) {
      this.selectedModel =
        vscode.workspace.getConfiguration('spockify').get<string>('defaultModel') ||
        models[0]?.id ||
        'spockify-auto';
    }
    const mode =
      vscode.workspace.getConfiguration('spockify').get<string>('agent.mode') ||
      'agent';
    this.post({
      type: 'ready',
      status: 'Ready · Ctrl+I · @file / @codebase / @web',
      pending: this.pendingUi(),
      models,
      selectedModel: this.selectedModel,
      agentMode: mode,
      thinking: readIdeThinkingMode(),
    } as HostMsg);
  }

  private async handleSend(
    text: string,
    contextTags?: string[],
    model?: string,
    agentMode?: string,
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.busy) return;

    const transport = await this.getTransport();
    if (!transport) {
      this.post({
        type: 'error',
        message: 'Sign in to Spockify to use Composer.',
      });
      return;
    }

    this.busy = true;
    this.abort = new AbortController();
    void this.setBusyContext(true);
    if (model) {
      this.selectedModel = model;
    }
    if (agentMode) {
      await vscode.workspace
        .getConfiguration('spockify')
        .update('agent.mode', agentMode, vscode.ConfigurationTarget.Workspace);
    }
    this.post({ type: 'busy', value: true });
    this.post({ type: 'status', text: 'Composer generating…' });
    this.post({ type: 'streamStart', model: this.selectedModel });
    this.post({
      type: 'streamModel',
      model: this.selectedModel,
      attribution: formatModelAttribution(this.selectedModel),
    });

    const t0 = Date.now();
    let resolvedModel = this.selectedModel;
    let costUsd: number | undefined;

    try {
      const result = await runComposerInstruction({
        transport,
        instruction: trimmed,
        contextTags,
        output: this.output,
        extContext: this.extContext,
        signal: this.abort.signal,
        model: this.selectedModel,
        onStream: (delta) => {
          if (delta) this.post({ type: 'streamDelta', content: delta });
        },
        onAgentEvent: (ev) => {
          if (ev.type === 'model' && ev.model) {
            resolvedModel = pickResolvedModel(this.selectedModel, ev.model);
            this.post({
              type: 'streamModel',
              model: resolvedModel,
              attribution: formatModelAttribution(
                this.selectedModel,
                resolvedModel,
              ),
            });
          } else if (ev.type === 'usage') {
            const c = costUsdFromUsage(ev.usage);
            if (c != null) costUsd = c;
          } else if (ev.type === 'toolStart') {
            const summary = toolArgsSummary(ev.name, ev.arguments);
            this.post({
              type: 'toolActivity',
              id: ev.id,
              name: ev.name,
              phase: 'start',
              arguments: ev.arguments,
              detail: summary || undefined,
            });
          } else if (ev.type === 'toolResult') {
            let detail: string | undefined;
            if (ev.name === 'terminal_run') {
              detail = ev.ok
                ? ev.content?.slice(0, 400)
                : ev.error || ev.content?.slice(0, 400);
            } else {
              detail = ev.ok
                ? ev.content?.slice(0, 120)
                : ev.error || ev.content?.slice(0, 120);
            }
            this.post({
              type: 'toolActivity',
              id: ev.id,
              name: ev.name,
              phase: ev.ok ? 'done' : 'fail',
              detail,
            });
          } else if (ev.type === 'status' && ev.text) {
            this.post({ type: 'status', text: ev.text });
          }
        },
      });

      if (this.abort.signal.aborted) {
        this.post({ type: 'done', text: 'Stopped' });
        return;
      }

      const latencyMs = Date.now() - t0;
      const attribution = formatModelAttribution(
        this.selectedModel,
        resolvedModel,
      );
      const routingHud = formatRoutingHud({
        latencyMs,
        costUsd,
        at: Date.now(),
      });
      recordTurnRouting({
        latencyMs,
        costUsd,
        model: resolvedModel,
        attribution,
      });

      if (result.summary) {
        this.post({
          type: 'streamDone',
          model: resolvedModel,
          attribution,
          routingHud,
        });
        this.post({ type: 'assistant', text: result.summary });
      } else {
        this.post({
          type: 'streamDone',
          model: resolvedModel,
          attribution,
          routingHud,
        });
      }
      this.refreshPending();
      const n = result.patchCount;
      this.post({
        type: 'done',
        text: n
          ? `${n} file(s) pending — Accept / Diff below or Ctrl+Shift+Enter · ${attribution}`
          : `Done · ${routingHud} · ${attribution}`,
      });
      if (n) {
        this.post({
          type: 'system',
          text: `Pending review: ${n} file(s). Accept all · Diff panel · or per-file.`,
        });
      }
    } catch (err) {
      if (this.abort.signal.aborted) {
        this.post({ type: 'done', text: 'Stopped' });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`composer panel: ${message}`);
      this.post({ type: 'error', message });
    } finally {
      this.busy = false;
      void this.setBusyContext(false);
      this.post({ type: 'busy', value: false });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'composer', 'composer.css'),
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'composer', 'composer.js'),
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${css}" />
  <title>Composer</title>
</head>
<body>
  <div class="panel">
    <div class="header">
      <span class="header-title">Composer</span>
      <div class="header-actions">
        <select id="agentMode" class="model-select" title="Agent mode">
          <option value="agent">Agent</option>
          <option value="ask">Ask</option>
          <option value="strict">Strict</option>
        </select>
        <select id="model" class="model-select" title="Model"></select>
        <button type="button" class="think-chip think-high" id="thinkBtn" title="Thinking High — click to cycle">High</button>
        <button type="button" class="icon-btn" id="newSession" title="New session">New</button>
      </div>
    </div>
    <div class="status" id="status">Ready</div>
    <div class="agent-strip" id="agentStrip" hidden></div>
    <div class="log" id="log"></div>
    <div class="pending" id="pending" hidden>
      <div class="pending-head">
        <h3>Pending (<span id="pendingCount">0</span>)</h3>
        <div class="pending-actions">
          <button type="button" class="icon-btn" id="diffReview">Diff panel</button>
          <button type="button" class="icon-btn" id="acceptAll">Accept all</button>
          <button type="button" class="icon-btn" id="discardAll">Discard</button>
        </div>
      </div>
      <div id="pendingList"></div>
    </div>
    <div class="composer">
      <div class="ctx-row">
        <button type="button" class="chip ctx-chip active" data-tag="file">@file</button>
        <button type="button" class="chip ctx-chip active" data-tag="selection">@selection</button>
        <button type="button" class="chip ctx-chip" data-tag="codebase">@codebase</button>
        <button type="button" class="chip ctx-chip" data-tag="folder">@folder</button>
        <button type="button" class="chip ctx-chip" data-tag="web">@web</button>
      </div>
      <textarea id="input" rows="3" placeholder="Multi-file change… Ctrl+Enter to run"></textarea>
      <div class="footer">
        <span class="hint">Agent tools · apply_patch · shadow review</span>
        <div>
          <button type="button" class="icon-btn" id="stop" hidden>Stop</button>
          <button type="button" class="btn primary" id="send">Run</button>
        </div>
      </div>
    </div>
  </div>
  <script src="${js}"></script>
</body>
</html>`;
  }
}

let sharedPanel: ComposerPanelProvider | undefined;

export function getComposerPanel(): ComposerPanelProvider | undefined {
  return sharedPanel;
}

export function registerComposerPanel(
  context: vscode.ExtensionContext,
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
): ComposerPanelProvider {
  sharedPanel = new ComposerPanelProvider(
    context.extensionUri,
    getTransport,
    output,
    context,
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ComposerPanelProvider.viewType,
      sharedPanel,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('spockify.composer.focus', async () => {
      await sharedPanel?.focusInput();
    }),
  );

  // Keep pending tree in sync when patches stage
  const tree = getComposerTree();
  if (tree) {
    context.subscriptions.push(
      tree.onPendingChange(() => {
        sharedPanel?.refreshPending();
      }),
    );
  }

  return sharedPanel;
}
