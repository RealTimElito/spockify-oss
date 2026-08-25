/**
 * Per-chat-tab agent runs — concurrent turns with deterministic tab routing.
 */

import type { ModelTransport } from '@spockify/ide-client';
import type { HostToWebview } from '../chat/protocol';
import type { ChatMessage } from '../chat/types';
import { textFromContent } from '../chat/chatContent';
import {
  formatModelAttribution,
  pickResolvedModel,
} from '../util/modelAttribution';
import {
  costUsdFromUsage,
  formatRoutingHud,
  recordTurnRouting,
} from '../util/routingHud';
import { DisplayStreamFilter } from './displayStreamFilter';
import type { AgentMessage, AgentMode } from './types';
import type { RuntimeHandle } from './register';
import { getSessionManager } from './sessionManager';
import {
  preferTerminalForPrompt,
  shouldAutoSpawnAgentRun,
} from './tools/shellAgentIntent';

function isParallelAgentsModel(model: string): boolean {
  const m = (model || '').toLowerCase();
  return m.includes('spockify-agents');
}

/** Agents button / spockify-agents model, or auto-detect from prompt (Agent/Auto). */
function shouldUseAgentsRunPath(
  model: string,
  mode: AgentMode,
  prompt: string,
): boolean {
  if (isParallelAgentsModel(model)) return true;
  // Ask is read-only — never auto-spawn shell / remote workers.
  if (mode === 'ask') return false;
  return shouldAutoSpawnAgentRun(prompt);
}

function lastUserPrompt(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      const t = textFromContent(messages[i].content).trim();
      if (t) return t;
    }
  }
  return '';
}

