import type {
  AgentRun,
  AgentRunEvent,
  CreateAgentRunRequest,
  ListAgentRunsResponse,
} from './agents';
import {
  SpockifyHttpClient,
  SpockifyHttpError,
  looksLikeJwt,
} from './http';
import type {
  ChatStreamChunk,
  ChatStreamToolCall,
  ModelTransport,
} from './transport';
import type {
  ApiBackend,
  ChatCompletionsRequest,
  ChatCompletionsResponse,
  ChatMessage,
  GhostFateRequest,
  GhostSuggestRequest,
  GhostSuggestResponse,
  HealthStatus,
  ListModelsResponse,
  ModelInfo,
  SpockifyClientOptions,
} from './types';

/** Resolve chat/models backend: explicit option, else JWT → owui, else litellm. */
export function resolveApiBackend(
  options: Pick<SpockifyClientOptions, 'apiKey' | 'apiBackend'>,
): ApiBackend {
  if (options.apiBackend === 'owui' || options.apiBackend === 'litellm') {
    return options.apiBackend;
  }
  const key = (options.apiKey || '').trim();
  if (looksLikeJwt(key)) return 'owui';
  return 'litellm';
}

type AccumulatedToolCall = {
  id: string;
  name: string;
  argumentsRaw: string;
};

/** Pull the routed worker id from Spockify orchestrator metadata. */
export function extractSpockifyWorker(
  payload: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const direct = payload.spockify_worker;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const hud = payload.spockify_hud;
  if (hud && typeof hud === 'object') {
    const h = hud as Record<string, unknown>;
    if (typeof h.worker === 'string' && h.worker.trim()) return h.worker.trim();
    if (typeof h.model === 'string' && h.model.trim()) return h.model.trim();
  }

  if (typeof payload.worker === 'string' && payload.worker.trim()) {
    return payload.worker.trim();
  }

  const sp = payload.spockify;
  if (sp && typeof sp === 'object') {
    const s = sp as Record<string, unknown>;
    if (typeof s.worker_model === 'string' && s.worker_model.trim()) {
      return s.worker_model.trim();
    }
    const routing = s.routing;
    if (routing && typeof routing === 'object') {
      const sel = (routing as Record<string, unknown>).selected_model;
      if (typeof sel === 'string' && sel.trim()) return sel.trim();
    }
    const sh = s.hud;
    if (sh && typeof sh === 'object') {
      const h = sh as Record<string, unknown>;
      if (typeof h.worker === 'string' && h.worker.trim()) return h.worker.trim();
    }
  }
  return undefined;
}

function wantsWorkerMetadata(model: string | undefined): boolean {
  const m = (model || '').trim();
  if (!m) return false;
  return (
    m === 'spockify-auto' ||
    m.endsWith('-auto') ||
    m === 'spockify-room' ||
    m === 'spockify-agents'
  );
}

function messageContentToString(
  text: ChatMessage['content'] | undefined,
): string {
  if (typeof text === 'string') return text;
  if (!Array.isArray(text)) return '';
  return text
    .filter(
      (p): p is { type: 'text'; text: string } => !!p && p.type === 'text',
    )
    .map((p) => p.text)
    .join('');
}

function accumulateToolCallDeltas(
  acc: Map<number, AccumulatedToolCall>,
  deltas?: Array<{
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>,
): void {
  if (!deltas?.length) return;
  for (const d of deltas) {
    const index = typeof d.index === 'number' ? d.index : acc.size;
    let row = acc.get(index);
    if (!row) {
      row = { id: d.id || `call_${index}`, name: '', argumentsRaw: '' };
      acc.set(index, row);
    }
    if (d.id) row.id = d.id;
    if (d.function?.name) row.name = d.function.name;
    if (typeof d.function?.arguments === 'string') {
      row.argumentsRaw += d.function.arguments;
    }
  }
}

function finalizeToolCalls(
  acc: Map<number, AccumulatedToolCall>,
): ChatStreamToolCall[] {
  const out: ChatStreamToolCall[] = [];
  for (const row of [...acc.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])) {
    if (!row.name) continue;
    let args: Record<string, unknown> = {};
    const raw = row.argumentsRaw.trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        /* keep empty args; expose raw */
      }
    }
    out.push({
      id: row.id,
      name: row.name,
      arguments: args,
      argumentsRaw: raw || undefined,
    });
  }
  return out;
}

