/**
 * Multi-file diff review panel — Phase 2 (WS-P2-K).
 * Real WebviewPanel (not QuickPick-only) tied to ApplyService.
 */

import * as vscode from 'vscode';
import { collapseUnifiedDiffLines } from '../collapsedDiff';
import { getApplyService } from '../serviceImpl';
import { notifyApplySuccess } from '../ux';
import type {
  ApplyPatchRequest,
  DiffPreview,
  FileDiffPreview,
  HunkId,
} from '../types';
import { escapeHtmlVisualizeWs } from '../whitespaceVis';

/** Canonical command id (package.json). */
export const DIFF_REVIEW_COMMAND = 'spockify.diffReview';
export const DIFF_REVIEW_ACCEPT_ALL = 'spockify.diffReview.acceptAll';
export const DIFF_REVIEW_REJECT_ALL = 'spockify.diffReview.rejectAll';

export interface DiffReviewOptions {
  output?: vscode.OutputChannel;
  title?: string;
}

interface PendingReview {
  request: ApplyPatchRequest;
  preview: DiffPreview;
  panel?: vscode.WebviewPanel;
}

let pending: PendingReview | undefined;

/** Alias used by apply/index exports. */
export async function openDiffReviewPanel(
  request: ApplyPatchRequest,
  options?: DiffReviewOptions,
): Promise<string[]> {
  return openDiffReview(request, options?.output);
}

/**
 * Open a WebviewPanel multi-file review for a patch request.
 * Falls back to a compact QuickPick if webview creation fails.
 * Returns applied paths (empty if cancelled / all rejected).
 */
