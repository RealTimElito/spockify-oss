/**
 * WS-C Chat panel entry — register from extension `activate()`.
 */

import * as vscode from 'vscode';

import { ChatPanelProvider, CHAT_VIEW_TYPE } from './ChatPanelProvider';
import { getComposerPanel } from '../composer/ComposerPanelProvider';
import { MockChatTransport } from './mockTransport';
import {
  adaptModelTransport,
  adaptModelTransportNotReady,
  createFallbackChatTransport,
  isChatModelTransport,
} from './transportAdapter';
import type { ChatModelTransport, ChatPanelDeps } from './types';

export {
  ChatPanelProvider,
  CHAT_VIEW_TYPE,
  MockChatTransport,
  adaptModelTransport,
  adaptModelTransportNotReady,
  createFallbackChatTransport,
  isChatModelTransport,
};
export type {
  ChatModelTransport,
  ChatPanelDeps,
  ChatMessage,
  ModelInfo,
} from './types';

export interface RegisteredChat {
  provider: ChatPanelProvider;
  disposables: vscode.Disposable[];
}

export function registerChatPanel(
  context: vscode.ExtensionContext,
  deps?: Partial<ChatPanelDeps> & {
    onSignIn?: () => Promise<void>;
    output?: vscode.OutputChannel;
    signedIn?: boolean;
    accountLabel?: string;
  },
): RegisteredChat {
  const defaultModel =
    deps?.defaultModel ??
    vscode.workspace.getConfiguration('spockify').get<string>('defaultModel') ??
    'spockify-auto';

  const provider = new ChatPanelProvider(context, context.extensionUri, {
    transport: deps?.transport ?? new MockChatTransport(),
    defaultModel,
    openExternal: deps?.openExternal,
    onSignIn: deps?.onSignIn,
    output: deps?.output,
    signedIn: deps?.signedIn,
    accountLabel: deps?.accountLabel,
    getModelTransport: deps?.getModelTransport,
  });

  const disposables: vscode.Disposable[] = [
    vscode.window.registerWebviewViewProvider(
      ChatPanelProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
    vscode.commands.registerCommand('spockify.chat.focus', async () => {
      await provider.focusInput();
    }),
    vscode.commands.registerCommand('spockify.chat.openFull', async () => {
      await vscode.env.openExternal(vscode.Uri.parse('https://spockify.eu'));
    }),
    vscode.commands.registerCommand('spockify.chat.stop', () => {
      provider.stopGeneration();
      getComposerPanel()?.stopGeneration();
    }),
    vscode.commands.registerCommand('spockify.chat.retry', async () => {
      await vscode.commands.executeCommand(`${CHAT_VIEW_TYPE}.focus`);
      provider.retryLastMessage();
    }),
    vscode.commands.registerCommand('spockify.chat.history', async () => {
      await provider.pickHistorySession();
    }),
  ];

  for (const d of disposables) {
    context.subscriptions.push(d);
  }

  return { provider, disposables };
}
