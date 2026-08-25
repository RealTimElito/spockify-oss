/**
 * Rolling integrated-terminal capture for chat / Ctrl+L context (Cursor-like).
 * Uses proposed terminalDataWriteEvent + terminalSelection when available.
 */

import * as vscode from 'vscode';
import {
  formatTerminalContextSection,
  stripAnsi,
  tailTerminalLines,
  type TerminalContextSnapshot,
} from './contextFormat';

export {
  formatTerminalContextSection,
  stripAnsi,
  tailTerminalLines,
  type TerminalContextSnapshot,
} from './contextFormat';

const DEFAULT_MAX_CHARS = 48_000;

const buffers = new Map<vscode.Terminal, string>();

function appendBuffer(terminal: vscode.Terminal, chunk: string): void {
  const clean = stripAnsi(chunk);
  if (!clean) return;
  const prev = buffers.get(terminal) ?? '';
  const next = (prev + clean).slice(-DEFAULT_MAX_CHARS);
  buffers.set(terminal, next);
}

function terminalSelection(terminal: vscode.Terminal): string | undefined {
  const sel = terminal.selection?.trim();
  return sel || undefined;
}

function maxLines(): number {
  return Math.min(
    500,
    Math.max(
      20,
      vscode.workspace
        .getConfiguration('spockify.chat')
        .get<number>('terminalContextLines', 120),
    ),
  );
}

export function attachTerminalDefault(): boolean {
  return (
    vscode.workspace
      .getConfiguration('spockify.chat')
      .get<boolean>('attachTerminal', true) ?? true
  );
}

/** Snapshot for the active terminal (selection preferred over tail buffer). */
export function captureTerminalContext(
  terminal = vscode.window.activeTerminal,
): TerminalContextSnapshot | undefined {
  if (!terminal) {
    return undefined;
  }
  const name = terminal.name || 'Terminal';
  const selection = terminalSelection(terminal);
  const raw = buffers.get(terminal) ?? '';
  const recentOutput = tailTerminalLines(raw, maxLines());
  const isEmpty = !selection && !recentOutput.trim();
  return { name, selection, recentOutput, isEmpty };
}

export function registerTerminalContextBuffer(
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal((t) => {
      if (!buffers.has(t)) {
        buffers.set(t, '');
      }
    }),
    vscode.window.onDidCloseTerminal((t) => {
      buffers.delete(t);
    }),
  );

  for (const t of vscode.window.terminals) {
    buffers.set(t, buffers.get(t) ?? '');
  }

  const writeEvent = vscode.window.onDidWriteTerminalData;
  if (typeof writeEvent === 'function') {
    context.subscriptions.push(
      writeEvent((e) => {
        appendBuffer(e.terminal, e.data);
      }),
    );
  }
}
