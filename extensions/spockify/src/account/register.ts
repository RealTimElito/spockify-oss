/**
 * Account / login polish — WS-CLONE-L
 * Moves account UX helpers out of extension.ts over time.
 */

import * as vscode from 'vscode';
import {
  getAccount,
  getApiKey,
  signIn,
  clearAuth,
  setApiKey,
} from '../auth';

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
      const ok = await signIn(context);
      if (ok) {
        await refreshAuthUi();
        void vscode.window.showInformationMessage('Signed in to Spockify.');
        // Pull/push prefs now that we have a Bearer (quiet).
        try {
          const { syncNow } = await import('../sync');
          await syncNow(context, getTransport, output, { quiet: true });
        } catch {
          /* offline OK */
        }
      }
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
      const account = await getAccount(context);
      const key = await getApiKey(context);
      const pick = await vscode.window.showQuickPick(
        [
          {
            label: key
              ? `$(check) Signed in${account?.label ? `: ${account.label}` : ''}`
              : '$(warning) Not signed in — AI features need spockify.eu',
            id: 'status',
            description: 'spockify.eu',
          },
          { label: '$(gear) Open Settings', id: 'settings' },
          { label: '$(sync) Check API health', id: 'health' },
          { label: '$(cloud-upload) Sync prefs now', id: 'sync' },
          { label: '$(symbol-misc) List models', id: 'models' },
          { label: '$(key) Sign in / replace credentials', id: 'signin' },
          { label: '$(sign-out) Sign out', id: 'signout' },
        ],
        {
          title: account
            ? `Spockify — ${account.label}`
            : 'Spockify account',
        },
      );
      if (!pick || pick.id === 'status') {
        return;
      }
      if (pick.id === 'settings') {
        await vscode.commands.executeCommand('spockify.settings.open');
      } else if (pick.id === 'health') {
        await vscode.commands.executeCommand('spockify.health');
      } else if (pick.id === 'sync') {
        await vscode.commands.executeCommand('spockify.sync.now');
      } else if (pick.id === 'models') {
        await vscode.commands.executeCommand('spockify.listModels');
      } else if (pick.id === 'signin') {
        await vscode.commands.executeCommand('spockify.signIn');
      } else if (pick.id === 'signout') {
        await vscode.commands.executeCommand('spockify.signOut');
      }
    }),
    vscode.commands.registerCommand('spockify.health', async () => {
      const transport = await getTransport();
      if (!transport) {
        void vscode.window.showErrorMessage(
          'Not signed in. Use Spockify: Sign In (API key or email).',
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
