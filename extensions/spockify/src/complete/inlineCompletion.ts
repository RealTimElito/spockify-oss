/**
 * Inline Tab completions (ghost text) via local heuristics + Ghost mode=complete.
 * Aggressive debounce, abort/supersede in-flight, speculative early fire, LRU cache.
 * Heuristics stay instant; LLM path prioritizes snappy TTFT over waiting.
 */

import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { GhostTrigger, ModelTransport } from '@spockify/ide-client';
import { SpockifyHttpError } from '@spockify/ide-client';
import {
  buildCompleteContext,
  cacheKey,
  normalizeInsertText,
  resolveDebounceMs,
  shouldSkipCompletion,
} from './context';
import { suggestLocalCompletion } from './localHeuristics';
import { recordTabLatency } from './latency';
import { workspaceKeyFromUri } from '../codebase/remoteMeta';
import { DiffHistoryTracker } from './diffHistory';
import { TabRetrievalCache } from './retrievalCache';
import { collapseEditToCursorLine } from './editRender';
import { collectLinterErrors } from './linterContext';
import { FateReporter, FATE_ACCEPT_COMMAND } from './fate';

export type TransportFactory = () => Promise<ModelTransport | undefined>;

/** Cleared stale session / prompt re-sign-in after Tab auth failures. */
export type AuthFailureHandler = () => Promise<void> | void;

interface CacheEntry {
  insert: string;
  at: number;
}

const CACHE_TTL_MS = 45_000;
const CACHE_MAX = 48;

/** requestId per rendered item — read back by the partial-accept hook. */
const itemRequestIds = new WeakMap<vscode.InlineCompletionItem, string>();

/** Avoid toast spam while the user keeps typing. */
const TOAST_COOLDOWN_MS = 60_000;
let lastAuthToastAt = 0;
let lastNetworkToastAt = 0;

function isAuthFailure(err: unknown): boolean {
  if (err instanceof SpockifyHttpError && err.isUnauthorized) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /401|403|Not authenticated|session has expired|Invalid token|token is invalid/i.test(
    msg,
  );
}

