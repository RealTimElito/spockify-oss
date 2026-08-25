/**
 * Ctrl+K in integrated terminal — propose shell command via floating overlay
 * (Spockify IDE workbench inject) or legacy inline-edit widget panel.
 */

import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import {
  captureTerminalContext,
} from '../terminal/contextBuffer';
import { streamTerminalCommand } from './streamTerminalCommand';
import { normalizeProposedShellCommand } from './normalizeShellCommand';
import {
  InlineEditWidgetPanel,
  useInlineEditWidget,
} from './widgetPanel';
import {
  TerminalInlineOverlay,
  isTerminalOverlayAvailable,
} from './terminalOverlay';
import { setPreviewActiveContext } from './session';

export type TransportFactory = () => Promise<ModelTransport | undefined>;

interface TerminalInlineSession {
  terminal: vscode.Terminal;
  proposedCommand: string;
  lastInstruction: string;
}

type TerminalUi = {
  kind: 'overlay' | 'panel' | 'input';
  overlay?: TerminalInlineOverlay;
  setStreaming: () => void;
  setPreviewCommand: (cmd: string) => void;
  setPreview: () => void;
  setPreviewActionHandler: (
    cb: (action: 'accept' | 'reject' | 'followUp') => void,
  ) => void;
  disposeUi: () => void;
};

let activeTerminalSession: TerminalInlineSession | undefined;
let sharedOverlay: TerminalInlineOverlay | undefined;

function defaultModel(): string {
  return (
    vscode.workspace.getConfiguration('spockify').get<string>('defaultModel') ||
    'spockify-auto'
  );
}

function getOverlay(): TerminalInlineOverlay {
  if (!sharedOverlay) {
    sharedOverlay = new TerminalInlineOverlay();
  }
  return sharedOverlay;
}

async function createTerminalUi(
  widget: InlineEditWidgetPanel,
  terminal: vscode.Terminal,
): Promise<TerminalUi> {
  if (await isTerminalOverlayAvailable()) {
    const overlay = getOverlay();
    return {
      kind: 'overlay',
      overlay,
      setStreaming: () => overlay.setStreaming(),
      setPreviewCommand: (cmd) => overlay.setPreviewCommand(cmd),
      setPreview: () => overlay.setPreview(),
      setPreviewActionHandler: (cb) => overlay.setPreviewActionHandler(cb),
      disposeUi: () => {
        void overlay.hide();
      },
    };
  }
  if (useInlineEditWidget()) {
    return {
      kind: 'panel',
      setStreaming: () => widget.setStreaming(),
      setPreviewCommand: (cmd) => widget.setPreviewCommand(cmd),
      setPreview: () => widget.setPreview(),
      setPreviewActionHandler: (cb) => widget.setPreviewActionHandler(cb),
      disposeUi: () => widget.dispose(),
    };
  }
  return {
    kind: 'input',
    setStreaming: () => undefined,
    setPreviewCommand: () => undefined,
    setPreview: () => undefined,
    setPreviewActionHandler: () => undefined,
    disposeUi: () => undefined,
  };
}

async function promptInstruction(
  ui: TerminalUi,
  widget: InlineEditWidgetPanel,
  terminal: vscode.Terminal,
  placeholder: string,
): Promise<string | undefined> {
  if (ui.kind === 'overlay' && ui.overlay) {
    return ui.overlay.openPrompt(placeholder);
  }
  if (ui.kind === 'panel') {
    widget.openForTerminal(terminal.name);
    return widget.promptInstructionForTerminal(placeholder);
  }
  const instruction = await vscode.window.showInputBox({
    title: 'Spockify Terminal (Ctrl+K)',
    prompt: 'Describe the command to generate',
    placeHolder: placeholder,
    ignoreFocusOut: true,
  });
  const trimmed = instruction?.trim();
  return trimmed || undefined;
}

function acceptTerminalSession(session: TerminalInlineSession): void {
  const cmd = normalizeProposedShellCommand(session.proposedCommand);
  if (!cmd) {
    void vscode.window.showWarningMessage('Nothing to run yet.');
    return;
  }
  session.terminal.show(true);
  // Cursor-like: Accept executes in the active PTY (sendText + newline).
  session.terminal.sendText(cmd, true);
  void vscode.window.showInformationMessage('Command sent to terminal.');
  activeTerminalSession = undefined;
  void setPreviewActiveContext(false);
}

/** True while terminal Ctrl+K has a preview (or streaming) session. */
export function hasActiveTerminalInlineEdit(): boolean {
  return activeTerminalSession !== undefined;
}

/**
 * Insert/run a shell command in the terminal Ctrl+K session terminal,
 * or the focused integrated terminal. Used by chat Apply on shell fences.
 */
export function sendCommandToTerminal(
  command: string,
  opts?: { execute?: boolean },
): boolean {
  const cmd = normalizeProposedShellCommand(command);
  if (!cmd) {
    return false;
  }
  const term =
    activeTerminalSession?.terminal ?? vscode.window.activeTerminal;
  if (!term) {
    void vscode.window.showWarningMessage(
      'No active terminal — focus the integrated terminal first.',
    );
    return false;
  }
  term.show(true);
  term.sendText(cmd, opts?.execute !== false);
  return true;
}

