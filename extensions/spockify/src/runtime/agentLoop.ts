/**
 * AgentRuntime — unified streaming tool loop for Chat / Composer / Terminal.
 */

import type { ModelTransport } from '@spockify/ide-client';
import type { UnifiedToolRegistry } from './unifiedRegistry';
import {
  formatToolsForPrompt,
  mergeToolCalls,
  parseToolCalls,
} from './parseToolCalls';
import { modeSystemAddon } from './modes';
import { getSessionManager } from './sessionManager';
import type {
  AgentMessage,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeEvent,
  SessionStatus,
  ToolCallRequest,
  ToolExecutionContext,
} from './types';

export interface AgentRuntimeDeps {
  transport: ModelTransport;
  registry: UnifiedToolRegistry;
  strictAllowlist: string[];
  output?: { appendLine(line: string): void };
}

/** OpenAI chat.completions message wire shape (subset). */
export type ApiChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail?: string } }
      >;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
};

function emit(
  opts: AgentRunOptions,
  event: AgentRuntimeEvent,
): void {
  opts.onEvent?.(event);
}

function toOpenAiToolCalls(
  calls: ToolCallRequest[],
): NonNullable<ApiChatMessage['tool_calls']> {
  return calls.map((c) => ({
    id: c.id,
    type: 'function' as const,
    function: {
      name: c.name,
      arguments: JSON.stringify(c.arguments ?? {}),
    },
  }));
}

/**
 * Flatten AgentMessage[] into OpenAI-shaped chat messages.
 * Assistant turns that invoked tools include `tool_calls`; tool results use
 * `role:tool` + `tool_call_id` when id is present (else user-wrapped for OSS).
 */
