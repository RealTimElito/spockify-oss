/**
 * Ctrl+K inline edit: prompt → streaming preview → Accept / Reject / Follow-up.
 * Prefers floating editor overlay (Spockify IDE inject); falls back to Beside panel.
 */

import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import { loadProjectRules } from '../rules';
import {
  commitInlineEditProposed,
  restoreInlineEditOriginal,
  showInlineEditPreview,
} from './preview';
import {
  endSession,
  getActiveInlineEditSession,
  resolveEditRange,
  setActiveInlineEditSession,
  setPreviewActiveContext,
  type InlineEditSession,
} from './session';
import { streamOrFetchEdit } from './streamEdit';
import {
  InlineEditWidgetPanel,
  useInlineEditWidget,
} from './widgetPanel';
import {
  startTerminalInlineEdit,
  acceptActiveTerminalInlineEdit,
  rejectActiveTerminalInlineEdit,
  disposeTerminalInlineOverlay,
} from './terminalInlineEdit';
import {
  EditorInlineOverlay,
  isEditorOverlayAvailable,
} from './editorOverlay';

export type TransportFactory = () => Promise<ModelTransport | undefined>;

const CMD = {
  main: 'spockify.inlineEdit',
  accept: 'spockify.inlineEdit.accept',
  reject: 'spockify.inlineEdit.reject',
  followUp: 'spockify.inlineEdit.followUp',
} as const;

type EditUi = {
  kind: 'overlay' | 'panel' | 'input';
  overlay?: EditorInlineOverlay;
  setStreaming: () => void;
  setPreview: () => void;
  setPreviewActionHandler: (
    cb: (action: 'accept' | 'reject' | 'followUp') => void,
  ) => void;
  disposeUi: () => void;
};

let sharedEditorOverlay: EditorInlineOverlay | undefined;
/** Active UI for the current editor Ctrl+K session (accept/reject keybindings). */
let activeEditUi: EditUi | undefined;

function getEditorOverlay(): EditorInlineOverlay {
  if (!sharedEditorOverlay) {
    sharedEditorOverlay = new EditorInlineOverlay();
  }
  return sharedEditorOverlay;
}

export function disposeEditorInlineOverlay(): void {
  sharedEditorOverlay?.dispose();
  sharedEditorOverlay = undefined;
}

async function createEditUi(widget: InlineEditWidgetPanel): Promise<EditUi> {
  if (await isEditorOverlayAvailable()) {
    const overlay = getEditorOverlay();
    return {
      kind: 'overlay',
      overlay,
      setStreaming: () => overlay.setStreaming(),
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
      setPreview: () => widget.setPreview(),
      setPreviewActionHandler: (cb) => widget.setPreviewActionHandler(cb),
      disposeUi: () => widget.dispose(),
    };
  }
  return {
    kind: 'input',
    setStreaming: () => undefined,
    setPreview: () => undefined,
    setPreviewActionHandler: () => undefined,
    disposeUi: () => undefined,
  };
}

async function promptInstruction(
  title: string,
  placeHolder: string,
  editor: vscode.TextEditor,
  range: vscode.Range,
  ui: EditUi,
  widget: InlineEditWidgetPanel,
): Promise<string | undefined> {
  if (ui.kind === 'overlay' && ui.overlay) {
    const file =
      editor.document.fileName.split(/[/\\]/).pop() || editor.document.fileName;
    const loc = `${file}:${range.start.line + 1}-${range.end.line + 1}`;
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    return ui.overlay.openPrompt(loc, placeHolder, {
      anchorLine: range.start.line + 1,
    });
  }
  if (ui.kind === 'panel') {
    return widget.promptInstruction(editor, range, placeHolder);
  }
  const instruction = await vscode.window.showInputBox({
    title,
    prompt: 'Describe the edit — streaming preview before apply',
    placeHolder,
    ignoreFocusOut: true,
  });
  const trimmed = instruction?.trim();
  return trimmed || undefined;
}

function defaultModel(): string {
  return (
    vscode.workspace.getConfiguration('spockify').get<string>('defaultModel') ||
    'spockify-auto'
  );
}

