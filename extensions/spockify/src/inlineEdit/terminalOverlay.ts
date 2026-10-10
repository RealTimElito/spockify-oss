/**
 * Cursor-like floating Ctrl+K overlay hosted inside the terminal pane.
 * Requires Spockify IDE workbench inject (spockify.terminalOverlay.* commands).
 */

import * as vscode from 'vscode';

export type TerminalOverlayAction =
  | { kind: 'submit'; instruction: string }
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'followUp' }
  | { kind: 'cancel' };

type PreviewHandler = (action: 'accept' | 'reject' | 'followUp') => void;

const CMD = {
  show: 'spockify.terminalOverlay.show',
  hide: 'spockify.terminalOverlay.hide',
  post: 'spockify.terminalOverlay.post',
  fromUi: 'spockify.terminalOverlay.fromUi',
} as const;

let overlayAvailableCache: boolean | undefined;

export async function isTerminalOverlayAvailable(): Promise<boolean> {
  if (overlayAvailableCache !== undefined) {
    return overlayAvailableCache;
  }
  try {
    const cmds = await vscode.commands.getCommands(true);
    overlayAvailableCache = cmds.includes(CMD.show);
  } catch {
    overlayAvailableCache = false;
  }
  return overlayAvailableCache;
}

/** Reset cache (tests). */
export function resetTerminalOverlayAvailabilityCache(): void {
  overlayAvailableCache = undefined;
}

export class TerminalInlineOverlay {
  private promptResolve?: (instruction: string | undefined) => void;
  private previewHandler?: PreviewHandler;
  private open = false;
  private readonly fromUiSub: vscode.Disposable;

  constructor() {
    this.fromUiSub = vscode.commands.registerCommand(CMD.fromUi, (raw: unknown) => {
      this.onFromUi(raw);
    });
  }

  dispose(): void {
    void this.hide();
    this.fromUiSub.dispose();
    if (this.promptResolve) {
      this.promptResolve(undefined);
      this.promptResolve = undefined;
    }
  }

  setPreviewActionHandler(cb: PreviewHandler): void {
    this.previewHandler = cb;
  }

  async openPrompt(placeholder = 'Command instructions'): Promise<string | undefined> {
    // Host builds a workbench DOM card (no iframe) — placeholder only.
    const ok = await vscode.commands.executeCommand<boolean>(CMD.show, {
      placeholder,
    });
    if (!ok) {
      return undefined;
    }
    this.open = true;
    await vscode.commands.executeCommand(CMD.post, {
      type: 'init',
      placeholder,
      mode: 'terminal',
    });
    await vscode.commands.executeCommand(CMD.post, { type: 'focus' });
    // Retry focus — terminal may still hold key focus briefly after show.
    setTimeout(() => {
      void vscode.commands.executeCommand(CMD.post, { type: 'focus' });
    }, 60);
    setTimeout(() => {
      void vscode.commands.executeCommand(CMD.post, { type: 'focus' });
    }, 180);
    return new Promise((resolve) => {
      this.promptResolve = resolve;
    });
  }

  setStreaming(): void {
    void vscode.commands.executeCommand(CMD.post, { type: 'streaming' });
  }

  setPreviewCommand(command: string): void {
    void vscode.commands.executeCommand(CMD.post, {
      type: 'previewCommand',
      command,
    });
  }

  setPreview(): void {
    void vscode.commands.executeCommand(CMD.post, { type: 'preview' });
  }

  async hide(): Promise<void> {
    if (!this.open) {
      // Still restore terminal focus if workbench already tore down the card.
      try {
        vscode.window.activeTerminal?.show(true);
      } catch {
        /* ignore */
      }
      return;
    }
    this.open = false;
    try {
      await vscode.commands.executeCommand(CMD.hide);
    } catch {
      /* workbench may lack patch */
    }
    // Return cursor to the integrated terminal after Esc/X/cancel/reject.
    try {
      vscode.window.activeTerminal?.show(true);
    } catch {
      /* ignore */
    }
  }

  private onFromUi(raw: unknown): void {
    if (!raw || typeof raw !== 'object') {
      return;
    }
    const msg = raw as { type?: string; instruction?: string };
    switch (msg.type) {
      case 'ready':
        // Host DOM card mounted — re-assert focus into the prompt.
        void vscode.commands.executeCommand(CMD.post, { type: 'focus' });
        break;
      case 'submit': {
        const instruction = (msg.instruction || '').trim();
        if (this.promptResolve) {
          const done = this.promptResolve;
          this.promptResolve = undefined;
          done(instruction || undefined);
          this.setStreaming();
        }
        break;
      }
      case 'accept':
        this.previewHandler?.('accept');
        break;
      case 'reject':
        if (this.promptResolve) {
          const done = this.promptResolve;
          this.promptResolve = undefined;
          done(undefined);
        }
        this.previewHandler?.('reject');
        // Workbench may already have torn down on reject; still clear state.
        void this.hide();
        break;
      case 'followUp':
        this.previewHandler?.('followUp');
        break;
      case 'cancel':
        if (this.promptResolve) {
          const done = this.promptResolve;
          this.promptResolve = undefined;
          done(undefined);
        }
        void this.hide();
        break;
      default:
        break;
    }
  }
}
