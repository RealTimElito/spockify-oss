/**
 * Product-root URLs for the IDE (not OpenAI `/v1` client URLs).
 * Chat/Tab/sync hit this root; the HTTP client appends `/v1` when needed.
 *
 * Defaults are local compose — not a hosted cloud product.
 */

/** @deprecated Prefer DEFAULT_SELF_HOST_BASE. Kept for isCloudHost checks. */
export const DEFAULT_CLOUD_BASE = 'https://spockify.eu';
/** OSS compose Open WebUI (docker/ide + ./docker/run.sh). */
export const DEFAULT_SELF_HOST_BASE = 'http://127.0.0.1:3080';
/** Optional LAN example when the stack is on another machine. */
export const SELF_HOST_LAN_HINT = 'http://10.0.0.10:3080';
export const DEPRECATED_TWIN_HOST = 'spark-f1f9.local';
export const CURRENT_TWIN_HOST = 'sparky.local';

export const ACCOUNT_API_KEY_HELP =
  'Create an sk- key in your Spockify chat UI: Settings → Account → API key. ' +
  'That is not the LiteLLM /ui/ admin (master key). ' +
  'You can also paste a key from any OpenAI-compatible server that exposes /v1.';

export const TAB_FIM_SELF_HOST_HELP =
  'Tab completions use Open WebUI on this same base URL (compose default :3080). ' +
  'Do not point the IDE base URL at the router :4100.';

const V1_SUFFIX = /\/v1$/i;
const DEPRECATED_TWIN_RE = /spark-f1f9\.local/gi;

export function isDeprecatedTwinHost(value: string | undefined): boolean {
  return /spark-f1f9\.local/i.test(value || '');
}

export function stripV1Suffix(url: string): string {
  return (url || '').trim().replace(/\/+$/, '').replace(V1_SUFFIX, '');
}

function withScheme(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `http://${raw}`;
}

/**
 * Normalize an IDE product root: trim, strip trailing `/v1`, rewrite the
 * retired twin hostname. Empty → local compose.
 */
export function normalizeProductBaseUrl(baseUrl?: string): string {
  let raw = (baseUrl || '').trim();
  if (!raw) return DEFAULT_SELF_HOST_BASE;
  raw = stripV1Suffix(withScheme(raw)).replace(/\/+$/, '');
  raw = raw.replace(DEPRECATED_TWIN_RE, CURRENT_TWIN_HOST);
  return raw || DEFAULT_SELF_HOST_BASE;
}

/** Alias used by the HTTP client. */
export function normalizeBaseUrl(baseUrl?: string): string {
  return normalizeProductBaseUrl(baseUrl);
}

export function isCloudHost(value: string | undefined): boolean {
  const raw = (value || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(normalizeProductBaseUrl(raw));
    return /(^|\.)spockify\.eu$/i.test(u.hostname);
  } catch {
    return /spockify\.eu/i.test(raw);
  }
}

/** Placeholder for the Self-hosted form — compose, never a hosted default. */
export function selfHostPlaceholder(current?: string): string {
  const cur = (current || '').trim();
  if (!cur || isCloudHost(cur) || isDeprecatedTwinHost(cur)) {
    return DEFAULT_SELF_HOST_BASE;
  }
  return normalizeProductBaseUrl(cur);
}

/** OpenAI-compat URL clients like OpenCode use. IDE does not store this. */
export function v1ClientUrl(productRoot?: string): string {
  return `${normalizeProductBaseUrl(productRoot)}/v1`;
}

export function looksLikeRouterPort(url: string | undefined): boolean {
  const raw = (url || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    return u.port === '4100';
  } catch {
    return /:4100(\/|$)/.test(raw);
  }
}

export function connectionHostLabel(baseUrl?: string): string {
  const root = normalizeProductBaseUrl(baseUrl);
  try {
    const u = new URL(root);
    return u.host || root.replace(/^https?:\/\//, '');
  } catch {
    return root.replace(/^https?:\/\//, '');
  }
}

/** Account connect modes — local/self-host first; no hosted cloud picker. */
export type ConnectKind = 'selfhost' | 'key';

export interface ConnectRequest {
  kind: ConnectKind;
  baseUrl?: string;
  email?: string;
  password?: string;
  apiKey?: string;
}

export function resolveConnectBaseUrl(req: ConnectRequest): string {
  return normalizeProductBaseUrl(req.baseUrl || DEFAULT_SELF_HOST_BASE);
}