function parseMessageToolCalls(
  message?: ChatMessage & {
    tool_calls?: Array<{
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  },
): ChatStreamToolCall[] {
  const calls = message?.tool_calls;
  if (!calls?.length) return [];
  const acc = new Map<number, AccumulatedToolCall>();
  calls.forEach((tc, index) => {
    acc.set(index, {
      id: tc.id || `call_${index}`,
      name: tc.function?.name || '',
      argumentsRaw: tc.function?.arguments || '',
    });
  });
  return finalizeToolCalls(acc);
}

/** Lightweight OSS filter (inlined so client has no hard dep on oss-models pkg). */
const DENY_PREFIXES = [
  'gpt-',
  'o1',
  'o3',
  'claude-',
  'anthropic',
  'gemini-',
  'copilot',
  'kimi',
  'mimo',
];
const ALLOW_PREFIXES = [
  'spockify-',
  'gpt-oss-',
  'gpt-oss:',
  'codestral',
  'web-codestral',
  'web-gemma',
  'web-llama',
  'orchestrator',
  'gemma',
  'llama',
  'mistral',
  'mixtral',
  'magistral',
  'ministral',
  'mathstral',
  'devstral',
  'nemotron',
  'qwen',
  'phi',
  'llava',
  'starcoder',
  'codellama',
  'ollama/',
];

function isDenied(id: string): boolean {
  const n = id.toLowerCase();
  if (n.startsWith('gpt-oss-') || n.startsWith('gpt-oss:')) return false;
  return DENY_PREFIXES.some((p) => n === p || n.startsWith(p));
}

function isAllowed(id: string): boolean {
  if (isDenied(id)) return false;
  const n = id.toLowerCase();
  return ALLOW_PREFIXES.some((p) => n === p || n.startsWith(p));
}

export function filterModelsOss(
  models: ModelInfo[],
  ossOnly = true,
): ModelInfo[] {
  return models.filter((m) => {
    if (!m?.id) return false;
    if (isDenied(m.id)) return false;
    if (!ossOnly) return true;
    return isAllowed(m.id);
  });
}

const THINKING_MODES = new Set(['off', 'low', 'medium', 'high', 'heavy']);
const THINKING_MARKER_ONLY_RE =
  /^\s*\[spockify_thinking:(off|low|light|medium|high|heavy)\]\s*$/i;

function normalizeThinkingMode(raw: unknown): string | undefined {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'light') return 'low';
  if (THINKING_MODES.has(s)) return s;
  return undefined;
}

function applyThinkingToRequest(request: ChatCompletionsRequest): {
  payload: ChatCompletionsRequest;
  headers: Record<string, string>;
} {
  const mode = normalizeThinkingMode(request.spockify_thinking);
  if (!mode) {
    return { payload: request, headers: {} };
  }
  const messages = Array.isArray(request.messages) ? [...request.messages] : [];
  const cleaned = messages.filter((m) => {
    if (m.role !== 'system' || typeof m.content !== 'string') return true;
    return !THINKING_MARKER_ONLY_RE.test(m.content);
  });
  cleaned.unshift({
    role: 'system',
    content: `[spockify_thinking:${mode}]`,
  });
  return {
    payload: {
      ...request,
      messages: cleaned,
      spockify_thinking: mode,
      spockify_think_enabled: mode !== 'off',
    },
    headers: {
      'X-Spockify-Thinking': mode,
      'X-Spockify-Think-Enabled': mode === 'off' ? '0' : '1',
    },
  };
}

/**
 * Default M0/M1 provider: HTTP to https://spockify.eu.
 * Auth: `Authorization: Bearer <LiteLLM sk-… | OWUI JWT>`.
 *
 * Session JWTs must use `apiBackend: 'owui'` (auto when token looks like JWT):
 * LiteLLM `/v1/chat/completions` rejects JWTs with 401 ("Virtual Key expected").
 */
export class RemoteSpockifyProvider implements ModelTransport {
  readonly providerId = 'remote' as const;
  private readonly http: SpockifyHttpClient;
  private readonly defaultOssOnly: boolean;
  readonly apiBackend: ApiBackend;

  constructor(
    options: SpockifyClientOptions & { ossOnly?: boolean } = {},
  ) {
    this.http = new SpockifyHttpClient(options);
    this.defaultOssOnly = options.ossOnly !== false;
    this.apiBackend = resolveApiBackend(options);
  }

  private get modelsPath(): string {
    return this.apiBackend === 'owui' ? '/openai/models' : '/v1/models';
  }

