/**
 * Quick Fix / lightbulb: "Fix with agent" on every diagnostic (error + warning).
 * Opens Spockify Chat in Agent mode with a focused fix prompt + nearby context.
 * Edits stage for Accept/Reject via the normal chat apply / inline review path.
 * Simple Flake8 E501 cases get a deterministic local wrap (no model round-trip).
 */

import * as vscode from 'vscode';
import type { ChatPanelProvider } from '../chat/ChatPanelProvider';
import {
  applyLocalDiagnosticFix,
  isLineTooLongDiagnostic,
} from './localDiagnosticFixes';
import {
  buildFixPromptFromParts,
  severityFromVsCodeNumber,
} from './fixWithAgentPrompt';

const CMD = 'spockify.fixWithAgent';
const TITLE = 'Fix with agent';

export type ChatProviderFactory = () => ChatPanelProvider | undefined;

export function registerFixWithAgent(
  context: vscode.ExtensionContext,
  getChat: ChatProviderFactory,
  output: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      CMD,
      async (
        uri?: vscode.Uri,
        diagnostic?: vscode.Diagnostic,
        range?: vscode.Range,
      ) => {
        const chat = getChat();
        if (!chat) {
          void vscode.window.showWarningMessage(
            'Spockify Chat is not ready yet.',
          );
          return;
        }

        const editor = vscode.window.activeTextEditor;
        const doc =
          (uri && (await openDoc(uri))) ||
          editor?.document;
        if (!doc) {
          void vscode.window.showWarningMessage(
            'No file open for Fix with agent.',
          );
          return;
        }

        const diag =
          diagnostic ??
          pickDiagnosticAt(
            doc,
            range ?? editor?.selection ?? new vscode.Range(0, 0, 0, 0),
          );
        if (!diag) {
          void vscode.window.showWarningMessage(
            'No diagnostic found under the cursor.',
          );
          return;
        }

        const localDiag = toLocalDiag(diag);
        output.appendLine(
          `fix-with-agent: ${doc.fileName} ${severityLabel(diag.severity)} ${clip(diag.message, 120)}`,
        );

        // Deterministic E501 wrap — stage immediately; skip silent agent no-ops.
        if (isLineTooLongDiagnostic(localDiag)) {
          const next = applyLocalDiagnosticFix(doc.getText(), localDiag);
          if (next && next !== doc.getText()) {
            const rel = vscode.workspace.asRelativePath(doc.uri, false);
            const staged = await stageLocalFixPatch(
              {
                path: rel.replace(/\\/g, '/') || doc.fileName,
                content: next,
              },
              output,
            );
            if (staged) {
              void vscode.window.showInformationMessage(
                'Fix with agent: staged local line wrap — Accept / Reject in the editor.',
              );
              await chat.focusInputWithContext();
              return;
            }
          }
        }

        const prompt = buildFixPrompt(doc, diag);
        await chat.sendAgentPrompt(prompt, {
          mode: 'agent',
          withContext: true,
          contextTags: ['file'],
        });
      },
    ),
    vscode.languages.registerCodeActionsProvider(
      { pattern: '**' },
      new FixWithAgentCodeActionProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      },
    ),
  );
}

async function stageLocalFixPatch(
  patch: { path: string; content: string },
  output: vscode.OutputChannel,
): Promise<boolean> {
  try {
    const { shouldAutoApplyFilePatches } = await import(
      '../runtime/agentPermissionMode'
    );
    if (shouldAutoApplyFilePatches()) {
      const { applyChatPatchesFromBridge } = await import(
        '../chat/applyBridge'
      );
      await applyChatPatchesFromBridge([patch], output);
      output.appendLine(
        `fix-with-agent: local E501 auto-applied ${patch.path}`,
      );
      return true;
    }
    const { stageInlineFileReview } = await import(
      '../apply/review/inlineReview'
    );
    await stageInlineFileReview([patch], {
      source: 'chat',
      openFirst: true,
    });
    output.appendLine(
      `fix-with-agent: local E501 staged ${patch.path} for inline review`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.appendLine(`fix-with-agent: local stage failed: ${msg}`);
    void vscode.window.showWarningMessage(
      `Fix with agent: couldn't stage local fix: ${msg}`,
    );
    return false;
  }
}

class FixWithAgentCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    _token: vscode.CancellationToken,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diag of context.diagnostics) {
      const action = new vscode.CodeAction(
        TITLE,
        vscode.CodeActionKind.QuickFix,
      );
      action.diagnostics = [diag];
      action.isPreferred = false;
      action.command = {
        command: CMD,
        title: TITLE,
        arguments: [document.uri, diag, diag.range],
      };
      actions.push(action);
    }
    return actions;
  }
}

function pickDiagnosticAt(
  doc: vscode.TextDocument,
  range: vscode.Range,
): vscode.Diagnostic | undefined {
  const all = vscode.languages.getDiagnostics(doc.uri);
  if (!all.length) return undefined;
  const overlapping = all.filter((d) => d.range.intersection(range));
  const pool = overlapping.length ? overlapping : all;
  const severityOrder = [
    vscode.DiagnosticSeverity.Error,
    vscode.DiagnosticSeverity.Warning,
    vscode.DiagnosticSeverity.Information,
    vscode.DiagnosticSeverity.Hint,
  ];
  pool.sort((a, b) => {
    const sa = severityOrder.indexOf(a.severity);
    const sb = severityOrder.indexOf(b.severity);
    if (sa !== sb) return sa - sb;
    return a.range.start.line - b.range.start.line;
  });
  return pool[0];
}

export function buildFixPrompt(
  doc: vscode.TextDocument,
  diag: vscode.Diagnostic,
): string {
  return buildFixPromptFromParts(
    {
      relativePath: vscode.workspace.asRelativePath(doc.uri, false),
      languageId: doc.languageId,
      text: doc.getText(),
      lineCount: doc.lineCount,
    },
    toLocalDiag(diag),
  );
}

function toLocalDiag(diag: vscode.Diagnostic) {
  const code =
    diag.code == null
      ? undefined
      : typeof diag.code === 'object' &&
          diag.code !== null &&
          'value' in diag.code
        ? (diag.code as { value: string | number }).value
        : (diag.code as string | number);

  return {
    message: diag.message,
    severity: severityFromVsCodeNumber(diag.severity),
    startLine: diag.range.start.line,
    endLine: diag.range.end.line,
    source: diag.source,
    code,
  };
}

function severityLabel(sev: vscode.DiagnosticSeverity): string {
  return severityFromVsCodeNumber(sev);
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

async function openDoc(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined;
  }
}