let previewStatus: vscode.StatusBarItem | undefined;

function showPreviewStatusBar(session: InlineEditSession): void {
  if (!previewStatus) {
    previewStatus = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      1000,
    );
  }
  previewStatus.text = '$(edit) Inline: Accept Ctrl+Enter · Reject Esc';
  previewStatus.tooltip = 'Spockify Ctrl+K preview active';
  previewStatus.command = CMD.accept;
  previewStatus.show();
  void session;
}

function hidePreviewStatusBar(): void {
  previewStatus?.hide();
}

function offerPreviewActions(
  session: InlineEditSession,
  ui: EditUi,
): void {
  showPreviewStatusBar(session);
  ui.setPreview();
  if (ui.kind === 'overlay' || ui.kind === 'panel') {
    ui.setPreviewActionHandler((action) => {
      if (getActiveInlineEditSession() !== session) {
        return;
      }
      if (action === 'accept') {
        acceptSession(session, ui);
      } else if (action === 'reject') {
        rejectSession(session, ui);
      } else if (action === 'followUp') {
        void vscode.commands.executeCommand(CMD.followUp);
      }
    });
    return;
  }
  void vscode.window
    .showInformationMessage(
      'Inline edit preview — Ctrl+Enter Accept · Esc Reject',
      'Accept',
      'Reject',
      'Follow-up',
    )
    .then(async (choice) => {
      if (getActiveInlineEditSession() !== session) {
        return;
      }
      if (choice === 'Accept') {
        acceptSession(session, ui);
      } else if (choice === 'Reject') {
        rejectSession(session, ui);
      } else if (choice === 'Follow-up') {
        await vscode.commands.executeCommand(CMD.followUp);
      }
    });
}

async function runGhostAndPreview(
  session: InlineEditSession,
  transport: ModelTransport,
  selectionForGhost: string,
  instruction: string,
  output: vscode.OutputChannel,
  token?: vscode.CancellationToken,
): Promise<boolean> {
  const { editor, range, originalText } = session;
  const rules = await loadProjectRules();
  const fullInstruction = rules
    ? `${instruction}\n\nProject rules:\n${rules}`
    : instruction;

  const abort = new AbortController();
  const onCancel = () => abort.abort();
  token?.onCancellationRequested(onCancel);

  let previewHandle: Awaited<ReturnType<typeof showInlineEditPreview>> | undefined;
  let previewInit: Promise<void> | undefined;
  let raf: ReturnType<typeof setTimeout> | undefined;
  let pendingPaint: string | undefined;
  let streamed = false;

  const ensurePreview = async (prop: string) => {
    if (!previewInit) {
      previewInit = showInlineEditPreview(
        editor,
        range,
        originalText,
        prop,
        editor.document.languageId,
      ).then((h) => {
        if (abort.signal.aborted) {
          h.dispose();
          return;
        }
        previewHandle = h;
        session.getPreviewRange = () => h.getPreviewRange();
        session.disposePreview = () => h.dispose();
        h.refresh(editor, range, session.proposedText || prop);
      });
    }
    await previewInit;
    const handle = previewHandle;
    if (handle) {
      handle.refresh(editor, range, prop);
    }
  };

  const schedulePaint = (text: string) => {
    pendingPaint = text;
    if (raf !== undefined) {
      return;
    }
    raf = setTimeout(() => {
      raf = undefined;
      const prop = pendingPaint;
      pendingPaint = undefined;
      if (!prop || abort.signal.aborted) {
        return;
      }
      session.proposedText = prop;
      void ensurePreview(prop);
    }, 32);
  };

  const t0 = Date.now();
  const full = editor.document.getText();
  const startOff = editor.document.offsetAt(range.start);
  const endOff = editor.document.offsetAt(range.end);

  try {
    const result = await streamOrFetchEdit(transport, {
      language: editor.document.languageId,
      filename: editor.document.fileName.split(/[/\\]/).pop() || 'untitled',
      selection: selectionForGhost,
      instruction: fullInstruction,
      prefix: full.slice(Math.max(0, startOff - 2000), startOff),
      suffix: full.slice(endOff, endOff + 2000),
      model: defaultModel(),
      signal: abort.signal,
      onPartial: (text) => {
        streamed = true;
        schedulePaint(text);
      },
    });

    if (abort.signal.aborted || token?.isCancellationRequested) {
      if (raf !== undefined) {
        clearTimeout(raf);
      }
      if (previewHandle?.isApplied()) {
        await restoreInlineEditOriginal(
          editor,
          previewHandle.getPreviewRange(),
          originalText,
        );
      }
      previewHandle?.dispose();
      session.disposePreview = () => {};
      output.appendLine(`inlineEdit cancelled ${Date.now() - t0}ms`);
      return false;
    }

    if (result === undefined) {
      if (raf !== undefined) {
        clearTimeout(raf);
      }
      if (previewHandle?.isApplied()) {
        await restoreInlineEditOriginal(
          editor,
          previewHandle.getPreviewRange(),
          originalText,
        );
      }
      previewHandle?.dispose();
      session.disposePreview = () => {};
      void vscode.window.showWarningMessage(
        'Inline edit returned empty (see Output → Spockify)',
      );
      return false;
    }

    const replacement = result.text;
    const requested = defaultModel();
    const { formatModelAttribution } = await import('../util/modelAttribution');
    const attribution = formatModelAttribution(requested, result.model);

    if (raf !== undefined) {
      clearTimeout(raf);
      raf = undefined;
    }
    session.proposedText = replacement;
    await ensurePreview(replacement);

    output.appendLine(
      `inlineEdit ok len=${replacement.length} stream=${streamed} ${Date.now() - t0}ms · ${attribution}`,
    );
    void vscode.window.setStatusBarMessage(`Ctrl+K · ${attribution}`, 4000);
    return true;
  } catch (err) {
    if (raf !== undefined) {
      clearTimeout(raf);
    }
    previewHandle?.dispose();
    session.disposePreview = () => {};
    throw err;
  }
}

