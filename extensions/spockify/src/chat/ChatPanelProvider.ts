/**
 * Spockify Chat — Cursor-like dense side panel.
 * Streaming, @file/@terminal/@codebase/@web + Ctrl+L selection chips, code Apply, OSS picker, history persistence.
 */

import * as vscode from 'vscode';

import { readAuthState } from '../auth';
import type { HostToWebview, WebviewToHost, AgentModeUi } from './protocol';
import type {
  ChatMessage,
  ChatPanelDeps,
  ChatModelTransport,
  ModelInfo,
} from './types';
import { MockChatTransport } from './mockTransport';
import {
  buildAtContext,
  resolveWebSection,
  captureEditorContext,
  editorAttachFlagsFromSnapshot,
} from '../rules';
import type { EditorContextSnapshot } from '../rules';
import { selectionChipFromSnapshot } from '../rules/editorAttach';
import {
  attachTerminalDefault,
  captureTerminalContext,
  formatTerminalContextSection,
} from '../terminal/contextBuffer';
import { shouldAttachCodebase } from '../codebase/attachPolicy';
import { retrieveCodebaseHitsForQuery } from '../codebase/retrieveForChat';
import { openWorkspaceFile, resolveWorkspaceUri } from './openWorkspaceFile';
import { readWorkspaceFileExcerpt } from './fileExcerpt';
import { messagesUsedFileEditTools, messagesFileEditToolsSucceeded } from '../composer/assistantProseDiffs';
import { spliceLineRange } from '../composer/parsePatches';
import {
  getRuntimeHandle,
  type AgentMode,
  assistantTextForDisplay,
  ChatSessionStore,
  stripContextSuffixForTitle,
  getChatTabAgentHost,
  shouldDeliverStreamToView,
} from '../runtime';
import type { ChatSessionUiState } from './chatSessionUi';
import { stepOpenTabId, normalizeContextChips } from './chatSessionUi';
import {
  buildUserContentFromAttachments,
  textFromContent,
  type ChatAttachmentPayload,
} from './chatContent';
import {
  composerUiModeAddon,
  normalizeComposerUiMode,
  toRuntimeAgentMode,
} from './composerModes';
import { mergePickerModels } from './modelCatalog';
import {
  readIdeThinkingMode,
  thinkingRequestExtras,
  writeIdeThinkingMode,
} from './thinkingPrefs';
import {
  normalizeThinkingMode,
  type ThinkingMode,
} from './thinkingModes';
import { getComposerTree } from '../composer/composerView';
import {
  hasActiveTerminalInlineEdit,
  sendCommandToTerminal,
} from '../inlineEdit/terminalInlineEdit';
import {
  isShellFenceLanguage,
  normalizeProposedShellCommand,
} from '../inlineEdit/normalizeShellCommand';
import {
  enqueueSend,
  dequeueSend,
  removeQueuedSend,
  toQueuedSendViewList,
  type QueuedSend,
} from './sendQueue';
import { resolveToolConsent } from '../runtime/toolConsent';

const VIEW_TYPE = 'spockify.chatView';
const FULL_SPOCKIFY_URL = 'https://spockify.eu';

