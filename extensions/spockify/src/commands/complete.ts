import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import type { TransportFactory } from './chat';
import { buildCompleteContext } from '../complete/context';

/**
 * Manual Ghost complete at cursor — same path as Tab InlineCompletionProvider.
 */
export function registerCompleteCommand(
  context: vscode.ExtensionContext,
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.complete', async () => {
      const transport = await getTransport();
      if (!transport) {
        return;
      }

      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('Open a file to run Ghost complete.');
        return;
      }

      const doc = editor.document;
      const pos = editor.selection.active;
      const offset = doc.offsetAt(pos);
      const full = doc.getText();
      const openTabs = vscode.window.visibleTextEditors
        .map((e) => e.document.fileName.split(/[/\\]/).pop() || '')
        .filter(Boolean);
      const ctx = buildCompleteContext(full, offset, doc.languageId, {
        openTabs,
      });

      try {
        const res = await transport.ghostSuggest({
          mode: 'complete',
          language: doc.languageId,
          filename: doc.fileName.split(/[/\\]/).pop() || 'untitled',
          prefix: ctx.prefix,
          suffix: ctx.suffix,
          context: ctx.context || undefined,
          code: ctx.code,
          cursor_line: pos.line,
        });
        const insert = res.insert_text || res.suggestion || '';
        output.appendLine(
          `complete ok=${res.ok} kind=${res.kind} mode=${res.mode} ` +
            `latency=${res.latency_ms}ms pfx=${ctx.prefix.length} ctx=${ctx.context.length}`,
        );
        output.appendLine(insert.slice(0, 400) || '(empty)');

        if (insert) {
          const apply = await vscode.window.showInformationMessage(
            'Ghost complete ready — insert at cursor?',
            'Insert',
          );
          if (apply === 'Insert') {
            await editor.edit((eb) => {
              eb.insert(pos, insert);
            });
          }
        } else {
          void vscode.window.showInformationMessage(
            'Ghost complete returned empty (see Output → Spockify)',
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`complete error: ${msg}`);
        void vscode.window.showErrorMessage(`Spockify complete failed: ${msg}`);
      }
    }),
  );
}
