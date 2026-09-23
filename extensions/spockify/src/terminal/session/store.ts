/**
 * Terminal agent session transcript + rewind — Phase 5 WS-P5-R
 * Rewind restores transcript view and offers cwd restore into a terminal.
 * Multi-session: list / open / continue from durable snapshots.
 */

import * as vscode from 'vscode';
import { mirrorSnapshot } from './active';

export interface TerminalSessionSnapshot {
  id: string;
  goal: string;
  cwd?: string;
  /** Env keys captured (values never stored). */
  envKeys?: string[];
  sections: string[];
  createdAt: number;
  /** Last commands run (for audit / re-run hints). */
  commands?: string[];
  /** Approved plan steps (Claude Code–class plan UI). */
  planSteps?: string[];
  status?: 'done' | 'cancelled' | 'error';
}

const KEY = 'spockify.terminalAgent.sessions';
const MAX = 40;

export function saveTerminalSession(
  context: vscode.ExtensionContext,
  snap: TerminalSessionSnapshot,
): void {
  const all = context.workspaceState.get<TerminalSessionSnapshot[]>(KEY) ?? [];
  const without = all.filter((s) => s.id !== snap.id);
  without.unshift(snap);
  void context.workspaceState.update(KEY, without.slice(0, MAX));
}

export function listTerminalSessions(
  context: vscode.ExtensionContext,
): TerminalSessionSnapshot[] {
  return context.workspaceState.get<TerminalSessionSnapshot[]>(KEY) ?? [];
}

export function getTerminalSession(
  context: vscode.ExtensionContext,
  id: string,
): TerminalSessionSnapshot | undefined {
  return listTerminalSessions(context).find((s) => s.id === id);
}

export async function openSessionTranscriptDoc(
  s: TerminalSessionSnapshot,
): Promise<void> {
  const content = [
    `# Terminal Agent session`,
    '',
    `**Goal:** ${s.goal}`,
    `**cwd:** ${s.cwd || '(none)'}`,
    `**When:** ${new Date(s.createdAt).toISOString()}`,
    `**Status:** ${s.status || 'done'}`,
    s.planSteps?.length
      ? `**Plan:**\n${s.planSteps.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
      : '',
    s.commands?.length
      ? `**Commands:**\n${s.commands.map((c) => `- \`${c}\``).join('\n')}`
      : '',
    '',
    '---',
    '',
    ...s.sections,
  ]
    .filter(Boolean)
    .join('\n');

  const doc = await vscode.workspace.openTextDocument({
    content,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

export async function pickTerminalSession(
  context: vscode.ExtensionContext,
  title = 'Terminal Agent sessions',
): Promise<TerminalSessionSnapshot | undefined> {
  const sessions = listTerminalSessions(context);
  if (!sessions.length) {
    void vscode.window.showInformationMessage('No terminal agent sessions yet.');
    return undefined;
  }
  const pick = await vscode.window.showQuickPick(
    sessions.map((s) => ({
      label: s.goal.slice(0, 80),
      description: new Date(s.createdAt).toLocaleString(),
      detail: `cwd: ${s.cwd || '(none)'} · ${s.sections.length} sections · ${(s.commands || []).length} cmds · ${s.status || 'done'}`,
      session: s,
    })),
    { title },
  );
  return pick?.session;
}

export async function rewindTerminalSession(
  context: vscode.ExtensionContext,
  sessionId?: string,
): Promise<void> {
  const s = sessionId
    ? getTerminalSession(context, sessionId) ??
      (await pickTerminalSession(context, 'Rewind — restore Terminal Agent session'))
    : await pickTerminalSession(context, 'Rewind — restore Terminal Agent session');
  if (!s) return;

  await openSessionTranscriptDoc(s);
  mirrorSnapshot(s);

  if (s.cwd) {
    const action = await vscode.window.showInformationMessage(
      `Restore terminal cwd to ${s.cwd}?`,
      'Open terminal at cwd',
      'Copy cwd',
      'Dismiss',
    );
    if (action === 'Copy cwd') {
      await vscode.env.clipboard.writeText(s.cwd);
      void vscode.window.showInformationMessage('cwd copied to clipboard.');
    } else if (action === 'Open terminal at cwd') {
      const term = vscode.window.createTerminal({
        name: 'Spockify rewind',
        cwd: s.cwd,
      });
      term.show();
      term.sendText(`# Restored from terminal agent session ${s.id}`);
      term.sendText(`cd ${JSON.stringify(s.cwd)}`);
    }
  }
}