  private get chatPath(): string {
    return this.apiBackend === 'owui'
      ? '/openai/chat/completions'
      : '/v1/chat/completions';
  }

  private get embeddingsPath(): string {
    return this.apiBackend === 'owui'
      ? '/api/v1/embeddings'
      : '/v1/embeddings';
  }

  async health(): Promise<HealthStatus> {
    if (!this.http.hasApiKey) {
      return {
        ok: false,
        baseUrl: this.http.baseUrl,
        detail: 'Missing API key / session (Sign in to Spockify)',
      };
    }
    try {
      await this.listModels();
      return { ok: true, baseUrl: this.http.baseUrl, status: 200 };
    } catch (err) {
      if (err instanceof SpockifyHttpError) {
        return {
          ok: false,
          baseUrl: this.http.baseUrl,
          status: err.status,
          detail: err.body.slice(0, 500) || err.message,
        };
      }
      return {
        ok: false,
        baseUrl: this.http.baseUrl,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listModels(opts?: { ossOnly?: boolean }): Promise<ModelInfo[]> {
    const body = await this.http.request<ListModelsResponse | ModelInfo[]>(
      this.modelsPath,
      { method: 'GET' },
    );
    const models = Array.isArray(body)
      ? body
      : (body?.data ?? []);
    const ossOnly = opts?.ossOnly ?? this.defaultOssOnly;
    return filterModelsOss(models, ossOnly);
  }

  async chatCompletions(
    request: ChatCompletionsRequest,
  ): Promise<ChatCompletionsResponse> {
    const { payload, headers } = applyThinkingToRequest(request);
    return this.http.request<ChatCompletionsResponse>(this.chatPath, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...payload, stream: false }),
    });
  }

