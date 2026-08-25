/**
 * Cursor-like inline Accept / Reject for pending file patches.
 * Interleaved red (removed) / green (added) lines are written in-place;
 * CodeLens Keep/Undo anchors to the edited region (no after/before ghosts,
 * no auto side-by-side diff).
 */

import * as vscode from 'vscode';
import { createShadowWorkspace } from '@spockify/shadow-workspace';
import { buildFileDiffPreview } from '../diff';
import { applyHunksToContent } from '../hunks';
import { getApplyService } from '../serviceImpl';
import type { DiffHunk, FileDiffPreview, HunkId } from '../types';
import type { FilePatch } from '../../composer/types';
import type { ShadowWorkspaceHandle } from '../../composer/shadowWorkspace';
import { getComposerTree } from '../../composer/composerView';
import type { ApplyPatchRequest } from '../types';
import { visualizeWhitespace } from '../whitespaceVis';
import {
  absoluteRanges,
  buildInlinePreviewDocument,
  type InlinePreviewDocument,
} from '../../inlineEdit/proposedContent';

/** Explicit colors — ThemeColor `diffEditor.*` is often invisible outside the diff editor. */
const ADDED = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(46, 160, 67, 0.28)',
  borderColor: 'rgba(46, 160, 67, 0.85)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  isWholeLine: true,
  overviewRulerColor: 'rgba(46, 160, 67, 0.9)',
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

const REMOVED = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(248, 81, 73, 0.28)',
  borderColor: 'rgba(248, 81, 73, 0.85)',
  borderWidth: '0 0 0 3px',
  borderStyle: 'solid',
  isWholeLine: true,
  textDecoration: 'line-through solid rgba(248, 81, 73, 0.7)',
  overviewRulerColor: 'rgba(248, 81, 73, 0.9)',
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

const HUNK_ANCHOR = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  overviewRulerColor: 'rgba(88, 166, 255, 0.85)',
  overviewRulerLane: vscode.OverviewRulerLane.Center,
});

const REVIEW_SCHEME = 'spockify-review';

interface PendingFileReview {
  path: string;
  uri: vscode.Uri;
  preview: FileDiffPreview;
  shadow?: ShadowWorkspaceHandle;
  source: 'chat' | 'composer' | 'agent';
  /** Hunk ids still pending (all at start). */
  remainingHunks: Set<HunkId>;
  /** Hunk ids explicitly rejected (excluded from staged content). */
  rejectedHunks: Set<HunkId>;
  /**
   * Cursor-style: interleaved red/green preview is already in the buffer.
   * Keep writes clean staged; Undo restores preview.currentContent.
   */
  appliedInBuffer: boolean;
  /** Last interleaved document written for decorations / CodeLens. */
  interleaved?: InlinePreviewDocument;
}

/** Visible mapping of a hunk onto the interleaved (or proposed) document. */
interface HunkVisual {
  /** CodeLens / scroll anchor — only set when the hunk maps to real lines. */
  range: vscode.Range | undefined;
  deleted: vscode.Range[];
  added: vscode.Range[];
  addCount: number;
  delCount: number;
  removedPreview: string[];
}

let reviews = new Map<string, PendingFileReview>();
let codeLensEmitter = new vscode.EventEmitter<void>();
let proposedProvider: vscode.Disposable | undefined;

function allHunkIds(review: PendingFileReview): HunkId[] {
  return review.preview.hunks.map((h) => h.id);
}

function computeWorkspaceContent(review: PendingFileReview): string {
  // Full-file replace fallback (synthetic / no unified diff case).
  if (!review.preview.unifiedDiff || review.preview.hunks.length <= 1) {
    const ids = allHunkIds(review);
    const only = ids[0];
    if (!only) return review.preview.currentContent;
    const rejected = review.rejectedHunks.has(only);
    const stillPending = review.remainingHunks.has(only);
    if (rejected || stillPending) return review.preview.currentContent;
    return review.preview.nextContent;
  }
  const accepted = allHunkIds(review).filter(
    (id) => !review.remainingHunks.has(id) && !review.rejectedHunks.has(id),
  );
  return applyHunksToContent(
    review.preview.currentContent,
    review.preview.hunks,
    accepted,
  );
}

