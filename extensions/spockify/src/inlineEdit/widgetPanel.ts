/**
 * Ctrl+K companion panel — instruction + Accept/Reject near the editor (split view).
 * OSS substitute for Cursor's floating inline widget (no workbench content-widget API).
 */

import * as vscode from 'vscode';

export type WidgetUserAction =
  | { kind: 'submit'; instruction: string }
  | { kind: 'accept' }
  | { kind: 'reject' }
  | { kind: 'followUp' }
  | { kind: 'cancel' };

type WidgetListener = (action: WidgetUserAction) => void;

export type InlineEditWidgetPlacement = 'beside' | 'float';

export function inlineEditWidgetPlacement(): InlineEditWidgetPlacement {
  const raw = vscode.workspace
    .getConfiguration('spockify')
    .get<string>('inlineEdit.widgetPlacement', 'float');
  return raw === 'beside' ? 'beside' : 'float';
}

export class InlineEditWidgetPanel {
  private panel?: vscode.WebviewPanel;
  private listener?: WidgetListener;
  private previewHandler?: (action: 'accept' | 'reject' | 'followUp') => void;
  private promptResolve?: (instruction: string | undefined) => void;
  private rangeDecoration?: vscode.TextEditorDecorationType;

  constructor(private readonly extensionUri: vscode.Uri) {}

  onAction(cb: WidgetListener): void {
    this.listener = cb;
  }

  setPreviewActionHandler(
    cb: (action: 'accept' | 'reject' | 'followUp') => void,
  ): void {
    this.previewHandler = cb;
  }

  promptInstruction(
    editor: vscode.TextEditor,
    range: vscode.Range,
    placeholder: string,
  ): Promise<string | undefined> {
    this.openForRange(editor, range);
    this.post({
      type: 'init',
      location: undefined,
      placeholder,
    });
    return new Promise((resolve) => {
      this.promptResolve = resolve;
    });
  }

  openForTerminal(name: string): void {
    const placement = inlineEditWidgetPlacement();
    const panel = this.ensurePanel('Spockify Terminal (Ctrl+K)');
    this.post({
      type: 'init',
      location: name || 'Terminal',
      placeholder: 'Describe the command to run…',
      mode: 'terminal',
      placement,
    });
    if (placement !== 'float') {
      this.post({ type: 'focus' });
    }
    panel.reveal(vscode.ViewColumn.Beside, placement === 'float');
  }

  promptInstructionForTerminal(placeholder: string): Promise<string | undefined> {
    this.post({
      type: 'init',
      placeholder,
      mode: 'terminal',
      // Keep the same placement as openForTerminal(): the widget toggles
      // float-mode based on `msg.placement`, and `undefined` would remove it.
      placement: inlineEditWidgetPlacement(),
    });
    return new Promise((resolve) => {
      this.promptResolve = resolve;
    });
  }

  setPreviewCommand(command: string): void {
    this.post({ type: 'previewCommand', command });
  }