export class SpockifyInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  private generation = 0;
  private inflight: AbortController | undefined;
  private readonly cache = new Map<string, CacheEntry>();
  /** Last successful ghost insert — used to avoid flicker on rapid typing. */
  private lastInsert?: string;
  private lastLine?: number;
  private lastLang?: string;
  /** For trigger classification (typing vs line_change vs editor_change). */
  private lastReqDocKey?: string;
  private lastReqLine?: number;

  constructor(
    private readonly getTransport: TransportFactory,
    private readonly output: vscode.OutputChannel,
    private readonly collectors?: {
      diffHistory: DiffHistoryTracker;
      retrieval: TabRetrievalCache;
      fate: FateReporter;
    },
    private readonly onAuthFailure?: AuthFailureHandler,
  ) {}

  /** Visible + Output notice; clears stale token on 401/403. */
  private async reportTabFailure(err: unknown, where: string): Promise<void> {
    const msg = err instanceof Error ? err.message : String(err);
    const auth = isAuthFailure(err);
    this.output.appendLine(`tab-complete error (${where}): ${msg}`);
    const now = Date.now();
    if (auth) {
      this.output.appendLine(
        'tab-complete hint: session expired or invalid token — re-sign in (status bar → Spockify). Email/password recommended after server restore.',
      );
      if (now - lastAuthToastAt >= TOAST_COOLDOWN_MS) {
        lastAuthToastAt = now;
        try {
          await this.onAuthFailure?.();
        } catch {
          /* ignore clear failures */
        }
        const pick = await vscode.window.showWarningMessage(
          'Spockify Tab: signed out (session expired). Sign in again for ghost suggestions.',
          'Sign in',
        );
        if (pick === 'Sign in') {
          await vscode.commands.executeCommand('spockify.signIn');
        }
      }
      return;
    }
    if (now - lastNetworkToastAt >= TOAST_COOLDOWN_MS) {
      lastNetworkToastAt = now;
      void vscode.window.showWarningMessage(
        `Spockify Tab failed: ${msg.slice(0, 160)}`,
      );
    }
  }

  /**
   * Proposed `inlineCompletionsAdditions` hook — the host calls this on
   * partial accepts (accept-next-word / accept-next-line). Safe no-op on
   * hosts that never call it; see fate.ts for the fallback semantics.
   */
  handleDidPartiallyAcceptCompletionItem(
    completionItem: vscode.InlineCompletionItem,
    infoOrLength: number | { acceptedLength?: number },
  ): void {
    const requestId = itemRequestIds.get(completionItem);
    if (!requestId) {
      return;
    }
    const chars =
      typeof infoOrLength === 'number'
        ? infoOrLength
        : (infoOrLength?.acceptedLength ?? 0);
    this.collectors?.fate.partiallyAccepted(requestId, chars);
  }

  private classifyTrigger(
    context: vscode.InlineCompletionContext,
    docKey: string,
    line: number,
  ): GhostTrigger {
    let trigger: GhostTrigger = 'typing';
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke) {
      trigger = 'manual';
    } else if (
      this.lastReqDocKey !== undefined &&
      this.lastReqDocKey !== docKey
    ) {
      trigger = 'editor_change';
    } else if (this.lastReqLine !== undefined && this.lastReqLine !== line) {
      trigger = 'line_change';
    }
    this.lastReqDocKey = docKey;
    this.lastReqLine = line;
    return trigger;
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | undefined> {
    const cfg = vscode.workspace.getConfiguration('spockify');
    if (!cfg.get<boolean>('completions.enabled', true)) {
      return undefined;
    }

    const baseDebounce = cfg.get<number>('completions.debounceMs', 30);
    const adaptive = cfg.get<boolean>('completions.adaptiveDebounce', true);
    const speculative = cfg.get<boolean>('completions.speculative', true);
    const maxLines = cfg.get<number>('completions.maxLines', 8);
    const logLatency = cfg.get<boolean>('completions.logLatency', true);

    const offset = document.offsetAt(position);
    const full = document.getText();
    if (shouldSkipCompletion(full, offset, document.languageId)) {
      return this.maybeReturnLast(document.languageId, position);
    }

    // Instant local heuristics (sequential numbers, missing comma) — no debounce.
    const local = suggestLocalCompletion(full, offset, document.languageId);
    if (local?.insert) {
      if (logLatency) {
        this.output.appendLine(
          `tab-complete local reason=${local.reason} len=${local.insert.length}`,
        );
      }
      this.lastInsert = local.insert;
      this.lastLine = position.line;
      this.lastLang = document.languageId;
      return listFor(local.insert, position);
    }

    // Supersede any prior request immediately (cancel HTTP if possible).
    // Speculative mode: never wait for the previous request — abort + fire new.
    this.inflight?.abort();
    const gen = ++this.generation;
    const ac = new AbortController();
    this.inflight = ac;
    const onCancel = () => ac.abort();
    token.onCancellationRequested(onCancel);

    const openTabs = vscode.window.visibleTextEditors
      .map((e) => e.document.fileName.split(/[/\\]/).pop() || '')
      .filter(Boolean);
    const ctx = buildCompleteContext(full, offset, document.languageId, {
      openTabs,
    });
    let debounceMs = resolveDebounceMs(
      baseDebounce,
      ctx.debounceHint,
      adaptive,
    );
    // Speculative: shave further for fast hints so TTFT starts ASAP.
    if (speculative && ctx.debounceHint === 'fast') {
      debounceMs = Math.min(debounceMs, 20);
    }

    if (debounceMs > 0) {
      await sleep(debounceMs);
    }
    if (
      token.isCancellationRequested ||
      gen !== this.generation ||
      ac.signal.aborted
    ) {
      return this.maybeReturnLast(document.languageId, position);
    }

    // Re-check local after debounce (cursor may have moved into a pattern).
    const localAfter = suggestLocalCompletion(
      document.getText(),
      document.offsetAt(
        vscode.window.activeTextEditor?.document === document
          ? vscode.window.activeTextEditor.selection.active
          : position,
      ),
      document.languageId,
    );
    if (localAfter?.insert) {
      this.lastInsert = localAfter.insert;
      this.lastLine = position.line;
      this.lastLang = document.languageId;
      return listFor(localAfter.insert, position);
    }

    const key = cacheKey(
      document.languageId,
      position.line,
      ctx.prefix.slice(-120),
    );
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      if (logLatency) {
        this.output.appendLine(
          `tab-complete cache hit len=${cached.insert.length} debounce=${debounceMs}ms`,
        );
      }
      return listFor(cached.insert, position);
    }

    const transport = await this.getTransport();
    if (
      !transport ||
      token.isCancellationRequested ||
      gen !== this.generation ||
      ac.signal.aborted
    ) {
      if (!transport) {
        this.output.appendLine(
          'tab-complete skipped: not signed in (Sign in to Spockify — email/password or API key)',
        );
        const now = Date.now();
        if (now - lastAuthToastAt >= TOAST_COOLDOWN_MS) {
          lastAuthToastAt = now;
          void vscode.window
            .showWarningMessage(
              'Spockify Tab: sign in for ghost suggestions.',
              'Sign in',
            )
            .then((pick) => {
              if (pick === 'Sign in') {
                void vscode.commands.executeCommand('spockify.signIn');
              }
            });
        }
      }
      return this.maybeReturnLast(document.languageId, position);
    }

    // Protocol v2 context: everything here is snapshot-from-memory (~0ms).
    // Diff trails and retrieval results are collected continuously in the
    // background; only a cold retrieval cache may wait ≤50ms (budgeted).
    const requestId = crypto.randomUUID();
    const docKey = document.uri.toString();
    const trigger = this.classifyTrigger(_context, docKey, position.line);
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    const workspaceId = folder ? workspaceKeyFromUri(folder.uri) : undefined;
    const relPath = vscode.workspace.asRelativePath(document.uri, false);
    const diffHistory = this.collectors?.diffHistory.snapshot();
    const linterErrors = this.collectors
      ? collectLinterErrors(document, position.line)
      : undefined;
    const contextItems = this.collectors
      ? await this.collectors.retrieval.snapshot(document, position)
      : undefined;
    if (
      token.isCancellationRequested ||
      gen !== this.generation ||
      ac.signal.aborted
    ) {
      return this.maybeReturnLast(document.languageId, position);
    }

    try {
      const t0 = Date.now();
      const res = await transport.ghostSuggest(
        {
          mode: 'complete',
          language: document.languageId,
          filename: document.fileName.split(/[/\\]/).pop() || 'untitled',
          prefix: ctx.prefix,
          suffix: ctx.suffix,
          context: ctx.context || undefined,
          cursor_line: position.line,
          code: ctx.code,
          request_id: requestId,
          workspace_id: workspaceId,
          rel_path: relPath,
          cursor_col: position.character,
          trigger,
          diff_history: diffHistory?.length ? diffHistory : undefined,
          context_items: contextItems?.length ? contextItems : undefined,
          linter_errors: linterErrors?.length ? linterErrors : undefined,
        },
        ac.signal,
      );
      if (
        token.isCancellationRequested ||
        gen !== this.generation ||
        ac.signal.aborted
      ) {
        this.collectors?.fate.ignored(requestId);
        return this.maybeReturnLast(document.languageId, position);
      }

      const latency = Date.now() - t0;
      recordTabLatency(latency);
      const modelHint =
        (typeof res.model === 'string' && res.model) ||
        'gpt-oss-20b';

      if (res.suppress_reason && !res.insert_text && !res.edit) {
        if (logLatency) {
          this.output.appendLine(
            `tab-complete suppressed reason=${res.suppress_reason} ${latency}ms`,
          );
        }
        this.collectors?.fate.ignored(requestId);
        return this.maybeReturnLast(document.languageId, position);
      }

      // Protocol v2 EDIT: replace a line range instead of inserting.
      if (res.mode === 'edit' && res.edit) {
        const rendered = this.renderEdit(document, position, requestId, res.edit);
        if (rendered) {
          if (logLatency) {
            this.output.appendLine(
              `tab-complete ok=${res.ok} mode=edit lines=${res.edit.start_line}-${res.edit.end_line} ${latency}ms · ${modelHint}`,
            );
          }
          return rendered;
        }
        // Fall through: the stable inline-completion API couldn't express
        // this edit (multi-line change away from the cursor, deletion, or
        // prefix mismatch — see editRender.ts). Use insert_text when the
        // server provided one; otherwise the suggestion is dropped.
        if (!res.insert_text && !res.suggestion) {
          this.collectors?.fate.ignored(requestId);
          return this.maybeReturnLast(document.languageId, position);
        }
      }

      const insert = normalizeInsertText(
        res.insert_text || res.suggestion || '',
        ctx.multilinePreferred,
        maxLines,
      );
      if (logLatency) {
        this.output.appendLine(
          `tab-complete ok=${res.ok} mode=${res.mode || '?'} len=${insert.length} ${latency}ms ` +
            `pfx=${ctx.prefix.length} sfx=${ctx.suffix.length} ctx=${ctx.context.length} ` +
            `items=${contextItems?.length ?? 0} lint=${linterErrors?.length ?? 0} diffs=${diffHistory?.length ?? 0} ` +
            `lang=${document.languageId} debounce=${debounceMs}ms multi=${ctx.multilinePreferred} trig=${trigger} · ${modelHint}`,
        );
      }
      if (!insert.trim()) {
        this.collectors?.fate.ignored(requestId);
        return this.maybeReturnLast(document.languageId, position);
      }

      this.cacheSet(key, insert);
      // Keep a stable last ghost to prevent UI flicker when the next
      // keystroke cancels this in-flight request.
      this.lastInsert = insert;
      this.lastLine = position.line;
      this.lastLang = document.languageId;
      this.collectors?.fate.suggestionShown(
        requestId,
        document,
        position.line,
        position.line + (insert.match(/\n/g)?.length ?? 0),
      );
      return listFor(insert, position, requestId);
    } catch (err) {
      this.collectors?.fate.ignored(requestId);
      if (ac.signal.aborted || isAbortError(err)) {
        return this.maybeReturnLast(document.languageId, position);
      }
      await this.reportTabFailure(err, 'suggest');
      return this.maybeReturnLast(document.languageId, position);
    } finally {
      if (this.inflight === ac) {
        this.inflight = undefined;
      }
    }
  }

  /**
   * Render a line-range EDIT as an inline completion when the stable API
   * can express it (single-line replace range at the cursor line — see
   * editRender.ts for the exact constraints).
   */
  private renderEdit(
    document: vscode.TextDocument,
    position: vscode.Position,
    requestId: string,
    edit: { start_line: number; end_line: number; new_text: string },
  ): vscode.InlineCompletionList | undefined {
    const docLines: string[] = [];
    const scanEnd = Math.min(document.lineCount - 1, edit.end_line);
    for (let l = 0; l <= scanEnd; l++) {
      docLines.push(document.lineAt(l).text);
    }
    const collapsed = collapseEditToCursorLine(
      docLines,
      edit,
      position.line,
      position.character,
    );
    if (!collapsed) {
      return undefined;
    }
    const lineLen = document.lineAt(collapsed.line).text.length;
    const item = new vscode.InlineCompletionItem(
      collapsed.insertText,
      new vscode.Range(collapsed.line, 0, collapsed.line, lineLen),
    );
    item.command = {
      command: FATE_ACCEPT_COMMAND,
      title: 'Spockify: report accepted completion',
      arguments: [requestId],
    };
    itemRequestIds.set(item, requestId);
    this.collectors?.fate.suggestionShown(
      requestId,
      document,
      edit.start_line,
      edit.end_line,
    );
    return { items: [item] };
  }

  private cacheSet(key: string, insert: string): void {
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, { insert, at: Date.now() });
  }

  private maybeReturnLast(
    languageId: string,
    position: vscode.Position,
  ): vscode.InlineCompletionList | undefined {
    if (
      !this.lastInsert ||
      this.lastLang !== languageId ||
      this.lastLine !== position.line
    ) {
      return undefined;
    }
    return listFor(this.lastInsert, position);
  }
}