function computeStagedContent(review: PendingFileReview): string {
  // Staged content is "everything except explicitly rejected hunks".
  if (!review.preview.unifiedDiff || review.preview.hunks.length <= 1) {
    const ids = allHunkIds(review);
    const only = ids[0];
    if (!only) return review.preview.nextContent;
    return review.rejectedHunks.has(only)
      ? review.preview.currentContent
      : review.preview.nextContent;
  }
  const staged = allHunkIds(review).filter(
    (id) => !review.rejectedHunks.has(id),
  );
  return applyHunksToContent(
    review.preview.currentContent,
    review.preview.hunks,
    staged,
  );
}

function keyForUri(uri: vscode.Uri): string {
  return uri.toString();
}

/** Prefer exact URI; fall back to path match (Remote-SSH / scheme quirks). */
function findReview(uri: vscode.Uri): PendingFileReview | undefined {
  const direct = reviews.get(keyForUri(uri));
  if (direct) return direct;
  const fs = uri.fsPath;
  const path = uri.path;
  for (const r of reviews.values()) {
    if (r.uri.fsPath === fs || r.uri.path === path) return r;
  }
  return undefined;
}

function lineRange(doc: vscode.TextDocument, ln: number): vscode.Range | undefined {
  if (ln < 0 || ln >= doc.lineCount) return undefined;
  return doc.lineAt(ln).range;
}

/**
 * Map a unified hunk onto the interleaved preview when available; otherwise
 * map onto proposed-line coordinates (legacy / no interleave metadata).
 */
function computeHunkVisual(
  doc: vscode.TextDocument,
  review: PendingFileReview,
  hunk: DiffHunk,
): HunkVisual {
  const deleted: vscode.Range[] = [];
  const added: vscode.Range[] = [];
  const removedPreview: string[] = [];
  let addCount = 0;
  let delCount = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = -1;

  const mark = (ln: number): void => {
    if (ln < 0 || ln >= doc.lineCount) return;
    first = Math.min(first, ln);
    last = Math.max(last, ln);
  };

  const interleaved = review.interleaved;
  if (interleaved) {
    for (const rel of interleaved.removedLineIndexes) {
      const r = lineRange(doc, rel);
      if (r) {
        deleted.push(r);
        removedPreview.push(interleaved.lines[rel]?.text ?? '');
        delCount++;
        mark(rel);
      }
    }
    for (const rel of interleaved.addedLineIndexes) {
      const r = lineRange(doc, rel);
      if (r) {
        added.push(r);
        addCount++;
        mark(rel);
      }
    }
    // Multi-hunk: nudge CodeLens toward this hunk's newStart among added lines.
    if (review.preview.hunks.length > 1 && interleaved.addedLineIndexes.length) {
      const target = Math.max(0, hunk.newStart - 1);
      let best = interleaved.addedLineIndexes[0]!;
      let bestDist = Math.abs(best - target);
      for (const rel of interleaved.addedLineIndexes) {
        const d = Math.abs(rel - target);
        if (d < bestDist) {
          bestDist = d;
          best = rel;
        }
      }
      first = best;
      last = best;
      addCount = Math.max(addCount, hunk.newLines);
      delCount = Math.max(delCount, hunk.oldLines);
      for (const hl of hunk.lines) {
        if (hl[0] === '-') removedPreview.push(hl.slice(1));
      }
    }
  } else if (hunk.lines.length) {
    let newLine = Math.max(0, hunk.newStart - 1);
    for (const hl of hunk.lines) {
      const prefix = hl[0];
      const body = hl.slice(1);
      if (prefix === '-') {
        delCount++;
        removedPreview.push(body);
        continue;
      }
      if (prefix === '+' || prefix === ' ') {
        if (prefix === '+') {
          addCount++;
          const r = lineRange(doc, newLine);
          if (r) {
            mark(newLine);
            added.push(r);
          }
        } else if (newLine < doc.lineCount) {
          mark(newLine);
        }
        newLine++;
      }
    }
  } else if (hunk.oldLines > 0 || hunk.newLines > 0) {
    const start = Math.max(0, hunk.newStart - 1);
    const end = Math.min(doc.lineCount, start + Math.max(hunk.newLines, 1));
    for (let ln = start; ln < end; ln++) {
      mark(ln);
      const r = lineRange(doc, ln);
      if (r) added.push(r);
    }
    addCount = Math.max(addCount, hunk.newLines);
    delCount = Math.max(delCount, hunk.oldLines);
  }

  const hasRange =
    Number.isFinite(first) && last >= first && doc.lineCount > 0;
  const range = hasRange
    ? new vscode.Range(first, 0, last, doc.lineAt(last).text.length)
    : undefined;

  return { range, deleted, added, addCount, delCount, removedPreview };
}

