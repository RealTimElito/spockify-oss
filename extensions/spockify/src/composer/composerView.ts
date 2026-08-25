/**
 * Composer sidebar tree — pending patches with per-file Accept / Diff / Discard.
 */

import * as vscode from 'vscode';
import type { FilePatch } from './types';
import type { ShadowWorkspaceHandle } from './shadowWorkspace';
import {
  readWorkspaceText,
  resolveWorkspaceUri,
  writePatchToWorkspace,
} from './applyBridge';
import { openDiffReview } from '../apply/review/diffReview';
import { getApplyService } from '../apply';
import type { ApplyPatchRequest } from '../apply/types';

const PENDING_CONTEXT = 'spockify.composer.hasPending';

async function setPendingContext(hasPending: boolean): Promise<void> {
  await vscode.commands.executeCommand(
    'setContext',
    PENDING_CONTEXT,
    hasPending,
  );
}

class ComposerItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    public readonly kind?:
      | 'action'
      | 'pendingHeader'
      | 'pendingFile'
      | 'touched'
      | 'hint',
    public readonly filePath?: string,
  ) {
    super(label, collapsible);
  }
}

export class ComposerTreeProvider implements vscode.TreeDataProvider<ComposerItem> {
  private readonly _onDidChange =
    new vscode.EventEmitter<ComposerItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private touchList: string[] = [];
  private pending: FilePatch[] = [];
  private shadow: ShadowWorkspaceHandle | undefined;
  private output: vscode.OutputChannel | undefined;
  private readonly _onPendingChange = new vscode.EventEmitter<void>();
  /** Fires when pending patches are staged/cleared (Composer webview sync). */
  readonly onPendingChange = this._onPendingChange.event;

  setOutput(output: vscode.OutputChannel): void {
    this.output = output;
  }

  private firePending(): void {
    void setPendingContext(this.pending.length > 0);
    this._onDidChange.fire();
    this._onPendingChange.fire();
  }

  refresh(files?: string[]): void {
    if (files) this.touchList = [...files];
    this._onDidChange.fire();
  }

  /** Stage patches for per-file Accept in the Composer tree. */
  setPending(
    patches: FilePatch[],
    opts?: { shadow?: ShadowWorkspaceHandle; touchList?: string[] },
  ): void {
    this.pending = [...patches];
    this.shadow = opts?.shadow;
    if (opts?.touchList) this.touchList = [...opts.touchList];
    this.firePending();
  }

  clearPending(): void {
    this.pending = [];
    this.firePending();
  }

  getPending(): FilePatch[] {
    return [...this.pending];
  }