export function flattenAgentMessagesForApi(
  messages: AgentMessage[],
): ApiChatMessage[] {
  const out: ApiChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const toolText =
        typeof m.content === 'string'
          ? m.content
          : m.content
              .filter(
                (p): p is { type: 'text'; text: string } => p.type === 'text',
              )
              .map((p) => p.text)
              .join('\n');
      // Prefer native OpenAI tool role when id present; else user-wrapped (OSS).
      if (m.toolCallId) {
        out.push({
          role: 'tool',
          content: toolText,
          name: m.name,
          tool_call_id: m.toolCallId,
        });
      } else {
        out.push({
          role: 'user',
          content: `Tool result (${m.name || 'tool'}):\n${toolText}`,
        });
      }
    } else if (m.role === 'assistant') {
      const row: ApiChatMessage = {
        role: 'assistant',
        content:
          typeof m.content === 'string'
            ? m.content
            : m.content
                .filter(
                  (p): p is { type: 'text'; text: string } => p.type === 'text',
                )
                .map((p) => p.text)
                .join('\n'),
      };
      if (m.toolCalls?.length) {
        row.tool_calls = toOpenAiToolCalls(m.toolCalls);
      }
      out.push(row);
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

function upsertNativeCalls(
  acc: Map<string, ToolCallRequest>,
  calls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>,
): void {
  for (const c of calls) {
    if (!c.name) continue;
    const id = c.id || `call_${acc.size}`;
    const prev = acc.get(id);
    acc.set(id, {
      id,
      name: c.name || prev?.name || '',
      arguments:
        c.arguments && Object.keys(c.arguments).length
          ? c.arguments
          : prev?.arguments ?? {},
    });
  }
}

export class AgentRuntime {
  constructor(private readonly deps: AgentRuntimeDeps) {}

  async run(opts: AgentRunOptions): Promise<AgentRunResult> {
    const maxTurns = opts.maxTurns ?? 8;
    const sessions = getSessionManager();
    const sessionId =
      opts.sessionId ?? `sess_${Date.now().toString(36)}`;
    const messages: AgentMessage[] = [...opts.messages];
    let status: SessionStatus = 'running';
    let cancelled = false;
    sessions.setStatus(sessionId, 'running');
    sessions.setMessages(sessionId, messages);

    const tools = this.deps.registry.listForMode(
      opts.mode,
      this.deps.strictAllowlist,
    );
    const toolPrompt = formatToolsForPrompt(
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
        mutates: t.mutates,
      })),
    );

    const systemParts = [
      opts.systemPrompt?.trim(),
      modeSystemAddon(opts.mode),
      toolPrompt,
    ].filter(Boolean);

    // Ensure a single leading system message
    if (!messages.some((m) => m.role === 'system')) {
      messages.unshift({ role: 'system', content: systemParts.join('\n\n') });
    } else {
      const idx = messages.findIndex((m) => m.role === 'system');
      const prev = messages[idx]?.content;
      const prevText =
        typeof prev === 'string'
          ? prev
          : Array.isArray(prev)
            ? prev
                .filter(
                  (p): p is { type: 'text'; text: string } => p.type === 'text',
                )
                .map((p) => p.text)
                .join('\n')
            : '';
      messages[idx] = {
        role: 'system',
        content: `${prevText}\n\n${systemParts.slice(1).join('\n\n')}`,
      };
    }

    emit(opts, { type: 'status', text: 'Running…', status: 'running' });

    try {
      for (let turn = 0; turn < maxTurns; turn++) {
        if (opts.signal?.aborted) {
          cancelled = true;
          status = 'cancelled';
          break;
        }

        // Pause gate: yield between turns until resume (or cancel/abort).
        if (sessions.get(sessionId)?.status === 'paused') {
          emit(opts, {
            type: 'status',
            text: 'Paused — Spockify: Resume Agent Session to continue',
            status: 'paused',
          });
          try {
            await sessions.waitIfPaused(sessionId, opts.signal);
          } catch {
            cancelled = true;
            status = 'cancelled';
            break;
          }
          const afterPause = sessions.get(sessionId);
          if (
            opts.signal?.aborted ||
            afterPause?.status === 'cancelled'
          ) {
            cancelled = true;
            status = 'cancelled';
            break;
          }
          status = 'running';
          sessions.setStatus(sessionId, 'running');
          emit(opts, {
            type: 'status',
            text: 'Resumed…',
            status: 'running',
          });
        }

        emit(opts, {
          type: 'status',
          text: `Turn ${turn + 1}…`,
          status: 'running',
        });

        let assistantText = '';
        const nativeAcc = new Map<string, ToolCallRequest>();
        let pausedMidStream = false;
        let turnModel = opts.model;
        let modelEmitted = false;
        const apiMessages = flattenAgentMessagesForApi(messages);
        const openaiTools = tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters ?? { type: 'object', properties: {} },
          },
        }));

        const streamSignal = sessions.streamSignal(sessionId, opts.signal);
        try {
          for await (const chunk of this.deps.transport.streamChatCompletions(
            {
              model: opts.model,
              messages: apiMessages,
              stream: true,
              ...(opts.requestExtras || {}),
              // Additive: models that honor OpenAI tools may emit native tool_calls.
              ...(openaiTools.length
                ? { tools: openaiTools, tool_choice: 'auto' }
                : {}),
            },
            streamSignal,
          )) {
            if (opts.signal?.aborted) {
              cancelled = true;
              break;
            }
            if (sessions.get(sessionId)?.status === 'paused') {
              pausedMidStream = true;
              break;
            }
            if (chunk.content) {
              assistantText += chunk.content;
              emit(opts, { type: 'text', content: chunk.content });
            }
            if (chunk.model) {
              turnModel = chunk.model;
              if (!modelEmitted) {
                modelEmitted = true;
                emit(opts, { type: 'model', model: turnModel });
              }
            }
            if (chunk.usage) {
              emit(opts, { type: 'usage', usage: chunk.usage });
            }
            if (chunk.toolCalls?.length) {
              upsertNativeCalls(
                nativeAcc,
                chunk.toolCalls.map((tc) => ({
                  id: tc.id,
                  name: tc.name,
                  arguments: tc.arguments,
                })),
              );
            }
            if (chunk.done) break;
          }
        } catch (err) {
          // Soft-pause aborts the fetch; treat as mid-stream pause, not cancel.
          if (
            sessions.get(sessionId)?.status === 'paused' &&
            !opts.signal?.aborted
          ) {
            pausedMidStream = true;
          } else if (opts.signal?.aborted) {
            cancelled = true;
          } else {
            throw err;
          }
        }

        if (pausedMidStream || sessions.get(sessionId)?.status === 'paused') {
          // Keep partial assistant text; skip tools; wait then continue next turn.
          if (assistantText) {
            messages.push({
              role: 'assistant',
              content: assistantText,
              model: turnModel,
            });
            sessions.setMessages(sessionId, messages);
          }
          emit(opts, {
            type: 'status',
            text: 'Paused — stream stopped. Resume to continue',
            status: 'paused',
          });
          try {
            await sessions.waitIfPaused(sessionId, opts.signal);
          } catch {
            cancelled = true;
            status = 'cancelled';
            break;
          }
          if (
            opts.signal?.aborted ||
            sessions.get(sessionId)?.status === 'cancelled'
          ) {
            cancelled = true;
            status = 'cancelled';
            break;
          }
          status = 'running';
          sessions.setStatus(sessionId, 'running');
          emit(opts, {
            type: 'status',
            text: 'Resumed…',
            status: 'running',
          });
          continue;
        }

        if (cancelled || opts.signal?.aborted) {
          cancelled = true;
          status = 'cancelled';
          if (assistantText) {
            messages.push({
              role: 'assistant',
              content: assistantText,
              model: turnModel,
            });
          }
          break;
        }

        // Prefer native SSE tool_calls; merge unique ```tool / hallucinated CLI forms.
        const nativeToolCalls = [...nativeAcc.values()].filter((c) => c.name);
        const calls = mergeToolCalls(
          nativeToolCalls,
          parseToolCalls(assistantText, {
            promoteShellFences: opts.mode !== 'ask',
          }),
        );
        if (nativeToolCalls.length) {
          emit(opts, {
            type: 'status',
            text: `Native tool_calls ×${nativeToolCalls.length}`,
            status: 'running',
          });
          this.deps.output?.appendLine(
            `runtime: native tool_calls=${nativeToolCalls.map((c) => c.name).join(',')}`,
          );
        }

        const assistantMsg: AgentMessage = {
          role: 'assistant',
          content: assistantText,
          model: turnModel,
          ...(calls.length ? { toolCalls: calls } : {}),
        };
        messages.push(assistantMsg);
        sessions.setMessages(sessionId, messages);

        if (!calls.length) {
          status = 'done';
          break;
        }

        for (const call of calls) {
          if (opts.signal?.aborted) {
            cancelled = true;
            status = 'cancelled';
            break;
          }
          if (sessions.get(sessionId)?.status === 'paused') {
            emit(opts, {
              type: 'status',
              text: 'Paused — resume before next tool',
              status: 'paused',
            });
            try {
              await sessions.waitIfPaused(sessionId, opts.signal);
            } catch {
              cancelled = true;
              status = 'cancelled';
              break;
            }
            if (
              opts.signal?.aborted ||
              sessions.get(sessionId)?.status === 'cancelled'
            ) {
              cancelled = true;
              status = 'cancelled';
              break;
            }
            sessions.setStatus(sessionId, 'running');
            emit(opts, {
              type: 'status',
              text: 'Resumed…',
              status: 'running',
            });
          }
          emit(opts, {
            type: 'toolStart',
            id: call.id,
            name: call.name,
            arguments: call.arguments,
          });

          const managed = sessions.get(sessionId);
          const result = await this.deps.registry.call(
            call.name,
            call.arguments,
            {
              signal: opts.signal,
              sessionId,
              mode: opts.mode,
              composerUiMode:
                (managed?.composerUiMode as ToolExecutionContext['composerUiMode']) ||
                undefined,
              planApproved: managed
                ? managed.composerUiMode !== 'plan' ||
                  managed.planApproved === true
                : true,
              output: this.deps.output,
            },
            this.deps.strictAllowlist,
          );

          emit(opts, {
            type: 'toolResult',
            id: call.id,
            name: call.name,
            ok: result.ok,
            content: result.content,
            error: result.error,
            checkpointId: result.checkpointId,
          });

          messages.push({
            role: 'tool',
            name: call.name,
            toolCallId: call.id,
            content: result.ok
              ? result.content
              : `Error: ${result.error || 'failed'}\n${result.content}`,
          });
          sessions.setMessages(sessionId, messages);
        }

        if (cancelled) break;
      }

      if (status === 'running') {
        status = 'done';
      }
    } catch (err) {
      if (opts.signal?.aborted) {
        cancelled = true;
        status = 'cancelled';
      } else {
        status = 'error';
        const message = err instanceof Error ? err.message : String(err);
        emit(opts, { type: 'error', message });
        emit(opts, { type: 'done', cancelled: false });
        sessions.setStatus(sessionId, 'error');
        return { messages, status, cancelled: false, error: message };
      }
    }

    sessions.setStatus(sessionId, status);
    sessions.setMessages(sessionId, messages);
    emit(opts, { type: 'done', cancelled });
    return { messages, status, cancelled };
  }
}

/** Convenience: run a single user turn with optional prior history. */
export async function runAgentTurn(
  deps: AgentRuntimeDeps,
  opts: Omit<AgentRunOptions, 'messages'> & {
    userText: string;
    history?: AgentMessage[];
  },
): Promise<AgentRunResult> {
  const runtime = new AgentRuntime(deps);
  const messages: AgentMessage[] = [...(opts.history ?? [])];
  messages.push({ role: 'user', content: opts.userText });
  return runtime.run({ ...opts, messages });
}