function clearDecorations(editor: vscode.TextEditor): void {
  editor.setDecorations(ADDED, []);
  editor.setDecorations(REMOVED, []);
  editor.setDecorations(HUNK_ANCHOR, []);
}

function paintFromInterleaved(
  editor: vscode.TextEditor,
  interleaved: InlinePreviewDocument,
): number {
  const doc = editor.document;
  const toRanges = (indexes: number[]) =>
    absoluteRanges(0, indexes, doc.lineCount).map((r) => {
      const endCol = doc.lineAt(r.endLine).text.length;
      return new vscode.Range(r.startLine, 0, r.endLine, endCol);
    });
  const removed = toRanges(interleaved.removedLineIndexes);
  const added = toRanges(interleaved.addedLineIndexes);
  const anchors: vscode.Range[] = [];
  const firstChange = [
    ...interleaved.removedLineIndexes,
    ...interleaved.addedLineIndexes,
  ].sort((a, b) => a - b)[0];
  if (firstChange !== undefined) {
    const r = lineRange(doc, firstChange);
    if (r) anchors.push(r);
  }
  editor.setDecorations(REMOVED, removed);
  editor.setDecorations(ADDED, added);
  editor.setDecorations(HUNK_ANCHOR, anchors);
  return removed.length + added.length;
}

function paintEditor(editor: vscode.TextEditor, review: PendingFileReview): number {
  if (!review.remainingHunks.size) {
    clearDecorations(editor);
    return 0;
  }
  if (review.interleaved) {
    return paintFromInterleaved(editor, review.interleaved);
  }

  const doc = editor.document;
  const added: vscode.Range[] = [];
  const removed: vscode.Range[] = [];
  const anchors: vscode.Range[] = [];
  let painted = 0;

  for (const hunk of review.preview.hunks) {
    if (!review.remainingHunks.has(hunk.id)) continue;
    const visual = computeHunkVisual(doc, review, hunk);
    added.push(...visual.added);
    removed.push(...visual.deleted);
    if (visual.range) anchors.push(visual.range);
    painted += visual.added.length + visual.deleted.length;
  }

  if (!painted && review.remainingHunks.size && doc.lineCount > 0) {
    const n = Math.min(doc.lineCount, 200);
    for (let ln = 0; ln < n; ln++) {
      added.push(doc.lineAt(ln).range);
      painted++;
    }
  }

  editor.setDecorations(ADDED, added);
  editor.setDecorations(REMOVED, removed);
  editor.setDecorations(HUNK_ANCHOR, anchors);
  return painted;
}

async function writeReviewBuffer(
  review: PendingFileReview,
  content: string,
): Promise<boolean> {
  const onDisk = await readUriText(review.uri);
  if (onDisk === content) {
    return true;
  }
  const result = await getApplyService().apply({
    files: [{ path: review.path, nextContent: content }],
    source: review.source,
  });
  return result.applied.includes(review.path);
}

/** Write Cursor-style interleaved red/green preview into the real buffer. */
async function applyInterleavedPreview(review: PendingFileReview): Promise<boolean> {
  const staged = computeStagedContent(review);
  const interleaved = buildInlinePreviewDocument(
    review.preview.currentContent,
    staged,
  );
  review.interleaved = interleaved;
  const ok = await writeReviewBuffer(review, interleaved.text);
  review.appliedInBuffer = ok;
  return ok;
}

/** Keep proposed text only (strip red lines). */
async function commitCleanStaged(review: PendingFileReview): Promise<boolean> {
  const staged = computeStagedContent(review);
  review.interleaved = undefined;
  const ok = await writeReviewBuffer(review, staged);
  review.appliedInBuffer = false;
  return ok;
}

