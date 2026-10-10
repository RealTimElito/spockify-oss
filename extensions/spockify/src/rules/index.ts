/**
 * WS-CLONE-H — Rules / Memories registration.
 */

import * as vscode from 'vscode';
import { getEffectiveRules, writeUserRules } from './load';
import { addMemory, getMemories } from './memories';

export {
  loadProjectRules,
  getEffectiveRules,
  writeUserRules,
} from './load';
export {
  buildAtContext,
  captureEditorContext,
  editorAttachFlagsFromSnapshot,
  parseMentions,
  resolveWebSection,
  resolveEditorAttachFlags,
  selectionChipFromSnapshot,
  type EditorContextSnapshot,
  type SelectionContextChip,
} from './context';
export {
  getMemories,
  setMemories,
  addMemory,
  formatMemoriesForPrompt,
} from './memories';

export function registerRulesCommands(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.rules.show', async () => {
      const effective = await getEffectiveRules(context);
      const doc = await vscode.workspace.openTextDocument({
        content:
          effective.text ||
          '(no rules found — add .spockify/rules, .cursorrules, or user rules)',
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
      output.appendLine(
        `rules layers: ${effective.layers.map((l) => `${l.layer}:${l.source}`).join(', ') || 'none'}`,
      );
    }),
    vscode.commands.registerCommand('spockify.rules.editUser', async () => {
      const text = await vscode.window.showInputBox({
        title: 'Spockify user rules',
        prompt: 'Replace user-level rules (stored in extension globalStorage)',
        placeHolder: 'Always use TypeScript strict…',
        ignoreFocusOut: true,
      });
      if (text === undefined) {
        return;
      }
      await writeUserRules(context, text);
      void vscode.window.showInformationMessage('User rules saved.');
    }),
    vscode.commands.registerCommand('spockify.memories.add', async () => {
      const text = await vscode.window.showInputBox({
        title: 'Add memory',
        prompt: 'Short fact for future chats',
        ignoreFocusOut: true,
      });
      if (!text?.trim()) {
        return;
      }
      await addMemory(context, text);
      void vscode.window.showInformationMessage('Memory saved.');
    }),
    vscode.commands.registerCommand('spockify.memories.list', async () => {
      const entries = await getMemories(context);
      const doc = await vscode.workspace.openTextDocument({
        content: entries.length
          ? entries.map((e) => `- (${e.id}) ${e.text}`).join('\n')
          : '(no memories)',
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }),
  );
}
