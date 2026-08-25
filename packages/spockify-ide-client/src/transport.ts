import type {
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  GhostFateRequest,
  GhostSuggestRequest,
  GhostSuggestResponse,
  HealthStatus,
  ModelInfo,
  ProviderId,
} from './types';
import type { AgentRun, AgentRunEvent, CreateAgentRunRequest } from './agents';

/** Native OpenAI-style tool call accumulated from SSE deltas. */
export interface ChatStreamToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Raw arguments string before JSON parse (when partial/malformed). */
  argumentsRaw?: string;
}

/** Streaming chat delta (OpenAI SSE shape, simplified). */
export interface ChatStreamChunk {
  content: string;
  done?: boolean;
  model?: string;
  /**
   * Worker / resolved model when the request used an alias like `spockify-auto`
   * (from `spockify_worker`, HUD, or routing metadata).
   */
  workerModel?: string;
  /** Present when the model emitted native `tool_calls` (finish_reason tool_calls). */
  toolCalls?: ChatStreamToolCall[];
  finishReason?: string | null;
  /** Final-chunk usage when the upstream includes it (tokens / optional cost). */
  usage?: Record<string, number>;
}

/**
 * Pluggable model transport — chat, completions, Ghost, agents, catalog.
 * Feature code must call this, not raw `fetch(spockify.eu)`.
 */
export interface ModelTransport {
  readonly providerId: ProviderId;

  health(): Promise<HealthStatus>;

  listModels(opts?: { ossOnly?: boolean }): Promise<ModelInfo[]>;

  /** Non-streaming chat completions. */
  chatCompletions(
    request: ChatCompletionsRequest,
  ): Promise<ChatCompletionsResponse>;

  /**
   * Streaming chat completions (SSE).
   * Preferred path for Chat panel.
   */
  streamChatCompletions(
    request: ChatCompletionsRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk>;

  /** Ghost suggest/complete/edit/chat via `/api/v1/spockify/ghost/suggest`. */
  ghostSuggest(
    request: GhostSuggestRequest,
    signal?: AbortSignal,
  ): Promise<GhostSuggestResponse>;

  /**
   * Suggestion fate telemetry via `/api/v1/spockify/ghost/fate` (protocol v2).
   * Optional — callers must fire-and-forget and silently drop failures
   * (the endpoint may not exist on older routers).
   */
  ghostFate?(
    request: GhostFateRequest,
    signal?: AbortSignal,
  ): Promise<void>;

  /**
   * Embeddings via OpenAI-compatible `POST /v1/embeddings` (spockify.eu).
   * Optional — callers must fall back to local hash vectors.
   */
  embed?(
    texts: string[],
    opts?: { model?: string },
  ): Promise<number[][]>;

  /**
   * IDE settings sync blob (Phase 6). Optional until route exists.
   */
  pullIdeSync?(opts?: { etag?: string }): Promise<{
    etag?: string;
    payload?: Record<string, unknown>;
    notModified?: boolean;
  }>;
  pushIdeSync?(
    payload: Record<string, unknown>,
    opts?: { etag?: string },
  ): Promise<{ etag?: string; ok: boolean; status?: number }>;

  /**
   * Remote index **metadata** only (Phase 6). Fingerprint / chunk counts —
   * never chunk text or vectors. Optional until route exists.
   */
  pullIdeIndex?(opts: {
    workspaceKey: string;
    etag?: string;
  }): Promise<{
    etag?: string;
    payload?: Record<string, unknown>;
    notModified?: boolean;
    workspaceKey?: string;
  }>;
  pushIdeIndex?(
    workspaceKey: string,
    payload: Record<string, unknown>,
    opts?: { etag?: string },
  ): Promise<{ etag?: string; ok: boolean; status?: number }>;

  /** Parallel agent runs (remote only; Local stub throws). */
  listAgentRuns?(): Promise<AgentRun[]>;
  getAgentRun?(runId: string): Promise<AgentRun>;
  createAgentRun?(request: CreateAgentRunRequest): Promise<AgentRun>;
  cancelAgentRun?(runId: string): Promise<AgentRun | void>;
  /**
   * Live SSE feed for one run — `/spockify/agents/runs/{id}/events`. Powers
   * the Agents webview's live status/tool activity. See {@link AgentRunEvent}
   * for what granularity is actually available today.
   */
  streamAgentRunEvents?(
    runId: string,
    signal?: AbortSignal,
  ): AsyncIterable<AgentRunEvent>;
}