function refreshVisibleEditors(): void {
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.scheme === REVIEW_SCHEME) continue;
    const review = findReview(editor.document.uri);
    if (review) paintEditor(editor, review);
    else clearDecorations(editor);
  }
  codeLensEmitter.fire();
}

async function resolvePatchUri(relPath: string): Promise<vscode.Uri | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  const clean = relPath.replace(/^\.\//, '').replace(/^\/+/, '');
  const found = await vscode.workspace.findFiles(
    `**/${clean.split('/').pop()}`,
    '**/node_modules/**',
    20,
  );
  const exact = found.find(
    (u) => u.path.endsWith('/' + clean) || u.path.endsWith(clean),
  );
  if (exact) return exact;
  return vscode.Uri.joinPath(folders[0].uri, clean);
}

async function readUriText(uri: vscode.Uri): Promise<string> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
  } catch {
    return '';
  }
}

function proposedUriFor(path: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: REVIEW_SCHEME,
    path: '/' + path.replace(/^\/+/, ''),
    query: 'proposed',
  });
}

async function openSideBySideDiff(review: PendingFileReview): Promise<void> {
  const right = proposedUriFor(review.path);
  await vscode.commands.executeCommand(
    'vscode.diff',
    review.uri,
    right,
    `Spockify: ${review.path} (current ↔ proposed)`,
    { preview: true, viewColumn: vscode.ViewColumn.Beside },
  );
  // Prefer visible whitespace in the diff editors (Cursor-like review).
  for (const ed of vscode.window.visibleTextEditors) {
    if (
      ed.document.uri.toString() === review.uri.toString() ||
      ed.document.uri.scheme === REVIEW_SCHEME
    ) {
      // VS Code types omit renderWhitespace on TextEditorOptions in some versions.
      (ed as vscode.TextEditor & { options: Record<string, unknown> }).options = {
        ...(ed.options as object),
        renderWhitespace: 'all',
      };
    }
  }
}

async function openPendingDiffReviewPanel(): Promise<void> {
  const pending = [...reviews.values()];
  if (!pending.length) {
    void vscode.window.showInformationMessage('No pending Spockify review.');
    return;
  }
  const { openDiffReview } = await import('./diffReview');
  const request: ApplyPatchRequest = {
    files: pending.map((r) => ({
      path: r.path,
      nextContent: computeStagedContent(r),
    })),
    source: pending[0]?.source ?? 'composer',
  };
  await openDiffReview(request);
}

/**
 * Stage patches for inline editor review. Opens the first file.
 * Pass `syncTree: false` when Composer already called setPending (keeps shadow).
 */