export async function startTerminalInlineEdit(
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
  widget: InlineEditWidgetPanel,
): Promise<void> {
  const terminal = vscode.window.activeTerminal;
  if (!terminal) {
    void vscode.window.showWarningMessage(
      'Focus the integrated terminal for Ctrl+K command generation.',
    );
    return;
  }

  const transport = await getTransport();
  if (!transport) {
    return;
  }

  const ui = await createTerminalUi(widget, terminal);
  const snap = captureTerminalContext(terminal);
  const instruction = await promptInstruction(
    ui,
    widget,
    terminal,
    'Command instructions',
  );
  if (!instruction) {
    ui.disposeUi();
    return;
  }

  const session: TerminalInlineSession = {
    terminal,
    proposedCommand: '',
    lastInstruction: instruction,
  };
  activeTerminalSession = session;

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Spockify terminal command (streaming)…',
        cancellable: true,
      },
      async (_progress, token) => {
        const abort = new AbortController();
        const cancelSub = token.onCancellationRequested(() => abort.abort());
        try {
          ui.setStreaming();
          const cmd = await streamTerminalCommand(transport, {
            instruction,
            terminalName: terminal.name,
            selection: snap?.selection,
            recentOutput: snap?.recentOutput,
            model: defaultModel(),
            signal: abort.signal,
            onPartial: (partial) => {
              session.proposedCommand = partial;
              ui.setPreviewCommand(partial);
            },
          });
          if (token.isCancellationRequested) {
            return;
          }
          if (!cmd?.trim()) {
            void vscode.window.showWarningMessage(
              'No command generated — try a clearer instruction.',
            );
            activeTerminalSession = undefined;
            ui.disposeUi();
            return;
          }
          session.proposedCommand = cmd.trim();
          ui.setPreviewCommand(cmd.trim());
          await setPreviewActiveContext(true);
          ui.setPreview();
          ui.setPreviewActionHandler((action) => {
            if (activeTerminalSession !== session) {
              return;
            }
            if (action === 'accept') {
              acceptTerminalSession(session);
              ui.disposeUi();
            } else if (action === 'reject') {
              activeTerminalSession = undefined;
              void setPreviewActiveContext(false);
              ui.disposeUi();
            } else if (action === 'followUp') {
              void runTerminalFollowUp(getTransport, output, widget, session, ui);
            }
          });
          if (ui.kind === 'input') {
            const choice = await vscode.window.showInformationMessage(
              `Run in terminal?\n${cmd.trim().slice(0, 240)}`,
              'Run',
              'Reject',
            );
            if (choice === 'Run') {
              acceptTerminalSession(session);
            } else {
              activeTerminalSession = undefined;
              void setPreviewActiveContext(false);
            }
          }
        } finally {
          cancelSub.dispose();
        }
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.appendLine(`terminal inlineEdit error: ${msg}`);
    void vscode.window.showErrorMessage(`Spockify terminal Ctrl+K failed: ${msg}`);
    activeTerminalSession = undefined;
    void setPreviewActiveContext(false);
    ui.disposeUi();
  }
}

async function runTerminalFollowUp(
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
  widget: InlineEditWidgetPanel,
  session: TerminalInlineSession,
  ui: TerminalUi,
): Promise<void> {
  const transport = await getTransport();
  if (!transport) {
    return;
  }
  const snap = captureTerminalContext(session.terminal);
  const instruction = await promptInstruction(
    ui,
    widget,
    session.terminal,
    'Refine the command…',
  );
  if (!instruction) {
    return;
  }
  session.lastInstruction = instruction;
  try {
    ui.setStreaming();
    const cmd = await streamTerminalCommand(transport, {
      instruction,
      terminalName: session.terminal.name,
      selection: snap?.selection,
      recentOutput: snap?.recentOutput,
      model: defaultModel(),
      onPartial: (partial) => {
        session.proposedCommand = partial;
        ui.setPreviewCommand(partial);
      },
    });
    if (cmd?.trim()) {
      session.proposedCommand = cmd.trim();
      ui.setPreviewCommand(cmd.trim());
      ui.setPreview();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output.appendLine(`terminal inlineEdit follow-up: ${msg}`);
  }
}

export function acceptActiveTerminalInlineEdit(): void {
  if (activeTerminalSession) {
    acceptTerminalSession(activeTerminalSession);
    void sharedOverlay?.hide();
  }
}

export function rejectActiveTerminalInlineEdit(): void {
  activeTerminalSession = undefined;
  void setPreviewActiveContext(false);
  void sharedOverlay?.hide();
}

/** Dispose shared overlay (extension deactivate). */
export function disposeTerminalInlineOverlay(): void {
  sharedOverlay?.dispose();
  sharedOverlay = undefined;
}
