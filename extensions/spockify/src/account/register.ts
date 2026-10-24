/**
 * Account / login polish — WS-CLONE-L
 * Moves account UX helpers out of extension.ts over time.
 */

import * as vscode from 'vscode';
import { signIn, clearAuth, setApiKey } from '../auth';

export function registerAccountCommands(
  context: vscode.ExtensionContext,
  opts: {
    output: vscode.OutputChannel;
    refreshAuthUi: () => Promise<void>;
    getTransport: () => Promise<
      import('@spockify/ide-client').ModelTransport | undefined
    >;
  },
): void {
  const { output, refreshAuthUi, getTransport } = opts;

  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.signIn', async () => {
      await signIn(context);
    }),
    vscode.commands.registerCommand('spockify.signOut', async () => {
      await clearAuth(context);
      await refreshAuthUi();
      void vscode.window.showInformationMessage('Signed out of Spockify.');
    }),
    vscode.commands.registerCommand('spockify.setApiKey', async () => {
      const ok = await setApiKey(context);
      if (ok) {
        await refreshAuthUi();
        void vscode.window.showInformationMessage('Spockify API key saved.');
      }
    }),
    vscode.commands.registerCommand('spockify.clearApiKey', async () => {
      await clearAuth(context);
      await refreshAuthUi();
      void vscode.window.showInformationMessage('Spockify credentials cleared.');
    }),
    vscode.commands.registerCommand('spockify.accountMenu', async () => {
      // Status-bar chip when signed in: same Account form as sign-in (no QuickPick).
      await vscode.commands.executeCommand('spockify.settings.open', 'account');
    }),
    vscode.commands.registerCommand('spockify.health', async () => {
      const transport = await getTransport();
      if (!transport) {
        void vscode.window.showErrorMessage(
          'Not signed in. Open Settings → Account (Spockify.eu, self-hosted, or sk- key).',
        );
        return;
      }
      const s = await transport.health();
      output.appendLine(`health: ${JSON.stringify(s)}`);
      if (s.ok) {
        void vscode.window.showInformationMessage(
          `Spockify API OK (${s.baseUrl})`,
        );
      } else {
        void vscode.window.showErrorMessage(
          `Spockify unreachable (${s.baseUrl}): ${s.detail || s.status || 'offline'}. Check network / API key, then Sign in again.`,
        );
      }
    }),
    vscode.commands.registerCommand('spockify.listModels', async () => {
      const transport = await getTransport();
      if (!transport) {
        return;
      }
      const models = await transport.listModels({ ossOnly: true });
      const ids = models.map((m) => m.id);
      output.appendLine(`models (${ids.length}): ${ids.join(', ')}`);
      void vscode.window.showInformationMessage(
        `Spockify: ${ids.length} OSS models (Output → Spockify)`,
      );
    }),
  );
}
