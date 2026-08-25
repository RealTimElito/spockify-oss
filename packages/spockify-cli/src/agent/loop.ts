import type { ModelTransport } from '@spockify/ide-client';
import type { ToolRegistry } from './registry';
import type {
  AgentMessage,
  AgentMode,
  AgentRuntimeEvent,
  ToolCallRequest,
} from './types';

function systemPrompt(mode: AgentMode, cwd: string): string {
  const modeBlock =
    mode === 'ask'
      ? `Mode: ASK (read-only). You may use read_file, grep, glob_file_search only. Do not mutate files or run shell.`
      : `Mode: AGENT. You can run shell, edit files, and change the workspace.`;

  return `You are Spockify CLI — a Claude Code–style coding agent running in the user's terminal.

Working directory: ${cwd}

You have tools: read_file, write_file, edit_file, grep, glob_file_search, shell.

CRITICAL — how you work:
- When the user asks you to list, check, run, install, dig, find, fix, or inspect anything on their machine: CALL the shell (or other) tool. Do NOT only paste a command in a markdown code block for them to copy.
- Prefer executing over instructing. Show results from tools, then briefly explain.
- Never say "you can run" / "try this command" when you could call shell yourself.
- Prefer edit_file for small edits; write_file for new files.
- Use grep/glob before guessing paths.
- Keep shell commands focused; do not exfiltrate secrets.
- Be concise after tools finish.

${modeBlock}

If native tool_calls are unavailable, emit a tool fence:
\`\`\`tool
{"name":"shell","arguments":{"command":"microk8s kubectl get pods -A"}}
\`\`\`
`;
}

function emit(
  onEvent: ((e: AgentRuntimeEvent) => void) | undefined,
  event: AgentRuntimeEvent,
): void {
  onEvent?.(event);
}

function toApiMessages(messages: AgentMessage[]) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool' as const,
        content: m.content,
        tool_call_id: m.toolCallId,
        name: m.name,
      };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant' as const,
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function' as const,
          function: {
            name: c.name,
            arguments: JSON.stringify(c.arguments ?? {}),
          },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

let toolIdSeq = 1;
function newId(): string {
  return `call_${Date.now().toString(36)}_${toolIdSeq++}`;
}

/** Parse ```tool JSON fences (OSS models that don't emit native tool_calls). */
export function parseToolFences(text: string): ToolCallRequest[] {
  const out: ToolCallRequest[] = [];
  const fence = /```tool(?:\s+\w+)?\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    const body = (m[1] || '').trim();
    if (!body) continue;
    try {
      const parsed = JSON.parse(body) as {
        name?: string;
        tool?: string;
        arguments?: unknown;
        args?: unknown;
        id?: string;
      };
      const name = parsed.name || parsed.tool;
      if (!name || typeof name !== 'string') continue;
      const argsRaw = parsed.arguments ?? parsed.args ?? {};
      const args =
        argsRaw && typeof argsRaw === 'object' && !Array.isArray(argsRaw)
          ? (argsRaw as Record<string, unknown>)
          : {};
      out.push({ id: parsed.id || newId(), name, arguments: args });
    } catch {
      /* ignore */
    }
  }
  return out;
}

function stripToolFences(text: string): string {
  return text.replace(/```tool(?:\s+\w+)?\s*\n[\s\S]*?```/gi, '').trim();
}

export async function runAgentTurn(options: {
  transport: ModelTransport;
  registry: ToolRegistry;
  model: string;
  mode: AgentMode;
  messages: AgentMessage[];
  cwd: string;
  yolo: boolean;
  maxTurns?: number;
  signal?: AbortSignal;
  confirm?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  onEvent?: (e: AgentRuntimeEvent) => void;
}): Promise<AgentMessage[]> {
  const {
    transport,
    registry,
    model,
    mode,
    cwd,
    yolo,
    signal,
    confirm,
    onEvent,
  } = options;
  const maxTurns = options.maxTurns ?? 12;
  const messages: AgentMessage[] = [
    { role: 'system', content: systemPrompt(mode, cwd) },
    ...options.messages.filter((m) => m.role !== 'system'),
  ];

  const tools = registry.openAiTools(mode);

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal?.aborted) {
      emit(onEvent, { type: 'done', cancelled: true });
      return messages;
    }
    emit(onEvent, { type: 'status', text: `model turn ${turn + 1}` });

    let text = '';
    const toolCalls: ToolCallRequest[] = [];
    const acc = new Map<
      number,
      { id: string; name: string; argumentsRaw: string }
    >();
    let modelAnnounced = false;
    let resolvedAnnounced: string | undefined;

    try {
      for await (const chunk of transport.streamChatCompletions(
        {
          model,
          messages: toApiMessages(messages) as never,
          stream: true,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? 'auto' : undefined,
        },
        signal,
      )) {
        const resolved =
          chunk.workerModel ||
          (chunk.model && chunk.model !== model ? chunk.model : undefined);
        if (!modelAnnounced) {
          emit(onEvent, {
            type: 'model',
            requested: model,
            resolved,
          });
          modelAnnounced = true;
          resolvedAnnounced = resolved;
        } else if (resolved && resolved !== resolvedAnnounced) {
          emit(onEvent, {
            type: 'model',
            requested: model,
            resolved,
          });
          resolvedAnnounced = resolved;
        }
        if (chunk.content) {
          text += chunk.content;
          emit(onEvent, { type: 'text', content: chunk.content });
        }
        if (chunk.toolCalls?.length) {
          for (const [i, tc] of chunk.toolCalls.entries()) {
            acc.set(i, {
              id: tc.id || `call_${i}`,
              name: tc.name || '',
              argumentsRaw:
                tc.argumentsRaw ||
                (tc.arguments && Object.keys(tc.arguments).length
                  ? JSON.stringify(tc.arguments)
                  : ''),
            });
          }
        }
      }
      if (!modelAnnounced) {
        emit(onEvent, { type: 'model', requested: model });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit(onEvent, { type: 'error', message: msg });
      throw err;
    }

    for (const row of [...acc.values()]) {
      if (!row.name) continue;
      let args: Record<string, unknown> = {};
      try {
        args = row.argumentsRaw
          ? (JSON.parse(row.argumentsRaw) as Record<string, unknown>)
          : {};
      } catch {
        args = { raw: row.argumentsRaw };
      }
      toolCalls.push({ id: row.id, name: row.name, arguments: args });
    }

    // Fallback for models that only emit ```tool fences
    if (!toolCalls.length && text) {
      for (const fc of parseToolFences(text)) {
        toolCalls.push(fc);
      }
      if (toolCalls.length) {
        text = stripToolFences(text);
      }
    }

    if (!toolCalls.length) {
      if (text) messages.push({ role: 'assistant', content: text });
      emit(onEvent, { type: 'done' });
      return messages;
    }

    messages.push({
      role: 'assistant',
      content: text,
      toolCalls,
    });

    for (const call of toolCalls) {
      emit(onEvent, {
        type: 'toolStart',
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      });
      const result = await registry.call(call.name, call.arguments, {
        cwd,
        mode,
        yolo,
        signal,
        confirm,
      });
      const content = result.ok
        ? result.content
        : `ERROR: ${result.error || result.content}`;
      emit(onEvent, {
        type: 'toolResult',
        id: call.id,
        name: call.name,
        ok: result.ok,
        content: result.content,
        error: result.error,
      });
      messages.push({
        role: 'tool',
        name: call.name,
        toolCallId: call.id,
        content,
      });
    }
  }

  emit(onEvent, { type: 'status', text: 'max turns reached' });
  emit(onEvent, { type: 'done' });
  return messages;
}
