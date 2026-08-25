/**
 * Checkpoints — snapshot pre-apply file contents; restore later.
 * WS-CLONE-I — durable under `.spockify/checkpoints/` when a workspace is open.
 */

import * as vscode from 'vscode';
import { getApplyService } from '../apply/serviceImpl';
import type { ApplyResult, ApplyService } from '../apply/types';
import { refreshApplyUndoContext } from '../apply/ux';
import {
  loadDurableCheckpoints,
  persistCheckpoint,
  removeDurableCheckpoint,
} from './persistence';

export interface CheckpointFile {
  path: string;
  uri: string;
  content: string;
}

export interface Checkpoint {
  id: string;
  createdAt: number;
  label: string;
  source: string;
  files: CheckpointFile[];
}

export class CheckpointStore {
  private readonly checkpoints: Checkpoint[] = [];
  private readonly max = 40;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly output?: vscode.OutputChannel) {}

  list(): Checkpoint[] {
    return [...this.checkpoints].reverse();
  }

  get(id: string): Checkpoint | undefined {
    return this.checkpoints.find((c) => c.id === id);
  }

  latest(): Checkpoint | undefined {
    return this.checkpoints.length
      ? this.checkpoints[this.checkpoints.length - 1]
      : undefined;
  }

  count(): number {
    return this.checkpoints.length;
  }

  onDidChange(cb: () => void): vscode.Disposable {
    this.listeners.add(cb);
    return new vscode.Disposable(() => this.listeners.delete(cb));
  }

  private notify(): void {
    for (const cb of this.listeners) {
      cb();
    }
  }

  add(cp: Checkpoint): void {
    this.checkpoints.push(cp);
    while (this.checkpoints.length > this.max) {
      const old = this.checkpoints.shift();
      if (old) {
        void removeDurableCheckpoint(old.id);
      }
    }
    this.output?.appendLine(
      `checkpoint: ${cp.id} files=${cp.files.length} source=${cp.source}`,
    );
    void persistCheckpoint(cp).catch(() => undefined);
    this.notify();
  }

  /** Merge durable store from workspace folder (survives IDE restart). */
  async hydrateFromDisk(): Promise<number> {
    const loaded = await loadDurableCheckpoints();
    if (!loaded.length) {
      return 0;
    }
    const byId = new Map(this.checkpoints.map((c) => [c.id, c]));
    for (const cp of loaded) {
      if (!byId.has(cp.id)) {
        byId.set(cp.id, cp);
      }
    }
    const merged = [...byId.values()].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    while (merged.length > this.max) {
      const old = merged.shift();
      if (old) {
        void removeDurableCheckpoint(old.id);
      }
    }
    this.checkpoints.length = 0;
    this.checkpoints.push(...merged);
    this.output?.appendLine(
      `checkpoint: hydrated ${this.checkpoints.length} from .spockify/checkpoints`,
    );
    this.notify();
    return this.checkpoints.length;
  }

  async createFromUris(
    uris: vscode.Uri[],
    opts: { label?: string; source?: string; id?: string } = {},
  ): Promise<Checkpoint> {
    const files: CheckpointFile[] = [];
    for (const uri of uris) {
      let content = '';
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        content = Buffer.from(data).toString('utf8');
      } catch {
        content = '';
      }
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const rel = folder
        ? uri.path.slice(folder.uri.path.length).replace(/^\//, '')
        : uri.path;
      files.push({ path: rel, uri: uri.toString(), content });
    }
    const cp: Checkpoint = {
      id: opts.id || `cp_manual_${Date.now().toString(36)}`,
      createdAt: Date.now(),
      label: opts.label || `Checkpoint (${files.length} file(s))`,
      source: opts.source || 'manual',
      files,
    };
    this.add(cp);
    return cp;
  }

  async restore(id: string): Promise<number> {
    const cp = this.get(id);
    if (!cp) {
      throw new Error(`Unknown checkpoint ${id}`);
    }
    let n = 0;
    for (const f of cp.files) {
      const uri = vscode.Uri.parse(f.uri);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(f.content, 'utf8'));
      n++;
    }
    this.output?.appendLine(`checkpoint: restored ${id} files=${n}`);
    return n;
  }
}

let singleton: CheckpointStore | undefined;

export function getCheckpointStore(
  output?: vscode.OutputChannel,
): CheckpointStore {
  if (!singleton) {
    singleton = new CheckpointStore(output);
  }
  return singleton;
}

