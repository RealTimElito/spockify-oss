/**
 * Spockify IDE extension — open-source Cursor clone surface.
 * AI → https://spockify.eu. No Copilot / Microsoft AI login.
 */

import * as vscode from 'vscode';
import {
  createModelTransport,
  looksLikeJwt,
  type ModelTransport,
  type ProviderId,
} from '@spockify/ide-client';
import {
  getApiKey,
  getAccount,
  readAuthState,
  signIn,
  AuthStatusBar,
  clearAuth,
} from './auth';
import { registerAccountCommands } from './account';
import { registerChatCommand } from './commands/chat';
import { registerCompleteCommand } from './commands/complete';
import { registerApplyCommand } from './commands/apply';
import { registerGenerateCommitMessage } from './commands/generateCommitMessage';
import { registerInlineEdit } from './commands/inlineEdit';
import { registerInlineCompletions } from './complete/inlineCompletion';
import { registerFixWithAgent } from './diagnostics/fixWithAgent';
import { registerComposer } from './composer/composer';
import { registerComposerView } from './composer/composerView';
import { registerComposerPanel } from './composer/ComposerPanelProvider';
import { registerShadowGc } from './composer/shadowGc';
import { browseComposerShadows } from './composer/shadowBrowse';
import { registerTerminalAgent } from './terminal/terminalAgent';
import { registerTerminalContextBuffer } from './terminal/contextBuffer';
import { registerAgentsView } from './agents/AgentsTreeProvider';
import { setAgentRunChatListener } from './agents/agentRunChatBridge';
import { registerCodebase } from './codebase';
import { registerRulesCommands } from './rules';
import {
  registerCheckpointCommands,
  bindApplyService,
  getCheckpointStore,
} from './checkpoints';
import { getApplyService, registerDiffReview, registerInlineFileReview } from './apply';
import { registerMcp } from './mcp';
import { registerChrome } from './chrome';
import { registerHelp } from './help/register';
import { registerWebBridgeCommands } from './web/bridges';
import { registerRemoteSshCommands } from './remoteSsh';
import { registerAgentRuntime } from './runtime';
import { registerSync } from './sync';
import { registerUpdateCheck } from './update';
import { registerSettings } from './settings';
import {
  registerChatPanel,
  createFallbackChatTransport,
  MockChatTransport,
} from './chat';

const API_KEY_SECRET = 'spockify.apiKey';

interface ResolveOptions {
  promptIfMissing?: boolean;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Spockify');
  context.subscriptions.push(output);
  const remote = vscode.env.remoteName ?? 'local';
  output.appendLine(
    `Spockify Cursor-clone extension activating… remote=${remote} (UI host; AI → spockify.eu)`,
  );

  const status = new AuthStatusBar(context);
  context.subscriptions.push(status.disposable);

  let setChatAuth: (signedIn: boolean, label?: string) => void = () => {};

  /** One credential read → status bar + chat (same source of truth). */
  const refreshAuthUi = async (): Promise<void> => {
    const { signedIn, accountLabel, key, account } =
      await readAuthState(context);
    await status.refresh({ key, account });
    setChatAuth(signedIn, accountLabel);
  };

  const resolveTransport = async (
    opts: ResolveOptions = {},
  ): Promise<ModelTransport | undefined> => {
    const cfg = vscode.workspace.getConfiguration('spockify');
    const provider = (cfg.get<string>('provider') || 'remote') as ProviderId;
    const baseUrl = cfg.get<string>('baseUrl') || 'https://spockify.eu';
    const ossOnly = cfg.get<boolean>('models.ossOnly', true);

    if (provider === 'local') {
      if (opts.promptIfMissing) {
        void vscode.window.showWarningMessage(
          'Local models coming soon. Use spockify.provider = remote.',
        );
      }
      return undefined;
    }

    let apiKey = await getApiKey(context);
    if (!apiKey) {
      if (opts.promptIfMissing) {
        const pick = await vscode.window.showWarningMessage(
          'Sign in to Spockify (spockify.eu) to use AI features.',
          'Sign in',
        );
        if (pick === 'Sign in') {
          const ok = await signIn(context);
          if (ok) {
            await refreshAuthUi();
            apiKey = await getApiKey(context);
          }
        }
      }
      if (!apiKey) {
        return undefined;
      }
    }

    const account = await getAccount(context);
    // Email/password → OWUI JWT (or OWUI sk-). Must not hit LiteLLM /v1 (401).
    const apiBackend =
      account?.kind === 'session' || looksLikeJwt(apiKey) ? 'owui' : 'litellm';

    return createModelTransport({
      provider: 'remote',
      baseUrl,
      apiKey,
      ossOnly,
      apiBackend,
    });
  };

  const getTransport = (): Promise<ModelTransport | undefined> =>
    resolveTransport({ promptIfMissing: true });

