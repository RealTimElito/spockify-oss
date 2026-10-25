/**
 * Terminal Agent plan approval UI (Claude Code–class plan→execute).
 */

import * as vscode from 'vscode';
import {
  parseNumberedPlan,
  type PlanStep,
} from './planParse';

export type { PlanStep } from './planParse';
export { formatPlanForPrompt, parseNumberedPlan } from './planParse';

export type PlanDecision = 'approve' | 'edit' | 'skip' | 'cancel';

/**
 * Show plan for user approval before tool execution.
 * Default path: QuickPick (fast); optional markdown preview.
 */
export async function showPlanApproval(
  goal: string,
  steps: PlanStep[],
  rawPlan?: string,
): Promise<{ decision: PlanDecision; editedSteps?: PlanStep[] }> {
  if (!steps.length) {
    return { decision: 'skip' };
  }

  const md = [
    `# Terminal Agent plan`,
    '',
    `**Goal:** ${goal}`,
    '',
    ...steps.map((s) => `${s.n}. ${s.text}`),
    '',
    rawPlan
      ? `---\n\n<details><summary>Raw plan text</summary>\n\n\`\`\`\n${rawPlan.slice(0, 6000)}\n\`\`\`\n\n</details>`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const doc = await vscode.workspace.openTextDocument({
    content: md,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside,
  });

  const pick = await vscode.window.showQuickPick(
    [
      {
        label: '$(check) Approve plan & execute',
        description: `${steps.length} step(s)`,
        decision: 'approve' as const,
      },
      {
        label: '$(edit) Edit steps…',
        description: 'Revise plan text before execute',
        decision: 'edit' as const,
      },
      {
        label: '$(debug-step-over) Skip plan gate',
        description: 'Run without locking the plan',
        decision: 'skip' as const,
      },
      {
        label: '$(close) Cancel',
        decision: 'cancel' as const,
      },
    ],
    {
      title: 'Spockify Terminal Agent — review plan',
      ignoreFocusOut: true,
      placeHolder:
        'Approve to start tool execution (ask-default policy still applies)',
    },
  );

  if (!pick || pick.decision === 'cancel') {
    return { decision: 'cancel' };
  }

  if (pick.decision === 'edit') {
    const edited = await vscode.window.showInputBox({
      title: 'Edit plan (one step per line, numbered)',
      value: steps.map((s) => `${s.n}. ${s.text}`).join('\n'),
      prompt: 'Numbered steps — empty cancels',
      ignoreFocusOut: true,
    });
    if (!edited?.trim()) {
      return { decision: 'cancel' };
    }
    const next = parseNumberedPlan(edited);
    if (!next.length) {
      void vscode.window.showWarningMessage(
        'Could not parse edited plan — cancelled.',
      );
      return { decision: 'cancel' };
    }
    return { decision: 'approve', editedSteps: next };
  }

  return { decision: pick.decision };
}
