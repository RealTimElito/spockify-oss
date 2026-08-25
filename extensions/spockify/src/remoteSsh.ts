/**
 * Spockify ↔ bundled open-remote-ssh — connect using ~/.ssh/config Host entries.
 */

import * as vscode from 'vscode';

export function registerRemoteSshCommands(
  context: vscode.ExtensionContext,
): void {
  const connect = async (reuseWindow: boolean) => {
    const cmd = reuseWindow
      ? 'openremotessh.openEmptyWindowInCurrentWindow'
      : 'openremotessh.openEmptyWindow';
    try {
      await vscode.commands.executeCommand(cmd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(
        `Remote SSH is unavailable (${msg}). Reinstall Spockify IDE AppImage.`,
      );
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.remoteSsh.connect', () =>
      connect(false),
    ),
    vscode.commands.registerCommand(
      'spockify.remoteSsh.connectCurrentWindow',
      () => connect(true),
    ),
    vscode.commands.registerCommand('spockify.remoteSsh.openConfig', () =>
      vscode.commands.executeCommand('openremotessh.openConfigFile'),
    ),
    vscode.commands.registerCommand('spockify.remoteSsh.focusExplorer', async () => {
      await vscode.commands.executeCommand('workbench.view.remote');
      await vscode.commands.executeCommand('sshHosts.focus');
    }),
  );
}