export async function stageInlineFileReview(
  patches: FilePatch[],
  options?: {
    openFirst?: boolean;
    source?: 'chat' | 'composer' | 'agent';
    syncTree?: boolean;
    shadow?: ShadowWorkspaceHandle;
    sessionId?: string;
  },
): Promise<void> {
  if (!patches.length) return;

  let shadow = options?.shadow;
  if (!shadow && options?.sessionId) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      shadow = await createShadowWorkspace(options.sessionId, {
        workspaceRoot,
        reuse: true,
      });
    }
  }

  if (shadow) {
    for (const p of patches) {
      await shadow.writeProposed(p.path, p.content);
    }
    await shadow.writeManifest({
      surface: options?.source ?? 'agent',
      staged: patches.map((p) => p.path),
    });
  }

  if (options?.syncTree !== false) {
    getComposerTree()?.setPending(patches, { shadow });
  }

  for (const patch of patches) {
    const uri = await resolvePatchUri(patch.path);
    if (!uri) continue;
    const current = await readUriText(uri);
    const preview = buildFileDiffPreview(patch.path, current, patch.content);
    const remaining = new Set<HunkId>(
      preview.hunks.length
        ? preview.hunks.map((h) => h.id)
        : ([`${patch.path}#0` as HunkId]),
    );
    // Synthetic full-file hunk id when no unified hunks
    if (!preview.hunks.length) {
      preview.hunks = [
        {
          id: `${patch.path}#0` as HunkId,
          path: patch.path,
          index: 0,
          header: '@@ full file @@',
          lines: [],
          oldStart: 1,
          oldLines: current.split('\n').length || 1,
          newStart: 1,
          newLines: patch.content.split('\n').length || 1,
        },
      ];
    }
    const review: PendingFileReview = {
      path: patch.path,
      uri,
      preview,
      shadow,
      source: options?.source ?? 'composer',
      remainingHunks: remaining,
      rejectedHunks: new Set<HunkId>(),
      appliedInBuffer: false,
    };
    reviews.set(keyForUri(uri), review);

    // Cursor-style: interleaved red/green in the real buffer, then decorate.
    const staged = computeStagedContent(review);
    if (staged !== current) {
      await applyInterleavedPreview(review);
    } else {
      review.appliedInBuffer = true;
      review.interleaved = buildInlinePreviewDocument(current, staged);
    }
  }

  let firstEditor: vscode.TextEditor | undefined;
  let firstReview: PendingFileReview | undefined;

  if (options?.openFirst !== false) {
    const first = patches[0];
    const uri = await resolvePatchUri(first.path);
    if (uri) {
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        const parent = vscode.Uri.joinPath(uri, '..');
        try {
          await vscode.workspace.fs.createDirectory(parent);
        } catch {
          /* ignore */
        }
        await vscode.workspace.fs.writeFile(uri, new Uint8Array());
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      firstEditor = await vscode.window.showTextDocument(doc, {
        preview: false,
        preserveFocus: false,
      });
      firstReview = findReview(uri);
      if (firstReview && firstEditor) {
        const visuals = firstReview.preview.hunks
          .filter((h) => firstReview!.remainingHunks.has(h.id))
          .map((h) => computeHunkVisual(firstEditor!.document, firstReview!, h));
        const anchor = visuals.find((v) => v.range)?.range;
        if (anchor) {
          firstEditor.revealRange(
            anchor,
            vscode.TextEditorRevealType.InCenterIfOutsideViewport,
          );
        }
      }
    }
  }

  refreshVisibleEditors();

  const n = patches.length;
  void vscode.window.setStatusBarMessage(
    `Spockify: ${n} file(s) pending review — Keep / Undo in editor (Cursor-style)`,
    6000,
  );
}

export function clearInlineFileReview(path?: string): void {
  if (!path) {
    reviews.clear();
    refreshVisibleEditors();
    return;
  }
  for (const [k, r] of [...reviews.entries()]) {
    if (r.path === path) reviews.delete(k);
  }
  refreshVisibleEditors();
}

async function acceptFile(path: string): Promise<void> {
  const entry = [...reviews.values()].find((r) => r.path === path);
  if (!entry) {
    await getComposerTree()?.acceptFile(path);
    return;
  }
  if (!entry.remainingHunks.size) {
    reviews.delete(keyForUri(entry.uri));
    await getComposerTree()?.discardFile(path);
    refreshVisibleEditors();
    return;
  }

  const stagedContent = computeStagedContent(entry);
  if (!(await commitCleanStaged(entry))) {
    void vscode.window.showWarningMessage(
      `Spockify inline review: could not apply staged file ${path}`,
    );
    return;
  }

  if (entry.shadow) {
    await entry.shadow.writeProposed(entry.path, stagedContent);
  }

  reviews.delete(keyForUri(entry.uri));
  await getComposerTree()?.discardFile(path);
  refreshVisibleEditors();
  void vscode.window.setStatusBarMessage(`Accepted ${path}`, 3000);
}

async function rejectFile(path: string): Promise<void> {
  for (const [k, r] of [...reviews.entries()]) {
    if (r.path !== path) continue;
    // Undo applied buffer back to pre-review content (Cursor Undo).
    if (r.appliedInBuffer) {
      r.interleaved = undefined;
      const original = r.preview.currentContent;
      const onDisk = await readUriText(r.uri);
      if (onDisk !== original) {
        await writeReviewBuffer(r, original);
      }
    }
    if (r.shadow) {
      await r.shadow.writeProposed(r.path, r.preview.currentContent);
    }
    reviews.delete(k);
  }
  await getComposerTree()?.discardFile(path);
  refreshVisibleEditors();
  void vscode.window.setStatusBarMessage(`Rejected ${path}`, 3000);
}

