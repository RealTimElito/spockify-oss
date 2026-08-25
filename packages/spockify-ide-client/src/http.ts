import type { SpockifyClientOptions } from './types';

export const DEFAULT_BASE_URL = 'https://spockify.eu';

export class SpockifyHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'SpockifyHttpError';
    this.status = status;
    this.body = body;
  }

  /** True for missing/invalid auth (sign-in again or paste a LiteLLM key). */
  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Heuristic: OWUI session JWT vs LiteLLM / OWUI `sk-…` keys. */
export function looksLikeJwt(token: string): boolean {
  const t = token.trim();
  return t.startsWith('eyJ') && t.split('.').length >= 3;
}

/**
 * Human-readable auth hint for chat / agents when spockify.eu returns 401/403.
 */
export function formatAuthErrorHint(err: SpockifyHttpError): string {
  const body = err.body.slice(0, 280);
  const wantsLiteLLM =
    /Virtual Key expected|expected to start with 'sk-'|Malformed API Key/i.test(
      body,
    );
  if (wantsLiteLLM) {
    return (
      'This endpoint needs a LiteLLM API key (sk-…), not a web session. ' +
      'Sign in again with **API key**, or use email/password (routes via Open WebUI). ' +
      'Create a key at https://spockify.eu/ui/'
    );
  }
  return (
    'Not authenticated (401). Sign in again (status bar → Spockify), ' +
    'or paste a LiteLLM API key from https://spockify.eu/ui/'
  );
}

export function normalizeBaseUrl(baseUrl?: string): string {
  const raw = (baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  return raw || DEFAULT_BASE_URL;
}

export class SpockifyHttpClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: SpockifyClientOptions = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = (options.apiKey || '').trim();
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  get hasApiKey(): boolean {
    return this.apiKey.length > 0;
  }

  get v1Base(): string {
    return `${this.baseUrl}/v1`;
  }

  authHeaders(init?: HeadersInit): Headers {
    const headers = new Headers(init);
    if (this.apiKey) {
      headers.set('Authorization', `Bearer ${this.apiKey}`);
    }
    return headers;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = path.startsWith('http')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const headers = this.authHeaders(init.headers);
    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await this.fetchImpl(url, { ...init, headers });
    const text = await res.text();
    if (!res.ok) {
      const err = new SpockifyHttpError(
        `Spockify API ${res.status} ${res.statusText} for ${url}`,
        res.status,
        text,
      );
      if (err.isUnauthorized) {
        err.message = `${err.message}\n${formatAuthErrorHint(err)}`;
      }
      throw err;
    }
    if (!text) {
      throw new SpockifyHttpError(
        `Empty response from ${url}`,
        res.status,
        '',
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SpockifyHttpError(`Invalid JSON from ${url}`, res.status, text);
    }
  }

  /**
   * Streaming POST — returns the raw Response for SSE parsing.
   * Caller must consume body; does not buffer full text.
   */
  async requestStream(path: string, init: RequestInit = {}): Promise<Response> {
    const url = path.startsWith('http')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

    const headers = this.authHeaders(init.headers);
    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json');
    }
    if (!headers.has('Accept')) {
      headers.set('Accept', 'text/event-stream');
    }

    const res = await this.fetchImpl(url, { ...init, headers });
    if (!res.ok) {
      const text = await res.text();
      const err = new SpockifyHttpError(
        `Spockify API ${res.status} ${res.statusText} for ${url}`,
        res.status,
        text,
      );
      if (err.isUnauthorized) {
        err.message = `${err.message}\n${formatAuthErrorHint(err)}`;
      }
      throw err;
    }
    return res;
  }
}

/** OWUI sign-in → JWT (same account as spockify.eu web). */
export interface OwuiSignInResult {
  token: string;
  email?: string;
  name?: string;
  id?: string;
  role?: string;
}

/**
 * POST /api/v1/auths/signin — returns OWUI session JWT.
 * Use with `apiBackend: 'owui'` (chat via `/openai/*`). LiteLLM `/v1/*` rejects JWTs.
 *
 * Optionally tries GET/POST `/api/v1/auths/api_key` when enabled on the server;
 * production Spockify currently disables API-key creation (403) — JWT is enough.
 */
export async function signInOwui(
  baseUrl: string,
  email: string,
  password: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<OwuiSignInResult> {
  const root = normalizeBaseUrl(baseUrl);
  const url = `${root}/api/v1/auths/signin`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const detail =
      (typeof body.detail === 'string' && body.detail) ||
      text.slice(0, 200) ||
      res.statusText;
    throw new SpockifyHttpError(
      `Sign-in failed: ${detail}`,
      res.status,
      text,
    );
  }
  const token = (body.token as string) || (body.access_token as string);
  if (!token) {
    throw new SpockifyHttpError('Sign-in response missing token', res.status, text);
  }

  // Prefer durable OWUI API key when the server allows it (often disabled).
  let credential = token;
  try {
    const owuiKey = await ensureOwuiApiKey(root, token, fetchImpl);
    if (owuiKey) credential = owuiKey;
  } catch {
    /* keep JWT */
  }

  return {
    token: credential,
    email: (body.email as string) || email,
    name: body.name as string | undefined,
    id: body.id as string | undefined,
    role: body.role as string | undefined,
  };
}

/**
 * GET existing OWUI user API key, or POST to create one.
 * Returns undefined when keys are disabled / not found.
 */
export async function ensureOwuiApiKey(
  baseUrl: string,
  bearerToken: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<string | undefined> {
  const root = normalizeBaseUrl(baseUrl);
  const headers = {
    Authorization: `Bearer ${bearerToken}`,
    'Content-Type': 'application/json',
  };

  const getRes = await fetchImpl(`${root}/api/v1/auths/api_key`, {
    method: 'GET',
    headers,
  });
  if (getRes.ok) {
    const body = (await getRes.json()) as { api_key?: string };
    if (body.api_key?.trim()) return body.api_key.trim();
  }

  if (getRes.status !== 404) {
    return undefined;
  }

  const postRes = await fetchImpl(`${root}/api/v1/auths/api_key`, {
    method: 'POST',
    headers,
  });
  if (!postRes.ok) {
    return undefined;
  }
  const created = (await postRes.json()) as { api_key?: string };
  return created.api_key?.trim() || undefined;
}
