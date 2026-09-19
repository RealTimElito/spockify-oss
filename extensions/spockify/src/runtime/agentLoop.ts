/**
 * IDE agent turn — thin bridge onto @spockify/harness runHarness.
 * Private loop archived at _archive/agentLoop.private.ts (not imported).
 */
import type { ModelTransport } from '@spockify/ide-client';
import {
  runHarness,
  ToolRegistry,
  type AgentMode as HarnessMode,
  type HarnessEvent,
  type HarnessSession,
} from '@spockify/harness';
import type { UnifiedToolRegistry } from './unifiedRegistry';
import { getSessionManager } from './sessionManager';
import { readActiveHarnessId } from '@spockify/harness-host';
import type {
  AgentMessage,
  AgentContent,
  AgentMode,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeEvent,
  SessionStatus,
} from './types';

export type { ApiChatMessage } from './flattenMessages';
export { flattenAgentMessagesForApi } from './flattenMessages';

export interface AgentRuntimeDeps {
  transport: ModelTransport;
  registry: UnifiedToolRegistry;
  strictAllowlist: string[];
  output?: { appendLine(line: string): void };
  /** Workspace root; defaults to process.cwd(). */
  cwd?: string;
}

function contentToString(content: AgentContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function toHarnessMode(mode: AgentMode): HarnessMode {
  if (mode === 'ask') return 'ask';
  if (mode === 'strict') return 'ask';
  return 'agent';
}

function mapEvent(ev: HarnessEvent): AgentRuntimeEvent | null {
  switch (ev.type) {
    case 'status':
      return { type: 'status', text: ev.text, status: 'running' };
    case 'text':
      return { type: 'text', content: ev.content };
    case 'model':
      return {
        type: 'model',
        model: ev.resolved || ev.requested,
      };
    case 'toolStart':
      return {
        type: 'toolStart',
        id: ev.id,
        name: ev.name,
        arguments: ev.arguments,
      };
    case 'toolResult':
      return {
        type: 'toolResult',
        id: ev.id,
        name: ev.name,
        ok: ev.ok,
        content: ev.content,
        error: ev.error,
      };
    case 'agents':
      return { type: 'agents', run: ev.run };
    case 'done':
      return { type: 'done', cancelled: ev.cancelled };
    case 'error':
      return { type: 'error', message: ev.message };
    default:
      return null;
  }
}

function ideToolsToHarness(
  ide: UnifiedToolRegistry,
  deps: AgentRuntimeDeps,
  sessionId: string,
  mode: AgentMode,
): ToolRegistry {
  const out = new ToolRegistry();
  for (const t of ide.listForMode(mode, deps.strictAllowlist)) {
    out.register(
      {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        mutates: t.mutates,
      },
      async (args, ctx) => {
        const r = await ide.call(
          t.name,
          args,
          {
            signal: ctx.signal,
            sessionId,
            mode,
            output: deps.output,
          },
          deps.strictAllowlist,
        );
        return {
          ok: r.ok,
          content: r.content,
          error: r.error,
        };
      },
    );
  }
  return out;
}

export class AgentRuntime {
  constructor(private readonly deps: AgentRuntimeDeps) {}

  async run(opts: AgentRunOptions): Promise<AgentRunResult> {
    const sessions = getSessionManager();
    const sessionId = opts.sessionId ?? `sess_${Date.now().toString(36)}`;
    let status: SessionStatus = 'running';
    let cancelled = false;
    sessions.setStatus(sessionId, 'running');
    const cwd = this.deps.cwd || process.cwd();
    const harnessId = readActiveHarnessId(cwd);
    const managed = sessions.get(sessionId);
    if (managed) managed.harnessId = harnessId;
    sessions.setActivityLabel(sessionId, `harness:${harnessId}`);
    const harnessRegistry = ideToolsToHarness(
      this.deps.registry,
      this.deps,
      sessionId,
      opts.mode,
    );

    const harnessMessages = opts.messages.map((m) => ({
      role: m.role,
      content: contentToString(m.content),
      toolCallId: m.toolCallId,
      name: m.name,
      toolCalls: m.toolCalls,
    }));

    const session: HarnessSession = {
      messages: harnessMessages,
      tick: 0,
      readSet: [],
      toolLog: [],
      todos: [],
      cwd,
      model: opts.model,
    };

    const emit = (event: AgentRuntimeEvent): void => {
      opts.onEvent?.(event);
    };
    emit({ type: 'status', text: 'Running…', status: 'running' });

    try {
      for await (const ev of runHarness({
        transport: this.deps.transport,
        session,
        registry: harnessRegistry,
        policy: {
          mode: toHarnessMode(opts.mode),
          maxTurns: opts.maxTurns ?? 48,
          yolo: false,
          writeRequiresRead: true,
          editCascade: true,
        },
        signal: opts.signal,
        systemPrompt: opts.systemPrompt,
        onEvent: (hev) => {
          const mapped = mapEvent(hev);
          if (mapped) emit(mapped);
        },
      })) {
        if (opts.signal?.aborted) {
          cancelled = true;
          status = 'cancelled';
          break;
        }
        void ev;
      }
      if (!cancelled) status = 'done';
    } catch (err) {
      if (opts.signal?.aborted) {
        cancelled = true;
        status = 'cancelled';
      } else {
        status = 'error';
        const message = err instanceof Error ? err.message : String(err);
        emit({ type: 'error', message });
        emit({ type: 'done', cancelled: false });
        sessions.setStatus(sessionId, 'error');
        return {
          messages: opts.messages,
          status,
          cancelled: false,
          error: message,
        };
      }
    }

    const outMessages: AgentMessage[] = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
      toolCallId: m.toolCallId,
      name: m.name,
      toolCalls: m.toolCalls,
    }));
    sessions.setStatus(sessionId, status);
    sessions.setMessages(sessionId, outMessages);
    emit({ type: 'done', cancelled });
    return { messages: outMessages, status, cancelled };
  }
}

/** Phase 4: IDE entry — body is runHarness, not a private tool loop. */
export async function runIdeAgentTurn(
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

/** @deprecated Use runIdeAgentTurn — kernel entry is @spockify/harness runAgentTurn */
export const runAgentTurn = runIdeAgentTurn;