  getTreeItem(element: ComposerItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ComposerItem): ComposerItem[] {
    if (element?.kind === 'pendingHeader') {
      return this.pending.map((p) => {
        const lines = p.content.split('\n').length;
        const basename = p.path.includes('/')
          ? p.path.slice(p.path.lastIndexOf('/') + 1)
          : p.path;
        const item = new ComposerItem(
          basename,
          vscode.TreeItemCollapsibleState.None,
          'pendingFile',
          p.path,
        );
        item.description = `${p.path} · ${lines} lines`;
        item.iconPath = new vscode.ThemeIcon('diff');
        item.contextValue = 'spockify.composer.pendingFile';
        item.tooltip = `${p.path}\nAccept / Diff / Discard (inline icons)`;
        item.command = {
          command: 'spockify.composer.diffPending',
          title: 'Diff',
          arguments: [p.path],
        };
        return item;
      });
    }

    if (element) return [];

    const start = new ComposerItem(
      'Start Composer (Ctrl+I)',
      vscode.TreeItemCollapsibleState.None,
      'action',
    );
    start.command = { command: 'spockify.composer', title: 'Composer' };
    start.iconPath = new vscode.ThemeIcon('edit');
    start.tooltip =
      'Multi-file agent · shadow under .spockify/shadow · Accept all / Diff Review';

    const review = new ComposerItem(
      'Diff Review panel',
      vscode.TreeItemCollapsibleState.None,
      'action',
    );
    review.command = {
      command: 'spockify.composer.diffReviewPending',
      title: 'Diff Review',
    };
    review.iconPath = new vscode.ThemeIcon('diff');
    review.tooltip = 'Open multi-file Diff Review for pending patches';

    const verify = new ComposerItem(
      'Run verify (tests)',
      vscode.TreeItemCollapsibleState.None,
      'action',
    );
    verify.command = { command: 'spockify.composer.verify', title: 'Verify' };
    verify.iconPath = new vscode.ThemeIcon('beaker');
    verify.tooltip = 'Run allowlisted test command via terminal protocol';

    const shadows = new ComposerItem(
      'List shadows…',
      vscode.TreeItemCollapsibleState.None,
      'action',
    );
    shadows.command = {
      command: 'spockify.composer.listShadows',
      title: 'Shadows',
    };
    shadows.iconPath = new vscode.ThemeIcon('folder-library');

    const hint = new ComposerItem(
      'Shadow ON · review: Diff panel (default)',
      vscode.TreeItemCollapsibleState.None,
      'hint',
    );
    hint.iconPath = new vscode.ThemeIcon('info');
    hint.tooltip =
      'spockify.composer.reviewMode=panel|tree|prompt · verifyAfterTurn optional';

    const items: ComposerItem[] = [start, review, verify, shadows, hint];

    if (this.pending.length) {
      const acceptAll = new ComposerItem(
        `Accept all (${this.pending.length})`,
        vscode.TreeItemCollapsibleState.None,
        'action',
      );
      acceptAll.command = {
        command: 'spockify.composer.acceptAllPending',
        title: 'Accept all',
      };
      acceptAll.iconPath = new vscode.ThemeIcon('check-all');
      acceptAll.tooltip = 'Write all pending files to the workspace';
      items.unshift(acceptAll);

      const discardAll = new ComposerItem(
        `Discard all (${this.pending.length})`,
        vscode.TreeItemCollapsibleState.None,
        'action',
      );
      discardAll.command = {
        command: 'spockify.composer.discardAllPending',
        title: 'Discard all',
      };
      discardAll.iconPath = new vscode.ThemeIcon('clear-all');
      items.splice(1, 0, discardAll);

      const header = new ComposerItem(
        `Pending review (${this.pending.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'pendingHeader',
      );
      header.iconPath = new vscode.ThemeIcon('git-pull-request');
      header.tooltip = 'Click a file to Diff · inline Accept / Diff / Discard';
      items.push(header);
    }

    if (this.touchList.length) {
      const header = new ComposerItem(
        `Touched (${this.touchList.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
        'hint',
      );
      items.push(header);
      for (const p of this.touchList) {
        const f = new ComposerItem(
          p,
          vscode.TreeItemCollapsibleState.None,
          'touched',
          p,
        );
        f.iconPath = new vscode.ThemeIcon('file');
        f.command = {
          command: 'spockify.composer.openTouched',
          title: 'Open',
          arguments: [p],
        };
        f.tooltip = 'Open in editor';
        items.push(f);
      }
    }
    return items;
  }

  private findPatch(filePath: string): FilePatch | undefined {
    return this.pending.find((p) => p.path === filePath);
  }

  async acceptFile(filePath: string): Promise<boolean> {
    const patch = this.findPatch(filePath);
    if (!patch) return false;
    const out =
      this.output ?? vscode.window.createOutputChannel('Spockify Composer');
    const uri = await resolveWorkspaceUri(patch.path);
    if (!uri) {
      void vscode.window.showWarningMessage(
        `Composer: could not resolve ${patch.path}`,
      );
      return false;
    }
    let content = patch.content;
    if (this.shadow) {
      content = (await this.shadow.readProposed(patch.path)) ?? content;
    }
    // Prefer ApplyService so Keep All / Accept share the undo checkpoint stack
    // (Cursor acceptAllDiffs behaviour).
    try {
      const result = await getApplyService().apply({
        files: [{ path: patch.path, nextContent: content }],
        source: 'composer',
      });
      if (!result.applied.includes(patch.path)) {
        const ok = await writePatchToWorkspace(
          { path: patch.path, content },
          uri,
          out,
        );
        if (!ok) return false;
      }
    } catch {
      const ok = await writePatchToWorkspace(
        { path: patch.path, content },
        uri,
        out,
      );
      if (!ok) return false;
    }
    this.pending = this.pending.filter((p) => p.path !== filePath);
    this.firePending();
    void vscode.window.setStatusBarMessage(`Accepted ${filePath}`, 3000);
    return true;
  }

  async discardFile(filePath: string): Promise<void> {
    this.pending = this.pending.filter((p) => p.path !== filePath);
    this.firePending();
  }

  async diffFile(filePath: string): Promise<void> {
    const patch = this.findPatch(filePath);
    if (!patch) return;
    const uri = await resolveWorkspaceUri(patch.path);
    const oldText = uri ? await readWorkspaceText(uri) : '';
    let content = patch.content;
    if (this.shadow) {
      content = (await this.shadow.readProposed(patch.path)) ?? content;
    }
    const left = await vscode.workspace.openTextDocument({
      content: oldText,
      language: 'plaintext',
    });
    const right = await vscode.workspace.openTextDocument({
      content,
      language: 'plaintext',
    });
    await vscode.commands.executeCommand(
      'vscode.diff',
      left.uri,
      right.uri,
      `Composer: ${patch.path}`,
    );
  }

  async acceptAll(): Promise<number> {
    const paths = this.pending.map((p) => p.path);
    let n = 0;
    for (const p of paths) {
      if (await this.acceptFile(p)) n++;
    }
    return n;
  }

  async discardAll(): Promise<number> {
    const n = this.pending.length;
    this.pending = [];
    this.firePending();
    return n;
  }

  async openTouched(filePath: string): Promise<void> {
    const uri = await resolveWorkspaceUri(filePath);
    if (!uri) {
      void vscode.window.showWarningMessage(`Composer: could not open ${filePath}`);
      return;
    }
    await vscode.window.showTextDocument(uri, { preview: true });
  }

  async openDiffReviewPending(): Promise<number> {
    if (!this.pending.length) {
      await vscode.commands.executeCommand('spockify.diffReview');
      return 0;
    }
    const out =
      this.output ?? vscode.window.createOutputChannel('Spockify Composer');
    const files = [];
    for (const p of this.pending) {
      const content =
        (this.shadow ? await this.shadow.readProposed(p.path) : undefined) ??
        p.content;
      files.push({ path: p.path, nextContent: content });
    }
    const request: ApplyPatchRequest = { files, source: 'composer' };
    try {
      getApplyService();
      const applied = await openDiffReview(request, out);
      if (applied.length) {
        const set = new Set(applied);
        this.pending = this.pending.filter((p) => !set.has(p.path));
        this.firePending();
      }
      return applied.length;
    } catch (err) {
      out.appendLine(
        `composer tree: diff panel failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }
}

let sharedTree: ComposerTreeProvider | undefined;

export function getComposerTree(): ComposerTreeProvider | undefined {
  return sharedTree;
}

export function registerComposerView(
  context: vscode.ExtensionContext,
  output?: vscode.OutputChannel,
): ComposerTreeProvider {
  sharedTree = new ComposerTreeProvider();
  if (output) sharedTree.setOutput(output);
  void setPendingContext(false);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('spockify.composerView', sharedTree),
    vscode.commands.registerCommand(
      'spockify.composer.acceptPending',
      async (pathOrItem?: string | ComposerItem) => {
        const path =
          typeof pathOrItem === 'string'
            ? pathOrItem
            : pathOrItem?.filePath;
        if (path) await sharedTree?.acceptFile(path);
      },
    ),
    vscode.commands.registerCommand(
      'spockify.composer.discardPending',
      async (pathOrItem?: string | ComposerItem) => {
        const path =
          typeof pathOrItem === 'string'
            ? pathOrItem
            : pathOrItem?.filePath;
        if (path) await sharedTree?.discardFile(path);
      },
    ),
    vscode.commands.registerCommand(
      'spockify.composer.diffPending',
      async (pathOrItem?: string | ComposerItem) => {
        const path =
          typeof pathOrItem === 'string'
            ? pathOrItem
            : pathOrItem?.filePath;
        if (path) await sharedTree?.diffFile(path);
      },
    ),
    vscode.commands.registerCommand(
      'spockify.composer.acceptAllPending',
      async () => {
        const n = await sharedTree?.acceptAll();
        if (n) {
          void vscode.window.showInformationMessage(
            `Accepted ${n} pending file(s)`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      'spockify.composer.discardAllPending',
      async () => {
        const n = await sharedTree?.discardAll();
        if (n) {
          void vscode.window.showInformationMessage(
            `Discarded ${n} pending file(s)`,
          );
        }
      },
    ),
    vscode.commands.registerCommand(
      'spockify.composer.openTouched',
      async (pathOrItem?: string | ComposerItem) => {
        const path =
          typeof pathOrItem === 'string'
            ? pathOrItem
            : pathOrItem?.filePath;
        if (path) await sharedTree?.openTouched(path);
      },
    ),
    vscode.commands.registerCommand(
      'spockify.composer.diffReviewPending',
      async () => {
        await sharedTree?.openDiffReviewPending();
      },
    ),
  );
  return sharedTree;
}