  const getTransportQuiet = (): Promise<ModelTransport | undefined> =>
    resolveTransport({ promptIfMissing: false });

  // MCP + agent runtime before Chat so Send can use UnifiedToolRegistry
  void registerMcp(context, output);
  registerAgentRuntime(context, getTransportQuiet, output);

  const chat = registerChatPanel(context, {
    transport: createFallbackChatTransport(
      getTransportQuiet,
      new MockChatTransport(),
    ),
    getModelTransport: getTransportQuiet,
    onSignIn: async () => {
      const ok = await signIn(context);
      if (ok) {
        await refreshAuthUi();
        void vscode.window.showInformationMessage('Signed in to Spockify.');
      }
    },
    output,
  });
  setChatAuth = (signedIn, label) => chat.provider.setAuth(signedIn, label);

  // Await first paint so status bar + chat share credentials before the
  // webview's ready handshake; fire-and-forget left chat on a stale false.
  void refreshAuthUi().then(() => {
    output.appendLine(
      'Spockify auth UI refreshed (status bar + chat).',
    );
  });
  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === API_KEY_SECRET) {
        void refreshAuthUi();
      }
    }),
  );

  registerAccountCommands(context, {
    output,
    refreshAuthUi,
    getTransport,
  });

  registerChatCommand(context, getTransport, output, () => chat.provider);
  registerCompleteCommand(context, getTransport, output);
  registerApplyCommand(context, getTransport, output);
  registerGenerateCommitMessage(context, getTransport, output);
  registerInlineEdit(context, getTransport, output);
  registerInlineCompletions(context, getTransportQuiet, output, {
    onAuthFailure: async () => {
      await clearAuth(context);
      await refreshAuthUi();
    },
  });
  registerFixWithAgent(context, () => chat.provider, output);
  registerComposer(context, getTransport, output);
  const composerTree = registerComposerView(context, output);
  registerComposerPanel(context, getTransport, output);
  registerShadowGc(context, output);
  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.composer.listShadows', () =>
      browseComposerShadows(),
    ),
  );
  registerTerminalAgent(context, getTransport, output);
  registerTerminalContextBuffer(context);
  registerAgentsView(context, getTransportQuiet, output);
  setAgentRunChatListener((payload) => {
    chat.provider.postAgentRunCard(payload);
  });
  context.subscriptions.push({
    dispose: () => setAgentRunChatListener(undefined),
  });
  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.chat.refreshFilesChanged', () => {
      chat.provider.refreshFilesChangedBar();
    }),
  );
  // Keep Files bar live when Composer pending changes (tool stage mid-turn).
  context.subscriptions.push(
    composerTree.onPendingChange(() => {
      chat.provider.refreshFilesChangedBar();
    }),
  );
  const codebase = registerCodebase(context, { output });
  codebase.setEmbedFactory(async () => {
    const t = await getTransportQuiet();
    if (!t?.embed) return undefined;
    const model =
      vscode.workspace
        .getConfiguration('spockify.codebase')
        .get<string>('embedModel', 'nomic-embed') ||
      'nomic-embed';
    return (texts: string[]) => t.embed!(texts, { model });
  });
  codebase.setTransportFactory(getTransportQuiet);
  registerRulesCommands(context, output);
  registerSync(context, {
    getTransport: getTransportQuiet,
    output,
    refreshAuthUi,
  });
  registerUpdateCheck(context, output);
  registerSettings({
    context,
    output,
    refreshAuthUi,
    getTransport: getTransportQuiet,
  });

  const checkpointStore = registerCheckpointCommands(context, output);
  const applyService = getApplyService(context);
  context.subscriptions.push(bindApplyService(applyService, checkpointStore));
  void getCheckpointStore(output);
  registerDiffReview(context, output);
  registerInlineFileReview(context);

  registerChrome(context);
  registerHelp(context);
  registerWebBridgeCommands(context);
  registerRemoteSshCommands(context);
  void composerTree;

  const welcomeKey = 'spockify.welcomeShown';
  if (!context.globalState.get(welcomeKey)) {
    void context.globalState.update(welcomeKey, true);
    void vscode.window
      .showInformationMessage(
        'Spockify IDE — open-source Cursor alternative. Sign in to spockify.eu for AI.',
        'Sign in',
        'Open Chat',
        'Help',
      )
      .then(async (c) => {
        if (c === 'Sign in') {
          await vscode.commands.executeCommand('spockify.signIn');
        } else if (c === 'Open Chat') {
          await vscode.commands.executeCommand('spockify.chat');
        } else if (c === 'Help') {
          await vscode.commands.executeCommand('spockify.help');
        }
      });
  }

  output.appendLine(
    'Ready: Chat Ctrl+L · Inline Ctrl+K · Tab · Composer · Generate Commit Message · Terminal Agent · Agents → spockify.eu',
  );
}

export function deactivate(): void {
  // no-op
}

export { API_KEY_SECRET };
