import * as vscode from 'vscode';
import type { TransportFactory } from './chat';
import {
  getApplyService,
  registerApplyCommands,
} from '../apply/applyService';

/**
 * Spockify Apply command — uses ApplyService for patches; Ghost edit when selection-only.
 */
export function registerApplyCommand(
  context: vscode.ExtensionContext,
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
): void {
  registerApplyCommands(context, getTransport, output);
  const applyService = getApplyService(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.apply', async () => {
      const patchText = await vscode.window.showInputBox({
        title: 'Spockify Apply',
        prompt:
          'Paste fenced file blocks or unified diff (leave empty for Ghost edit on selection)',
        ignoreFocusOut: true,
      });

      if (patchText?.trim()) {
        const req = applyService.parsePatchText(patchText.trim(), 'inline');
        if (req.files.length) {
          const preview = await applyService.preview(req);
          output.appendLine(
            `apply: ${preview.files.length} file(s) ready`,
          );
          const result = await applyService.apply(req);
          if (result.applied.length) {
            void vscode.window.showInformationMessage(
              `Spockify applied ${result.applied.length} file(s).`,
            );
          }
          return;
        }
      }

      const transport = await getTransport();
      if (!transport) {
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('Open a file to apply an edit.');
        return;
      }

      const selection = editor.document.getText(editor.selection);
      if (!selection.trim()) {
        void vscode.window.showWarningMessage(
          'Select code to rewrite, or paste a patch when prompted.',
        );
        return;
      }

      const instruction = await vscode.window.showInputBox({
        title: 'Spockify Apply (Ghost edit)',
        prompt: 'Instruction for Ghost edit mode (Cmd/Ctrl+K style)',
        value: 'Improve this code.',
        ignoreFocusOut: true,
      });
      if (!instruction?.trim()) {
        return;
      }

      try {
        const res = await transport.ghostSuggest({
          mode: 'edit',
          language: editor.document.languageId,
          filename:
            editor.document.fileName.split(/[/\\]/).pop() || 'untitled',
          selection,
          instruction: instruction.trim(),
          code: editor.document.getText().slice(0, 6000),
        });
        const replacement = res.suggestion || '';
        output.appendLine(
          `apply/edit ok=${res.ok} kind=${res.kind} len=${replacement.length}`,
        );

        if (!replacement) {
          void vscode.window.showWarningMessage(
            'Ghost edit returned empty (see Output → Spockify)',
          );
          return;
        }

        const confirm = await vscode.window.showInformationMessage(
          'Replace selection with Ghost edit?',
          'Replace',
        );
        if (confirm === 'Replace') {
          await editor.edit((eb) => {
            eb.replace(editor.selection, replacement);
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`apply error: ${msg}`);
        void vscode.window.showErrorMessage(`Spockify apply failed: ${msg}`);
      }
    }),
  );
}