  private ensurePanel(title: string): vscode.WebviewPanel {
    if (this.panel) {
      this.panel.title = title;
      this.panel.reveal(
        vscode.ViewColumn.Beside,
        inlineEditWidgetPlacement() === 'float',
      );
      return this.panel;
    }
    const placement = inlineEditWidgetPlacement();
    const preserveFocus = placement === 'float';
    this.panel = vscode.window.createWebviewPanel(
      'spockify.inlineEditWidget',
      title,
      {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus,
      },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'media', 'inlineEdit'),
        ],
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      'media',
      'spockify-activity.svg',
    );
    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((raw) => {
      void this.onWebMessage(raw);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.listener?.({ kind: 'cancel' });
    });
    return this.panel;
  }

  openForRange(editor: vscode.TextEditor, range: vscode.Range): void {
    const file =
      editor.document.fileName.split(/[/\\]/).pop() || editor.document.fileName;
    const loc = `${file}:${range.start.line + 1}-${range.end.line + 1}`;
    const panel = this.ensurePanel('Spockify Inline Edit');
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    this.highlightRange(editor, range);
    this.post({
      type: 'init',
      location: loc,
      placeholder: 'Fix types, add error handling, refactor…',
      placement: inlineEditWidgetPlacement(),
    });
    this.post({ type: 'focus' });
    panel.reveal(
      vscode.ViewColumn.Beside,
      inlineEditWidgetPlacement() === 'float',
    );
  }

  setStreaming(): void {
    this.post({ type: 'streaming' });
  }

  setPreview(): void {
    this.post({ type: 'preview' });
  }

  resetPrompt(): void {
    this.post({
      type: 'reset',
      placeholder: 'Refine the previewed change…',
    });
  }

  dispose(): void {
    if (this.promptResolve) {
      this.promptResolve(undefined);
      this.promptResolve = undefined;
    }
    this.clearRangeHighlight();
    this.panel?.dispose();
    this.panel = undefined;
  }

  private clearRangeHighlight(): void {
    if (this.rangeDecoration) {
      this.rangeDecoration.dispose();
      this.rangeDecoration = undefined;
    }
  }

  private highlightRange(editor: vscode.TextEditor, range: vscode.Range): void {
    this.clearRangeHighlight();
    if (inlineEditWidgetPlacement() !== 'float') {
      return;
    }
    this.rangeDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.selectionHighlightBackground'),
      borderRadius: '2px',
      isWholeLine: true,
    });
    editor.setDecorations(this.rangeDecoration, [range]);
  }

  private post(msg: Record<string, unknown>): void {
    void this.panel?.webview.postMessage(msg);
  }

  private onWebMessage(raw: unknown): void {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as { type?: string; instruction?: string };
    switch (msg.type) {
      case 'ready':
        break;
      case 'submit': {
        const instruction = (msg.instruction || '').trim();
        if (this.promptResolve) {
          const done = this.promptResolve;
          this.promptResolve = undefined;
          done(instruction || undefined);
          this.setStreaming();
          break;
        }
        if (instruction) {
          this.listener?.({ kind: 'submit', instruction });
        }
        break;
      }
      case 'accept':
        if (this.previewHandler) {
          this.previewHandler('accept');
        } else {
          this.listener?.({ kind: 'accept' });
        }
        break;
      case 'reject':
        if (this.previewHandler) {
          this.previewHandler('reject');
        } else {
          this.listener?.({ kind: 'reject' });
        }
        break;
      case 'followUp':
        if (this.previewHandler) {
          this.previewHandler('followUp');
        } else {
          this.listener?.({ kind: 'followUp' });
        }
        break;
      case 'cancel':
        if (this.promptResolve) {
          const done = this.promptResolve;
          this.promptResolve = undefined;
          done(undefined);
        }
        this.listener?.({ kind: 'cancel' });
        break;
      default:
        break;
    }
  }

  private html(webview: vscode.Webview): string {
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'inlineEdit', 'widget.css'),
    );
    const js = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'inlineEdit', 'widget.js'),
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${css}" />
  <title>Inline Edit</title>
</head>
<body id="root">
  <div class="wrap">
    <div class="head">
      <span class="loc" id="loc">Inline edit</span>
      <span class="phase" id="phase">Instruction</span>
    </div>
    <div class="body">
      <textarea id="input" rows="4" placeholder="Describe the edit…"></textarea>
      <div class="preview-hint" id="hint" hidden>
        Diff in editor · <kbd>Ctrl+Enter</kbd> Accept · <kbd>Esc</kbd> Reject
      </div>
    </div>
    <div class="actions">
      <button type="button" class="secondary" id="cancel">Close</button>
      <button type="button" class="primary" id="run">Generate</button>
      <button type="button" class="secondary" id="reject" hidden>Reject</button>
      <button type="button" class="secondary" id="follow" hidden>Follow-up</button>
      <button type="button" class="primary" id="accept" hidden>Accept</button>
    </div>
  </div>
  <script src="${js}"></script>
</body>
</html>`;
  }
}

export function useInlineEditWidget(): boolean {
  return (
    vscode.workspace
      .getConfiguration('spockify')
      .get<boolean>('inlineEdit.widgetPanel') ?? true
  );
}
