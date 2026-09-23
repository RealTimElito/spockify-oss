import {
  createModelTransport,
  type ModelTransport,
} from '@spockify/ide-client';
import type { ChatCompletionsRequest } from '@spockify/ide-client';
import {
  formatLabModelMissingError,
  isLabCatalogId,
  isPublicProdHost,
  matchLabUpstreamId,
} from '@spockify/harness';

export const LOCAL_OLLAMA_BASE = 'http://127.0.0.1:11434';

export type LabPinKind = 'ollama' | 'stack';

export type LabPinTarget = {
  baseUrl: string;
  apiModel: string;
  kind: LabPinKind;
};

const PROBE_MS = 800;

export function isLocalOllamaUrl(url: string): boolean {
  try {
    const u = new URL(url.includes('://') ? url : `http://${url}`);
    return u.port === '11434';
  } catch {
    return /:11434(\/|$)/.test(url);
  }
}

function normalizeUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

type ListModelsFn = (url: string) => Promise<string[]>;

async function readJson(
  url: string,
  apiKey?: string,
): Promise<unknown | undefined> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), PROBE_MS);
  try {
    const headers: Record<string, string> = {};
    if (apiKey?.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal });
    if (!res.ok) return undefined;
    return (await res.json()) as unknown;
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

/** Ollama `/api/tags` plus OpenAI `/v1/models`. */
export async function listHostModelIds(
  baseUrl: string,
  apiKey?: string,
): Promise<string[]> {
  const root = normalizeUrl(baseUrl);
  const ids = new Set<string>();
  const tags = await readJson(`${root}/api/tags`, apiKey);
  if (tags && typeof tags === 'object' && 'models' in tags) {
    const rows = (tags as { models?: Array<{ name?: string; model?: string }> })
      .models;
    for (const row of rows || []) {
      const name = (row.name || row.model || '').trim();
      if (name) ids.add(name);
    }
  }
  const openai = await readJson(`${root}/v1/models`, apiKey);
  if (openai && typeof openai === 'object') {
    const rows = Array.isArray(openai)
      ? openai
      : (openai as { data?: Array<{ id?: string }> }).data;
    for (const row of rows || []) {
      const id =
        typeof row === 'string'
          ? row
          : (row as { id?: string }).id?.trim() || '';
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Lab/eval pins talk to local Ollama when the mapped tag is pulled.
 * Never send an unpublished catalog id to the public API.
 */
export async function resolveLabPinTarget(opts: {
  catalogId: string;
  configuredBaseUrl: string;
  explicitBaseUrl?: string;
  apiKey?: string;
  listModels?: ListModelsFn;
}): Promise<LabPinTarget> {
  const catalogId = (opts.catalogId || '').trim();
  const configured = normalizeUrl(
    opts.explicitBaseUrl || opts.configuredBaseUrl || '',
  );
  if (!isLabCatalogId(catalogId)) {
    return { baseUrl: configured, apiModel: catalogId, kind: 'stack' };
  }

  const list: ListModelsFn =
    opts.listModels ||
    ((url) => listHostModelIds(url, opts.apiKey));

  const ollamaIds = await list(LOCAL_OLLAMA_BASE);
  const ollamaHit = matchLabUpstreamId(catalogId, ollamaIds);
  if (ollamaHit) {
    return {
      baseUrl: LOCAL_OLLAMA_BASE,
      apiModel: ollamaHit,
      kind: 'ollama',
    };
  }

  if (configured && !isPublicProdHost(configured) && configured !== LOCAL_OLLAMA_BASE) {
    const ids = await list(configured);
    const hit = matchLabUpstreamId(catalogId, ids);
    if (hit) {
      return { baseUrl: configured, apiModel: hit, kind: 'stack' };
    }
  }

  throw new Error(formatLabModelMissingError(catalogId, configured || 'the configured API'));
}

export function remapTransportModel(
  inner: ModelTransport,
  catalogId: string,
  apiModel: string,
): ModelTransport {
  const from = (catalogId || '').trim().toLowerCase();
  const to = (apiModel || '').trim();
  if (!from || !to || from === to.toLowerCase()) return inner;
  const remap = (id: string) =>
    (id || '').trim().toLowerCase() === from ? to : id;
  return {
    ...inner,
    providerId: inner.providerId,
    health: () => inner.health(),
    listModels: (o) => inner.listModels(o),
    chatCompletions: (req: ChatCompletionsRequest) =>
      inner.chatCompletions({ ...req, model: remap(req.model) }),
    streamChatCompletions: (req: ChatCompletionsRequest, signal?: AbortSignal) =>
      inner.streamChatCompletions({ ...req, model: remap(req.model) }, signal),
    ghostSuggest: (req, signal) => inner.ghostSuggest(req, signal),
    ghostFate: inner.ghostFate?.bind(inner),
    embed: inner.embed?.bind(inner),
    pullIdeSync: inner.pullIdeSync?.bind(inner),
    pushIdeSync: inner.pushIdeSync?.bind(inner),
    pullIdeIndex: inner.pullIdeIndex?.bind(inner),
    pushIdeIndex: inner.pushIdeIndex?.bind(inner),
    listAgentRuns: inner.listAgentRuns?.bind(inner),
    getAgentRun: inner.getAgentRun?.bind(inner),
    createAgentRun: inner.createAgentRun?.bind(inner),
    cancelAgentRun: inner.cancelAgentRun?.bind(inner),
    streamAgentRunEvents: inner.streamAgentRunEvents?.bind(inner),
  };
}

export function openSessionTransport(opts: {
  baseUrl: string;
  apiKey?: string;
  catalogId: string;
  apiModel: string;
  apiBackend?: 'owui' | 'litellm';
}): ModelTransport {
  const inner = createModelTransport({
    apiKey: opts.apiKey || '',
    baseUrl: opts.baseUrl,
    apiBackend:
      opts.apiBackend ||
      (isLocalOllamaUrl(opts.baseUrl) ? 'litellm' : undefined),
  });
  return remapTransportModel(inner, opts.catalogId, opts.apiModel);
}
