import type { ModelTransport } from '@spockify/ide-client';
import {
  codingChildTimeoutMs,
  codingSpawnCap,
  codingSpawnEnabled,
  formatDoneDigest,
  mergeDigestUserMessage,
  parseSpawnCoding,
  spawnMarkerComplete,
  specsFromTaskCalls,
  stripSpawnCoding,
  timeoutDigest,
  type CodingSpawnSpec,
} from './codingSpawn';
import {
  isAutoModelId,
  isWriteTool,
  pinModelAfterWrite,
  thinkingRequestFields,
} from './catalog';
import {
  pickSessionModel,
  recommendViaTransport,
} from './sessionPicker';
import { DOER_CONTINUE_INJECT, isStructuredDoneOrBlocked } from './doer';
import { LoopDetector } from './loopDetect';
import { ReplayGuard, runToolsParallel } from './parallel';
import { PermissionMemory } from './permissions';
import type { ToolRegistry } from './registry';
import {
  filterChildRegistry,
  killTaskAgent,
  runTaskBash,
  spawnTaskAgent,
} from './taskAgent';
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
  skillBodies?: string[],
): string {
  const skillBlock =
    skillBodies && skillBodies.length
      ? `\nAttached skills:\n${skillBodies.slice(0, 2).join('\n\n')}\n`
      : '';
  if (override?.trim()) {
    const agentsBlock = agentsMd
      ? `\nProject memory (AGENTS.md / .spockify/AGENT.md):\n${agentsMd.slice(0, 12_000)}\n`
      : '';
    return `${override.trim()}\n\nWorking directory: ${cwd}${agentsBlock}${skillBlock}`;
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
${skillBlock}`;
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

function childSystemPrompt(kind: string, goal: string): string {
  return `You are a TaskAgent (${kind}). Complete this goal with tools only. Do not spawn children.\n\n${goal}`;
}

async function runCodingChildren(options: {
  specs: CodingSpawnSpec[];
  transport: ModelTransport;
  registry: ToolRegistry;
  model: string;
  cwd: string;
  yolo: boolean;
  signal?: AbortSignal;
  onEvent?: (e: HarnessEvent) => void;
}): Promise<string> {
  const cap = codingSpawnCap();
  const picked = options.specs.slice(0, cap);
  const timeoutMs = codingChildTimeoutMs();
  const parts: string[] = new Array(picked.length).fill('');
  await Promise.all(
    picked.map(async (spec, i) => {
      const handle = spawnTaskAgent(spec.kind);
      emit(options.onEvent, { type: 'taskSpawn', id: handle.id, kind: spec.kind });
      if (options.signal) {
        if (options.signal.aborted) handle.abort.abort();
        else {
          options.signal.addEventListener(
            'abort',
            () => handle.abort.abort(),
            { once: true },
          );
        }
      }
      const work = (async (): Promise<string> => {
        if (spec.kind === 'bash') {
          const command = spec.command || spec.prompt || 'true';
          const r = await runTaskBash(handle, command, options.cwd, timeoutMs);
          if (r.error === 'blocked:timeout' || handle.abort.signal.aborted) {
            return timeoutDigest(handle.id, spec.kind, command);
          }
          return formatDoneDigest({
            id: handle.id,
            kind: spec.kind,
            prompt: command,
            bash: r,
          });
        }
        const childReg = filterChildRegistry(options.registry, spec.kind);
        const childMessages = await runAgentTurn({
          transport: options.transport,
          registry: childReg,
          model: options.model,
          mode: spec.kind === 'explore' ? 'plan' : 'build',
          messages: [{ role: 'user', content: spec.prompt }],
          cwd: options.cwd,
          yolo: options.yolo,
          maxTurns: 8,
          signal: handle.abort.signal,
          systemPrompt: childSystemPrompt(spec.kind, spec.prompt),
          allowCodingSpawn: false,
        });
        if (handle.abort.signal.aborted) {
          return timeoutDigest(handle.id, spec.kind, spec.prompt);
        }
        return formatDoneDigest({
          id: handle.id,
          kind: spec.kind,
          prompt: spec.prompt,
          messages: childMessages,
        });
      })();
      void work.catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raced = await Promise.race([
          work.then((digest) => ({ timedOut: false as const, digest })),
          new Promise<{ timedOut: true }>((resolve) => {
            timer = setTimeout(() => {
              if (!handle.abort.signal.aborted) handle.abort.abort();
              resolve({ timedOut: true });
            }, timeoutMs);
          }),
        ]);
        parts[i] = raced.timedOut
          ? timeoutDigest(handle.id, spec.kind, spec.prompt)
          : raced.digest;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parts[i] =
          handle.abort.signal.aborted || /abort/i.test(msg)
            ? timeoutDigest(handle.id, spec.kind, spec.prompt)
            : formatDoneDigest({
                id: handle.id,
                kind: spec.kind,
                prompt: spec.prompt,
                bash: { ok: false, content: '', error: msg },
              });
      } finally {
        if (timer) clearTimeout(timer);
        killTaskAgent(handle);
        emit(options.onEvent, { type: 'taskDone', id: handle.id });
      }
    }),
  );
  return parts.filter(Boolean).join('\n\n');
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
  /** Up to 2 skill bodies injected into the system prompt. */
  skillBodies?: string[];
  /** Default: build/agent unless SPOCKIFY_CODING_SPAWN=0. Children must pass false. */
  allowCodingSpawn?: boolean;
  /**
   * When false, a final assistant message with no tool calls ends the turn.
   * Default true for agent/build (injects the coding `done | blocked:policy` nudge once).
   */
  continueOnProse?: boolean;
  /** When true, Auto keeps this think level instead of the picker's. */
  userPinnedThink?: boolean;
}): Promise<AgentMessage[]> {
  const {
    transport,
    registry,
    mode,
    cwd,
    yolo,
    signal,
    confirm,
    onEvent,
    agentsMd,
    askUser,
  } = options;
  let model = options.model;
  let thinking = options.thinking;
  let pinLocked = false;
  let lastResolved = model;
  const maxTurns = resolveCliMaxTurns({
    mode,
    yolo,
    maxTurns: options.maxTurns,
  });
  const readSet = options.readSet || new Set<string>();
  const todos = options.todos || [];
  const permissions = options.permissions || new PermissionMemory();
  const skillBodies = (options.skillBodies || []).slice(0, 2);
  const activeSkills = skillBodies;
  const detector =
    options.loopDetector ||
    new LoopDetector({ window: 20, threshold: 5 });
  const replay = new ReplayGuard();
  const parallelTools = options.parallelTools !== false;
  const doer = !isReadOnlyMode(mode);
  const continueOnProse = doer && options.continueOnProse !== false;
  const allowCodingSpawn =
    options.allowCodingSpawn !== false &&
    codingSpawnEnabled() &&
    !isReadOnlyMode(mode);
  let continueInjected = false;
  let spawnRoundUsed = false;

  const messages: AgentMessage[] = [
    {
      role: 'system',
      content: systemPrompt(
        mode,
        cwd,
        agentsMd,
        options.systemPrompt,
        skillBodies,
      ),
    },
    ...options.messages.filter((m) => m.role !== 'system'),
  ];

  const tools = allowCodingSpawn
    ? registry.openAiTools(mode)
    : registry.openAiTools(mode).filter((t) => t.function.name !== 'task');
  let repairUsed = false;

  if (isAutoModelId(model)) {
    const firstUser = messages.find((m) => m.role === 'user')?.content || '';
    const pin = await pickSessionModel({
      userModel: model,
      userThink: options.userPinnedThink ? thinking : undefined,
      prompt: isReadOnlyMode(mode) ? '' : firstUser,
      recommend:
        isReadOnlyMode(mode) || typeof transport.chatCompletions !== 'function'
          ? undefined
          : (p) => recommendViaTransport(transport, p),
    });
    model = pin.model;
    thinking = pin.think;
    lastResolved = pin.model;
    emit(onEvent, {
      type: 'status',
      text: `auto → ${pin.model} think=${pin.think}`,
    });
    emit(onEvent, {
      type: 'model',
      requested: options.model,
      resolved: pin.model,
    });
  }

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
    let spawnBreak: CodingSpawnSpec[] | null = null;

    try {
      for await (const chunk of transport.streamChatCompletions(
        {
          model,
          messages: toApiMessages(messages) as never,
          stream: true,
          tools: tools.length ? tools : undefined,
          tool_choice: tools.length ? 'auto' : undefined,
          ...thinkingRequestFields(model, thinking),
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
        if (resolved && !pinLocked) lastResolved = resolved;
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
        if (
          allowCodingSpawn &&
          !spawnRoundUsed &&
          spawnMarkerComplete(text)
        ) {
          const specs = parseSpawnCoding(text);
          if (specs.length) {
            spawnBreak = specs;
            break;
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

    if (!toolCalls.length && text && !spawnBreak) {
      for (const fc of parseToolFences(text)) {
        toolCalls.push(fc);
      }
      if (toolCalls.length) {
        text = stripToolFences(text);
      }
    }

    if (
      allowCodingSpawn &&
      !spawnRoundUsed &&
      !spawnBreak &&
      spawnMarkerComplete(text)
    ) {
      const specs = parseSpawnCoding(text);
      if (specs.length) spawnBreak = specs;
    }

    if (allowCodingSpawn && !spawnRoundUsed && spawnBreak?.length) {
      const notes = stripSpawnCoding(text);
      if (notes) messages.push({ role: 'assistant', content: notes });
      const digest = await runCodingChildren({
        specs: spawnBreak,
        transport,
        registry,
        model,
        cwd,
        yolo,
        signal,
        onEvent,
      });
      spawnRoundUsed = true;
      messages.push({
        role: 'user',
        content: mergeDigestUserMessage(digest, notes),
      });
      continue;
    }

    const taskSpecs =
      allowCodingSpawn && !spawnRoundUsed
        ? specsFromTaskCalls(toolCalls)
        : [];
    const otherCalls = toolCalls.filter((c) => c.name !== 'task');
    const spawnedThisTurn = taskSpecs.length > 0;

    if (spawnedThisTurn) {
      const notes = stripSpawnCoding(text);
      messages.push({
        role: 'assistant',
        content: notes,
        toolCalls,
      });
      const digest = await runCodingChildren({
        specs: taskSpecs,
        transport,
        registry,
        model,
        cwd,
        yolo,
        signal,
        onEvent,
      });
      spawnRoundUsed = true;
      const taskCalls = toolCalls.filter((c) => c.name === 'task');
      for (const call of taskCalls) {
        emit(onEvent, {
          type: 'toolStart',
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
        emit(onEvent, {
          type: 'toolResult',
          id: call.id,
          name: call.name,
          ok: true,
          content: digest,
        });
        messages.push({
          role: 'tool',
          name: call.name,
          toolCallId: call.id,
          content: digest,
        });
      }
      if (!otherCalls.length) continue;
      toolCalls.length = 0;
      toolCalls.push(...otherCalls);
      text = notes;
    } else {
      toolCalls.length = 0;
      toolCalls.push(...otherCalls);
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
      if (
        continueOnProse &&
        !continueInjected &&
        !isStructuredDoneOrBlocked(text)
      ) {
        continueInjected = true;
        messages.push({ role: 'user', content: DOER_CONTINUE_INJECT });
        continue;
      }
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
      if (result.ok && isWriteTool(call.name) && !pinLocked) {
        pinLocked = true;
        model = pinModelAfterWrite(model, lastResolved);
      }
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
  permissions?: PermissionMemory;
  onEvent?: (e: HarnessEvent) => void;
}): AsyncGenerator<HarnessEvent, HarnessSession, void> {
  const queue: HarnessEvent[] = [];
  let done = false;
  const push = (e: HarnessEvent) => {
    if (e.type === 'status') {
      const m = /^auto → (\S+) think=(\S+)/.exec(e.text);
      if (m) options.session.model = m[1]!;
    }
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
    userPinnedThink: options.policy.userPinnedThink,
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
    permissions: options.permissions,
    confirm: options.confirm,
    onEvent: push,
    allowCodingSpawn: options.policy.codingSpawn !== false,
    skillBodies: options.session.skillBodies,
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
