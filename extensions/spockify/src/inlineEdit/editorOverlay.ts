/**
 * Cursor-like floating Ctrl+K overlay hosted over the active text editor.
 * Requires Spockify IDE workbench inject (spockify.editorOverlay.* commands).
 */

import * as vscode from 'vscode';

export type EditorOverlayAction =
  | { kind: 'submit'; instruction: string }
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'followUp' }
  | { kind: 'cancel' };

type PreviewHandler = (action: 'accept' | 'reject' | 'followUp') => void;

const CMD = {
  show: 'spockify.editorOverlay.show',
  hide: 'spockify.editorOverlay.hide',
  post: 'spockify.editorOverlay.post',
  fromUi: 'spockify.editorOverlay.fromUi',
} as const;

let overlayAvailableCache: boolean | undefined;

export async function isEditorOverlayAvailable(): Promise<boolean> {
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
export function resetEditorOverlayAvailabilityCache(): void {
  overlayAvailableCache = undefined;
}

export class EditorInlineOverlay {
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

  async openPrompt(
    location: string,
    placeholder = 'Describe the edit…',
    opts?: { anchorLine?: number },
  ): Promise<string | undefined> {
    const ok = await vscode.commands.executeCommand<boolean>(CMD.show, {
      placeholder,
      location,
      anchorLine: opts?.anchorLine,
    });
    if (!ok) {
      return undefined;
    }
    this.open = true;
    await vscode.commands.executeCommand(CMD.post, {
      type: 'init',
      placeholder,
      location,
      mode: 'editor',
      anchorLine: opts?.anchorLine,
    });
    await vscode.commands.executeCommand(CMD.post, { type: 'focus' });
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

  setPreview(): void {
    void vscode.commands.executeCommand(CMD.post, { type: 'preview' });
  }

  async hide(): Promise<void> {
    if (!this.open) {
      return;
    }
    this.open = false;
    try {
      await vscode.commands.executeCommand(CMD.hide);
    } catch {
      /* workbench may lack patch */
    }
  }

  private onFromUi(raw: unknown): void {
    if (!raw || typeof raw !== 'object') {
      return;
    }
    const msg = raw as { type?: string; instruction?: string };
    switch (msg.type) {
      case 'ready':
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
