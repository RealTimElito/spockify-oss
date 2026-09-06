import { createModelTransport, type ModelInfo } from '@spockify/ide-client';
import {
  DEFAULT_BASE_URL,
  LOCAL_BASE_CANDIDATES,
  formatUnreachableHint,
  type SpockifyCredentials,
} from './config';
import { MODEL_PRESETS, type ModelPreset } from './models';

const PROBE_MS = 600;

/** Probe OWUI `/health` or LiteLLM `/health/liveliness` (and `/`). */
export async function probeBaseUrl(baseUrl: string): Promise<boolean> {
  const root = baseUrl.replace(/\/+$/, '');
  const paths =
    root.includes(':4000')
      ? ['/health/liveliness', '/health', '/']
      : ['/health', '/'];
  for (const path of paths) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROBE_MS);
    try {
      const res = await fetch(`${root}${path}`, {
        method: 'GET',
        signal: ctrl.signal,
      });
      if (res.ok || res.status === 401 || res.status === 403) return true;
    } catch {
      /* try next */
    } finally {
      clearTimeout(t);
    }
  }
  return false;
}

/**
 * Prefer env / local compose when SPOCKIFY_BASE_URL is unset, before cloud
 * credentials or https://spockify.eu.
 */
export async function discoverBaseUrl(explicit?: string): Promise<string> {
  if (explicit?.trim()) return explicit.trim().replace(/\/+$/, '');

  const fromEnv = process.env.SPOCKIFY_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');

  const fromWebui = process.env.WEBUI_URL?.trim();
  if (fromWebui) return fromWebui.replace(/\/+$/, '');

  for (const candidate of LOCAL_BASE_CANDIDATES) {
    if (await probeBaseUrl(candidate)) return candidate;
  }

  return DEFAULT_BASE_URL;
}

export function resolveBaseUrlWithCreds(
  discovered: string,
  creds: SpockifyCredentials | null,
): string {
  // Local/env discovery wins. Only use saved host when nothing local answered
  // and discovery fell through to the cloud default.
  if (discovered === DEFAULT_BASE_URL && creds?.baseUrl) {
    return creds.baseUrl.replace(/\/+$/, '');
  }
  return discovered;
}

export function formatModelsFetchError(baseUrl: string, err: unknown): string {
  const cause =
    err && typeof err === 'object' && 'cause' in err
      ? (err as { cause?: { code?: string; message?: string } }).cause
      : undefined;
  const detail =
    cause?.code ||
    cause?.message ||
    (err instanceof Error ? err.message : String(err));
  return `Cannot list models at ${baseUrl} (${detail}). ${formatUnreachableHint(baseUrl)}`;
}

/** Map live catalog ids → picker rows; keep preset blurbs/aliases when known. */
export function mergeLiveModels(live: ModelInfo[]): ModelPreset[] {
  const byId = new Map(
    MODEL_PRESETS.map((p) => [p.id.toLowerCase(), p] as const),
  );
  const out: ModelPreset[] = [];
  const seen = new Set<string>();

  for (const m of live) {
    const id = (m.id || '').trim();
    if (!id || seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    const preset = byId.get(id.toLowerCase());
    out.push({
      id,
      aliases: preset?.aliases ?? [],
      blurb:
        preset?.blurb ||
        (typeof m.name === 'string' && m.name !== id ? m.name : 'on this stack'),
    });
  }

  // Prefer curated order for known aliases, then the rest alpha.
  const rank = new Map(MODEL_PRESETS.map((p, i) => [p.id.toLowerCase(), i]));
  out.sort((a, b) => {
    const ra = rank.get(a.id.toLowerCase());
    const rb = rank.get(b.id.toLowerCase());
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.id.localeCompare(b.id);
  });
  return out;
}

/**
 * OWUI chat (:3080 / spockify.eu) exposes models/chat at `/openai/*`.
 * LiteLLM (:4000) uses `/v1/*`. A sk- key alone is not enough to pick —
 * hitting OWUI `/v1/models` returns the SPA HTML shell.
 */
export async function resolveStackApiBackend(
  baseUrl: string,
): Promise<'owui' | 'litellm'> {
  const root = baseUrl.replace(/\/+$/, '');
  if (/:(4000)(\/|$)/.test(root)) return 'litellm';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROBE_MS);
    const res = await fetch(`${root}/health/liveliness`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) {
      const text = await res.text();
      if (/alive/i.test(text)) return 'litellm';
    }
  } catch {
    /* not LiteLLM */
  }
  return 'owui';
}

export async function fetchStackModels(options: {
  apiKey: string;
  baseUrl: string;
}): Promise<ModelPreset[]> {
  const apiBackend = await resolveStackApiBackend(options.baseUrl);
  const transport = createModelTransport({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    apiBackend,
    // Show whatever this stack serves — do not invent a second catalog.
    ossOnly: false,
  });
  try {
    const live = await transport.listModels({ ossOnly: false });
    if (!live.length && apiBackend === 'owui') {
      // Rare: empty OWUI openai list — try LiteLLM path once.
      const fallback = createModelTransport({
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        apiBackend: 'litellm',
        ossOnly: false,
      });
      const again = await fallback.listModels({ ossOnly: false });
      return mergeLiveModels(again);
    }
    return mergeLiveModels(live);
  } catch (err) {
    throw new Error(formatModelsFetchError(options.baseUrl, err));
  }
}

/** Prefer a model that actually exists on the stack. */
export function pickDefaultModel(
  available: ModelPreset[],
  preferred?: string,
): string {
  const ids = available.map((m) => m.id);
  const lower = new Map(ids.map((id) => [id.toLowerCase(), id]));
  const want = (preferred || '').trim();
  if (want && lower.has(want.toLowerCase())) {
    return lower.get(want.toLowerCase())!;
  }
  for (const id of [
    'spockify-auto',
    'codestral',
    'llama3.2-3b',
    'llama3.2-3b-cpu',
    'gpt-oss-20b',
  ]) {
    if (lower.has(id)) return lower.get(id)!;
  }
  return ids[0] || preferred || 'spockify-auto';
}