/** User green-lit a Plan-mode draft (Cursor plan → execute). */
function looksLikePlanApproval(text: string): boolean {
  const t = (text || '').trim().toLowerCase();
  if (!t || t.length > 200) return false;
  return /^(yes|y|ok|okay|go|go ahead|proceed|implement|execute|do it|lgtm|approve(d)?|ship it|make it so|sounds good|looks good)([.!\s].*)?$/.test(
    t,
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export type ChatTabHostSink = (
  chatTabId: string,
  message: HostToWebview,
) => void;

type TransportFactory = () => Promise<ModelTransport | undefined>;

interface TabRunState {
  chatTabId: string;
  agentSessionId: string;
  abort: AbortController;
  stopPosted: boolean;
  displayFilter: DisplayStreamFilter;
  pendingDelta: string;
  deltaFlushTimer: ReturnType<typeof setTimeout> | undefined;
  messages: ChatMessage[];
  assistantIndex: number;
  requestedModel: string;
  resolvedModel: string;
  costUsd?: number;
}

export interface ChatTabTurnInput {
  chatTabId: string;
  messages: ChatMessage[];
  assistantIndex: number;
  model: string;
  mode: AgentMode;
  /** Cursor-like UI mode (Plan / Debug / Multitask / Ask / Agent). */
  composerUiMode?: 'agent' | 'plan' | 'debug' | 'multitask' | 'ask' | 'strict';
  /** Extra system text for Plan / Debug / Multitask UI modes. */
  uiModeAddon?: string;
  /** Optional extra chat-completions request fields. */
  requestExtras?: Record<string, unknown>;
  getModelTransport?: TransportFactory;
  /** Legacy mock / offline chat transport path. */
  runLegacyTransport?: (
    assistantIndex: number,
    t0: number,
    onChunk: (raw: string, model?: string) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  onPersist: (chatTabId: string, messages: ChatMessage[]) => void;
}

/** True when a stream event should update the visible webview for `viewTabId`. */
export function shouldDeliverStreamToView(
  chatTabId: string | undefined,
  viewTabId: string,
): boolean {
  return !chatTabId || chatTabId === viewTabId;
}

export class ChatTabAgentHost {
  private readonly runs = new Map<string, TabRunState>();
  private sink: ChatTabHostSink | undefined;
  private viewTabId = '';

  setSink(sink: ChatTabHostSink | undefined): void {
    this.sink = sink;
  }

  setViewTabId(id: string): void {
    this.viewTabId = id;
  }

  getViewTabId(): string {
    return this.viewTabId;
  }

  /**
   * Request an inline tool consent UI from the active Chat webview.
   * The webview must respond with `toolConsentResponse` to unblock callers.
   */
  requestToolConsent(
    chatTabId: string,
    request: Omit<
      HostToWebview & { type: 'toolConsentRequest' },
      'chatTabId'
    >,
  ): void {
    // Reuse the existing routing guard by emitting like other stream events.
    this.emit(chatTabId, request as HostToWebview);
  }

  isStreaming(chatTabId: string): boolean {
    return this.runs.has(chatTabId);
  }

  listStreamingTabIds(): string[] {
    return [...this.runs.keys()];
  }

  /** Live messages while a turn is in flight (for tab switches). */
  getLiveMessages(chatTabId: string): ChatMessage[] | undefined {
    return this.runs.get(chatTabId)?.messages;
  }

  cancel(chatTabId: string): boolean {
    const run = this.runs.get(chatTabId);
    if (!run) {
      return getSessionManager().cancelByChatTabId(chatTabId);
    }
    run.stopPosted = true;
    run.abort.abort();
    getSessionManager().cancelByChatTabId(chatTabId);
    return true;
  }

  pause(chatTabId: string): boolean {
    return getSessionManager().pauseByChatTabId(chatTabId);
  }

  resume(chatTabId: string): boolean {
    return getSessionManager().resumeByChatTabId(chatTabId);
  }

  async runTurn(
    input: ChatTabTurnInput,
    runtimeHandle: RuntimeHandle | undefined,
  ): Promise<void> {
    const existing = this.runs.get(input.chatTabId);
    if (existing) {
      existing.abort.abort();
      this.clearRunTimers(existing);
      this.runs.delete(input.chatTabId);
    }

    const abort = new AbortController();
    const run: TabRunState = {
      chatTabId: input.chatTabId,
      agentSessionId: '',
      abort,
      stopPosted: false,
      displayFilter: new DisplayStreamFilter(),
      pendingDelta: '',
      deltaFlushTimer: undefined,
      messages: input.messages,
      assistantIndex: input.assistantIndex,
      requestedModel: input.model,
      resolvedModel: input.model,
    };
    this.runs.set(input.chatTabId, run);

    const assistant = run.messages[input.assistantIndex];
    if (assistant?.role === 'assistant') {
      assistant.model = input.model;
    }

    const t0 = Date.now();
    let firstTokenSent = false;

    this.emit(input.chatTabId, {
      type: 'streamStart',
      chatTabId: input.chatTabId,
      model: input.model,
    });
    this.emitAttribution(run);
    this.emit(input.chatTabId, {
      type: 'status',
      text: 'Generating…',
      chatTabId: input.chatTabId,
    });

    try {
      const live = await input.getModelTransport?.();
      const prompt = lastUserPrompt(
        run.messages.slice(0, input.assistantIndex),
      );
      // Local shell probes need no remote createAgentRun; remote fan-out does.
      const canAgentsPath =
        preferTerminalForPrompt(prompt) || !!live?.createAgentRun;
      if (
        live &&
        canAgentsPath &&
        shouldUseAgentsRunPath(input.model, input.mode, prompt)
      ) {
        await this.runViaAgentsRestApi(
          input,
          live,
          run,
          t0,
          () => {
            firstTokenSent = true;
          },
          () => firstTokenSent,
        );
      } else if (live && runtimeHandle) {
        await this.runViaAgentRuntime(
          input,
          runtimeHandle,
          live,
          run,
          t0,
          () => {
            firstTokenSent = true;
          },
          () => firstTokenSent,
        );
      } else if (input.runLegacyTransport) {
        await input.runLegacyTransport(
          input.assistantIndex,
          t0,
          (raw, model) => {
            if (model) this.applyResolvedModel(run, model);
            if (!firstTokenSent && raw) {
              firstTokenSent = true;
              this.emit(input.chatTabId, {
                type: 'firstToken',
                ms: Date.now() - t0,
                chatTabId: input.chatTabId,
              });
            }
            run.messages[input.assistantIndex].content += raw;
            this.enqueueDelta(run, input.chatTabId, raw);
          },
          abort.signal,
        );
        this.flushPendingDelta(run, input.chatTabId);
        this.flushDisplayTail(run, input.chatTabId);
      } else {
        throw new Error('No model transport available');
      }

      this.flushPendingDelta(run, input.chatTabId);
      this.flushDisplayTail(run, input.chatTabId);
      this.stampAssistantModel(run);

      const latencyMs = Date.now() - t0;
      const attribution = formatModelAttribution(
        run.requestedModel,
        run.resolvedModel,
      );
      const routingHud = formatRoutingHud({
        latencyMs,
        costUsd: run.costUsd,
        at: Date.now(),
      });
      recordTurnRouting({
        latencyMs,
        costUsd: run.costUsd,
        model: run.resolvedModel,
        attribution,
      });

      const aborted = abort.signal.aborted || run.stopPosted;
      // Drop from streaming map *before* terminal webview events so
      // postSessions / history sync cannot re-arm Thinking (stale tab ids).
      this.clearStreamingRun(input.chatTabId, run);
      if (run.stopPosted) {
        this.emit(input.chatTabId, {
          type: 'streamStopped',
          chatTabId: input.chatTabId,
        });
        this.emit(input.chatTabId, {
          type: 'streamDone',
          chatTabId: input.chatTabId,
          model: run.resolvedModel,
          attribution,
          latencyMs,
          costUsd: run.costUsd,
          routingHud,
        });
        input.onPersist(input.chatTabId, run.messages);
        return;
      }
      if (aborted) {
        this.emit(input.chatTabId, {
          type: 'streamStopped',
          chatTabId: input.chatTabId,
        });
      } else {
        this.emit(input.chatTabId, {
          type: 'latency',
          ms: latencyMs,
          chatTabId: input.chatTabId,
        });
        this.emit(input.chatTabId, {
          type: 'status',
          text: `Done · ${routingHud}`,
          chatTabId: input.chatTabId,
        });
      }
      this.emit(input.chatTabId, {
        type: 'streamDone',
        chatTabId: input.chatTabId,
        model: run.resolvedModel,
        attribution,
        latencyMs,
        costUsd: run.costUsd,
        routingHud,
      });
      input.onPersist(input.chatTabId, run.messages);
    } catch (err) {
      this.flushPendingDelta(run, input.chatTabId);
      this.flushDisplayTail(run, input.chatTabId);
      this.stampAssistantModel(run);
      this.clearStreamingRun(input.chatTabId, run);
      if (run.stopPosted || abort.signal.aborted) {
        if (!run.stopPosted) {
          this.emit(input.chatTabId, {
            type: 'streamStopped',
            chatTabId: input.chatTabId,
          });
          this.emit(input.chatTabId, {
            type: 'streamDone',
            chatTabId: input.chatTabId,
            model: run.resolvedModel,
            attribution: formatModelAttribution(
              run.requestedModel,
              run.resolvedModel,
            ),
          });
        }
        input.onPersist(input.chatTabId, run.messages);
        return;
      }
      const message =
        err instanceof Error ? err.message : 'Chat request failed';
      this.emit(input.chatTabId, {
        type: 'streamError',
        message,
        chatTabId: input.chatTabId,
      });
      this.emit(input.chatTabId, {
        type: 'streamDone',
        chatTabId: input.chatTabId,
        model: run.resolvedModel,
        attribution: formatModelAttribution(
          run.requestedModel,
          run.resolvedModel,
        ),
      });
      input.onPersist(input.chatTabId, run.messages);
    } finally {
      this.clearStreamingRun(input.chatTabId, run);
    }
  }

  /** Idempotent: remove tab from streaming set before terminal UI events. */
  private clearStreamingRun(chatTabId: string, run: TabRunState): void {
    if (this.runs.get(chatTabId) === run) {
      this.runs.delete(chatTabId);
    }
    this.clearRunTimers(run);
  }

  private applyResolvedModel(run: TabRunState, model: string): void {
    const next = pickResolvedModel(run.requestedModel, model);
    if (!next || next === run.resolvedModel) return;
    run.resolvedModel = next;
    this.stampAssistantModel(run);
    this.emitAttribution(run);
  }

  private stampAssistantModel(run: TabRunState): void {
    const msg = run.messages[run.assistantIndex];
    if (msg?.role === 'assistant') {
      msg.model = run.resolvedModel;
    }
  }

  private emitAttribution(run: TabRunState): void {
    this.emit(run.chatTabId, {
      type: 'streamModel',
      model: run.resolvedModel,
      attribution: formatModelAttribution(
        run.requestedModel,
        run.resolvedModel,
      ),
      chatTabId: run.chatTabId,
    });
  }

  private async runViaAgentsRestApi(
    input: ChatTabTurnInput,
    live: ModelTransport,
    run: TabRunState,
    t0: number,
    markFirst: () => void,
    hasFirst: () => boolean,
  ): Promise<void> {
    const prompt = lastUserPrompt(run.messages.slice(0, input.assistantIndex));
    if (!prompt) {
      throw new Error('No user prompt for parallel agents');
    }

    // Ping/curl/etc. → local shell workers (Explorer/Analyst cannot ping).
    if (preferTerminalForPrompt(prompt)) {
      const { runLocalShellAgentRun } = await import('./tools/builtins');
      this.emit(input.chatTabId, {
        type: 'status',
        text: 'Local shell agents…',
        chatTabId: input.chatTabId,
      });
      const result = await runLocalShellAgentRun(
        prompt,
        {
          signal: run.abort.signal,
          sessionId: run.agentSessionId || `chat-${input.chatTabId}`,
          mode: input.mode,
        },
        {
          getApplyService: () => {
            throw new Error('apply not used for local shell agents');
          },
          getTransport: async () => live,
        },
      );
      // result.content is full worker stdout (formatAgentRunTranscript), not a
      // card stub — required so the next user turn can see ping latencies etc.
      const text = result.ok
        ? result.content
        : result.content?.trim()
          ? result.content
          : `Local shell agents failed: ${result.error || 'unknown'}`;
      if (!hasFirst()) {
        markFirst();
        this.emit(input.chatTabId, {
          type: 'firstToken',
          ms: Date.now() - t0,
          chatTabId: input.chatTabId,
        });
      }
      run.messages[input.assistantIndex].content += text;
      this.enqueueDelta(run, input.chatTabId, text);
      this.flushPendingDelta(run, input.chatTabId);
      return;
    }

    if (!live.createAgentRun || !live.getAgentRun) {
      throw new Error('Remote agent API unavailable');
    }

    this.emit(input.chatTabId, {
      type: 'status',
      text: 'Starting parallel agents…',
      chatTabId: input.chatTabId,
    });

    const raw = await live.createAgentRun({
      parent_prompt: prompt,
      model: 'spockify-agents',
      synthesize: true,
    });
    const { sanitizeAgentRun } = await import('../agents/agentRunUi');
    const {
      agentRunToCardPayload,
      publishAgentRunToChat,
    } = await import('../agents/agentRunChatBridge');
    let agentRun = sanitizeAgentRun(raw);
    const card = agentRunToCardPayload(agentRun);
    if (card) publishAgentRunToChat(card);
    void import('vscode')
      .then((vs) => vs.commands.executeCommand('spockify.agents.refresh'))
      .catch(() => undefined);

    const terminal = new Set(['done', 'failed', 'cancelled']);
    let stoppedWatching = false;
    while (!terminal.has(agentRun.status)) {
      // Cursor-like: Stop cancels THIS chat turn's wait only — parallel agents
      // keep running (cancel from Agents HUD / Cancel on the activity bar).
      if (run.abort.signal.aborted || run.stopPosted) {
        stoppedWatching = true;
        break;
      }
      try {
        await sleep(1500, run.abort.signal);
      } catch {
        stoppedWatching = true;
        break;
      }
      agentRun = sanitizeAgentRun(await live.getAgentRun(agentRun.id));
      const next = agentRunToCardPayload(agentRun);
      if (next) publishAgentRunToChat(next);
      this.emit(input.chatTabId, {
        type: 'status',
        text: `Parallel agents: ${agentRun.status}`,
        chatTabId: input.chatTabId,
      });
    }

    const { formatAgentRunTranscript } = await import(
      '../agents/agentRunTranscript'
    );
    const summary = formatAgentRunTranscript({
      heading: stoppedWatching
        ? 'Stopped watching parallel agents (run continues in Agents panel — Cancel there to abort workers).'
        : agentRun.status === 'cancelled'
          ? 'Parallel agents run cancelled.'
          : '',
      synthesis: agentRun.synthesis,
      workers: (agentRun.workers || []).map((w) => ({
        name: w.name,
        id: w.id,
        state: w.state,
        result: w.result,
        error: w.error,
      })),
      error: agentRun.error,
    });
    // Prefer a clean user-facing answer: synthesis alone when present.
    const synth = (agentRun.synthesis || '').trim();
    const text = stoppedWatching
      ? summary
      : agentRun.status === 'cancelled'
        ? summary
        : synth || summary;
    if (!hasFirst()) {
      markFirst();
      this.emit(input.chatTabId, {
        type: 'firstToken',
        ms: Date.now() - t0,
        chatTabId: input.chatTabId,
      });
    }
    run.messages[input.assistantIndex].content += text;
    this.enqueueDelta(run, input.chatTabId, text);
    this.flushPendingDelta(run, input.chatTabId);
  }

  private async runViaAgentRuntime(
    input: ChatTabTurnInput,
    runtimeHandle: RuntimeHandle,
    live: ModelTransport,
    run: TabRunState,
    t0: number,
    markFirst: () => void,
    hasFirst: () => boolean,
  ): Promise<void> {
    runtimeHandle.refreshMcpBridge();
    const session = runtimeHandle.sessions.create(
      input.mode,
      'chat',
      input.chatTabId,
    );
    run.agentSessionId = session.id;
    getSessionManager().setComposerUiMode(
      session.id,
      input.composerUiMode || input.mode,
    );
    // Cursor Plan: approve when the user explicitly green-lights execution.
    if (
      input.composerUiMode === 'plan' &&
      looksLikePlanApproval(lastUserPrompt(run.messages))
    ) {
      getSessionManager().approvePlan(session.id);
    }
    getSessionManager().setActivityLabel(session.id, 'Thinking');
    run.abort.signal.addEventListener('abort', () => {
      session.abort.abort();
    });

    const assistantIndex = input.assistantIndex;
    const history: AgentMessage[] = run.messages
      .slice(0, assistantIndex)
      .filter(
        (m) =>
          m.role === 'user' ||
          m.role === 'assistant' ||
          m.role === 'system' ||
          m.role === 'tool',
      )
      .map((m) => ({
        role: m.role as AgentMessage['role'],
        content: m.content,
        name: m.name,
        toolCallId: m.toolCallId,
        toolCalls: m.toolCalls,
        model: m.model,
      }));

    const runtime = runtimeHandle.createRuntime(live);
    runtimeHandle.sessions.setStatus(session.id, 'running');

    const result = await runtime.run({
      model: input.model,
      mode: input.mode,
      systemPrompt: [
        'You are Spockify Chat in VS Code (Cursor-like agent).',
        'You CAN explore the workspace (read_file, grep, list_dir, glob_file_search, codebase_search), ' +
          'use web_search/fetch_url, run real shell via terminal_run, and spawn parallel agents ' +
          'via spockify_create_agent_run ONLY when the user explicitly asks for multiple/parallel agents. ' +
          'Do not claim these capabilities are missing when the tools are listed.',
        'Be careful and thorough. Ground answers in real files — do not invent paths or behavior; prefer local tools over guessing.',
        'For "where is X defined/declared/implemented" or "how does this work" / selection questions: ' +
          'grep or codebase_search first (then read_file), never answer from the selection alone. ' +
          'Cite as startLine:endLine:rel/path or path:line, and put the path on the fence ' +
          '(```start:end:path or ```lang rel/path) — never a bare language fence without a path.',
        'Never say a symbol is undefined or "not in the snippet" without searching the workspace first.',
        'If @codebase / codebase_search hits are thin, empty, or ambiguous: escalate — multiple grep/glob passes with broader queries and synonyms, then read more files. Never claim you cannot browse the repo.',
        'For live web/docs: web_search and fetch_url (Spockify SearXNG + browser fetch, same as spockify.eu).',
        'When the user asks to create or change project files, you MUST call write_file or apply_patch. Prefer COMPLETE file contents after read_file. Unique changed-line snippets are OK (spliced into the file); never send a truncated wipe that deletes the rest. Prefer tools over only showing markdown; if you must show a fix in chat, use a parseable unified diff or ```start:end:path for the changed range.',
        'If you do show a fix in chat, prefer a parseable unified diff, or a path fence with ```start:end:path for the changed range — never paste a short snippet as if it were the whole file.',
        'terminal_run runs shell on the workspace host (Remote SSH included) — use ONLY when a command must execute. ' +
          'command must be real shell argv/script — never markdown headings, plans, or prose. Never for math, explanations, or code reading.',
        'Never invent "terminal_run bash …" prose or markdown Apply blocks instead of calling tools.',
        'Prefer native tool_calls; if text-only, emit ```tool JSON only.',
        'Cite workspace-relative paths only (never HTML like path">path).',
        'Remote SSH: commands run on the remote host with that workspace cwd.',
        input.uiModeAddon?.trim() || '',
      ]
        .filter(Boolean)
        .join(' '),
      messages: history,
      maxTurns: input.mode === 'ask' ? 10 : 20,
      requestExtras: input.requestExtras,
      sessionId: session.id,
      signal: session.abort.signal,
      onEvent: (ev) => {
        const tabId = input.chatTabId;
        if (ev.type === 'model' && ev.model) {
          this.applyResolvedModel(run, ev.model);
        } else if (ev.type === 'usage') {
          const cost = costUsdFromUsage(ev.usage);
          if (cost != null) run.costUsd = cost;
        } else if (ev.type === 'text' && ev.content) {
          if (!hasFirst()) {
            markFirst();
            this.emit(tabId, {
              type: 'firstToken',
              ms: Date.now() - t0,
              chatTabId: tabId,
            });
          }
          run.messages[assistantIndex].content += ev.content;
          this.enqueueDelta(run, tabId, ev.content);
        } else if (ev.type === 'toolStart') {
          this.flushPendingDelta(run, tabId);
          this.flushDisplayTail(run, tabId);
          // No separate generic "status" event here — the webview derives
          // its one-line "current action" (Running: <cmd>, Reading
          // <file>, …) directly from this toolStart event (see
          // toolStatusLine() in chat.js) so it doesn't get clobbered by a
          // less specific "Tool: <name>" line racing in right after.
          this.emit(tabId, {
            type: 'toolStart',
            id: ev.id,
            name: ev.name,
            arguments: ev.arguments,
            chatTabId: tabId,
          });
          void this.noteToolActivity(run.agentSessionId, ev.name, ev.arguments);
        } else if (ev.type === 'toolResult') {
          this.flushPendingDelta(run, tabId);
          this.emit(tabId, {
            type: 'toolResult',
            id: ev.id,
            name: ev.name,
            ok: ev.ok,
            content: ev.content,
            error: ev.error,
            checkpointId: ev.checkpointId,
            chatTabId: tabId,
          });
          getSessionManager().setActivityLabel(
            run.agentSessionId,
            'Thinking',
          );
          // Agent-run tool cards hide raw tool bodies in the webview — promote
          // the finished transcript/synthesis into the assistant bubble so the
          // user gets a plain-text answer (not only worker status chips).
          this.maybeSurfaceAgentRunTranscript(run, tabId, ev.name, ev.ok, ev.content);
        } else if (ev.type === 'status') {
          this.flushPendingDelta(run, tabId);
          this.emit(tabId, {
            type: 'status',
            text: ev.text,
            chatTabId: tabId,
          });
          if (ev.status === 'paused') {
            this.emit(tabId, {
              type: 'sessionPaused',
              paused: true,
              chatTabId: tabId,
            });
          } else if (ev.status === 'running' && /Resumed/i.test(ev.text)) {
            this.emit(tabId, {
              type: 'sessionPaused',
              paused: false,
              chatTabId: tabId,
            });
          }
        } else if (ev.type === 'error') {
          this.emit(tabId, {
            type: 'streamError',
            message: ev.message,
            chatTabId: tabId,
          });
        }
      },
    });

    runtimeHandle.sessions.setStatus(
      session.id,
      result.cancelled ? 'cancelled' : result.status,
    );

    const shaped = result.messages
      .filter((m) => m.role !== 'system')
      .map(
        (m): ChatMessage => ({
          role: m.role,
          content: m.content,
          name: m.name,
          toolCallId: m.toolCallId,
          toolCalls: m.toolCalls,
          model:
            m.model ||
            (m.role === 'assistant' ? run.resolvedModel : undefined),
        }),
      );
    if (shaped.length) {
      run.messages = shaped;
      for (let i = run.messages.length - 1; i >= 0; i--) {
        if (run.messages[i].role === 'assistant') {
          run.assistantIndex = i;
          break;
        }
      }
    } else {
      const lastAssistant = [...result.messages]
        .reverse()
        .find((m) => m.role === 'assistant');
      if (lastAssistant?.content && !run.messages[assistantIndex]?.content) {
        run.messages[assistantIndex].content = lastAssistant.content;
      }
      if (lastAssistant?.model) {
        this.applyResolvedModel(run, lastAssistant.model);
      }
    }
    // Tool results are role=tool; webview hides create_agent_run bodies. Fold
    // finished transcripts into the last assistant message for history + UI.
    this.promoteAgentRunTranscripts(run, input.chatTabId);
    this.stampAssistantModel(run);
  }

  /**
   * Status-bar activity + soft-reveal of files the agent is about to edit.
   * preserveFocus so the chat composer stays usable mid-turn.
   */
  private async noteToolActivity(
    agentSessionId: string,
    name: string,
    args: Record<string, unknown> | undefined,
  ): Promise<void> {
    const {
      openWorkspaceFile,
      pathFromMutatingToolArgs,
    } = await import('../chat/openWorkspaceFile');
    const pathHint = pathFromMutatingToolArgs(name, args);
    const base = pathHint
      ? pathHint.split(/[/\\]/).pop() || pathHint
      : undefined;
    let label: string | undefined;
    if (name === 'write_file' || name === 'apply_patch') {
      label = base ? `Editing ${base}` : 'Applying edits';
    } else if (name === 'read_file') {
      label = base ? `Reading ${base}` : 'Reading';
    } else if (name === 'terminal_run') {
      label = 'Running terminal';
    } else if (
      name === 'spockify_create_agent_run' ||
      name === 'create_agent_run'
    ) {
      label = 'Spawning agents';
    } else if (name) {
      label = name.replace(/_/g, ' ');
    }
    getSessionManager().setActivityLabel(agentSessionId, label);
    if (
      pathHint &&
      (name === 'write_file' || name === 'apply_patch' || name === 'read_file')
    ) {
      try {
        await openWorkspaceFile(pathHint, {
          preserveFocus: true,
          quiet: true,
        });
      } catch {
        /* ignore reveal failures mid-turn */
      }
    }
  }

  /**
   * When create_agent_run finishes, stream its transcript into the assistant
   * message. The webview suppresses AGENT_RUN_TOOLS bodies (card-only UX).
   */
  private maybeSurfaceAgentRunTranscript(
    run: TabRunState,
    chatTabId: string,
    toolName: string | undefined,
    ok: boolean | undefined,
    content: string | undefined,
  ): void {
    const name = (toolName || '').toLowerCase();
    if (
      name !== 'spockify_create_agent_run' &&
      name !== 'create_agent_run'
    ) {
      return;
    }
    if (!ok) return;
    const body = (content || '').trim();
    if (!body || body.startsWith('{')) return;
    const text = `\n\n${body}\n`;
    const idx = run.assistantIndex;
    if (run.messages[idx]?.role === 'assistant') {
      const prev =
        typeof run.messages[idx].content === 'string'
          ? run.messages[idx].content
          : '';
      if (prev.includes(body.slice(0, Math.min(120, body.length)))) {
        return;
      }
      run.messages[idx].content = prev + text;
    }
    this.enqueueDelta(run, chatTabId, text);
    this.flushPendingDelta(run, chatTabId);
  }

  /** After agent loop reshape, keep synthesis in the assistant bubble + history. */
  private promoteAgentRunTranscripts(run: TabRunState, chatTabId: string): void {
    const toolBodies = run.messages
      .filter(
        (m) =>
          m.role === 'tool' &&
          (m.name === 'spockify_create_agent_run' ||
            m.name === 'create_agent_run'),
      )
      .map((m) =>
        typeof m.content === 'string' ? m.content.trim() : '',
      )
      .filter((t) => t && !t.startsWith('{'));
    if (!toolBodies.length) return;
    let assistantIdx = -1;
    for (let i = run.messages.length - 1; i >= 0; i--) {
      if (run.messages[i].role === 'assistant') {
        assistantIdx = i;
        break;
      }
    }
    if (assistantIdx < 0) return;
    run.assistantIndex = assistantIdx;
    const assistant = run.messages[assistantIdx];
    for (const body of toolBodies) {
      const needle = body.slice(0, Math.min(120, body.length));
      const prev =
        typeof assistant.content === 'string' ? assistant.content : '';
      if (prev.includes(needle)) continue;
      const text = `\n\n${body}\n`;
      assistant.content = prev + text;
      this.enqueueDelta(run, chatTabId, text);
    }
    this.flushPendingDelta(run, chatTabId);
  }

  private enqueueDelta(
    run: TabRunState,
    chatTabId: string,
    raw: string,
  ): void {
    const content = run.displayFilter.push(raw);
    if (!content) return;
    run.pendingDelta += content;
    if (run.deltaFlushTimer) return;
    run.deltaFlushTimer = setTimeout(() => {
      run.deltaFlushTimer = undefined;
      this.flushPendingDelta(run, chatTabId);
    }, 16);
  }

  private flushDisplayTail(run: TabRunState, chatTabId: string): void {
    const tail = run.displayFilter.flush();
    if (tail) {
      run.pendingDelta += tail;
      this.flushPendingDelta(run, chatTabId);
    }
  }

  private flushPendingDelta(run: TabRunState, chatTabId: string): void {
    this.clearDeltaTimer(run);
    if (!run.pendingDelta) return;
    const chunk = run.pendingDelta;
    run.pendingDelta = '';
    this.emit(chatTabId, {
      type: 'streamDelta',
      content: chunk,
      chatTabId,
    });
  }

  private clearDeltaTimer(run: TabRunState): void {
    if (run.deltaFlushTimer) {
      clearTimeout(run.deltaFlushTimer);
      run.deltaFlushTimer = undefined;
    }
  }

  private clearRunTimers(run: TabRunState): void {
    this.clearDeltaTimer(run);
  }

  private emit(chatTabId: string, message: HostToWebview): void {
    const withTab = { ...message, chatTabId } as HostToWebview;
    this.sink?.(chatTabId, withTab);
  }
}

let sharedHost: ChatTabAgentHost | undefined;

export function getChatTabAgentHost(): ChatTabAgentHost {
  if (!sharedHost) {
    sharedHost = new ChatTabAgentHost();
  }
  return sharedHost;
}

export function resetChatTabAgentHostForTests(): void {
  sharedHost = undefined;
}