/** Subscribe to ApplyService.onApplied and record pre-apply snapshots. */
export function bindApplyService(
  applyService: ApplyService,
  store: CheckpointStore,
): vscode.Disposable {
  return applyService.onApplied((e: ApplyResult) => {
    if (!e.applied.length || !e.checkpointId) {
      return;
    }
    const snap = applyService.getLastUndoSnapshot?.();
    if (!snap || snap.checkpointId !== e.checkpointId) {
      return;
    }
    store.add({
      id: snap.checkpointId,
      createdAt: Date.now(),
      label: `Apply (${snap.source}): ${snap.files.map((f) => f.path).join(', ')}`.slice(
        0,
        120,
      ),
      source: snap.source,
      files: snap.files,
    });
  });
}

async function pickAndRestore(
  store: CheckpointStore,
  applyService: ApplyService,
): Promise<void> {
  const items = store.list();
  if (!items.length) {
    void vscode.window.showInformationMessage(
      'No checkpoints yet. They appear after Apply / Accept / apply_patch.',
    );
    return;
  }
  const pick = await vscode.window.showQuickPick(
    items.map((c) => ({
      label: `$(history) ${c.label}`,
      description: new Date(c.createdAt).toLocaleString(),
      detail: `${c.id} · ${c.source} · ${c.files.length} file(s): ${c.files.map((f) => f.path).join(', ')}`.slice(
        0,
        200,
      ),
      cp: c,
    })),
    {
      title: 'Spockify checkpoints — select to restore pre-apply files',
      matchOnDescription: true,
      matchOnDetail: true,
      placeHolder: 'Newest first · stored under .spockify/checkpoints',
    },
  );
  if (!pick) {
    return;
  }
  await confirmAndRestore(store, pick.cp.id, applyService);
}

async function confirmAndRestore(
  store: CheckpointStore,
  id: string,
  applyService: ApplyService,
): Promise<void> {
  const cp = store.get(id);
  if (!cp) {
    void vscode.window.showWarningMessage(`Unknown checkpoint ${id}`);
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Restore checkpoint ${cp.id}? Overwrites ${cp.files.length} file(s) with pre-apply contents.`,
    { modal: true },
    'Restore',
  );
  if (confirm !== 'Restore') {
    return;
  }
  const n = await store.restore(id);
  applyService.clearUndo();
  await refreshApplyUndoContext(applyService);
  void vscode.window.showInformationMessage(
    `Restored ${n} file(s) from ${id.slice(0, 12)}.`,
  );
}

export function registerCheckpointCommands(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): CheckpointStore {
  const store = getCheckpointStore(output);
  const applyService = getApplyService(context);

  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    92,
  );
  status.command = 'spockify.checkpoints.list';
  status.tooltip =
    'Spockify checkpoints — click to list / restore · Ctrl+Alt+Z undoes last apply';
  context.subscriptions.push(status);

  const refreshStatus = (): void => {
    const n = store.count();
    const canUndo = applyService.canUndo();
    if (n === 0 && !canUndo) {
      status.hide();
      return;
    }
    if (canUndo) {
      status.text = `$(discard) undo${n ? ` · ${n}` : ''}`;
      status.command = 'spockify.applyUndo';
      status.tooltip = `Undo last apply${n ? ` · ${n} checkpoint(s) in list` : ''} (Ctrl+Alt+Z)`;
    } else {
      status.text = `$(history) ${n}`;
      status.command = 'spockify.checkpoints.list';
      status.tooltip = `${n} checkpoint(s) — click to restore (.spockify/checkpoints)`;
    }
    status.show();
  };

  context.subscriptions.push(
    store.onDidChange(refreshStatus),
    applyService.onApplied(() => refreshStatus()),
  );
  if (applyService.onUndone) {
    context.subscriptions.push(applyService.onUndone(() => refreshStatus()));
  }
  void store.hydrateFromDisk().then(() => refreshStatus());

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void store.hydrateFromDisk().then(() => refreshStatus());
    }),
    vscode.commands.registerCommand('spockify.checkpoints.list', async () => {
      await pickAndRestore(store, applyService);
      refreshStatus();
    }),
    vscode.commands.registerCommand(
      'spockify.checkpoints.restore',
      async (id?: string) => {
        if (id && typeof id === 'string') {
          await confirmAndRestore(store, id, applyService);
        } else {
          await pickAndRestore(store, applyService);
        }
        refreshStatus();
      },
    ),
    vscode.commands.registerCommand('spockify.checkpoints.create', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('Open a file to checkpoint.');
        return;
      }
      const cp = await store.createFromUris([editor.document.uri], {
        label: `Manual: ${editor.document.fileName.split(/[/\\]/).pop()}`,
        source: 'manual',
      });
      void vscode.window
        .showInformationMessage(`Checkpoint ${cp.id} created.`, 'List')
        .then((pick) => {
          if (pick === 'List') {
            void vscode.commands.executeCommand('spockify.checkpoints.list');
          }
        });
      refreshStatus();
    }),
  );

  return store;
}
