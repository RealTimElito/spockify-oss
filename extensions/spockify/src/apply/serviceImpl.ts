import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { buildFileDiffPreview } from './diff';
import { applyHunksToContent, listHunkIds, parseHunksFromUnifiedDiff } from './hunks';
import { parsePatchText } from './parse';
import { tryApplyRangedEdit } from './rangedEdit';
import { notifyApplySuccess, refreshApplyUndoContext } from './ux';
import type {
  ApplyPatchRequest,
  ApplyResult,
  ApplyService,
  ApplyServiceOptions,
  DiffPreview,
  HunkId,
} from './types';

interface UndoEntry {
  uri: vscode.Uri;
  path: string;
  previousContent: string;
}

/** Pre-apply file bytes for checkpoint restore (WS-CLONE-I). */
export interface ApplyUndoSnapshot {
  checkpointId: string;
  source: ApplyPatchRequest['source'];
  files: Array<{ path: string; uri: string; content: string }>;
}

export function createApplyService(
  _context?: vscode.ExtensionContext,
  options: ApplyServiceOptions = {},
): ApplyService {
  const listeners = new Set<(e: ApplyResult) => void>();
  const undoListeners = new Set<() => void>();
  let undoStack: UndoEntry[] = [];
  let lastSnapshot: ApplyUndoSnapshot | undefined;

  const resolveUri =
    options.resolveUri ??
    (async (relPath: string): Promise<vscode.Uri | undefined> => {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        return undefined;
      }
      const clean = relPath.replace(/^\.\//, '').replace(/^\/+/, '');
      const found = await vscode.workspace.findFiles(
        `**/${clean.split('/').pop()}`,
        '**/node_modules/**',
        20,
      );
      const exact = found.find(
        (u) => u.path.endsWith('/' + clean) || u.path.endsWith(clean),
      );
      if (exact) {
        return exact;
      }
      return vscode.Uri.joinPath(folders[0].uri, clean);
    });

  const readFile =
    options.readFile ??
    (async (uri: vscode.Uri): Promise<string> => {
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(data).toString('utf8');
      } catch {
        return '';
      }
    });

  const writeFile =
    options.writeFile ??
    (async (uri: vscode.Uri, content: string): Promise<void> => {
      // Cursor-like: create missing parent dirs so write_file / apply can mint new paths.
      const parent = vscode.Uri.joinPath(uri, '..');
      try {
        await vscode.workspace.fs.createDirectory(parent);
      } catch {
        /* exists or not creatable — write will surface real errors */
      }
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    });

  async function readCurrentContent(path: string): Promise<string> {
    const uri = await resolveUri(path);
    if (!uri) {
      return '';
    }
    return readFile(uri);
  }

  function resolveNextContent(
    path: string,
    current: string,
    file: ApplyPatchRequest['files'][0],
    hunkFilter: HunkId[] | undefined,
  ): string {
    if (file.nextContent !== undefined && hunkFilter === undefined) {
      return file.nextContent;
    }
    if (file.unifiedDiff?.trim()) {
      const hunks = parseHunksFromUnifiedDiff(path, file.unifiedDiff);
      return applyHunksToContent(current, hunks, hunkFilter);
    }
    if (file.nextContent !== undefined) {
      if (hunkFilter === undefined) {
        return file.nextContent;
      }
      const preview = buildFileDiffPreview(path, current, file.nextContent);
      return applyHunksToContent(current, preview.hunks, hunkFilter);
    }
    return current;
  }

  function syncUndoContext(): void {
    void vscode.commands.executeCommand(
      'setContext',
      'spockify.apply.canUndo',
      undoStack.length > 0,
    );
  }

  const service: ApplyService = {
    parsePatchText,

    async preview(req: ApplyPatchRequest): Promise<DiffPreview> {
      const files = [];
      for (const f of req.files) {
        const current = await readCurrentContent(f.path);
        files.push(
          buildFileDiffPreview(
            f.path,
            current,
            f.nextContent,
            f.unifiedDiff,
          ),
        );
      }
      return { files };
    },

    async apply(
      req: ApplyPatchRequest,
      opts?: { hunks?: HunkId[] },
    ): Promise<ApplyResult> {
      const applied: string[] = [];
      const rejected: string[] = [];
      const batchUndo: UndoEntry[] = [];
      const hunkFilter = opts?.hunks;

      for (const f of req.files) {
        const uri = await resolveUri(f.path);
        if (!uri) {
          rejected.push(f.path);
          continue;
        }
        const current = await readFile(uri);
        const next = resolveNextContent(f.path, current, f, hunkFilter);

        if (next === current) {
          rejected.push(f.path);
          continue;
        }

        if (hunkFilter !== undefined) {
          const preview = buildFileDiffPreview(
            f.path,
            current,
            f.nextContent,
            f.unifiedDiff,
          );
          const allIds = listHunkIds(preview.hunks);
          const accepted = new Set(hunkFilter);
          for (const id of allIds) {
            if (!accepted.has(id)) {
              rejected.push(id);
            }
          }
        }

        batchUndo.push({
          uri,
          path: f.path,
          previousContent: current,
        });
        // Prefer a minimal ranged TextEdit so SCM / File changes / inline
        // diff see a surgical edit instead of wipe-file + paste.
        let wrote = false;
        if (!options.writeFile) {
          try {
            wrote = await tryApplyRangedEdit(uri, current, next);
          } catch {
            wrote = false;
          }
        }
        if (!wrote) {
          await writeFile(uri, next);
        }
        applied.push(f.path);
      }

      let checkpointId: string | undefined;
      if (batchUndo.length) {
        undoStack = batchUndo;
        checkpointId = `cp_${crypto.randomBytes(6).toString('hex')}`;
        lastSnapshot = {
          checkpointId,
          source: req.source,
          files: batchUndo.map((e) => ({
            path: e.path,
            uri: e.uri.toString(),
            content: e.previousContent,
          })),
        };
      }

      const result: ApplyResult = { applied, rejected, checkpointId };
      for (const cb of listeners) {
        cb(result);
      }
      syncUndoContext();
      return result;
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    clearUndo(): void {
      undoStack = [];
      lastSnapshot = undefined;
      syncUndoContext();
      for (const cb of undoListeners) {
        cb();
      }
    },

    async undoLast(): Promise<number> {
      const entries = undoStack;
      undoStack = [];
      lastSnapshot = undefined;
      let n = 0;
      for (const e of entries.reverse()) {
        await writeFile(e.uri, e.previousContent);
        n++;
      }
      for (const cb of undoListeners) {
        cb();
      }
      syncUndoContext();
      return n;
    },

    getLastUndoSnapshot(): ApplyUndoSnapshot | undefined {
      return lastSnapshot;
    },

    onApplied(cb: (e: ApplyResult) => void): vscode.Disposable {
      listeners.add(cb);
      return new vscode.Disposable(() => listeners.delete(cb));
    },

    onUndone(cb: () => void): vscode.Disposable {
      undoListeners.add(cb);
      return new vscode.Disposable(() => undoListeners.delete(cb));
    },
  };

  syncUndoContext();
  return service;
}

