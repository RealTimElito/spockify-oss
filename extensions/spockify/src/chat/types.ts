/**
 * WS-C chat types. Provider-agnostic — do not fetch spockify.eu directly.
 *
 * TODO(WS-B): Replace local stubs with imports from `spockify-ide-client`
 * once ModelTransport + shared message types land.
 */

import type { ChatContent } from './chatContent';

export type {
  ChatAttachmentPayload,
  ChatContent,
  ChatContentPart,
  ChatImageUrlPart,
  ChatTextPart,
} from './chatContent';

/** Minimal chat message shape (OpenAI-compatible). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  /** Plain string or multimodal parts (text + image_url). */
  content: ChatContent;
  name?: string;
  toolCallId?: string;
  /** Assistant-only: OpenAI-shaped tool requests for follow-up turns. */
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Model id that generated this assistant turn (persisted for attribution). */
  model?: string;
}

export interface ModelInfo {
  id: string;
  /** Display label; may omit for id-only stubs. */
  label?: string;
  /** True when model passes OSS policy (WS-E). */
  oss?: boolean;
}

export interface ChatCompletionChunk {
  /** Incremental assistant text (SSE delta). */
  content: string;
  /** True on final chunk. */
  done?: boolean;
  /** Actual model from the response when present (e.g. Auto-resolved). */
  model?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  /** Cancel in-flight SSE / fallback chunking. */
  signal?: AbortSignal;
}

/**
 * Narrow surface chat needs from ModelTransport (plan §9).
 * WS-B owns the full interface; chat only depends on these methods.
 */
export interface ChatModelTransport {
  listModels(): Promise<ModelInfo[]>;
  /**
   * Stream chat completions. Yields text deltas.
   * Maps to POST https://spockify.eu/v1/chat/completions (stream).
   */
  chatCompletions(
    request: ChatCompletionRequest,
  ): AsyncIterable<ChatCompletionChunk>;
}

export interface ChatPanelDeps {
  /** Injected by extension activate(); mock until WS-B wires RemoteSpockify. */
  transport: ChatModelTransport;
  /** Default OSS alias until picker loads remote catalog. */
  defaultModel?: string;
  /** Opens https://spockify.eu for deferred features. */
  openExternal?: (url: string) => Thenable<boolean>;
  /**
   * Live ModelTransport for Phase 1 AgentRuntime (tools + cancel).
   * When available, Chat Send uses the unified runtime instead of a raw stream loop.
   */
  getModelTransport?: () => Promise<import('@spockify/ide-client').ModelTransport | undefined>;
}

/** Persisted chat thread (workspace or global state). */
export type ChatSession = import('../runtime/chatSessionStore').PersistedChatSession;

export type ChatSessionSummary =
  import('../runtime/chatSessionStore').ChatSessionSummary;
