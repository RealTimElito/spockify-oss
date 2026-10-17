/** Provider id stored in `spockify.provider` settings. */
export type ProviderId = 'remote' | 'local';

/** OpenAI-compatible function tool call (assistant message). */
export interface ChatToolCall {
  id: string;
  type?: 'function';
  function: {
    name: string;
    /** JSON string of arguments (OpenAI wire shape). */
    arguments: string;
  };
}

/** OpenAI multimodal content part (text + image_url). */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: string } };

/** OpenAI-compatible message body: plain string or multimodal parts. */
export type ChatContent = string | ChatContentPart[];

/** OpenAI-compatible chat message. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ChatContent;
  name?: string;
  /** Present when role === 'tool'. */
  tool_call_id?: string;
  /** Present when role === 'assistant' and the model requested tools. */
  tool_calls?: ChatToolCall[];
}

export interface ModelInfo {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  /** Optional display name when catalog provides one. */
  name?: string;
}

export interface ListModelsResponse {
  object: string;
  data: ModelInfo[];
}

export interface ChatCompletionsRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;
}

export interface ChatCompletionsChoice {
  index: number;
  message?: ChatMessage;
  delta?: Partial<ChatMessage>;
  finish_reason?: string | null;
}

export interface ChatCompletionsResponse {
  id?: string;
  object?: string;
  model?: string;
  choices: ChatCompletionsChoice[];
  usage?: Record<string, number>;
  /** Present on orchestrated aliases (spockify-auto, …). */
  spockify_worker?: string;
  spockify?: {
    worker_model?: string;
    routing?: { selected_model?: string };
    hud?: { worker?: string; model?: string };
  };
  spockify_hud?: { worker?: string; model?: string };
}

/** Ghost suggest modes — aligned with router `GhostSuggestRequest`. */
export type GhostMode = 'suggest' | 'complete' | 'edit' | 'chat';

/** What caused the Tab request (protocol v2). */
export type GhostTrigger =
  | 'typing'
  | 'line_change'
  | 'manual'
  | 'linter'
  | 'editor_change';

/** Per-file recent-edit trail: unified diffs, newest last (protocol v2). */
export interface GhostDiffHistoryEntry {
  file: string;
  diffs: string[];
  timestamps: number[];
}

/** Retrieval hit attached to a Tab request (protocol v2). */
export interface GhostContextItem {
  path: string;
  symbol: string | null;
  contents: string;
  score: number;
}

/** Diagnostic near the cursor attached to a Tab request (protocol v2). */
export interface GhostLinterError {
  path: string;
  message: string;
  line: number;
  severity: string;
}

/** Line-range EDIT suggestion (protocol v2, `mode: "edit"`). */
export interface GhostEdit {
  start_line: number;
  end_line: number;
  new_text: string;
}

export interface GhostSuggestRequest {
  mode?: GhostMode;
  code?: string;
  language?: string;
  instruction?: string;
  local_only?: boolean;
  cursor_line?: number | null;
  filename?: string;
  selection?: string;
  prefix?: string;
  suffix?: string;
  /** Optional FIM hints: file-head imports, open tab names (not whole repo). */
  context?: string;
  role?: string | null;
  // Protocol v2 additions — all optional server-side; the v1 router ignores
  // unknown fields (Pydantic default), so sending them is always safe.
  /** Client-generated UUID; keys the fate report for this request. */
  request_id?: string;
  workspace_id?: string;
  rel_path?: string;
  cursor_col?: number;
  /** Per-file timestamped edit trails, newest last. */
  diff_history?: GhostDiffHistoryEntry[];
  context_items?: GhostContextItem[];
  linter_errors?: GhostLinterError[];
  trigger?: GhostTrigger;
}

export interface GhostSuggestResponse {
  ok: boolean;
  suggestion?: string;
  insert_text?: string;
  mode?: string;
  kind?: string;
  note?: string;
  latency_ms?: number;
  fallback_error?: string;
  /** Model used for remote complete (e.g. gpt-oss-20b). */
  model?: string;
  reason?: string;
  // Protocol v2 additions.
  request_id?: string;
  /** Present when mode === 'edit': replace lines start_line..end_line. */
  edit?: GhostEdit;
  confidence?: number;
  suppress_reason?: string;
  [key: string]: unknown;
}

/** Suggestion outcome reported to `/ghost/fate` (protocol v2). */
export type GhostFate = 'accepted' | 'rejected' | 'partial' | 'ignored';

export interface GhostFateRequest {
  request_id: string;
  fate: GhostFate;
  /** Whether the suggestion was ever rendered to the user. */
  seen: boolean;
  partial_accept_chars?: number;
  /** What the affected lines look like ~1–2s after the fate settled. */
  settled_text?: string;
  client_ts: number;
}

export interface HealthStatus {
  ok: boolean;
  baseUrl: string;
  status?: number;
  detail?: string;
}

/**
 * OpenAI-compatible chat/models backend.
 * - `litellm`: `/v1/*` (virtual keys `sk-…` from spockify.eu/ui)
 * - `owui`: `/openai/*` + OWUI APIs (email/password JWT)
 */
export type ApiBackend = 'litellm' | 'owui';

export interface SpockifyClientOptions {
  /** Product root, default `https://spockify.eu` (not `/v1`). */
  baseUrl?: string;
  /** LiteLLM virtual key / OWUI JWT — sent as `Authorization: Bearer`. */
  apiKey?: string;
  /**
   * Force chat/models routing. Default: auto — JWT (`eyJ…`) → owui, else litellm.
   * Email/password login must use `owui` (LiteLLM rejects session JWTs with 401).
   */
  apiBackend?: ApiBackend;
  /** Optional fetch override (tests). */
  fetch?: typeof globalThis.fetch;
  /** Prefer OSS-only catalog filter (default true). */
  ossOnly?: boolean;
}