function acceptSession(session: InlineEditSession, ui: EditUi): void {
  const { editor, proposedText } = session;
  if (!proposedText.trim()) {
    void vscode.window.showWarningMessage('Nothing to accept yet.');
    return;
  }
  const previewRange =
    session.getPreviewRange?.() ?? session.range;
  void commitInlineEditProposed(editor, previewRange, proposedText).then(() => {
    void vscode.window.showInformationMessage('Inline edit applied.');
  });
  hidePreviewStatusBar();
  ui.disposeUi();
  activeEditUi = undefined;
  endSession(session);
}

function rejectSession(session: InlineEditSession, ui: EditUi): void {
  const previewRange = session.getPreviewRange?.() ?? session.range;
  void restoreInlineEditOriginal(
    session.editor,
    previewRange,
    session.originalText,
  );
  hidePreviewStatusBar();
  endSession(session);
  ui.disposeUi();
  activeEditUi = undefined;
}

async function startInlineEdit(
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
  widget: InlineEditWidgetPanel,
): Promise<void> {
  const existing = getActiveInlineEditSession();
  if (existing) {
    endSession(existing);
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage(
      'Open a file and select code for inline edit (Ctrl+K).',
    );
    return;
  }

  const transport = await getTransport();
  if (!transport) {
    return;
  }

  const ui = await createEditUi(widget);
  activeEditUi = ui;
  const { range, text } = resolveEditRange(editor);
  const instruction = await promptInstruction(
    'Spockify Inline Edit (Ctrl+K)',
    'Fix types, add error handling, refactor…',
    editor,
    range,
    ui,
    widget,
  );
  if (!instruction) {
    ui.disposeUi();
    activeEditUi = undefined;
    return;
  }

  const session: InlineEditSession = {
    editor,
    range,
    originalText: text,
    proposedText: '',
    lastInstruction: instruction,
    disposePreview: () => {},
  };

  ui.setStreaming();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Spockify inline edit (streaming)…',
      cancellable: true,
    },
    async (_progress, token) => {
      try {
        const ok = await runGhostAndPreview(
          session,
          transport,
          text,
          instruction,
          output,
          token,
        );
        if (!ok) {
          ui.disposeUi();
          activeEditUi = undefined;
          return;
        }
        setActiveInlineEditSession(session);
        await setPreviewActiveContext(true);
        offerPreviewActions(session, ui);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        output.appendLine(`inlineEdit error: ${msg}`);
        void vscode.window.showErrorMessage(`Spockify inline edit failed: ${msg}`);
        endSession(session);
        ui.disposeUi();
        activeEditUi = undefined;
      }
    },
  );
}