export { VIEW_TYPE as CHAT_VIEW_TYPE };

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = VIEW_TYPE;

  private view?: vscode.WebviewView;
  private transport: ChatModelTransport;
  private messages: ChatMessage[] = [];
  private selectedModel: string;
  private readonly chatSessions: ChatSessionStore;
  private currentSessionId: string;
  private openTabIds: string[] = [];
  private readonly openExternal: (url: string) => Thenable<boolean>;
  private signedIn = false;
  private accountLabel?: string;
  private onSignIn?: () => Promise<void>;
  private output?: vscode.OutputChannel;
  private getModelTransport?: ChatPanelDeps['getModelTransport'];
  private agentMode: AgentModeUi = 'agent';
  /** Editor context captured on Ctrl+L / attachContext (survives chat focus). */
  private editorContextSnap?: EditorContextSnapshot;
  private lastAttachChips?: {
    file?: boolean;
    terminal?: boolean;
    codebase?: boolean;
    web?: boolean;
  };
  /** Per-tab FIFO of sends submitted while a turn was already streaming —
   * keeps the composer usable instead of blocking/dropping input. */
  private readonly sendQueues = new Map<string, QueuedSend[]>();
  /** Re-entrancy guard for drainQueue (tab switch races). */
  private readonly draining = new Set<string>();
  /**
   * When true (Fix with agent), stage parseable prose diffs after the turn
   * even if the model skipped apply_patch / write_file.
   */
  private pendingFixWithAgentStage = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly extensionUri: vscode.Uri,
    deps?: Partial<ChatPanelDeps> & {
      onSignIn?: () => Promise<void>;
      output?: vscode.OutputChannel;
      signedIn?: boolean;
      accountLabel?: string;
    },
  ) {
    this.transport = deps?.transport ?? new MockChatTransport();
    this.selectedModel = deps?.defaultModel ?? 'spockify-auto';
    this.openExternal =
      deps?.openExternal ??
      ((url) => vscode.env.openExternal(vscode.Uri.parse(url)));
    this.onSignIn = deps?.onSignIn;
    this.output = deps?.output;
    this.signedIn = deps?.signedIn ?? false;
    this.accountLabel = deps?.accountLabel;
    this.getModelTransport = deps?.getModelTransport;
    const cfgMode = vscode.workspace
      .getConfiguration('spockify')
      .get<string>('agent.mode', 'agent');
    const storedUi = this.getStoreValue<AgentModeUi>('spockify.chat.composerMode');
    this.agentMode = normalizeComposerUiMode(
      storedUi ?? cfgMode,
      cfgMode === 'ask' ? 'ask' : 'agent',
    );

    this.chatSessions = new ChatSessionStore(this.store);
    const loaded = this.chatSessions.loadCurrent();
    this.messages = loaded.messages as ChatMessage[];
    this.currentSessionId = loaded.id;
    if (loaded.messages.length && loaded.mode) {
      this.agentMode = loaded.mode;
    }
    if (loaded.model) {
      this.selectedModel = loaded.model;
    }
    this.openTabIds = this.chatSessions.touchOpenTab(this.currentSessionId);
    const tabHost = getChatTabAgentHost();
    tabHost.setViewTabId(this.currentSessionId);
    tabHost.setSink((tabId, msg) => this.onTabAgentMessage(tabId, msg));
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('spockify.runAllUnsandboxed') ||
          e.affectsConfiguration('spockify.agentPermissionMode') ||
          e.affectsConfiguration('spockify.chat.maxMode') ||
          e.affectsConfiguration('spockify.chat.thinking') ||
          e.affectsConfiguration('spockify.agent.mode')
        ) {
          this.postModelPrefs();
        }
      }),
    );
  }

  setTransport(transport: ChatModelTransport): void {
    this.transport = transport;
    void this.refreshModels();
  }

  setAuth(signedIn: boolean, accountLabel?: string): void {
    this.signedIn = signedIn;
    this.accountLabel = accountLabel;
    this.post({ type: 'auth', signedIn, accountLabel });
  }

  /**
   * Re-read SecretStorage + account globalState so chat matches the status bar
   * even when the webview loads before activate's refreshAuthUi finishes.
   */
  private async hydrateAuthFromStorage(): Promise<void> {
    const { signedIn, accountLabel } = await readAuthState(this.context);
    this.signedIn = signedIn;
    this.accountLabel = accountLabel;
  }

  /** Push auth immediately so UI cannot stay logged-out while models load. */
  private async pushAuthNow(): Promise<void> {
    await this.hydrateAuthFromStorage();
    this.post({
      type: 'auth',
      signedIn: this.signedIn,
      accountLabel: this.accountLabel,
    });
  }

  /** Palette / shortcut: new chat tab (webview saves composer UI first). */
  requestNewChatTab(): void {
    this.post({ type: 'newChatTab' });
  }

  /** Cycle open chat tabs (keyboard). */
  switchChatTab(delta: 1 | -1): void {
    const ids = this.openTabIds.length
      ? this.openTabIds
      : this.chatSessions.getOpenTabIds();
    const nextId = stepOpenTabId(ids, this.currentSessionId, delta);
    if (!nextId || nextId === this.currentSessionId) {
      return;
    }
    this.post({ type: 'switchSessionTab', id: nextId });
  }

  /** Focus panel then the composer textarea. */
  async focusInput(): Promise<void> {
    await vscode.commands.executeCommand(`${VIEW_TYPE}.focus`);
    // Webview may not be ready yet on first open — retry once.
    this.post({ type: 'focusInput' });
    setTimeout(() => this.post({ type: 'focusInput' }), 80);
  }

  /** Ctrl+L / Focus Chat — focus panel, attach editor + terminal context, composer caret. */
  async focusInputWithContext(): Promise<void> {
    this.postAttachContextFromHost();
    await this.focusInput();
    const chips = this.lastAttachChips;
    const selectionChip = selectionChipFromSnapshot(this.editorContextSnap);
    if (chips) {
      setTimeout(
        () =>
          this.post({
            type: 'attachContext',
            chips,
            selectionChip,
          }),
        80,
      );
    }
  }

  /**
   * Programmatic agent turn (e.g. Quick Fix "Fix with agent").
   * Forces Agent UI mode so tools can edit; patches stage for Accept/Reject
   * when auto-apply is off (default review path). If the model only dumps a
   * markdown unified diff, we still parse and stage it as a safety net.
   */
  async sendAgentPrompt(
    text: string,
    opts?: {
      mode?: AgentModeUi;
      withContext?: boolean;
      contextTags?: ('file' | 'codebase' | 'terminal' | 'web')[];
      /** Stage prose unified diffs when tools were not used (default true). */
      stageProseDiffFallback?: boolean;
    },
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.applyComposerMode(opts?.mode ?? 'agent');
    this.pendingFixWithAgentStage = opts?.stageProseDiffFallback !== false;
    try {
      await this.focusInputWithContext();
      await this.handleSend(
        trimmed,
        this.selectedModel,
        opts?.withContext !== false,
        opts?.contextTags ?? ['file'],
      );
    } finally {
      // Cleared in runCompletion after staging; keep if send queued mid-stream.
      if (!getChatTabAgentHost().isStreaming(this.currentSessionId)) {
        this.pendingFixWithAgentStage = false;
      }
    }
  }

  private postAttachContextFromHost(): void {
    this.editorContextSnap = captureEditorContext();
    const editorFlags = editorAttachFlagsFromSnapshot(this.editorContextSnap);
    const term = captureTerminalContext();
    const terminalFocused =
      !!vscode.window.activeTerminal && !this.editorContextSnap;
    const selectionChip = selectionChipFromSnapshot(this.editorContextSnap);
    const chips = {
      file: selectionChip ? false : editorFlags.includeActiveFile,
      terminal:
        attachTerminalDefault() && (terminalFocused || term !== undefined),
      codebase: false,
      web: false,
    };
    this.lastAttachChips = chips;
    this.post({
      type: 'attachContext',
      chips,
      selectionChip,
    });
    if (term?.isEmpty) {
      this.post({
        type: 'status',
        text: '@terminal — buffer fills as the shell runs',
      });
    }
  }

  /** Palette / keybinding: abort in-flight completion for the active tab. */
  stopGeneration(): void {
    const host = getChatTabAgentHost();
    if (!host.isStreaming(this.currentSessionId)) return;
    // Reject any pending tool consent (Cursor cancel ladder).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { rejectAllPendingToolConsents } = require('../runtime/toolConsent') as {
        rejectAllPendingToolConsents?: () => void;
      };
      rejectAllPendingToolConsents?.();
    } catch {
      /* optional */
    }
    host.cancel(this.currentSessionId);
  }

  /** Refresh Files-changed bar from composer pending + inline reviews. */
  refreshFilesChangedBar(): void {
    this.postFilesChanged();
  }

  /** Clear thread and start a new persisted session. */
  newChat(ui?: ChatSessionUiState): void {
    this.persistSessionUi(this.currentSessionId, ui);
    this.stopGeneration();
    this.messages = [];
    this.currentSessionId = this.chatSessions.createNewChat();
    getChatTabAgentHost().setViewTabId(this.currentSessionId);
    this.agentMode = normalizeComposerUiMode(
      this.getStoreValue<AgentModeUi>('spockify.chat.composerMode') ??
        vscode.workspace
          .getConfiguration('spockify')
          .get<string>('agent.mode', 'agent'),
      'agent',
    );
    this.post({ type: 'history', messages: [] });
    this.applySessionUiToWebview({});
    this.postSessions();
  }

  /** Re-run model on the last user turn (no duplicate user bubble). */
  retryLastMessage(): void {
    if (getChatTabAgentHost().isStreaming(this.currentSessionId)) return;
    let lastUser = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) return;
    this.messages = this.messages.slice(0, lastUser + 1);
    this.postHistory(this.messages);
    const chatTabId = this.currentSessionId;
    void this.runCompletion({ retry: true }, chatTabId).then(() =>
      this.drainQueue(chatTabId),
    );
  }

  async pickHistorySession(): Promise<void> {
    await vscode.commands.executeCommand(`${VIEW_TYPE}.focus`);
    this.post({ type: 'historyPanel', open: true });
    this.postSessions();
  }

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
        vscode.Uri.joinPath(this.extensionUri, 'media', 'chat'),
      ],
    };
    // Listener MUST be registered before html — otherwise the webview's
    // synchronous `ready` post is lost and models/auth never hydrate.
    webview.onDidReceiveMessage((raw: WebviewToHost) => {
      void this.onMessage(raw);
    });
    webview.html = this.getHtml(webview);
    // Belt-and-suspenders: push auth as soon as the view exists so a late
    // or dropped `ready` cannot leave the panel looking logged out.
    void this.pushAuthNow();
  }

  private async onMessage(msg: WebviewToHost): Promise<void> {
    switch (msg.type) {
      case 'ready':
        await this.pushReady();
        break;
      case 'send':
        if (msg.agentMode) {
          this.agentMode = msg.agentMode;
        }
        await this.handleSend(
          msg.text,
          msg.model,
          msg.withContext,
          msg.contextTags,
          msg.selectionChips,
          msg.attachments,
          { modifierFlip: msg.modifierFlip === true },
        );
        break;
      case 'selectModel':
        this.selectedModel = msg.model;
        this.setStoreValue('spockify.chat.selectedModel', msg.model);
        this.setStoreValue(
          'spockify.chat.autoModel',
          msg.model === 'spockify-auto' || msg.model.endsWith('-auto'),
        );
        this.postModelPrefs();
        break;
      case 'selectAgentMode':
        this.applyComposerMode(msg.mode);
        break;
      case 'setAutoModel':
        this.setStoreValue('spockify.chat.autoModel', msg.enabled);
        if (msg.enabled) {
          this.selectedModel = 'spockify-auto';
          this.setStoreValue('spockify.chat.selectedModel', 'spockify-auto');
        }
        this.postModelPrefs();
        break;
      case 'setMaxMode': {
        const enabled = !!msg.enabled;
        this.setStoreValue('spockify.chat.maxMode', enabled);
        void vscode.workspace
          .getConfiguration('spockify')
          .update('chat.maxMode', enabled, vscode.ConfigurationTarget.Global);
        this.postModelPrefs();
        break;
      }
      case 'setThinkingMode': {
        const mode = normalizeThinkingMode(msg.mode);
        this.setStoreValue('spockify.chat.thinking', mode);
        void writeIdeThinkingMode(mode);
        this.postModelPrefs();
        break;
      }
      case 'setRunAllUnsandboxed': {
        const enabled = !!msg.enabled;
        const { setAgentPermissionMode } = await import(
          '../runtime/agentPermissionMode'
        );
        await setAgentPermissionMode(enabled ? 'allowAll' : 'askEveryTime');
        this.postModelPrefs();
        break;
      }
      case 'setAgentPermissionMode': {
        const { isAgentPermissionMode, setAgentPermissionMode } = await import(
          '../runtime/agentPermissionMode'
        );
        if (isAgentPermissionMode(msg.mode)) {
          await setAgentPermissionMode(msg.mode);
        }
        this.postModelPrefs();
        break;
      }
      case 'addModels':
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'spockify.defaultModel',
        );
        void this.openExternal(FULL_SPOCKIFY_URL);
        break;
      case 'composerAcceptAll': {
        const { hasInlineReviews } = await import(
          '../apply/review/inlineReview'
        );
        if (hasInlineReviews()) {
          await vscode.commands.executeCommand('spockify.inlineReview.acceptAll');
        } else {
          await vscode.commands.executeCommand(
            'spockify.composer.acceptAllPending',
          );
        }
        this.postFilesChanged();
        break;
      }
      case 'composerDiscardAll': {
        const { hasInlineReviews, listInlineReviewPaths } = await import(
          '../apply/review/inlineReview'
        );
        if (hasInlineReviews() || listInlineReviewPaths().length) {
          await vscode.commands.executeCommand('spockify.inlineReview.rejectAll');
        } else {
          const pending = getComposerTree()?.getPending()?.length ?? 0;
          if (pending > 0) {
            await vscode.commands.executeCommand(
              'spockify.composer.discardAllPending',
            );
          } else {
            // Cursor Undo All when nothing pending: undo last applied checkpoint.
            try {
              const { getApplyService } = await import('../apply');
              await getApplyService().undoLast();
            } catch {
              /* ignore */
            }
          }
        }
        this.postFilesChanged();
        break;
      }
      case 'composerReview':
        await vscode.commands.executeCommand(
          'spockify.composer.diffReviewPending',
        );
        break;
      case 'newChat':
        this.newChat(msg.ui);
        break;
      case 'openFullSpockify':
        await this.openExternal(FULL_SPOCKIFY_URL);
        break;
      case 'stop':
        this.stopGeneration();
        break;
      case 'pause':
      case 'resume':
        // Pause removed — Stop (square) cancels the in-flight turn.
        break;
      case 'retry':
        this.retryLastMessage();
        break;
      case 'clearQueuedSend': {
        const chatTabId = this.currentSessionId;
        const next = removeQueuedSend(
          this.sendQueues.get(chatTabId) ?? [],
          msg.id,
        );
        this.sendQueues.set(chatTabId, next);
        this.postQueuedSends(chatTabId);
        break;
      }
      case 'listSessions':
        this.post({ type: 'historyPanel', open: true });
        this.postSessions();
        break;
      case 'requestSessions':
        this.postSessions();
        break;
      case 'switchSession':
        this.switchSession(msg.id, msg.ui);
        break;
      case 'closeSessionTab':
        this.closeSessionTab(msg.id, msg.ui);
        break;
      case 'loadSession':
        this.switchSession(msg.id);
        break;
      case 'applyBlock':
        await this.handleApply(
          msg.code,
          msg.pathHint,
          msg.shell,
          msg.startLine,
          msg.endLine,
        );
        break;
      case 'openFile':
        await openWorkspaceFile(msg.path, {
          line: msg.line,
          column: msg.column,
          endLine: msg.endLine,
        });
        break;
      case 'requestFileExcerpt': {
        const excerpt = await readWorkspaceFileExcerpt(
          msg.path,
          msg.startLine,
          msg.endLine,
        );
        this.post({
          type: 'fileExcerpt',
          requestId: msg.requestId,
          path: excerpt?.path ?? msg.path,
          startLine: excerpt?.startLine ?? msg.startLine,
          endLine: excerpt?.endLine ?? (msg.endLine ?? msg.startLine),
          text: excerpt?.text,
          truncated: excerpt?.truncated,
        });
        break;
      }
      case 'undoApply':
        await vscode.commands.executeCommand('spockify.applyUndo');
        break;
      case 'listCheckpoints':
        await vscode.commands.executeCommand('spockify.checkpoints.list');
        break;
      case 'restoreCheckpoint':
        await vscode.commands.executeCommand(
          'spockify.checkpoints.restore',
          msg.id,
        );
        break;
      case 'signIn':
        await this.onSignIn?.();
        break;
      case 'openHelp':
        await vscode.commands.executeCommand('spockify.help');
        break;
      case 'openSettings':
        await vscode.commands.executeCommand('spockify.settings.open');
        break;
      case 'insertAt':
        this.post({
          type: 'status',
          text:
            msg.kind === 'codebase'
              ? '@codebase chip — retrieval attaches on Send'
              : msg.kind === 'web'
                ? '@web chip — SearXNG web search attaches on Send'
                : `@${msg.kind} — enable chip before Send`,
        });
        break;
      case 'spawnAgents': {
        const fromArg = msg.prompt?.trim();
        const lastUser = [...this.messages]
          .reverse()
          .find((m) => m.role === 'user');
        const prompt =
          fromArg ||
          (lastUser
            ? stripContextSuffix(textFromContent(lastUser.content)).trim()
            : '');
        await vscode.commands.executeCommand(
          'spockify.agents.spawnFromPrompt',
          prompt || undefined,
        );
        break;
      }
      case 'openAgentRun': {
        const runId = msg.runId?.trim();
        if (runId) {
          await vscode.commands.executeCommand(
            'spockify.agents.openRunPanel',
            runId,
          );
        }
        break;
      }
      case 'cancelAgentRun': {
        const runId = msg.runId?.trim();
        if (runId) {
          await vscode.commands.executeCommand(
            'spockify.agents.cancelById',
            runId,
          );
        }
        break;
      }
      case 'toolConsentResponse':
        resolveToolConsent(msg.id, msg.decision);
        break;
      default:
        break;
    }
  }

  /** Push a clone-safe agent-run status card into the chat webview. */
  postAgentRunCard(payload: {
    runId: string;
    status: string;
    prompt?: string;
    model?: string;
    description?: string;
    workers?: Array<{
      id: string;
      name?: string;
      state?: string;
      prompt?: string;
    }>;
  }): void {
    this.post({
      type: 'agentRunCard',
      runId: payload.runId,
      status: payload.status,
      prompt: payload.prompt,
      model: payload.model,
      description: payload.description,
      workers: payload.workers,
      chatTabId: this.currentSessionId,
    });
  }

  private persistSessionUi(id: string, ui?: ChatSessionUiState): void {
    if (!ui) return;
    this.chatSessions.saveSessionUi(
      id,
      ui,
      toRuntimeAgentMode(this.agentMode),
    );
  }

  private applyComposerMode(mode: AgentModeUi): void {
    this.agentMode = normalizeComposerUiMode(mode);
    this.setStoreValue('spockify.chat.composerMode', this.agentMode);
    const runtime = toRuntimeAgentMode(this.agentMode);
    void vscode.workspace
      .getConfiguration('spockify')
      .update('agent.mode', runtime, vscode.ConfigurationTarget.Global);
    if (this.agentMode === 'plan') {
      void vscode.workspace
        .getConfiguration('spockify')
        .update(
          'terminalAgent.planApproval',
          true,
          vscode.ConfigurationTarget.Global,
        );
    }
    this.post({ type: 'agentMode', mode: this.agentMode });
    this.postModelPrefs();
  }

  private isAutoModel(): boolean {
    const autoPref = this.getStoreValue<boolean>('spockify.chat.autoModel');
    if (autoPref === false) return false;
    if (autoPref === true) return true;
    return (
      !this.selectedModel ||
      this.selectedModel === 'spockify-auto' ||
      this.selectedModel.endsWith('-auto')
    );
  }

  private isMaxMode(): boolean {
    const cfg = vscode.workspace
      .getConfiguration('spockify')
      .get<boolean>('chat.maxMode');
    if (typeof cfg === 'boolean') return cfg;
    return !!this.getStoreValue<boolean>('spockify.chat.maxMode');
  }

  private thinkingMode(): ThinkingMode {
    const stored = this.getStoreValue<string>('spockify.chat.thinking');
    if (stored) return normalizeThinkingMode(stored);
    return readIdeThinkingMode();
  }

  private getAgentPermissionMode(): string {
    const cfg = vscode.workspace.getConfiguration('spockify');
    const raw = cfg.get<string>('agentPermissionMode');
    if (
      raw === 'allowAll' ||
      raw === 'askEveryTime' ||
      raw === 'autoRunReviewFiles'
    ) {
      return raw;
    }
    if (cfg.get<boolean>('runAllUnsandboxed') === true) {
      return 'allowAll';
    }
    return 'askEveryTime';
  }

  private isRunAllUnsandboxed(): boolean {
    return this.getAgentPermissionMode() === 'allowAll';
  }

  private postModelPrefs(): void {
    this.post({
      type: 'modelPrefs',
      auto: this.isAutoModel(),
      maxMode: this.isMaxMode(),
      thinking: this.thinkingMode(),
      runAllUnsandboxed: this.isRunAllUnsandboxed(),
      agentPermissionMode: this.getAgentPermissionMode(),
      selectedModel: this.selectedModel,
    });
  }

  private postFilesChanged(): void {
    const treeN = getComposerTree()?.getPending()?.length ?? 0;
    let inlineN = 0;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { listInlineReviewPaths } = require('../apply/review/inlineReview') as {
        listInlineReviewPaths: () => string[];
      };
      inlineN = listInlineReviewPaths()?.length ?? 0;
    } catch {
      /* optional during early activate */
    }
    const count = Math.max(treeN, inlineN);
    this.post({ type: 'filesChanged', count });
  }

  private applySessionUiToWebview(ui?: ChatSessionUiState): void {
    const merged = ui ?? {};
    if (merged.agentMode) {
      this.agentMode = normalizeComposerUiMode(merged.agentMode);
      this.post({ type: 'agentMode', mode: this.agentMode });
    }
    const chips = normalizeContextChips(merged.contextChips);
    this.lastAttachChips = chips;
    this.post({ type: 'attachContext', chips });
    this.post({ type: 'composerDraft', text: merged.draft ?? '' });
  }

  private switchSession(id: string, ui?: ChatSessionUiState): void {
    if (id === this.currentSessionId) {
      if (ui) {
        this.persistSessionUi(id, ui);
        this.applySessionUiToWebview(
          this.chatSessions.getById(id)?.ui ?? ui,
        );
      }
      return;
    }
    this.snapshotStreamingTab(this.currentSessionId);
    this.persistSessionUi(this.currentSessionId, ui);
    const found = this.chatSessions.switchTo(id);
    this.currentSessionId = found.id;
    getChatTabAgentHost().setViewTabId(found.id);
    const live = getChatTabAgentHost().getLiveMessages(found.id);
    this.messages = (live ? [...live] : [...found.messages]) as ChatMessage[];
    if (found.ui?.agentMode) {
      this.agentMode = normalizeComposerUiMode(found.ui.agentMode);
    } else if (found.mode) {
      this.agentMode = normalizeComposerUiMode(found.mode);
    }
    if (found.model) {
      this.selectedModel = found.model;
    }
    this.postHistory(this.messages);
    this.applySessionUiToWebview(found.ui);
    this.syncActiveTabStreamingUi();
    this.postSessions();
    this.post({ type: 'historyPanel', open: false });
  }

  private closeSessionTab(id: string, ui?: ChatSessionUiState): void {
    const host = getChatTabAgentHost();
    if (host.isStreaming(id)) {
      host.cancel(id);
    }
    this.persistSessionUi(id, ui);
    const open = this.chatSessions.removeOpenTab(id);
    if (id !== this.currentSessionId) {
      this.postSessions();
      return;
    }
    const fallback = open[0] ?? this.chatSessions.createNewChat();
    this.switchSession(fallback);
  }

  private loadSession(id: string): void {
    this.switchSession(id);
  }

  private async applyChatPatches(
    patches: { path: string; content: string }[],
  ): Promise<void> {
    if (!patches.length) return;
    const output =
      this.output ?? vscode.window.createOutputChannel('Spockify');
    const { shouldAutoApplyFilePatches } = await import(
      '../runtime/agentPermissionMode'
    );
    if (!shouldAutoApplyFilePatches()) {
      const { stageInlineFileReview } = await import(
        '../apply/review/inlineReview'
      );
      await stageInlineFileReview(patches, {
        source: 'chat',
        openFirst: true,
        sessionId: this.currentSessionId,
      });
      output.appendLine(
        `chat apply: staged ${patches.length} file(s) for inline review`,
      );
      return;
    }
    const { applyChatPatchesFromBridge } = await import('./applyBridge');
    await applyChatPatchesFromBridge(patches, output);
  }

  private async handleApply(
    code: string,
    pathHint?: string,
    shell?: boolean,
    startLine?: number,
    endLine?: number,
  ): Promise<void> {
    const pathLooksLikeFile =
      !!pathHint &&
      (pathHint.includes('/') || /\.[a-z0-9]+$/i.test(pathHint)) &&
      !isShellFenceLanguage(pathHint);

    const preferTerminal =
      shell === true ||
      isShellFenceLanguage(pathHint) ||
      (hasActiveTerminalInlineEdit() && !pathLooksLikeFile);

    if (preferTerminal) {
      const cmd = normalizeProposedShellCommand(code);
      if (!cmd) {
        void vscode.window.showWarningMessage('Empty command — nothing to run.');
        return;
      }
      if (sendCommandToTerminal(cmd, { execute: true })) {
        void vscode.window.showInformationMessage('Command sent to terminal.');
      }
      return;
    }

    if (pathHint && (pathHint.includes('/') || pathHint.includes('.'))) {
      let content = code;
      if (
        startLine != null &&
        endLine != null &&
        startLine > 0 &&
        endLine >= startLine
      ) {
        const uri = await resolveWorkspaceUri(pathHint);
        if (uri) {
          try {
            const doc = await vscode.workspace.openTextDocument(uri);
            content = spliceLineRange(
              doc.getText(),
              startLine,
              endLine,
              code,
            );
          } catch {
            /* use raw code as full-file content */
          }
        }
      }
      await this.applyChatPatches([{ path: pathHint, content }]);
      return;
    }
    const rel = await vscode.window.showInputBox({
      title: 'Apply to workspace file',
      prompt: 'Workspace-relative path (e.g. scripts/check_spockify.py)',
      placeHolder: 'scripts/example.py',
      ignoreFocusOut: true,
    });
    if (rel?.trim()) {
      await this.applyChatPatches([{ path: rel.trim(), content: code }]);
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      // No editor — if content looks like a shell command, send to terminal.
      if (sendCommandToTerminal(code, { execute: true })) {
        void vscode.window.showInformationMessage('Command sent to terminal.');
        return;
      }
      void vscode.window.showWarningMessage('Open a file to Apply.');
      return;
    }
    const sel = editor.selection;
    if (!sel.isEmpty) {
      await editor.edit((eb) => eb.replace(sel, code));
    } else {
      const confirm = await vscode.window.showInformationMessage(
        'Apply code at cursor (or replace selection next time)?',
        'Insert',
        'Replace file',
      );
      if (confirm === 'Replace file') {
        const full = new vscode.Range(
          editor.document.positionAt(0),
          editor.document.positionAt(editor.document.getText().length),
        );
        await editor.edit((eb) => eb.replace(full, code));
      } else if (confirm === 'Insert') {
        await editor.edit((eb) => eb.insert(sel.active, code));
      }
    }
  }

  private async pushReady(): Promise<void> {
    // Auth first — listModels can be slow/fail; never block signed-in UI on it.
    await this.hydrateAuthFromStorage();
    this.post({
      type: 'auth',
      signedIn: this.signedIn,
      accountLabel: this.accountLabel,
    });

    const models = await this.loadModelsForPicker();
    const storedModel = this.getStoreValue<string>('spockify.chat.selectedModel');
    if (storedModel) this.selectedModel = storedModel;
    if (!models.some((m) => m.id === this.selectedModel) && models[0]) {
      this.selectedModel = models[0].id;
    }
    // Re-read in case credentials landed during listModels.
    await this.hydrateAuthFromStorage();
    this.post({
      type: 'ready',
      models,
      selectedModel: this.selectedModel,
      messages: this.messagesForWebview(this.messages),
      signedIn: this.signedIn,
      accountLabel: this.accountLabel,
      sessions: this.chatSessions.listHistoryForPanel(),
      currentSessionId: this.currentSessionId,
      openTabIds: this.chatSessions.getOpenTabIds(),
      sessionUi: loadedUiFromSession(this.chatSessions.getById(this.currentSessionId)),
      agentMode: this.agentMode,
    });
    this.postModelPrefs();
    this.postFilesChanged();
    this.applySessionUiToWebview(
      loadedUiFromSession(this.chatSessions.getById(this.currentSessionId)),
    );
    // Webview remount mid-turn: re-arm streamStart so deltas paint again.
    this.syncActiveTabStreamingUi();
  }

  /** Catalog for the model menu — never return empty when signed in. */
  private async loadModelsForPicker(): Promise<ModelInfo[]> {
    let models: ModelInfo[] = [];
    try {
      models = await this.transport.listModels();
    } catch (err) {
      this.output?.appendLine(
        `[chat] listModels failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    models = (models || []).filter((m) => m && m.id && m.oss !== false);
    return mergePickerModels(models);
  }

  private async refreshModels(): Promise<void> {
    if (!this.view) return;
    const models = await this.loadModelsForPicker();
    this.post({ type: 'models', models, selectedModel: this.selectedModel });
  }

  /**
   * Handle a composer submission. Never blocks/drops: if a turn is already
   * streaming for this tab, the submission is appended to a FIFO queue
   * (see sendQueue.ts) and surfaced to the webview as a queued chip; it
   * runs automatically once the in-flight turn (and anything queued ahead
   * of it) finishes. If the tab is idle, it runs immediately — same as
   * before this feature existed.
   *
   * Cursor queueMessageDefaultBehavior: `queue` (default) or `stop-and-send`
   * (abort current turn with new_message_submitted semantics, then send).
   */
  private async handleSend(
    text: string,
    model: string,
    withContext: boolean,
    contextTags?: ('file' | 'codebase' | 'terminal' | 'web')[],
    selectionChips?: Array<{
      id: string;
      fileName: string;
      filePath: string;
      startLine: number;
      endLine: number;
      text: string;
    }>,
    attachments?: ChatAttachmentPayload[],
    opts?: { modifierFlip?: boolean },
  ): Promise<void> {
    const trimmed = text.trim();
    const atts = (attachments ?? []).filter(Boolean);
    if (!trimmed && !atts.length) return;

    this.selectedModel = model || this.selectedModel;
    const chatTabId = this.currentSessionId;
    const host = getChatTabAgentHost();
    const streaming = host.isStreaming(chatTabId);

    const cfg = vscode.workspace.getConfiguration('spockify');
    const queueBehavior =
      cfg.get<string>('composer.queueMessageDefaultBehavior', 'queue') ||
      'queue';
    // Cursor: Enter uses default; Ctrl/Cmd+Enter flips queue ↔ stop-and-send.
    const flip = opts?.modifierFlip === true;
    let behavior: 'queue' | 'stop-and-send' =
      queueBehavior === 'stop-and-send' ? 'stop-and-send' : 'queue';
    if (flip) {
      behavior = behavior === 'stop-and-send' ? 'queue' : 'stop-and-send';
    }
    const stopAndSend = streaming && behavior === 'stop-and-send';

    if (stopAndSend) {
      this.stopGeneration();
      // Queue as head so drain picks it up after abort settles.
      const rest = this.sendQueues.get(chatTabId) ?? [];
      const queue = enqueueSend([], {
        userText: trimmed,
        model: this.selectedModel,
        withContext,
        contextTags,
        selectionChips,
        attachments: atts.length ? atts : undefined,
      }).concat(rest);
      this.sendQueues.set(chatTabId, queue);
      this.postQueuedSends(chatTabId);
      // Brief yield so cancel completes before drain.
      await new Promise((r) => setTimeout(r, 50));
      await this.drainQueue(chatTabId);
      return;
    }

    const queue = enqueueSend(this.sendQueues.get(chatTabId) ?? [], {
      userText: trimmed,
      model: this.selectedModel,
      withContext,
      contextTags,
      selectionChips,
      attachments: atts.length ? atts : undefined,
    });
    this.sendQueues.set(chatTabId, queue);
    this.postQueuedSends(chatTabId);
    await this.drainQueue(chatTabId);
  }

  private postQueuedSends(chatTabId: string): void {
    if (chatTabId !== this.currentSessionId) return;
    this.post({
      type: 'queuedSends',
      chatTabId,
      items: toQueuedSendViewList(this.sendQueues.get(chatTabId) ?? []),
    });
  }

  /**
   * Run queued sends for `chatTabId` one at a time, in submission order,
   * while the tab is idle. No-ops immediately if a turn is already
   * streaming (the queued item stays put — this same method runs again
   * once that turn's runCompletion resolves) or if the user has since
   * switched to a different tab (resumes via syncActiveTabStreamingUi()
   * when they switch back — avoids writing into another tab's `this.messages`).
   */
  private async drainQueue(chatTabId: string): Promise<void> {
    if (this.draining.has(chatTabId)) return;
    this.draining.add(chatTabId);
    try {
      const host = getChatTabAgentHost();
      while (
        chatTabId === this.currentSessionId &&
        !host.isStreaming(chatTabId)
      ) {
        const { item, rest } = dequeueSend(
          this.sendQueues.get(chatTabId) ?? [],
        );
        if (!item) return;
        this.sendQueues.set(chatTabId, rest);
        this.postQueuedSends(chatTabId);
        this.selectedModel = item.model || this.selectedModel;
        await this.runCompletion(
          {
            userText: item.userText,
            withContext: item.withContext,
            contextTags: item.contextTags,
            selectionChips: item.selectionChips,
            attachments: item.attachments,
          },
          chatTabId,
        );
      }
    } finally {
      this.draining.delete(chatTabId);
    }
  }

  private async runCompletion(
    opts?: {
      userText?: string;
      withContext?: boolean;
      contextTags?: ('file' | 'codebase' | 'terminal' | 'web')[];
      selectionChips?: Array<{
        id: string;
        fileName: string;
        filePath: string;
        startLine: number;
        endLine: number;
        text: string;
      }>;
      attachments?: ChatAttachmentPayload[];
      retry?: boolean;
    },
    targetChatTabId?: string,
  ): Promise<void> {
    const chatTabId = targetChatTabId ?? this.currentSessionId;
    if (getChatTabAgentHost().isStreaming(chatTabId)) return;

    const attachments = (opts?.attachments ?? []).filter(Boolean);
    const hasUserPayload =
      !!opts?.userText?.trim() || attachments.length > 0;
    if (hasUserPayload) {
      let userText = opts?.userText ?? '';
      const tags = opts?.contextTags ?? [];
      const selectionChips = (opts?.selectionChips ?? []).filter((c) =>
        Boolean(c?.text?.trim()),
      );
      const { parseMentions } = await import('../rules/mentions');
      const mentions = parseMentions(userText);
      const wantFile =
        tags.includes('file') ||
        mentions.kinds.has('file') ||
        mentions.filePaths.length > 0;
      const wantSel =
        selectionChips.length > 0 ||
        mentions.kinds.has('selection') ||
        /@selection/i.test(userText);
      const explicitCodebase =
        tags.includes('codebase') ||
        mentions.kinds.has('codebase') ||
        mentions.kinds.has('folder');
      const codebaseCfg = vscode.workspace.getConfiguration('spockify.codebase');
      const wantCodebase = shouldAttachCodebase({
        explicit: explicitCodebase,
        autoAttach: codebaseCfg.get<boolean>('autoAttach', true),
        autoAttachAsk: codebaseCfg.get<boolean>('autoAttachAsk', true),
        uiMode: this.agentMode,
      });
      const wantWeb =
        tags.includes('web') ||
        mentions.kinds.has('web') ||
        mentions.kinds.has('docs');
      const wantTerminal =
        tags.includes('terminal') || mentions.kinds.has('terminal');

      if (
        wantFile ||
        wantSel ||
        wantCodebase ||
        wantWeb ||
        wantTerminal ||
        mentions.filePaths.length
      ) {
        let codebaseHits:
          | Array<{
              path: string;
              startLine: number;
              endLine: number;
              text: string;
            }>
          | undefined;
        if (wantCodebase) {
          const retrieved = await retrieveCodebaseHitsForQuery(
            mentions.cleanQuery || userText,
            {
              pathPrefix: mentions.folderPaths[0],
              log: this.output,
            },
          );
          codebaseHits = retrieved.hits;
          if (retrieved.hits.length) {
            this.post({
              type: 'status',
              text: `@codebase · ${retrieved.hits.length} hit(s)`,
              chatTabId,
            });
          } else if (retrieved.status === 'empty') {
            this.post({
              type: 'status',
              text: '@codebase · no hits (try Reindex Codebase)',
              chatTabId,
            });
          } else if (retrieved.status !== 'ok') {
            this.post({
              type: 'status',
              text: `@codebase · ${retrieved.status}`,
              chatTabId,
            });
          }
        }
        const extraUris: vscode.Uri[] = [];
        const root = vscode.workspace.workspaceFolders?.[0]?.uri;
        if (root) {
          for (const rel of mentions.filePaths) {
            extraUris.push(vscode.Uri.joinPath(root, rel));
          }
        }
        if (wantWeb) {
          this.post({
            type: 'status',
            text: '@web · searching…',
            chatTabId,
          });
        }
        const webSection = wantWeb
          ? await resolveWebSection(this.context, userText, {
              force: tags.includes('web'),
            })
          : undefined;
        if (wantWeb) {
          this.post({
            type: 'status',
            text: webSection?.trim()
              ? '@web · results attached'
              : '@web · no results (check sign-in / SearXNG)',
            chatTabId,
          });
        }
        const terminalSection = wantTerminal
          ? formatTerminalContextSection(captureTerminalContext())
          : undefined;
        const ctx = await buildAtContext({
          includeSelection: wantSel && selectionChips.length === 0,
          includeActiveFile: wantFile,
          selectionChips,
          editorSnapshot: this.editorContextSnap,
          codebaseHits,
          extraUris,
          context: this.context,
          webSection,
          terminalSection,
        });
        if (ctx) {
          userText = `${userText}\n\n---\n${ctx}`;
        } else if (wantCodebase && !codebaseHits?.length) {
          userText = `${userText}\n\n---\n[@codebase — no hits; try Reindex Codebase]`;
        } else if (wantWeb && !webSection?.trim()) {
          userText = `${userText}\n\n---\n[@web — no results; sign in or try web_search tool]`;
        } else if (wantTerminal && !terminalSection?.trim()) {
          userText = `${userText}\n\n---\n[@terminal — no recent output; run commands in the integrated terminal]`;
        }
      }

      const userContent = buildUserContentFromAttachments(
        userText,
        attachments,
      );
      this.messages.push({ role: 'user', content: userContent });
    }

    // Push empty assistant before history so the webview ends on this turn's
    // assistant node (not the previous reply) when streamStart arrives.
    this.messages.push({
      role: 'assistant',
      content: '',
      model: this.selectedModel,
    });
    // resumeStreaming: history rebuild clears local streaming; without this
    // flag, early streamDelta can be dropped before streamStart is processed
    // (and streamingTabIds often still lags behind the run).
    this.post({
      type: 'history',
      messages: this.messagesForWebview(this.messages),
      resumeStreaming: true,
    });
    const assistantIndex = this.messages.length - 1;
    const requestExtras = {
      ...this.chatPipelineRequestExtras(),
      ...thinkingRequestExtras(this.thinkingMode()),
    };

    const host = getChatTabAgentHost();
    await host.runTurn(
      {
        chatTabId,
        messages: this.messages,
        assistantIndex,
        model: this.selectedModel,
        mode: toRuntimeAgentMode(this.agentMode),
        composerUiMode: this.agentMode,
        uiModeAddon: composerUiModeAddon(this.agentMode),
        requestExtras,
        getModelTransport: this.getModelTransport,
        runLegacyTransport: async (idx, _t0, onChunk, signal) => {
          for await (const chunk of this.transport.chatCompletions({
            model: this.selectedModel,
            messages: this.messages.slice(0, -1),
            stream: true,
            signal,
            ...requestExtras,
          })) {
            if (signal.aborted) break;
            if (chunk.content) {
              onChunk(chunk.content, chunk.model);
            } else if (chunk.model) {
              onChunk('', chunk.model);
            }
            if (chunk.done) break;
          }
        },
        onPersist: (id, messages) => {
          if (id === this.currentSessionId) {
            this.messages = messages;
          }
          const lastAssistant = [...messages]
            .reverse()
            .find((m) => m.role === 'assistant' && m.model);
          this.chatSessions.saveThread({
            id,
            messages,
            mode: toRuntimeAgentMode(this.agentMode),
            model: lastAssistant?.model || this.selectedModel,
          });
          this.postSessions();
        },
      },
      getRuntimeHandle(),
    );

    if (chatTabId === this.currentSessionId) {
      await this.stageOrApplyAssistantPatches({
        forceProseDiffFallback: this.pendingFixWithAgentStage,
      });
      this.pendingFixWithAgentStage = false;
    }
  }

  /**
   * After a turn: stage path fences / unified diffs for Accept/Reject
   * (Ask + Review files), or auto-apply when Allow all is on.
   * Skip when write_file/apply_patch already ran this turn (tools own staging).
   * Fix with agent sets forceProseDiffFallback so a markdown-only diff still
   * stages when the model skipped tools.
   */
  private async stageOrApplyAssistantPatches(opts?: {
    forceProseDiffFallback?: boolean;
  }): Promise<void> {
    let turnStart = 0;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        turnStart = i;
        break;
      }
    }
    const usedEditTools = messagesUsedFileEditTools(this.messages, turnStart);
    if (usedEditTools) {
      // Tools ran — skip prose when they staged/applied. For Fix with agent,
      // refused tools used to leave a silent no-op; fall through to prose.
      const toolsOk = messagesFileEditToolsSucceeded(this.messages, turnStart);
      if (toolsOk || !opts?.forceProseDiffFallback) {
        return;
      }
      this.output?.appendLine(
        'fix-with-agent: edit tools ran but did not stage — trying prose fallback',
      );
    }

    const finalAssistant = [...this.messages]
      .reverse()
      .find((m) => m.role === 'assistant');
    const final = textFromContent(finalAssistant?.content ?? '');
    const { collectChatReviewPatchesDetailed } = await import(
      '../composer/materializeChatPatches'
    );
    const { patches, skips } = await collectChatReviewPatchesDetailed(final, {
      allowOpenEditorFallback: true,
    });
    if (!patches.length) {
      if (opts?.forceProseDiffFallback) {
        const reason =
          skips[0] ||
          'no apply_patch/write_file success and no parseable prose diff to stage';
        this.output?.appendLine(`fix-with-agent: couldn't stage: ${reason}`);
        void vscode.window.showWarningMessage(
          `Fix with agent: couldn't stage: ${clipToast(reason)}`,
        );
      }
      return;
    }

    const { shouldAutoApplyFilePatches } = await import(
      '../runtime/agentPermissionMode'
    );
    // Ask agent mode is read-only for tools, but still offer Accept UI for
    // proposed fences/diffs. Allow all (non-Ask) auto-applies.
    if (this.agentMode !== 'ask' && shouldAutoApplyFilePatches()) {
      await this.applyChatPatches(patches);
      return;
    }
    const { stageInlineFileReview } = await import(
      '../apply/review/inlineReview'
    );
    await stageInlineFileReview(patches, {
      source: 'chat',
      openFirst: true,
      sessionId: this.currentSessionId,
    });
    this.output?.appendLine(
      `chat apply: staged ${patches.length} file(s) for inline review` +
        (opts?.forceProseDiffFallback ? ' (fix-with-agent fallback)' : ''),
    );
  }

  private chatPipelineRequestExtras(): Record<string, unknown> {
    const cfg = vscode.workspace.getConfiguration('spockify');
    const enabled = cfg.get<boolean>('chat.pipeline.enabled', false);
    const workModel = (
      cfg.get<string>('chat.pipeline.workModel', 'codestral') || 'codestral'
    ).trim();
    const explainModel = (
      cfg.get<string>('chat.pipeline.explainModel', 'gemma4-12b') || 'gemma4-12b'
    ).trim();
    const postProcess = cfg.get<boolean>('chat.pipeline.postProcess', true);
    const hideIntermediate = cfg.get<boolean>('chat.pipeline.hideIntermediate', true);
    const devLog = cfg.get<boolean>('chat.pipeline.devLog', false);
    return {
      spockify_pipeline_enabled: enabled,
      spockify_pipeline_work_model: workModel,
      spockify_pipeline_explain_model: explainModel,
      spockify_pipeline_post_process: postProcess,
      spockify_pipeline_hide_intermediate: hideIntermediate,
      spockify_pipeline_dev_log: devLog,
    };
  }

  private onTabAgentMessage(tabId: string, msg: HostToWebview): void {
    const msgChatTabId = 'chatTabId' in msg ? msg.chatTabId : undefined;
    // Tool consent must never be dropped: callers await a response to
    // unblock tool execution. Even if the chat view is on a different tab,
    // surface the inline consent bar in the active webview.
    if (msg.type === 'toolConsentRequest') {
      this.post(msg);
      return;
    }
    if (!shouldDeliverStreamToView(msgChatTabId ?? tabId, this.currentSessionId)) {
      if (
        msg.type === 'streamStart' ||
        msg.type === 'streamDone' ||
        msg.type === 'streamStopped'
      ) {
        this.postSessions();
      }
      return;
    }
    this.post(msg);
    if (
      msg.type === 'streamStart' ||
      msg.type === 'streamDone' ||
      msg.type === 'streamStopped'
    ) {
      this.postSessions();
    }
    // Terminal sync: if live deltas were dropped (history race, remount,
    // stale streaming flag), push the finished transcript so the reply is
    // visible immediately — not only after the user's next send.
    if (
      msg.type === 'streamDone' ||
      msg.type === 'streamStopped' ||
      msg.type === 'streamError'
    ) {
      const live =
        getChatTabAgentHost().getLiveMessages(tabId) ??
        (tabId === this.currentSessionId ? this.messages : undefined);
      if (live?.length) {
        this.output?.appendLine(
          `[chat] terminal history sync after ${msg.type} (${live.length} msgs)`,
        );
        this.postHistory(live);
      }
    }
  }

  private snapshotStreamingTab(tabId: string): void {
    const live = getChatTabAgentHost().getLiveMessages(tabId);
    if (!live?.length) return;
    this.chatSessions.saveThread({
      id: tabId,
      messages: live,
      mode: toRuntimeAgentMode(this.agentMode),
      model: this.selectedModel,
    });
  }

  private syncActiveTabStreamingUi(): void {
    const chatTabId = this.currentSessionId;
    const host = getChatTabAgentHost();
    if (host.isStreaming(chatTabId)) {
      // Remount / tab focus mid-turn: restore painted content then re-arm.
      const live = host.getLiveMessages(chatTabId);
      if (live?.length) {
        this.post({
          type: 'history',
          messages: this.messagesForWebview(live),
          resumeStreaming: true,
        });
      }
      this.post({
        type: 'streamStart',
        chatTabId,
      });
    } else {
      // Switching back to a tab that has items queued from before (either
      // queued while it was streaming, or queued while it wasn't the
      // active tab) — resume draining now that it's idle and active again.
      void this.drainQueue(chatTabId);
    }
    this.postQueuedSends(chatTabId);
  }

  private post(msg: HostToWebview): void {
    void this.view?.webview.postMessage(msg);
  }

  private messagesForWebview(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((m) => {
      if (m.role !== 'assistant' || !m.content) return m;
      const raw =
        typeof m.content === 'string' ? m.content : String(m.content ?? '');
      const display = assistantTextForDisplay(raw);
      if (display === raw) return m;
      return { ...m, content: display };
    });
  }

  private postHistory(messages: ChatMessage[]): void {
    this.post({ type: 'history', messages: this.messagesForWebview(messages) });
  }

  private postSessions(): void {
    this.post({
      type: 'sessions',
      sessions: this.chatSessions.listHistoryForPanel(),
      currentSessionId: this.currentSessionId,
      openTabIds: this.chatSessions.getOpenTabIds(),
      streamingTabIds: getChatTabAgentHost().listStreamingTabIds(),
      sessionUi: loadedUiFromSession(
        this.chatSessions.getById(this.currentSessionId),
      ),
    });
  }

  private get store(): vscode.Memento {
    return vscode.workspace.workspaceFolders?.length
      ? this.context.workspaceState
      : this.context.globalState;
  }

  private getStoreValue<T>(key: string): T | undefined {
    return this.store.get<T>(key);
  }

  private setStoreValue(key: string, value: unknown): void {
    void this.store.update(key, value);
  }

  private persistCurrentSession(): void {
    this.chatSessions.saveThread({
      id: this.currentSessionId,
      messages: this.messages,
      mode: toRuntimeAgentMode(this.agentMode),
      model: this.selectedModel,
    });
    this.postSessions();
  }

  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'chat', 'chat.css'),
    );
    const katexStyleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'media',
        'chat',
        'katex',
        'katex.min.css',
      ),
    );
    const katexScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'media',
        'chat',
        'katex',
        'katex.min.js',
      ),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'chat', 'chat.js'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${katexStyleUri}" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>Spockify Chat</title>
