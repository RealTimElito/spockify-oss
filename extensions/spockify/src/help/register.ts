/**
 * Spockify: Help & Tips — markdown preview of media/HELP.md.
 */

import * as vscode from 'vscode';

const HELP_COMMAND = 'spockify.help';

export function registerHelp(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(HELP_COMMAND, async () => {
      const mediaUri = vscode.Uri.joinPath(
        context.extensionUri,
        'media',
        'HELP.md',
      );
      try {
        await vscode.commands.executeCommand('markdown.showPreview', mediaUri);
      } catch {
        // Fallback if markdown extension is unavailable.
        const doc = await vscode.workspace.openTextDocument(mediaUri);
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    }),
  );
}
