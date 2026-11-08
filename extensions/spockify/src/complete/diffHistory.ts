/**
 * Workspace-scoped diff-history collector for Tab completions (protocol v2).
 *
 * Tracks per-file recent-edit trails as small unified diffs with timestamps.
 * Bursts of keystrokes are coalesced: a file's pending edits flush into one
 * diff after ~1s idle. Collection is fully off the request critical path —
 * providers call snapshot() which only reads in-memory state.
 */

import * as vscode from 'vscode';
import type { GhostDiffHistoryEntry } from '@spockify/ide-client';
import {
  computeUnifiedDiff,
  pushTrailDiff,
  snapshotTrails,
  type FileTrail,
} from './diffTrail';

const FLUSH_IDLE_MS = 1000;
/** Don't trail huge documents — diffing them per-keystroke burst is wasteful. */
const MAX_TRACKED_DOC_CHARS = 1_500_000;

interface PendingFile {
  baseline: string;
  timer: ReturnType<typeof setTimeout>;
}

function relPathFor(doc: vscode.TextDocument): string | undefined {
  if (doc.uri.scheme !== 'file' && doc.uri.scheme !== 'vscode-remote') {
    return undefined;
  }
  const rel = vscode.workspace.asRelativePath(doc.uri, false);
  if (!rel || rel.includes('/.git/') || rel.startsWith('.git/')) {
    return undefined;
  }
  return rel.replace(/\\/g, '/');
}

export class DiffHistoryTracker implements vscode.Disposable {
  private readonly trails = new Map<string, FileTrail>();
  /** Files with unflushed edits: baseline text + idle timer. */
  private readonly pending = new Map<string, PendingFile>();
  /** Baseline text per file, captured at open / last flush. */
  private readonly baselines = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    // Seed baselines for already-open docs so the first edit diffs cleanly.
    for (const doc of vscode.workspace.textDocuments) {
      this.seed(doc);
    }
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.seed(doc)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onChange(e)),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const rel = relPathFor(doc);
        if (rel) {
          this.flushFile(rel, doc);
          this.baselines.delete(rel);
        }
      }),
    );
  }

  private seed(doc: vscode.TextDocument): void {
    const rel = relPathFor(doc);
    if (!rel || this.baselines.has(rel)) {
      return;
    }
    const text = doc.getText();
    if (text.length > MAX_TRACKED_DOC_CHARS) {
      return;
    }
    this.baselines.set(rel, text);
  }

  private onChange(e: vscode.TextDocumentChangeEvent): void {
    if (e.contentChanges.length === 0) {
      return;
    }
    const rel = relPathFor(e.document);
    if (!rel) {
      return;
    }
    if (!this.baselines.has(rel)) {
      // Never saw the open event (e.g. doc predates activation with edits
      // in flight) — start trailing from the post-change text.
      this.seed(e.document);
      return;
    }
    const existing = this.pending.get(rel);
    if (existing) {
      clearTimeout(existing.timer);
      existing.timer = setTimeout(
        () => this.flushFile(rel, e.document),
        FLUSH_IDLE_MS,
      );
      return;
    }
    this.pending.set(rel, {
      baseline: this.baselines.get(rel) ?? '',
      timer: setTimeout(() => this.flushFile(rel, e.document), FLUSH_IDLE_MS),
    });
  }

  private flushFile(rel: string, doc: vscode.TextDocument): void {
    const pend = this.pending.get(rel);
    if (!pend) {
      return;
    }
    clearTimeout(pend.timer);
    this.pending.delete(rel);
    if (doc.isClosed) {
      return;
    }
    const current = doc.getText();
    if (current.length > MAX_TRACKED_DOC_CHARS) {
      this.baselines.delete(rel);
      return;
    }
    const diff = computeUnifiedDiff(pend.baseline, current, rel);
    this.baselines.set(rel, current);
    if (diff) {
      pushTrailDiff(this.trails, rel, diff, Date.now());
    }
  }

  /**
   * Snapshot the trails for one Tab request (~0ms, in-memory only).
   * Pending (unflushed) edits stay pending — the request's prefix/suffix
   * already carries the very latest keystrokes.
   */
  snapshot(): GhostDiffHistoryEntry[] {
    return snapshotTrails(this.trails);
  }

  dispose(): void {
    for (const pend of this.pending.values()) {
      clearTimeout(pend.timer);
    }
    this.pending.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