async function acceptHunk(path: string, hunkId: HunkId): Promise<void> {
  const entry = [...reviews.values()].find((r) => r.path === path);
  if (!entry) return;

  if (!entry.remainingHunks.has(hunkId)) return;

  entry.remainingHunks.delete(hunkId);

  // Interleaved buffer still shows all non-rejected changes until the last Keep.
  if (!entry.remainingHunks.size) {
    if (!(await commitCleanStaged(entry))) {
      entry.remainingHunks.add(hunkId);
      return;
    }
    if (entry.shadow) {
      await entry.shadow.writeProposed(entry.path, computeStagedContent(entry));
    }
    reviews.delete(keyForUri(entry.uri));
    await getComposerTree()?.discardFile(path);
  } else if (!entry.appliedInBuffer) {
    const desiredWorkspaceContent = computeWorkspaceContent(entry);
    if (!(await writeReviewBuffer(entry, desiredWorkspaceContent))) {
      entry.remainingHunks.add(hunkId);
      return;
    }
  }
  refreshVisibleEditors();
}

async function rejectHunk(path: string, hunkId: HunkId): Promise<void> {
  const entry = [...reviews.values()].find((r) => r.path === path);
  if (!entry) return;

  if (!entry.remainingHunks.has(hunkId)) return;
  entry.remainingHunks.delete(hunkId);
  entry.rejectedHunks.add(hunkId);

  const stagedContent = computeStagedContent(entry);
  if (entry.remainingHunks.size) {
    if (entry.appliedInBuffer) {
      await applyInterleavedPreview(entry);
    }
  } else if (entry.appliedInBuffer) {
    entry.interleaved = undefined;
    await writeReviewBuffer(entry, stagedContent);
    entry.appliedInBuffer = false;
  }

  if (entry.shadow) {
    await entry.shadow.writeProposed(entry.path, stagedContent);
  }

  if (!entry.remainingHunks.size) {
    reviews.delete(keyForUri(entry.uri));
    await getComposerTree()?.discardFile(path);
  }
  refreshVisibleEditors();
}

class InlineReviewCodeLensProvider implements vscode.CodeLensProvider {
  readonly onDidChangeCodeLenses = codeLensEmitter.event;

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme === REVIEW_SCHEME) return [];
    const review = findReview(document.uri);
    if (!review) return [];

    const lenses: vscode.CodeLens[] = [];
    // Anchor file-level Keep/Undo to the first pending hunk (Cursor sticky bar),
    // not the top of the file.
    let fileAnchor = new vscode.Range(0, 0, 0, 0);
    for (const hunk of review.preview.hunks) {
      if (!review.remainingHunks.has(hunk.id)) continue;
      const visual = computeHunkVisual(document, review, hunk);
      if (visual.range) {
        fileAnchor = new vscode.Range(
          visual.range.start.line,
          0,
          visual.range.start.line,
          0,
        );
        break;
      }
    }
    lenses.push(
      new vscode.CodeLens(fileAnchor, {
        title: '$(check) Keep file',
        command: 'spockify.inlineReview.acceptFile',
        arguments: [review.path],
      }),
      new vscode.CodeLens(fileAnchor, {
        title: '$(discard) Undo file',
        command: 'spockify.inlineReview.rejectFile',
        arguments: [review.path],
      }),
      new vscode.CodeLens(fileAnchor, {
        title: '$(diff) Show Diff',
        command: 'spockify.inlineReview.showDiff',
        arguments: [review.path],
      }),
      new vscode.CodeLens(fileAnchor, {
        title: '$(preview) Review',
        command: 'spockify.inlineReview.openReview',
        arguments: [],
      }),
    );

    for (const hunk of review.preview.hunks) {
      if (!review.remainingHunks.has(hunk.id)) continue;
      const visual = computeHunkVisual(document, review, hunk);
      if (!visual.range) continue;
      if (
        visual.added.length === 0 &&
        visual.addCount === 0 &&
        visual.delCount === 0
      ) {
        continue;
      }
      const line = visual.range.start.line;
      const range = new vscode.Range(line, 0, line, 0);
      const stats =
        visual.addCount || visual.delCount
          ? ` (+${visual.addCount}/−${visual.delCount})`
          : '';
      const hoverBits =
        visual.removedPreview.length > 0
          ? visual.removedPreview
              .slice(0, 8)
              .map((t) => visualizeWhitespace(t) || '·')
              .join(' · ')
          : '';
      lenses.push(
        new vscode.CodeLens(range, {
          title: `$(check) Keep${stats}`,
          command: 'spockify.inlineReview.acceptHunk',
          arguments: [review.path, hunk.id],
          tooltip: hoverBits ? `Removed: ${hoverBits}` : undefined,
        }),
        new vscode.CodeLens(range, {
          title: '$(discard) Undo',
          command: 'spockify.inlineReview.rejectHunk',
          arguments: [review.path, hunk.id],
        }),
      );
    }
    return lenses;
  }
}

