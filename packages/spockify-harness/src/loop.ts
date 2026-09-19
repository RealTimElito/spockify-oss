import type { ModelTransport } from '@spockify/ide-client';
import { LoopDetector } from './loopDetect';
import { ReplayGuard, runToolsParallel } from './parallel';
import { PermissionMemory } from './permissions';
import type { ToolRegistry } from './registry';
import {
  isReadOnlyMode,
  normalizeMode,
  type AgentMessage,
  type AgentMode,
  type HarnessEvent,
  type HarnessPolicy,
  type HarnessSession,
  type ThinkingEffort,
  type TodoItem,
  type ToolCallRequest,
} from './types';

/** Agent default horizon (matches IDE spockify.agent.maxTurns). */
export const DEFAULT_AGENT_MAX_TURNS = 48;
/** YOLO / long-horizon eval-style budget. */
export const DEFAULT_YOLO_MAX_TURNS = 80;
export const AGENT_MAX_TURNS_HARD_CAP = 80;
export const DEFAULT_ASK_MAX_TURNS = 12;

export function resolveCliMaxTurns(opts: {
  mode: AgentMode;
  yolo: boolean;
  maxTurns?: number;
}): number {
  if (typeof opts.maxTurns === 'number' && Number.isFinite(opts.maxTurns) && opts.maxTurns > 0) {
    return Math.min(AGENT_MAX_TURNS_HARD_CAP, Math.max(1, Math.floor(opts.maxTurns)));
  }
  const fromEnv = Number(process.env.SPOCKIFY_MAX_TURNS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.min(AGENT_MAX_TURNS_HARD_CAP, Math.max(1, Math.floor(fromEnv)));
  }
  if (isReadOnlyMode(opts.mode)) return DEFAULT_ASK_MAX_TURNS;
  if (opts.yolo) return DEFAULT_YOLO_MAX_TURNS;
  return DEFAULT_AGENT_MAX_TURNS;
}

function systemPrompt(
  mode: AgentMode,
  cwd: string,
  agentsMd?: string,
  override?: string,
): string {
  if (override?.trim()) {
    const agentsBlock = agentsMd
      ? `\nProject memory (AGENTS.md / .spockify/AGENT.md):\n${agentsMd.slice(0, 12_000)}\n`
      : '';
    return `${override.trim()}\n\nWorking directory: ${cwd}${agentsBlock}`;
  }
  const readOnly = isReadOnlyMode(mode);
  const modeBlock = readOnly
    ? `Mode: PLAN/ASK (read-only). You may use read/read_file, grep, glob/glob_file_search only. No WRITE, shell, or apply_patch.`
    : `Mode: BUILD/AGENT. Prefer apply_patch (SEARCH/REPLACE) over raw dumps. Use grep/glob/read-range instead of cat/ls thrash.
After edits: call run_tests (or shell pytest). On red: repair with fail-object, or git_reset.
Do not claim done without green evidence.`;

  const agentsBlock = agentsMd
    ? `\nProject memory (AGENTS.md / .spockify/AGENT.md):\n${agentsMd.slice(0, 12_000)}\n`
    : '';

  return `You are Spockify — an OpenCode-shaped coding agent in the user's terminal.

Working directory: ${cwd}
${agentsBlock}
Tools: read, grep, glob, apply_patch, bash/shell, run_tests, git_snapshot, git_reset, todowrite, write_file, edit_file.

CRITICAL:
- Prefer executing tools over pasting commands for the user.
- Prefer apply_patch SEARCH/REPLACE; unified diffs are rejected.
- Prefer grep/glob/read with line ranges over unbounded cat/ls.
- Keep shell focused; do not exfiltrate secrets.
- Be concise after tools finish.

${modeBlock}

If native tool_calls are unavailable, emit a tool fence:
\`\`\`tool
{"name":"shell","arguments":{"command":"pytest -q"}}
\`\`\`
`;
}