</head>
<body>
  <div class="panel">
    <header class="header">
      <div class="header-top">
        <div class="tab-scroller" role="presentation">
          <div id="chatTabs" class="chat-tabs" role="tablist" aria-label="Chat threads"></div>
        </div>
        <div class="header-actions">
          <button type="button" id="settingsBtn" class="icon-btn icon-only" title="Spockify Settings" aria-label="Spockify Settings">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 2.5h3l.4 1.6a4.5 4.5 0 0 1 1.1.6l1.6-.5 1.5 2.6-1.2 1.1c.1.4.1.7.1 1.1s0 .7-.1 1.1l1.2 1.1-1.5 2.6-1.6-.5a4.5 4.5 0 0 1-1.1.6L9.5 13.5h-3l-.4-1.6a4.5 4.5 0 0 1-1.1-.6l-1.6.5L1.9 9.2l1.2-1.1A4 4 0 0 1 3 7c0-.4 0-.7.1-1.1L1.9 4.8l1.5-2.6 1.6.5c.3-.25.7-.45 1.1-.6L6.5 2.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/></svg>
          </button>
          <button type="button" id="helpBtn" class="icon-btn icon-only" title="Help &amp; Tips" aria-label="Help and tips">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M6.6 6.4a1.5 1.5 0 1 1 2.2 1.3c-.5.3-.8.7-.8 1.3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="8" cy="11.2" r="0.7" fill="currentColor"/></svg>
          </button>
          <button type="button" id="historyBtn" class="icon-btn icon-only" title="Chat history" aria-label="Chat history">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8l2.2 1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button type="button" id="newChat" class="icon-btn icon-only primary" title="New chat" aria-label="New chat">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          </button>
        </div>
      </div>
      <div class="header-meta">
        <span id="authChip" class="auth-chip" title="Account">…</span>
      </div>
    </header>

    <aside id="historyPanel" class="history-panel" hidden aria-label="Chat history">
      <div class="history-head">
        <span class="history-title">History</span>
        <button type="button" id="historyClose" class="icon-btn tiny" title="Close" aria-label="Close history">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </button>
      </div>
      <ul id="historyList" class="history-list"></ul>
      <p id="historyEmpty" class="history-empty" hidden>No saved chats yet.</p>
    </aside>

    <main id="messages" class="messages" aria-live="polite"></main>
    <button type="button" id="jumpLatest" class="jump-latest" hidden title="Jump to latest">↓ Latest</button>

    <footer class="composer">
      <div class="composer-fade" aria-hidden="true"></div>
      <div id="streamPhaseBar" class="stream-phase-bar" hidden aria-live="polite">
        <span id="streamPhaseDot" class="stream-phase-dot" aria-hidden="true"></span>
        <span id="streamPhaseLabel" class="stream-phase-label">Thinking</span>
      </div>
      <div id="agentsActivityBar" class="agents-activity-bar" hidden aria-label="Agents activity">
        <div class="agents-activity-inner">
          <span id="agentsActivityTitle" class="agents-activity-title">Agents</span>
          <div id="agentsActivityProgress" class="agents-activity-progress" hidden aria-hidden="true">
            <div id="agentsActivityFill" class="agents-activity-fill"></div>
          </div>
          <div id="agentsActivityWorkers" class="agents-activity-workers"></div>
          <button type="button" id="agentsActivityOpen" class="ghost-btn agents-activity-open" hidden>Open</button>
          <button type="button" id="agentsActivityCancel" class="ghost-btn agents-activity-cancel" hidden>Cancel</button>
        </div>
      </div>
      <div id="filesChangedBar" class="files-changed-bar" hidden>
        <button type="button" id="filesChangedToggle" class="files-changed-count" title="Review pending file changes in the editor">&gt; <span id="filesChangedCount">0</span> Files</button>
        <button type="button" id="undoAllFiles" class="files-link">Undo All</button>
        <button type="button" id="keepAllFiles" class="files-link">Keep All</button>
        <button type="button" id="reviewFiles" class="review-btn">Review</button>
      </div>
      <div id="toolConsentBar" class="tool-consent-bar" hidden aria-label="Tool consent">
        <div class="tool-consent-text">
          <div class="tool-consent-title">
            <span id="toolConsentTitle">Tool wants to run</span>
            <span id="toolConsentBadge" class="tool-consent-badge" hidden></span>
          </div>
          <div class="tool-consent-command">
            <code id="toolConsentCommand">command...</code>
          </div>
        </div>
        <div class="tool-consent-actions">
          <button type="button" id="toolConsentAccept" class="ghost-btn tool-consent-accept">Accept</button>
          <button type="button" id="toolConsentAllowSession" class="ghost-btn" hidden>Allow for session</button>
          <button type="button" id="toolConsentRunTerminal" class="ghost-btn" hidden>Run in Terminal</button>
          <button type="button" id="toolConsentReject" class="ghost-btn">Reject</button>
        </div>
      </div>
      <div id="queuedSends" class="queued-sends" hidden aria-label="Queued messages"></div>
      <div class="composer-box" id="composerBox">
        <div id="selChips" class="sel-chips" hidden aria-label="Selection context"></div>
        <textarea id="input" rows="2" placeholder="Plan, search, build anything…"
          aria-label="Chat message"></textarea>
        <div class="composer-toolbar">
          <div class="composer-left">
            <div class="ctx-attach">
              <button type="button" id="ctxBtn" class="ctx-btn" aria-haspopup="menu" aria-expanded="false" title="Context (@)">
                <span aria-hidden="true">@</span>
                <span id="ctxBtnSummary" class="ctx-btn-summary"></span>
              </button>
              <div id="ctxMenu" class="popover ctx-menu" hidden role="menu" aria-label="Context">
                <button type="button" class="ctx-item ctx-chip active" data-tag="file" role="menuitemcheckbox" aria-checked="true">
                  <span class="ctx-item-label">@file</span><span class="ctx-item-check">✓</span>
                </button>
                <button type="button" class="ctx-item ctx-chip active" data-tag="terminal" role="menuitemcheckbox" aria-checked="true" title="Attach integrated terminal">
                  <span class="ctx-item-label">@terminal</span><span class="ctx-item-check">✓</span>
                </button>
                <button type="button" class="ctx-item ctx-chip" data-tag="codebase" role="menuitemcheckbox" aria-checked="false" title="Attach @codebase">
                  <span class="ctx-item-label">@codebase</span><span class="ctx-item-check"></span>
                </button>
                <button type="button" class="ctx-item ctx-chip" data-tag="web" role="menuitemcheckbox" aria-checked="false" title="Web Search (SearXNG — same as spockify.eu)">
                  <span class="ctx-item-label">@web</span><span class="ctx-item-check"></span>
                </button>
              </div>
            </div>
            <button type="button" id="modeBtn" class="mode-pill mode-agent" data-mode="agent" aria-haspopup="menu" aria-expanded="false" title="Mode (Shift+Tab)">
              <span id="modeBtnIcon" class="mode-pill-icon" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.8 8c0-1.7 1.4-3.1 3.1-3.1 1.2 0 2 .6 3.1 2 1.1-1.4 1.9-2 3.1-2 1.7 0 3.1 1.4 3.1 3.1S13.8 11.1 12.1 11.1c-1.2 0-2-.6-3.1-2-1.1 1.4-1.9 2-3.1 2C4.2 11.1 2.8 9.7 2.8 8z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg></span>
              <span id="modeBtnLabel" class="mode-pill-label">Agent</span>
              <span class="chev" aria-hidden="true">▾</span>
            </button>
            <button type="button" id="modelBtn" class="model-chip" aria-haspopup="menu" aria-expanded="false" title="Model">
              <span id="modelBtnLabel">Auto</span>
              <span class="chev" aria-hidden="true">▾</span>
            </button>
            <button type="button" id="thinkBtn" class="think-chip think-high" title="Thinking High — click to cycle" aria-label="Thinking High. Click to cycle.">
              <span id="thinkBtnLabel">High</span>
            </button>
            <button type="button" id="permBtn" class="perm-chip" aria-haspopup="menu" aria-expanded="false" title="Tool &amp; file permissions">
              <span id="permBtnLabel">Ask</span>
              <span class="chev" aria-hidden="true">▾</span>
            </button>
            <span id="latency" class="latency"></span>
          </div>
          <div class="composer-right">
            <button type="button" id="signInBtn" class="ghost-btn">Sign in</button>
            <button type="button" id="attachBtn" class="icon-round" title="Attach file" aria-label="Attach file">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 11.5l5-5a2.12 2.12 0 0 0-3-3l-5.5 5.5a3.18 3.18 0 0 0 4.5 4.5l6-6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            </button>
            <input type="file" id="filePick" class="sr-only" multiple tabindex="-1" aria-hidden="true" />
            <button type="button" id="sendStop" class="icon-round send-round mode-agent" data-mode="send" title="Send (Enter)" aria-label="Send">
              <svg class="send-glyph" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 12.5V4M4.75 7.25 8 4l3.25 3.25" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <svg class="stop-glyph" width="8" height="8" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" hidden><rect x="2.5" y="2.5" width="7" height="7" rx="1"/></svg>
            </button>
          </div>
        </div>
        <div id="modeMenu" class="popover mode-menu" hidden role="menu" aria-label="Mode"></div>
        <div id="permMenu" class="popover perm-menu" hidden role="menu" aria-label="Permissions"></div>
        <div id="modelMenu" class="popover model-menu" hidden role="dialog" aria-label="Models">
          <input type="search" id="modelSearch" class="model-search" placeholder="Search models" autocomplete="off" />
          <div class="model-toggle-row">
            <div class="model-toggle-copy">
              <div class="model-toggle-title">Auto</div>
              <div class="model-toggle-desc">Balanced quality and speed, recommended for most tasks</div>
            </div>
            <button type="button" id="autoToggle" class="toggle" role="switch" aria-checked="true" title="Auto"></button>
          </div>
          <div class="model-toggle-row max-row">
            <div class="model-toggle-copy">
              <div class="model-toggle-title">MAX Mode</div>
            </div>
            <button type="button" id="maxToggle" class="toggle" role="switch" aria-checked="false" title="MAX Mode"></button>
          </div>
          <div id="modelList" class="model-list" role="listbox" aria-label="Model list"></div>
          <button type="button" id="addModelsBtn" class="add-models">Add Models</button>
        </div>
        <!-- Hidden selects kept for protocol/tests compatibility -->
        <select id="model" class="sr-only" aria-hidden="true" tabindex="-1"></select>
        <select id="agentMode" class="sr-only" aria-hidden="true" tabindex="-1">
          <option value="agent">agent</option>
          <option value="plan">plan</option>
          <option value="debug">debug</option>
          <option value="multitask">multitask</option>
          <option value="ask">ask</option>
          <option value="strict">strict</option>
        </select>
      </div>
      <div class="composer-foot">
        <span id="composerHint" class="composer-hint">Stop ends this turn · agents keep running</span>
        <button type="button" id="openFull" class="linkish">spockify.eu</button>
      </div>
    </footer>
  </div>
  <script nonce="${nonce}" src="${katexScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function stripContextSuffix(
  content: string | import('./chatContent').ChatContent,
): string {
  return stripContextSuffixForTitle(
    typeof content === 'string' ? content : textFromContent(content),
  );
}

function loadedUiFromSession(
  row:
    | {
        ui?: ChatSessionUiState;
        mode?: AgentModeUi;
      }
    | undefined,
): ChatSessionUiState | undefined {
  if (!row) return undefined;
  return {
    ...row.ui,
    agentMode: row.ui?.agentMode ?? row.mode,
  };
}

function getNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function clipToast(s: string, n = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}