export async function openDiffReview(
  request: ApplyPatchRequest,
  output?: vscode.OutputChannel,
): Promise<string[]> {
  const applyService = getApplyService();
  const preview = await applyService.preview(request);
  if (!preview.files.length) {
    void vscode.window.showWarningMessage('Spockify: nothing to review.');
    return [];
  }

  output?.appendLine(
    `diffReview panel: ${preview.files.length} file(s), ${countHunks(preview)} hunk(s)`,
  );

  return new Promise<string[]>((resolve) => {
    const panel = vscode.window.createWebviewPanel(
      'spockifyDiffReview',
      'Spockify Diff Review',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    pending = { request, preview, panel };
    let settled = false;
    const applied: string[] = [];
    const remaining = new Set(preview.files.map((f) => f.path));

    const finish = (paths: string[]): void => {
      if (settled) return;
      settled = true;
      pending = undefined;
      panel.dispose();
      if (paths.length) {
        void notifyApplySuccess(
          {
            applied: paths,
            rejected: [],
            checkpointId: getApplyService().getLastUndoSnapshot?.()?.checkpointId,
          },
          { label: 'Spockify Diff Review' },
        );
      }
      resolve(paths);
    };

    const refresh = (): void => {
      const files = preview.files.filter((f) => remaining.has(f.path));
      panel.webview.html = renderHtml(files, applied.length);
    };

    panel.webview.onDidReceiveMessage(async (msg: { type: string; path?: string; hunks?: string[] }) => {
      if (msg.type === 'rejectAll') {
        finish(applied);
        return;
      }
      if (msg.type === 'acceptAll') {
        const batch: ApplyPatchRequest = {
          ...request,
          files: request.files.filter((f) => remaining.has(f.path)),
        };
        const result = await applyService.apply(batch);
        applied.push(...result.applied);
        finish(applied);
        return;
      }
      if (msg.type === 'acceptFile' && msg.path) {
        const fileReq = request.files.find((f) => f.path === msg.path);
        if (fileReq) {
          const result = await applyService.apply({
            ...request,
            files: [fileReq],
          });
          applied.push(...result.applied);
        }
        remaining.delete(msg.path);
        if (!remaining.size) finish(applied);
        else refresh();
        return;
      }
      if (msg.type === 'rejectFile' && msg.path) {
        remaining.delete(msg.path);
        if (!remaining.size) finish(applied);
        else refresh();
        return;
      }
      if (msg.type === 'acceptHunks' && msg.path && msg.hunks?.length) {
        const fileReq = request.files.find((f) => f.path === msg.path);
        if (fileReq) {
          const result = await applyService.apply(
            { ...request, files: [fileReq] },
            { hunks: msg.hunks as HunkId[] },
          );
          applied.push(...result.applied);
        }
        remaining.delete(msg.path);
        if (!remaining.size) finish(applied);
        else refresh();
        return;
      }
      if (msg.type === 'openDiff' && msg.path) {
        const file = preview.files.find((f) => f.path === msg.path);
        if (file) {
          const left = await vscode.workspace.openTextDocument({
            content: file.currentContent ?? '',
            language: 'plaintext',
          });
          const right = await vscode.workspace.openTextDocument({
            content: file.nextContent ?? '',
            language: 'plaintext',
          });
          await vscode.commands.executeCommand(
            'vscode.diff',
            left.uri,
            right.uri,
            `Diff Review: ${file.path}`,
          );
        }
      }
    });

    panel.onDidDispose(() => {
      if (!settled) {
        settled = true;
        pending = undefined;
        resolve(applied);
      }
    });

    refresh();
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function diffLineStats(unified: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of unified.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { added, removed };
}

/** Colorize unified-diff lines for the review panel (per-line, visible whitespace). */
function renderColoredDiff(unified: string): string {
  const raw = unified || '(full file replace — no unified diff)';
  const sliced = raw.length > 12_000 ? `${raw.slice(0, 12_000)}\n…` : raw;
  return renderCollapsedDiffHtml(sliced);
}

function renderCollapsedDiffHtml(unified: string): string {
  const rows = collapseUnifiedDiffLines(unified.split('\n'));
  return rows
    .map((row) => {
      if (row.kind === 'collapsed') {
        const cls = row.sig === '-' ? 'ln del collapsed' : 'ln add collapsed';
        const sig = row.sig === '-' ? '−' : '+';
        const title = escapeHtml((row.expanded || []).join('\n').slice(0, 2000));
        return `<span class="${cls}" title="${title}"><span class="sig">${sig}</span>${escapeHtml(row.text)}</span>`;
      }
      const line = row.text;
      const prefix = line[0] ?? '';
      const body = line.length ? line.slice(1) : '';
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ')) {
        return `<span class="ln meta">${escapeHtml(line)}</span>`;
      }
      if (line.startsWith('@@')) {
        return `<span class="ln hunk">${escapeHtml(line)}</span>`;
      }
      if (prefix === '+' && !line.startsWith('+++')) {
        return `<span class="ln add"><span class="sig">+</span>${escapeHtmlVisualizeWs(body)}</span>`;
      }
      if (prefix === '-' && !line.startsWith('---')) {
        return `<span class="ln del"><span class="sig">−</span>${escapeHtmlVisualizeWs(body)}</span>`;
      }
      if (prefix === ' ') {
        return `<span class="ln"><span class="sig"> </span>${escapeHtmlVisualizeWs(body)}</span>`;
      }
      return `<span class="ln">${escapeHtml(line)}</span>`;
    })
    .join('\n');
}

function renderHtml(files: FileDiffPreview[], acceptedCount: number): string {
  const fileBlocks = files
    .map((f, i) => {
      const stats = diffLineStats(f.unifiedDiff || '');
      const diff = renderColoredDiff(f.unifiedDiff || '');
      const hunkOpts = f.hunks
        .map(
          (h) =>
            `<label class="hunk"><input type="checkbox" checked data-hunk="${escapeHtml(h.id)}" /> ${escapeHtml(h.header || `hunk ${h.index}`)}</label>`,
        )
        .join('');
      return `
<section class="file" data-path="${escapeHtml(f.path)}">
  <header>
    <strong>${escapeHtml(f.path)}</strong>
    <span class="meta">+${stats.added} −${stats.removed} · ${f.hunks.length} hunk(s)</span>
  </header>
  <pre class="diff">${diff}</pre>
  <div class="hunks">${hunkOpts || '<em>no hunks — full file</em>'}</div>
  <div class="actions">
    <button data-act="acceptFile" data-i="${i}">Accept</button>
    <button data-act="rejectFile" data-i="${i}" class="secondary">Discard</button>
    <button data-act="acceptHunks" data-i="${i}" class="secondary">Accept checked hunks</button>
    <button data-act="openDiff" data-i="${i}" class="secondary">Open Diff</button>
  </div>
</section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  :root {
    color-scheme: light dark;
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, #444);
    --btn: var(--vscode-button-background);
    --btnFg: var(--vscode-button-foreground);
    --btnSec: var(--vscode-button-secondaryBackground, #3a3d41);
    --btnSecFg: var(--vscode-button-secondaryForeground, var(--fg));
    --muted: var(--vscode-descriptionForeground);
    --addBg: color-mix(in srgb, #3dd68c 22%, transparent);
    --delBg: color-mix(in srgb, #ff7b72 22%, transparent);
    --hunkFg: var(--vscode-textLink-foreground, #4fc1ff);
  }
  body {
    font-family: var(--vscode-font-family);
    background: var(--bg);
    color: var(--fg);
    margin: 0;
    padding: 12px 16px 48px;
  }
  h1 { font-size: 1.1rem; margin: 0 0 4px; }
  .toolbar {
    display: flex; gap: 8px; flex-wrap: wrap; align-items: center;
    position: sticky; top: 0; z-index: 2;
    background: var(--bg); padding: 8px 0 12px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 12px;
  }
  button {
    background: var(--btn); color: var(--btnFg);
    border: none; padding: 6px 12px; border-radius: 2px; cursor: pointer;
  }
  button.secondary {
    background: var(--btnSec); color: var(--btnSecFg); opacity: 0.95;
  }
  .file {
    border: 1px solid var(--border);
    border-radius: 4px;
    margin-bottom: 14px;
    overflow: hidden;
  }
  .file header {
    display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap;
    padding: 8px 10px; border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 85%, var(--fg));
  }
  .meta { color: var(--muted); font-size: 0.85rem; }
  pre.diff {
    margin: 0; padding: 0; max-height: 420px; overflow: auto;
    font-size: 12px; line-height: 1.45;
    font-family: var(--vscode-editor-font-family, ui-monospace, monospace);
    tab-size: 4;
  }
  .ln {
    display: block; padding: 0 10px 0 0;
    white-space: pre;
    word-break: normal;
    overflow-wrap: normal;
  }
  .ln .sig {
    display: inline-block;
    width: 1.2em;
    text-align: center;
    opacity: 0.75;
    user-select: none;
  }
  .ln.add { background: var(--addBg); }
  .ln.del { background: var(--delBg); }
  .ln.collapsed {
    cursor: help;
    font-weight: 600;
    white-space: pre-wrap;
    padding: 2px 10px 2px 0;
  }
  .ln.hunk { color: var(--hunkFg); white-space: pre-wrap; }
  .ln.meta { color: var(--muted); }
  .hunks { padding: 6px 10px; display: flex; flex-direction: column; gap: 4px; }
  .hunk { font-size: 0.85rem; color: var(--muted); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 10px 10px; }
  .empty { color: var(--muted); padding: 24px 0; }
</style>
</head>
<body>
  <h1>Spockify Diff Review</h1>
  <p class="meta">${files.length} remaining · ${acceptedCount} accepted this session · Accept all / per-file / Discard</p>
  <div class="toolbar">
    <button id="acceptAll">Accept all</button>
    <button id="rejectAll" class="secondary">Discard all</button>
  </div>
  ${files.length ? fileBlocks : '<p class="empty">Nothing left to review.</p>'}
  <script>
    const vscode = acquireVsCodeApi();
    const files = ${JSON.stringify(files.map((f) => f.path))};
    document.getElementById('acceptAll')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'acceptAll' });
    });
    document.getElementById('rejectAll')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'rejectAll' });
    });
    document.querySelectorAll('button[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-i'));
        const path = files[i];
        const act = btn.getAttribute('data-act');
        if (act === 'acceptHunks') {
          const section = btn.closest('section');
          const hunks = [...section.querySelectorAll('input[data-hunk]:checked')]
            .map((el) => el.getAttribute('data-hunk'));
          vscode.postMessage({ type: 'acceptHunks', path, hunks });
          return;
        }
        vscode.postMessage({ type: act, path });
      });
    });
  </script>
</body>
</html>`;
}

function countHunks(preview: DiffPreview): number {
  return preview.files.reduce((n, f) => n + f.hunks.length, 0);
}

export function registerDiffReview(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      DIFF_REVIEW_COMMAND,
      async (text?: string, source?: ApplyPatchRequest['source']) => {
        const applyService = getApplyService(context);
        let request: ApplyPatchRequest;
        if (typeof text === 'string' && text.trim()) {
          request = applyService.parsePatchText(text, source ?? 'chat');
        } else {
          const pasted = await vscode.window.showInputBox({
            title: 'Spockify Diff Review',
            prompt: 'Paste fenced file blocks or unified diff',
            ignoreFocusOut: true,
          });
          if (!pasted?.trim()) {
            return;
          }
          request = applyService.parsePatchText(pasted, source ?? 'chat');
        }
        if (!request.files.length) {
          void vscode.window.showWarningMessage('No patches found.');
          return;
        }
        await openDiffReview(request, output);
      },
    ),
    vscode.commands.registerCommand(DIFF_REVIEW_ACCEPT_ALL, async () => {
      if (!pending) {
        void vscode.window.showInformationMessage('No active diff review.');
        return;
      }
      const result = await getApplyService().apply(pending.request);
      pending.panel?.dispose();
      pending = undefined;
      void vscode.window.showInformationMessage(
        `Accepted ${result.applied.length} file(s).`,
      );
    }),
    vscode.commands.registerCommand(DIFF_REVIEW_REJECT_ALL, async () => {
      pending?.panel?.dispose();
      pending = undefined;
      void vscode.window.showInformationMessage('Diff review discarded.');
    }),
  );
}