let sharedService: ApplyService | undefined;

export function getApplyService(
  context?: vscode.ExtensionContext,
): ApplyService {
  if (!sharedService) {
    sharedService = createApplyService(context);
  }
  return sharedService;
}

export function registerApplyCommands(
  context: vscode.ExtensionContext,
  getTransport: () => Promise<import('@spockify/ide-client').ModelTransport | undefined>,
  output: vscode.OutputChannel,
): void {
  const applyService = getApplyService(context);

  void refreshApplyUndoContext(applyService);

  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.applyUndo', async () => {
      if (!applyService.canUndo()) {
        void vscode.window.showInformationMessage(
          'Spockify: nothing to undo. Use Checkpoints to restore an older snapshot.',
          'Checkpoints',
        ).then((pick) => {
          if (pick === 'Checkpoints') {
            void vscode.commands.executeCommand('spockify.checkpoints.list');
          }
        });
        return;
      }
      const n = await applyService.undoLast();
      void vscode.window.showInformationMessage(
        n
          ? `Spockify: undid last apply (${n} file(s)).`
          : 'Spockify: nothing to undo.',
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'spockify.applyPatches',
      async (text: string, source?: ApplyPatchRequest['source']) => {
        const req = applyService.parsePatchText(text, source ?? 'chat');
        if (!req.files.length) {
          void vscode.window.showWarningMessage('No patches found in text.');
          return;
        }
        const preview = await applyService.preview(req);
        output.appendLine(
          `apply: preview ${preview.files.length} file(s), ${preview.files.reduce((n, f) => n + f.hunks.length, 0)} hunk(s)`,
        );
        const result = await applyService.apply(req);
        output.appendLine(
          `apply: applied=${result.applied.join(', ') || '(none)'}`,
        );
        await notifyApplySuccess(result);
      },
    ),
  );

  void getTransport;
}