async function runFollowUpOnce(
  session: InlineEditSession,
  transport: ModelTransport,
  output: vscode.OutputChannel,
  widget: InlineEditWidgetPanel,
): Promise<void> {
  const ui = activeEditUi ?? (await createEditUi(widget));
  activeEditUi = ui;
  const instruction = await promptInstruction(
    'Spockify Inline Edit — Follow-up',
    'Refine the previewed change…',
    session.editor,
    session.range,
    ui,
    widget,
  );
  if (!instruction) {
    if (getActiveInlineEditSession() === session) {
      offerPreviewActions(session, ui);
    } else {
      ui.disposeUi();
      activeEditUi = undefined;
    }
    return;
  }
  session.lastInstruction = instruction;
  ui.setStreaming();
  const ok = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Spockify inline edit (follow-up)…',
      cancellable: true,
    },
    (_progress, token) =>
      runGhostAndPreview(
        session,
        transport,
        session.proposedText,
        instruction,
        output,
        token,
      ),
  );
  if (!ok) {
    if (getActiveInlineEditSession() === session) {
      offerPreviewActions(session, ui);
    } else {
      ui.disposeUi();
      activeEditUi = undefined;
    }
    return;
  }
  if (getActiveInlineEditSession() === session) {
    offerPreviewActions(session, ui);
  }
}

export function registerInlineEdit(
  context: vscode.ExtensionContext,
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
): void {
  const widget = new InlineEditWidgetPanel(context.extensionUri);
  context.subscriptions.push(
    { dispose: () => widget.dispose() },
    { dispose: () => disposeTerminalInlineOverlay() },
    { dispose: () => disposeEditorInlineOverlay() },
    vscode.commands.registerCommand(CMD.main, () =>
      startInlineEdit(getTransport, output, widget),
    ),
    vscode.commands.registerCommand('spockify.inlineEdit.terminal', () =>
      startTerminalInlineEdit(getTransport, output, widget),
    ),
    vscode.commands.registerCommand(CMD.accept, () => {
      const session = getActiveInlineEditSession();
      if (session) {
        const ui =
          activeEditUi ??
          ({
            kind: 'input' as const,
            setStreaming: () => undefined,
            setPreview: () => undefined,
            setPreviewActionHandler: () => undefined,
            disposeUi: () => undefined,
          } satisfies EditUi);
        acceptSession(session, ui);
        return;
      }
      acceptActiveTerminalInlineEdit();
    }),
    vscode.commands.registerCommand(CMD.reject, () => {
      const session = getActiveInlineEditSession();
      if (session) {
        const ui =
          activeEditUi ??
          ({
            kind: 'input' as const,
            setStreaming: () => undefined,
            setPreview: () => undefined,
            setPreviewActionHandler: () => undefined,
            disposeUi: () => undefined,
          } satisfies EditUi);
        rejectSession(session, ui);
        widget.dispose();
        return;
      }
      rejectActiveTerminalInlineEdit();
      widget.dispose();
    }),
    vscode.commands.registerCommand(CMD.followUp, async () => {
      const session = getActiveInlineEditSession();
      if (!session) {
        return;
      }
      const transport = await getTransport();
      if (!transport) {
        return;
      }
      await runFollowUpOnce(session, transport, output, widget);
    }),
    {
      dispose: () => {
        previewStatus?.dispose();
        previewStatus = undefined;
      },
    },
  );
}