function emit(
  onEvent: ((e: HarnessEvent) => void) | undefined,
  event: HarnessEvent,
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

/** One repair turn when model emits a markdown command fence with zero tool_calls. */
export function maybeFenceRepairHint(text: string, toolCalls: ToolCallRequest[]): string | null {
  if (toolCalls.length) return null;
  if (/```(?:bash|sh|shell|zsh)\s*\n[\s\S]*?```/i.test(text)) {
    return (
      'That was not a tool call. Emit a real tool call now ' +
      '(native tool_calls or a ```tool JSON fence), do not only paste a shell fence.'
    );
  }
  return null;
}

export async function runAgentTurn(options: {
  transport: ModelTransport;
  registry: ToolRegistry;
  model: string;
  mode: AgentMode;
  thinking?: ThinkingEffort;
  messages: AgentMessage[];
  cwd: string;
  yolo: boolean;
  maxTurns?: number;
  signal?: AbortSignal;
  agentsMd?: string;
  /** When set, replaces the default harness system prompt body. */
  systemPrompt?: string;
  todos?: TodoItem[];
  readSet?: Set<string>;
  parallelTools?: boolean;
  permissions?: PermissionMemory;
  writeRequiresRead?: boolean;
  loopDetector?: LoopDetector;
  confirm?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  askUser?: (prompt: string) => Promise<string>;
  onEvent?: (e: HarnessEvent) => void;
}): Promise<AgentMessage[]> {
  const {
    transport,
    registry,
    model,
    mode,
    thinking,
    cwd,
    yolo,
    signal,
    confirm,
    onEvent,
    agentsMd,
    askUser,
  } = options;
  const maxTurns = resolveCliMaxTurns({
    mode,
    yolo,
    maxTurns: options.maxTurns,
  });
  const readSet = options.readSet || new Set<string>();
  const todos = options.todos || [];
  const permissions = options.permissions || new PermissionMemory();
  const activeSkills: string[] = [];
  const detector =
    options.loopDetector ||
    new LoopDetector({ window: 20, threshold: 5 });
  const replay = new ReplayGuard();
  const parallelTools = options.parallelTools !== false;

  const messages: AgentMessage[] = [
    {
      role: 'system',
      content: systemPrompt(mode, cwd, agentsMd, options.systemPrompt),
    },
    ...options.messages.filter((m) => m.role !== 'system'),
  ];

  const tools = registry.openAiTools(mode);
  let repairUsed = false;

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
          ...(thinking && thinking !== 'off'
            ? { spockify_thinking: thinking }
            : {}),
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
        if (chunk.spockifyAgents) {
          emit(onEvent, { type: 'agents', run: chunk.spockifyAgents });
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

    if (!toolCalls.length && text) {
      for (const fc of parseToolFences(text)) {
        toolCalls.push(fc);
      }
      if (toolCalls.length) {
        text = stripToolFences(text);
      }
    }

    if (!toolCalls.length) {
      const hint = !repairUsed ? maybeFenceRepairHint(text, toolCalls) : null;
      if (hint) {
        repairUsed = true;
        if (text) messages.push({ role: 'assistant', content: text });
        messages.push({ role: 'user', content: hint });
        continue;
      }
      if (text) messages.push({ role: 'assistant', content: text });
      emit(onEvent, { type: 'done' });
      return messages;
    }

    messages.push({
      role: 'assistant',
      content: text,
      toolCalls,
    });

    const accepted: ToolCallRequest[] = [];
    for (const call of toolCalls) {
      if (signal?.aborted) {
        emit(onEvent, { type: 'toolKilled', id: call.id, name: call.name });
        emit(onEvent, { type: 'done', cancelled: true });
        return messages;
      }
      const replayErr = replay.check(call.id);
      if (replayErr) {
        emit(onEvent, {
          type: 'toolResult',
          id: call.id,
          name: call.name,
          ok: false,
          content: '',
          error: replayErr,
        });
        messages.push({
          role: 'tool',
          name: call.name,
          toolCallId: call.id,
          content: `ERROR: ${replayErr}`,
        });
        continue;
      }
      emit(onEvent, {
        type: 'toolStart',
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      });
      accepted.push(call);
    }

    const ctx = {
      cwd,
      mode,
      yolo,
      signal,
      confirm,
      readSet,
      todos,
      permissions,
      activeSkills,
      writeRequiresRead: options.writeRequiresRead !== false,
      askUser,
      onEvent,
    };

    const outcomes = await runToolsParallel(accepted, registry, ctx, {
      parallel: parallelTools,
    });

    for (const { call, result } of outcomes) {
      if (signal?.aborted) {
        emit(onEvent, { type: 'toolKilled', id: call.id, name: call.name });
        emit(onEvent, { type: 'done', cancelled: true });
        return messages;
      }
      const content = result.ok
        ? result.content
        : `ERROR: ${result.error || result.content}`;
      const sig = detector.signature(call.name, call.arguments, content);
      const count = detector.observe(sig);
      if (detector.shouldWarn(count)) {
        emit(onEvent, { type: 'loopWarning', signature: sig, count });
      }
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

/**
 * Frozen kernel API. CLI / IDE / lab must share this stream.
 * Router never executes workspace tools (decision record).
 */
export async function* runHarness(options: {
  transport: ModelTransport;
  session: HarnessSession;
  registry: ToolRegistry;
  policy: HarnessPolicy;
  signal?: AbortSignal;
  agentsMd?: string;
  systemPrompt?: string;
  confirm?: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;
  onEvent?: (e: HarnessEvent) => void;
}): AsyncGenerator<HarnessEvent, HarnessSession, void> {
  const queue: HarnessEvent[] = [];
  let done = false;
  const push = (e: HarnessEvent) => {
    queue.push(e);
    options.onEvent?.(e);
  };

  const readSet = new Set(options.session.readSet);
  const todos = options.session.todos.slice();
  const mode = options.policy.mode;
  const yolo = Boolean(options.policy.yolo);
  const detector = new LoopDetector({
    window: options.policy.loopWindow ?? 20,
    threshold: options.policy.loopThreshold ?? 5,
  });

  const runPromise = runAgentTurn({
    transport: options.transport,
    registry: options.registry,
    model: options.session.model,
    mode,
    thinking: options.policy.thinking,
    messages: options.session.messages,
    cwd: options.session.cwd,
    yolo,
    maxTurns: options.policy.maxTurns,
    signal: options.signal,
    agentsMd: options.agentsMd,
    systemPrompt: options.systemPrompt,
    todos,
    readSet,
    parallelTools: options.policy.parallelTools !== false,
    writeRequiresRead: options.policy.writeRequiresRead !== false,
    loopDetector: detector,
    confirm: options.confirm,
    onEvent: push,
  }).then((messages) => {
    done = true;
    return messages;
  });

  while (!done || queue.length) {
    if (queue.length) {
      yield queue.shift()!;
      continue;
    }
    await new Promise((r) => setTimeout(r, 5));
  }

  const messages = await runPromise;
  options.session.messages = messages.filter((m) => m.role !== 'system');
  options.session.tick += 1;
  options.session.readSet = [...readSet];
  options.session.todos = todos;
  return options.session;
}

export { normalizeMode, isReadOnlyMode };
