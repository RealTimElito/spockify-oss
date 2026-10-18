/**
 * Product-root URLs for the IDE (not OpenAI `/v1` client URLs).
 * Chat/Tab/sync hit this root; the HTTP client appends `/v1` when needed.
 */

export const DEFAULT_CLOUD_BASE = 'https://spockify.eu';
/** OSS compose Open WebUI (docker/ide + ./docker/run.sh). */
export const DEFAULT_SELF_HOST_BASE = 'http://127.0.0.1:3080';
/** Lab twin LAN NodePort — hostname after the spark-f1f9 rename. */
export const SELF_HOST_LAN_HINT = 'http://sparky.local:30080';
export const DEPRECATED_TWIN_HOST = 'spark-f1f9.local';
export const CURRENT_TWIN_HOST = 'sparky.local';

export const ACCOUNT_API_KEY_HELP =
  'Create a 90-day sk- key in web chat: Settings → Account → API key. ' +
  'That is not the LiteLLM /ui/ admin (master key). ' +
  'OpenCode uses https://spockify.eu/v1 + sk-; this IDE uses the product root and appends /v1 itself.';

export const TAB_FIM_SELF_HOST_HELP =
  'Tab completions use Open WebUI on this same base URL (compose :3080, LAN :30080). ' +
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
 * retired twin hostname. Never returns `spark-f1f9.local`.
 */
export function normalizeProductBaseUrl(baseUrl?: string): string {
  let raw = (baseUrl || '').trim();
  if (!raw) return DEFAULT_CLOUD_BASE;
  raw = stripV1Suffix(withScheme(raw)).replace(/\/+$/, '');
  raw = raw.replace(DEPRECATED_TWIN_RE, CURRENT_TWIN_HOST);
  return raw || DEFAULT_CLOUD_BASE;
}

/** Alias used by the HTTP client. */
export function normalizeBaseUrl(baseUrl?: string): string {
  return normalizeProductBaseUrl(baseUrl);
}

export function isCloudHost(value: string | undefined): boolean {
  const raw = (value || '').trim();
  if (!raw) return true;
  try {
    const u = new URL(normalizeProductBaseUrl(raw));
    return /(^|\.)spockify\.eu$/i.test(u.hostname);
  } catch {
    return /spockify\.eu/i.test(raw);
  }
}

/** Placeholder for the Self-hosted form — compose, never the old twin name. */
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

export type ConnectKind = 'cloud' | 'selfhost' | 'key';

export interface ConnectRequest {
  kind: ConnectKind;
  baseUrl?: string;
  email?: string;
  password?: string;
  apiKey?: string;
}

export function resolveConnectBaseUrl(req: ConnectRequest): string {
  if (req.kind === 'cloud') {
    return DEFAULT_CLOUD_BASE;
  }
  return normalizeProductBaseUrl(req.baseUrl || DEFAULT_SELF_HOST_BASE);
}
