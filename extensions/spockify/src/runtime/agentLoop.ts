/**
 * IDE agent turn — thin bridge onto @spockify/harness runHarness.
 * Private loop archived at _archive/agentLoop.private.ts (not imported).
 */
import type { ModelTransport } from '@spockify/ide-client';
import type { HarnessSession, PermissionMemory } from '@spockify/harness';
import type { UnifiedToolRegistry } from './unifiedRegistry';
import { getSessionManager } from './sessionManager';
import { contentToString, mapEvent, toHarnessMode } from './agentLoopMap';

type HarnessRuntime = typeof import('@spockify/harness');
type HarnessHost = typeof import('@spockify/harness-host');
type PluginSession = typeof import('./pluginSession');

function loadHarness(): HarnessRuntime {
  // Lazy require: a packaged IDE that omitted this dep must still activate
  // so spockify.chat / spockify.chat.new register.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@spockify/harness') as HarnessRuntime;
}

function loadHarnessHost(): HarnessHost {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@spockify/harness-host') as HarnessHost;
}

function loadPluginSession(): PluginSession {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./pluginSession') as PluginSession;
}

/** Session-scoped grants — one Allow per normalized command until session end. */
const sessionGrants = new Map<string, PermissionMemory>();
import type {
  AgentMessage,
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

function ideToolsToHarness(
  ide: UnifiedToolRegistry,
  deps: AgentRuntimeDeps,
  sessionId: string,
  mode: AgentMode,
): import('@spockify/harness').ToolRegistry {
  const { ToolRegistry } = loadHarness();
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
    const { formatSessionPin, isAutoModelId, PermissionMemory, runHarness } =
      loadHarness();
    const { resolveHarnessOrFallback } = loadHarnessHost();
    const { runIdePlugin } = loadPluginSession();
    const picked = resolveHarnessOrFallback(undefined, cwd);
    const harnessId = picked.harness.id;
    const managed = sessions.get(sessionId);
    if (managed) managed.harnessId = harnessId;
    const think = String(opts.requestExtras?.spockify_thinking || 'off');
    const auto = isAutoModelId?.(opts.model) ?? false;
    const startModel =
      auto && managed?.resolvedModel ? managed.resolvedModel : opts.model;
    const startThink =
      auto && managed?.resolvedThink ? managed.resolvedThink : think;
    const autoHud = auto && !managed?.resolvedModel;
    sessions.setActivityLabel(
      sessionId,
      formatSessionPin({
        harnessId,
        model: startModel,
        thinking: startThink,
        auto: autoHud,
      }),
    );
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
      model: startModel,
    };
    let permissions = sessionGrants.get(sessionId);
    if (!permissions) {
      permissions = new PermissionMemory();
      sessionGrants.set(sessionId, permissions);
    }

    const emit = (event: AgentRuntimeEvent): void => {
      opts.onEvent?.(event);
    };
    emit({ type: 'status', text: 'Running…', status: 'running' });
    if (picked.fallbackReason) {
      emit({ type: 'error', message: picked.fallbackReason });
    }

    try {
      let pluginDone = false;
      if (harnessId !== 'spockify' && !picked.fallbackReason) {
        const plugin = await runIdePlugin({
          harness: picked.harness,
          cwd,
          model: startModel,
          messages: harnessMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          maxTurns: opts.maxTurns,
          signal: opts.signal,
          onEvent: emit,
        });
        if (plugin.ok) {
          pluginDone = true;
          status = 'done';
        } else {
          emit({
            type: 'error',
            message:
              plugin.error ||
              `harness ${harnessId} failed; using Spockify kernel`,
          });
        }
      }
      if (!pluginDone) {
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
          thinking:
            startThink === 'off'
              ? 'off'
              : (startThink as 'low' | 'medium' | 'high' | 'heavy'),
        },
        permissions,
        signal: opts.signal,
        systemPrompt: opts.systemPrompt,
        onEvent: (hev) => {
          if (hev.type === 'status' && hev.text.startsWith('auto → ')) {
            const m = /^auto → (\S+) think=(\S+)/.exec(hev.text);
            if (m && managed) {
              managed.resolvedModel = m[1];
              managed.resolvedThink = m[2];
              session.model = m[1]!;
              sessions.setActivityLabel(
                sessionId,
                formatSessionPin({
                  harnessId,
                  model: m[1]!,
                  thinking: m[2],
                  auto: true,
                }),
              );
            }
          }
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
