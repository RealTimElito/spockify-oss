/**
 * Suggestion "fate" reporting (protocol v2): every Tab suggestion is keyed by
 * a client-generated request_id and its outcome — accepted / partial /
 * rejected / ignored — is POSTed fire-and-forget to /ghost/fate.
 *
 * Detection strategy per outcome:
 * - accepted: the InlineCompletionItem's `command` fires on commit (stable
 *   VS Code API — commands attached to inline items run after insertion).
 * - partial: `handleDidPartiallyAcceptCompletionItem` on the provider
 *   (proposed `inlineCompletionsAdditions` API). If the host build doesn't
 *   call the hook, partial accepts settle as accepted (when the user commits
 *   the rest) or rejected (when they type away) — a known fallback.
 * - rejected: the suggestion was shown but superseded — a newer suggestion
 *   replaced it, the document changed without a commit, or the editor lost
 *   focus. VS Code has no "dismissed" event, so supersession is the signal.
 * - ignored: the request resolved but the suggestion was never shown
 *   (aborted in flight, empty/suppressed response, stale generation).
 *
 * ~1.5s after a fate settles, the affected lines are re-read as settled_text
 * so the router can learn what the code actually converged to.
 */

import * as vscode from 'vscode';
import type {
  GhostFate,
  GhostFateRequest,
  ModelTransport,
} from '@spockify/ide-client';

export const FATE_ACCEPT_COMMAND = 'spockify.completions.fateAccept';

const SETTLE_DELAY_MS = 1500;
const SETTLED_TEXT_MAX_CHARS = 500;
const MAX_PENDING = 64;

interface ShownSuggestion {
  requestId: string;
  docKey: string;
  startLine: number;
  endLine: number;
  shownAt: number;
  partialChars?: number;
}

type TransportFactory = () => Promise<ModelTransport | undefined>;

function telemetryEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('spockify')
    .get<boolean>('completions.telemetry', true);
}

export class FateReporter implements vscode.Disposable {
  /** Currently shown, unresolved suggestion per document. */
  private readonly shown = new Map<string, ShownSuggestion>();
  private readonly byRequestId = new Map<string, ShownSuggestion>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;

  constructor(
    private readonly getTransport: TransportFactory,
    private readonly output?: vscode.OutputChannel,
  ) {
    this.disposables.push(
      vscode.commands.registerCommand(
        FATE_ACCEPT_COMMAND,
        (requestId: unknown) => {
          if (typeof requestId === 'string') {
            this.accepted(requestId);
          }
        },
      ),
      // Switching editors abandons whatever ghost was showing there.
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        const activeKey = editor?.document.uri.toString();
        for (const [docKey, s] of [...this.shown]) {
          if (docKey !== activeKey) {
            this.resolve(s, s.partialChars ? 'partial' : 'rejected', true);
          }
        }
      }),
    );
  }

  /** A request finished but its suggestion never reached the screen. */
  ignored(requestId: string): void {
    this.enqueue({
      request_id: requestId,
      fate: 'ignored',
      seen: false,
      client_ts: Date.now(),
    });
  }

  /**
   * A suggestion was returned to the editor. An earlier unresolved one on
   * the same document is superseded → rejected (or partial if partially
   * accepted before being replaced).
   */
  suggestionShown(
    requestId: string,
    document: vscode.TextDocument,
    startLine: number,
    endLine: number,
  ): void {
    const docKey = document.uri.toString();
    const prev = this.shown.get(docKey);
    if (prev && prev.requestId !== requestId) {
      this.resolve(prev, prev.partialChars ? 'partial' : 'rejected', true);
    }
    if (this.shown.size >= MAX_PENDING) {
      // Leak guard — drop the oldest without reporting.
      const oldest = this.shown.keys().next().value;
      if (oldest !== undefined) {
        const s = this.shown.get(oldest);
        this.shown.delete(oldest);
        if (s) this.byRequestId.delete(s.requestId);
      }
    }
    const record: ShownSuggestion = {
      requestId,
      docKey,
      startLine,
      endLine,
      shownAt: Date.now(),
    };
    this.shown.set(docKey, record);
    this.byRequestId.set(requestId, record);
  }

  accepted(requestId: string): void {
    const s = this.byRequestId.get(requestId);
    if (s) {
      this.resolve(s, 'accepted', true);
    }
  }

  /** From handleDidPartiallyAcceptCompletionItem (when the host calls it). */
  partiallyAccepted(requestId: string, acceptedChars: number): void {
    const s = this.byRequestId.get(requestId);
    if (s) {
      s.partialChars = Math.max(s.partialChars ?? 0, acceptedChars);
    }
  }

  private resolve(s: ShownSuggestion, fate: GhostFate, seen: boolean): void {
    this.shown.delete(s.docKey);
    this.byRequestId.delete(s.requestId);
    const event: GhostFateRequest = {
      request_id: s.requestId,
      fate,
      seen,
      client_ts: Date.now(),
    };
    if (s.partialChars) {
      event.partial_accept_chars = s.partialChars;
    }
    // Delay the send so settled_text reflects post-fate reality.
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      event.settled_text = this.readSettledText(s);
      this.enqueue(event);
    }, SETTLE_DELAY_MS);
    this.timers.add(timer);
  }

  private readSettledText(s: ShownSuggestion): string | undefined {
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === s.docKey,
    );
    if (!doc || doc.isClosed) {
      return undefined;
    }
    const start = Math.min(s.startLine, doc.lineCount - 1);
    const end = Math.min(s.endLine, doc.lineCount - 1);
    const lines: string[] = [];
    for (let l = start; l <= end; l++) {
      lines.push(doc.lineAt(l).text);
    }
    return lines.join('\n').slice(0, SETTLED_TEXT_MAX_CHARS) || undefined;
  }

  /** Fire-and-forget: never blocks typing, silently drops on any failure. */
  private enqueue(event: GhostFateRequest): void {
    if (this.disposed || !telemetryEnabled()) {
      return;
    }
    void (async () => {
      try {
        const transport = await this.getTransport();
        await transport?.ghostFate?.(event);
      } catch {
        // Older routers have no /ghost/fate; network may be down. Drop.
      }
    })();
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) {
      clearTimeout(t);
    }
    this.timers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
