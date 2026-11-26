/**
 * IDE Swarm bridge. Kept out of agentLoop.ts so that file stays a thin
 * runHarness adapter.
 */
import type { ModelTransport } from '@spockify/ide-client';
import type {
  HarnessEvent,
  PermissionMemory,
  ToolRegistry,
} from '@spockify/harness';
import { getSessionManager } from './sessionManager';
import type {
  AgentMessage,
  AgentRunOptions,
  AgentRunResult,
  AgentRuntimeEvent,
} from './types';
import type { AgentRuntimeDeps } from './agentLoop';

type HarnessRuntime = typeof import('@spockify/harness');

function loadHarness(): HarnessRuntime {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@spockify/harness') as HarnessRuntime;
}

type SwarmApi = HarnessRuntime & {
  runSwarm?: (opts: {
    transport: ModelTransport;
    registry: ToolRegistry;
    model: string;
    cwd: string;
    userPrompt: string;
    permissions?: PermissionMemory;
    signal?: AbortSignal;
    thinking?: unknown;
    yolo?: boolean;
    control?: { cancel(id: string): boolean };
    onWorker?: AgentRunOptions['onSwarmWorker'];
    onEvent?: (event: HarnessEvent) => void;
    askUser?: (prompt: string) => Promise<string>;
  }) => Promise<{
    kind: string;
    transcript: string;
    workers: Array<{
      id: string;
      title: string;
      prompt: string;
      state: 'running' | 'done' | 'failed' | 'cancelled';
      error?: string;
      digest?: string;
      statusLabel?: string;
    }>;
  }>;
  SwarmRunControl?: new () => { cancel(id: string): boolean };
};

export async function runIdeCodingSwarm(
  deps: AgentRuntimeDeps,
  opts: AgentRunOptions,
  ctx: {
    emit: (event: AgentRuntimeEvent) => void;
    registry: ToolRegistry;
    permissions: PermissionMemory;
    cwd: string;
    model: string;
    messages: Array<{ role: string; content: string }>;
  },
  sessionId: string,
): Promise<AgentRunResult | undefined> {
  const api = loadHarness() as SwarmApi;
  if (typeof api.runSwarm !== 'function' || !api.SwarmRunControl) {
    ctx.emit({
      type: 'error',
      message: 'Swarm runner missing; falling back to the kernel',
    });
    return undefined;
  }
  const control = new api.SwarmRunControl();
  opts.onSwarmControl?.(control);
  const userPrompt =
    [...ctx.messages].reverse().find((m) => m.role === 'user')?.content || '';
  ctx.emit({ type: 'status', text: 'Swarm · starting', status: 'running' });
  const swarm = await api.runSwarm({
    transport: deps.transport,
    registry: ctx.registry,
    model: ctx.model,
    cwd: ctx.cwd,
    userPrompt,
    permissions: ctx.permissions,
    signal: opts.signal,
    thinking: opts.requestExtras?.spockify_thinking,
    yolo: false,
    control,
    askUser: opts.askUser,
    onWorker: (row) => opts.onSwarmWorker?.(row),
    onEvent: (event) => {
      if (
        event.type === 'text' ||
        event.type === 'thinking' ||
        event.type === 'done'
      ) {
        return;
      }
      if (event.type === 'toolStart') {
        ctx.emit({
          type: 'toolStart',
          id: event.id,
          name: event.name,
          arguments: event.arguments,
        });
      } else if (event.type === 'toolResult') {
        ctx.emit({
          type: 'toolResult',
          id: event.id,
          name: event.name,
          ok: event.ok,
          content: event.content,
          error: event.error,
        });
      } else if (event.type === 'askUser') {
        ctx.emit({
          type: 'status',
          text: `Question: ${event.prompt}`,
          status: 'running',
        });
      } else if (event.type === 'error') {
        ctx.emit({ type: 'error', message: event.message });
      } else if (event.type === 'status') {
        ctx.emit({ type: 'status', text: event.text, status: 'running' });
      }
    },
  });
  const transcript = swarm.transcript || '';
  if (transcript) {
    ctx.emit({ type: 'text', content: transcript });
  }
  const messages: AgentMessage[] = opts.messages.map((m) => ({ ...m }));
  let placed = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'assistant') {
      messages[i] = { ...messages[i], content: transcript };
      placed = true;
      break;
    }
  }
  if (!placed) messages.push({ role: 'assistant', content: transcript });
  const cancelled = swarm.kind === 'cancelled' || Boolean(opts.signal?.aborted);
  ctx.emit({
    type: 'done',
    cancelled,
    reason: cancelled ? 'cancelled' : 'unverified',
  });
  const result: AgentRunResult = {
    messages,
    status: cancelled ? 'cancelled' : 'done',
    cancelled,
  };
  const sessions = getSessionManager();
  sessions.setStatus(sessionId, result.status);
  sessions.setMessages(sessionId, result.messages);
  return result;
}
