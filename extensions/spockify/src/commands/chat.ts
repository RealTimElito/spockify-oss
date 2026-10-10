import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import type { ChatPanelProvider } from '../chat';

export type TransportFactory = () => Promise<ModelTransport | undefined>;

/**
 * Ctrl+L — focus Spockify Chat and put caret in the composer (Cursor-like).
 * Multi-tab new / cycle commands wire the webview session strip.
 */
export function registerChatCommand(
  context: vscode.ExtensionContext,
  _getTransport: TransportFactory,
  output: vscode.OutputChannel,
  getChat?: () => ChatPanelProvider | undefined,
): void {
  const focusChatView = async (): Promise<void> => {
    await vscode.commands.executeCommand('spockify.chatView.focus');
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.chat', async () => {
      output.appendLine('chat: focusing Spockify Chat input');
      const chat = getChat?.();
      if (chat) {
        await chat.focusInputWithContext();
        return;
      }
      await focusChatView();
    }),
    vscode.commands.registerCommand('spockify.chat.new', async () => {
      await focusChatView();
      const chat = getChat?.();
      chat?.requestNewChatTab();
    }),
    vscode.commands.registerCommand('spockify.chat.nextTab', async () => {
      await focusChatView();
      const chat = getChat?.();
      chat?.switchChatTab(1);
    }),
    vscode.commands.registerCommand('spockify.chat.previousTab', async () => {
      await focusChatView();
      const chat = getChat?.();
      chat?.switchChatTab(-1);
    }),
  );
}