export function registerInlineFileReview(
  context: vscode.ExtensionContext,
): void {
  const provider = new InlineReviewCodeLensProvider();

  proposedProvider = vscode.workspace.registerTextDocumentContentProvider(
    REVIEW_SCHEME,
    {
      provideTextDocumentContent(uri: vscode.Uri): string {
        const rel = uri.path.replace(/^\//, '');
        const entry = [...reviews.values()].find(
          (r) => r.path === rel || r.path.endsWith(rel),
        );
        if (!entry) return '';
        return computeStagedContent(entry);
      },
    },
  );

  context.subscriptions.push(
    proposedProvider,
    vscode.languages.registerCodeLensProvider({ scheme: '*' }, provider),
    vscode.window.onDidChangeActiveTextEditor(() => refreshVisibleEditors()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (findReview(e.document.uri)) refreshVisibleEditors();
    }),
    vscode.commands.registerCommand(
      'spockify.inlineReview.acceptFile',
      async (path: string) => acceptFile(path),
    ),
    vscode.commands.registerCommand(
      'spockify.inlineReview.rejectFile',
      async (path: string) => rejectFile(path),
    ),
    vscode.commands.registerCommand(
      'spockify.inlineReview.acceptHunk',
      async (path: string, hunkId: HunkId) => acceptHunk(path, hunkId),
    ),
    vscode.commands.registerCommand(
      'spockify.inlineReview.rejectHunk',
      async (path: string, hunkId: HunkId) => rejectHunk(path, hunkId),
    ),
    vscode.commands.registerCommand(
      'spockify.inlineReview.showDiff',
      async (path?: string) => {
        const entry = path
          ? [...reviews.values()].find((r) => r.path === path)
          : [...reviews.values()][0];
        if (!entry) {
          void vscode.window.showInformationMessage('No pending Spockify review.');
          return;
        }
        await openSideBySideDiff(entry);
      },
    ),
    vscode.commands.registerCommand(
      'spockify.inlineReview.openReview',
      async () => openPendingDiffReviewPanel(),
    ),
    vscode.commands.registerCommand('spockify.inlineReview.acceptAll', async () => {
      const paths = [...new Set([...reviews.values()].map((r) => r.path))];
      for (const p of paths) await acceptFile(p);
    }),
    vscode.commands.registerCommand('spockify.inlineReview.rejectAll', async () => {
      const paths = [...new Set([...reviews.values()].map((r) => r.path))];
      for (const p of paths) await rejectFile(p);
    }),
    {
      dispose: () => {
        reviews.clear();
        codeLensEmitter.dispose();
      },
    },
  );

  // Keep decorations when Composer tree pending changes externally.
  const tree = getComposerTree();
  tree?.onPendingChange(() => {
    const pending = tree.getPending();
    const paths = new Set(pending.map((p) => p.path));
    for (const [k, r] of [...reviews.entries()]) {
      if (!paths.has(r.path)) reviews.delete(k);
    }
    refreshVisibleEditors();
  });
}

export function hasInlineReviews(): boolean {
  return reviews.size > 0;
}

/** Used by apply_patch staging — list pending paths. */
export function listInlineReviewPaths(): string[] {
  return [...new Set([...reviews.values()].map((r) => r.path))];
}