function listFor(
  insert: string,
  position: vscode.Position,
  requestId?: string,
): vscode.InlineCompletionList {
  const item = new vscode.InlineCompletionItem(
    insert,
    new vscode.Range(position, position),
  );
  if (requestId) {
    item.command = {
      command: FATE_ACCEPT_COMMAND,
      title: 'Spockify: report accepted completion',
      arguments: [requestId],
    };
    itemRequestIds.set(item, requestId);
  }
  return { items: [item] };
}

export function registerInlineCompletions(
  context: vscode.ExtensionContext,
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
  opts?: { onAuthFailure?: AuthFailureHandler },
): void {
  const diffHistory = new DiffHistoryTracker();
  const retrieval = new TabRetrievalCache(output);
  const fate = new FateReporter(getTransport, output);
  context.subscriptions.push(diffHistory, retrieval, fate);
  const provider = new SpockifyInlineCompletionProvider(
    getTransport,
    output,
    {
      diffHistory,
      retrieval,
      fate,
    },
    opts?.onAuthFailure,
  );
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: '**' },
      provider,
    ),
  );

  // Warm/preload the Ghost completion model so the first Tab isn't a cold start.
  const warm = vscode.workspace
    .getConfiguration('spockify')
    .get<boolean>('completions.warmOnStartup', true);
  if (warm) {
    void warmGhostModel(getTransport, output, opts?.onAuthFailure);
  }
}