  async *streamChatCompletions(
    request: ChatCompletionsRequest,
    signal?: AbortSignal,
  ): AsyncIterable<ChatStreamChunk> {
    const { payload: thinkReq, headers: thinkHeaders } =
      applyThinkingToRequest(request);
    // LiteLLM strips orchestrator SSE/HUD on stream; non-stream keeps
    // spockify_worker. For auto/room/agents, fetch once then emit as a stream.
    if (wantsWorkerMetadata(thinkReq.model)) {
      const full = await this.chatCompletions({ ...thinkReq, stream: false });
      if (!full || typeof full !== 'object') {
        yield {
          content: '',
          done: true,
          finishReason: 'error',
        };
        return;
      }
      const choice = full.choices?.[0];
      const textStr = messageContentToString(choice?.message?.content);
      const workerModel =
        extractSpockifyWorker(full as unknown as Record<string, unknown>) ||
        (full.model && full.model !== thinkReq.model ? full.model : undefined);
      const native = parseMessageToolCalls(choice?.message);
      if (textStr) {
        yield {
          content: textStr,
          model: full.model,
          workerModel,
        };
      }
      yield {
        content: '',
        done: true,
        model: full.model,
        workerModel,
        toolCalls: native.length ? native : undefined,
        finishReason: choice?.finish_reason ?? null,
        usage: full.usage as Record<string, number> | undefined,
      };
      return;
    }

    const payload = { ...thinkReq, stream: true };
    const res = await this.http.requestStream(this.chatPath, {
      method: 'POST',
      headers: thinkHeaders,
      body: JSON.stringify(payload),
      signal,
    });

    const headerWorker =
      res.headers.get('x-spockify-worker') ||
      res.headers.get('X-Spockify-Worker') ||
      undefined;

    if (!res.body) {
      // Fallback: non-stream
      const full = await this.chatCompletions(thinkReq);
      if (!full || typeof full !== 'object') {
        yield { content: '', done: true, finishReason: 'error' };
        return;
      }
      const choice = full.choices?.[0];
      const textStr = messageContentToString(choice?.message?.content);
      const workerModel =
        extractSpockifyWorker(full as unknown as Record<string, unknown>) ||
        headerWorker ||
        (full.model && full.model !== thinkReq.model ? full.model : undefined);
      if (textStr) yield { content: textStr, model: full.model, workerModel };
      const native = parseMessageToolCalls(choice?.message);
      yield {
        content: '',
        done: true,
        model: full.model,
        workerModel,
        toolCalls: native.length ? native : undefined,
        finishReason: choice?.finish_reason ?? null,
        usage: full.usage as Record<string, number> | undefined,
      };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let workerModel = headerWorker;
    const toolAcc = new Map<number, AccumulatedToolCall>();
    const onAbort = () => {
      try {
        void reader.cancel();
      } catch {
        /* ignore */
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            const toolCalls = finalizeToolCalls(toolAcc);
            yield {
              content: '',
              done: true,
              workerModel,
              toolCalls: toolCalls.length ? toolCalls : undefined,
            };
            return;
          }
          try {
            const json = JSON.parse(data) as Record<string, unknown>;
            const fromMeta = extractSpockifyWorker(json);
            if (fromMeta) workerModel = fromMeta;

            const choices = json.choices as
              | Array<{
                  delta?: {
                    content?: string;
                    tool_calls?: Array<{
                      index?: number;
                      id?: string;
                      type?: string;
                      function?: { name?: string; arguments?: string };
                    }>;
                  };
                  finish_reason?: string | null;
                }>
              | undefined;
            const choice = choices?.[0];
            const delta = choice?.delta?.content ?? '';
            const model =
              typeof json.model === 'string' ? json.model : undefined;
            if (delta) {
              yield { content: delta, model, workerModel };
            }
            accumulateToolCallDeltas(toolAcc, choice?.delta?.tool_calls);
            if (choice?.finish_reason) {
              const toolCalls = finalizeToolCalls(toolAcc);
              yield {
                content: '',
                done: true,
                model,
                workerModel,
                toolCalls: toolCalls.length ? toolCalls : undefined,
                finishReason: choice.finish_reason,
                usage: json.usage as Record<string, number> | undefined,
              };
              return;
            }
            if (json.usage && !choice?.delta) {
              yield {
                content: '',
                done: true,
                model,
                workerModel,
                usage: json.usage as Record<string, number>,
              };
              return;
            }
            // HUD-only SSE (no choices) — surface worker early
            if (fromMeta && !choices) {
              yield { content: '', model, workerModel: fromMeta };
            }
          } catch {
            // ignore malformed SSE chunks
          }
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
    const toolCalls = finalizeToolCalls(toolAcc);
    yield {
      content: '',
      done: true,
      workerModel,
      toolCalls: toolCalls.length ? toolCalls : undefined,
    };
  }

  async ghostSuggest(
    request: GhostSuggestRequest,
    signal?: AbortSignal,
  ): Promise<GhostSuggestResponse> {
    const body: GhostSuggestRequest = {
      mode: 'suggest',
      language: 'plaintext',
      filename: 'untitled',
      code: '',
      prefix: '',
      suffix: '',
      context: '',
      selection: '',
      instruction: 'Suggest a concise improvement or completion.',
      local_only: false,
      ...request,
    };
    // OWUI proxy accepts JWT + (after server fix) LiteLLM sk. Prefer the
    // authenticated Spockify proxy for both backends so one path stays live.
    return this.http.request<GhostSuggestResponse>(
      '/api/v1/spockify/ghost/suggest',
      {
        method: 'POST',
        body: JSON.stringify(body),
        signal,
      },
    );
  }

  async ghostFate(
    request: GhostFateRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.http.request<{ ok?: boolean }>(
      '/api/v1/spockify/ghost/fate',
      {
        method: 'POST',
        body: JSON.stringify(request),
        signal,
      },
    );
  }

  async embed(
    texts: string[],
    opts?: { model?: string },
  ): Promise<number[][]> {
    const model = opts?.model || 'nomic-embed';
    const body = await this.http.request<{
      data?: Array<{ embedding?: number[]; index?: number }>;
    }>(this.embeddingsPath, {
      method: 'POST',
      body: JSON.stringify({ model, input: texts }),
    });
    const rows = body?.data ?? [];
    return texts.map((_, i) => {
      const row = rows.find((r) => r.index === i) ?? rows[i];
      return row?.embedding ?? [];
    });
  }

  async pullIdeSync(opts?: { etag?: string }): Promise<{
    etag?: string;
    payload?: Record<string, unknown>;
    notModified?: boolean;
  }> {
    try {
      const headers: Record<string, string> = {};
      if (opts?.etag) headers['If-None-Match'] = opts.etag;
      const body = await this.http.request<{
        etag?: string;
        payload?: Record<string, unknown>;
      }>('/api/v1/spockify/ide/sync', { method: 'GET', headers });
      return { etag: body?.etag, payload: body?.payload };
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 0;
      if (status === 304) {
        return { notModified: true, etag: opts?.etag };
      }
      if (status === 404) {
        return { payload: undefined };
      }
      throw err;
    }
  }

  async pushIdeSync(
    payload: Record<string, unknown>,
    opts?: { etag?: string },
  ): Promise<{ etag?: string; ok: boolean; status?: number }> {
    const headers: Record<string, string> = {};
    if (opts?.etag) headers['If-Match'] = opts.etag;
    try {
      const body = await this.http.request<{ etag?: string; ok?: boolean }>(
        '/api/v1/spockify/ide/sync',
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ payload }),
        },
      );
      return { etag: body?.etag, ok: body?.ok !== false };
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 0;
      if (status === 404 || status === 412) {
        return { ok: false, status };
      }
      throw err;
    }
  }

  async pullIdeIndex(opts: {
    workspaceKey: string;
    etag?: string;
  }): Promise<{
    etag?: string;
    payload?: Record<string, unknown>;
    notModified?: boolean;
    workspaceKey?: string;
  }> {
    const key = encodeURIComponent(opts.workspaceKey);
    try {
      const headers: Record<string, string> = {};
      if (opts.etag) headers['If-None-Match'] = opts.etag;
      const body = await this.http.request<{
        etag?: string;
        payload?: Record<string, unknown>;
        workspace_key?: string;
      }>(`/api/v1/spockify/ide/index?workspace_key=${key}`, {
        method: 'GET',
        headers,
      });
      return {
        etag: body?.etag,
        payload: body?.payload,
        workspaceKey: body?.workspace_key ?? opts.workspaceKey,
      };
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 0;
      if (status === 304) {
        return {
          notModified: true,
          etag: opts.etag,
          workspaceKey: opts.workspaceKey,
        };
      }
      if (status === 404) {
        return { payload: undefined, workspaceKey: opts.workspaceKey };
      }
      throw err;
    }
  }

  async pushIdeIndex(
    workspaceKey: string,
    payload: Record<string, unknown>,
    opts?: { etag?: string },
  ): Promise<{ etag?: string; ok: boolean; status?: number }> {
    const headers: Record<string, string> = {};
    if (opts?.etag) headers['If-Match'] = opts.etag;
    try {
      const body = await this.http.request<{ etag?: string; ok?: boolean }>(
        '/api/v1/spockify/ide/index',
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({ workspace_key: workspaceKey, payload }),
        },
      );
      return { etag: body?.etag, ok: body?.ok !== false };
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? Number((err as { status: number }).status)
          : 0;
      if (status === 404 || status === 412 || status === 413) {
        return { ok: false, status };
      }
      throw err;
    }
  }

  async listAgentRuns(): Promise<AgentRun[]> {
    const body = await this.http.request<ListAgentRunsResponse | AgentRun[]>(
      '/api/v1/spockify/agents/runs',
      { method: 'GET' },
    );
    if (Array.isArray(body)) return body;
    return body?.runs ?? body?.items ?? [];
  }

  async getAgentRun(runId: string): Promise<AgentRun> {
    return this.http.request<AgentRun>(
      `/api/v1/spockify/agents/runs/${encodeURIComponent(runId)}`,
      { method: 'GET' },
    );
  }

  async createAgentRun(request: CreateAgentRunRequest): Promise<AgentRun> {
    return this.http.request<AgentRun>('/api/v1/spockify/agents/runs', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async cancelAgentRun(runId: string): Promise<AgentRun | void> {
    const body = await this.http.request<{ ok?: boolean; run?: AgentRun }>(
      `/api/v1/spockify/agents/runs/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST', body: '{}' },
    );
    return body?.run;
  }

  /**
   * Live SSE feed for one run. Same line-buffered `data: {...}` parsing
   * approach as streamChatCompletions — the router emits one JSON object
   * per line, terminated by `data: [DONE]`.
   */
  async *streamAgentRunEvents(
    runId: string,
    signal?: AbortSignal,
  ): AsyncIterable<AgentRunEvent> {
    const res = await this.http.requestStream(
      `/api/v1/spockify/agents/runs/${encodeURIComponent(runId)}/events`,
      { method: 'GET', signal },
    );
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const onAbort = () => {
      try {
        void reader.cancel();
      } catch {
        /* ignore */
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data) as AgentRunEvent;
          } catch {
            // ignore malformed SSE chunks
          }
        }
      }
    } finally {
      signal?.removeEventListener('abort', onAbort);
      try {
        reader.releaseLock();
      } catch {
        /* ignore */
      }
    }
  }
}