/** Fire-and-forget tiny complete to keep gpt-oss-20b (or GHOST_COMPLETE_MODEL) resident. */
async function warmGhostModel(
  getTransport: TransportFactory,
  output: vscode.OutputChannel,
  onAuthFailure?: AuthFailureHandler,
): Promise<void> {
  try {
    // Small delay so activate() finishes and auth/transport can settle.
    await sleep(1500);
    const transport = await getTransport();
    if (!transport) return;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12_000);
    try {
      const res = await transport.ghostSuggest(
        {
          mode: 'complete',
          language: 'typescript',
          filename: '_warm.ts',
          prefix: 'const x = ',
          suffix: '\n',
          cursor_line: 0,
          code: 'const x = ',
        },
        ac.signal,
      );
      output.appendLine(
        `tab-complete warm ok=${res.ok} model=${res.model || '?'}`,
      );
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (isAbortError(err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    output.appendLine(`tab-complete warm skipped: ${msg}`);
    if (isAuthFailure(err)) {
      const now = Date.now();
      if (now - lastAuthToastAt >= TOAST_COOLDOWN_MS) {
        lastAuthToastAt = now;
        try {
          await onAuthFailure?.();
        } catch {
          /* ignore */
        }
        void vscode.window
          .showWarningMessage(
            'Spockify Tab: session expired — sign in again for ghost suggestions.',
            'Sign in',
          )
          .then((pick) => {
            if (pick === 'Sign in') {
              void vscode.commands.executeCommand('spockify.signIn');
            }
          });
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}
