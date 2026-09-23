import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://spockify.eu';
/** Primary coding model (orchestrator routes code → gpt-oss-20b; codestral is fallback). */
export const DEFAULT_MODEL = 'gpt-oss-20b';

/** Local OSS compose probes when SPOCKIFY_BASE_URL / WEBUI_URL are unset. */
export const LOCAL_BASE_CANDIDATES = [
  'http://127.0.0.1:3080',
  'http://127.0.0.1:30080',  // lab twin OWUI NodePort
  'http://127.0.0.1:4000',
  'http://127.0.0.1:30400',
] as const;

/** Lab twin probes when SPOCKIFY_LAB_HOST or SPOCKIFY_LAB_TWIN is set. */
export function labTwinBaseCandidates(): string[] {
  const host = (process.env.SPOCKIFY_LAB_HOST || '').trim();
  if (host) {
    return [
      `http://${host}:30080`,
      `http://${host}:30400`,
      `http://${host}:30100`,
    ];
  }
  if (process.env.SPOCKIFY_LAB_TWIN === '1') {
    // Host comes from env only — do not hardcode LAN IPs in the CLI package.
    return ['http://127.0.0.1:30080', 'http://127.0.0.1:30400'];
  }
  return [];
}

export function formatUnreachableHint(baseUrl: string): string {
  return (
    `For local OSS compose use --base-url http://127.0.0.1:3080 ` +
    `(or export SPOCKIFY_BASE_URL / WEBUI_URL). Lab twin: SPOCKIFY_LAB_HOST=<host> ` +
    `or SPOCKIFY_BASE_URL=http://<host>:30400. Tried host: ${baseUrl}. ` +
    `Cloud default is ${DEFAULT_BASE_URL}.`
  );
}

export interface SpockifyCredentials {
  accessToken: string;
  baseUrl: string;
  user?: { id?: string; email?: string; name?: string };
  updatedAt: string;
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) return path.join(xdg, 'spockify');
  return path.join(os.homedir(), '.config', 'spockify');
}

export function credentialsPath(): string {
  return path.join(configDir(), 'credentials.json');
}

export function ensureConfigDir(): void {
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
}

export function loadCredentials(): SpockifyCredentials | null {
  const p = credentialsPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as SpockifyCredentials;
    if (!raw?.accessToken) return null;
    return {
      ...raw,
      baseUrl: (raw.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    };
  } catch {
    return null;
  }
}

export function saveCredentials(creds: SpockifyCredentials): void {
  ensureConfigDir();
  const p = credentialsPath();
  fs.writeFileSync(p, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
}

export function clearCredentials(): void {
  const p = credentialsPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function hostKey(url: string): string {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return `${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
  } catch {
    return url.replace(/\/+$/, '').toLowerCase();
  }
}

/** OWUI vs LiteLLM NodePorts on the same hostname share device-minted keys. */
const OWUI_PORTS = new Set(['30080', '3080', '80', '443']);
const LITELLM_PORTS = new Set(['30400', '4000', '30100']);

function parseHostPort(url: string): { hostname: string; port: string } | null {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? '443' : '80'),
    };
  } catch {
    return null;
  }
}

/** True when URLs are the same stack (exact host:port or OWUI↔LiteLLM on one host). */
export function sameCredentialStack(a: string, b: string): boolean {
  if (hostKey(a) === hostKey(b)) return true;
  const pa = parseHostPort(a);
  const pb = parseHostPort(b);
  if (!pa || !pb || pa.hostname !== pb.hostname) return false;
  const cross =
    (OWUI_PORTS.has(pa.port) && LITELLM_PORTS.has(pb.port)) ||
    (LITELLM_PORTS.has(pa.port) && OWUI_PORTS.has(pb.port));
  return cross;
}

/**
 * Device login lives on Open WebUI, not LiteLLM.
 * Map LiteLLM ports → matching OWUI NodePort/compose port on the same host.
 */
export function webUiBaseForLogin(baseUrl: string): string {
  try {
    const u = new URL(baseUrl.includes('://') ? baseUrl : `http://${baseUrl}`);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (!LITELLM_PORTS.has(port)) return baseUrl.replace(/\/+$/, '');
    // Lab twin LiteLLM :30400 / :30100 → OWUI :30080; compose :4000 → :3080.
    u.port = port === '4000' ? '3080' : '30080';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return baseUrl.replace(/\/+$/, '');
  }
}

/**
 * Lab closed-loop talks OpenAI `/v1/*` on LiteLLM.
 * Map OWUI NodePort/compose → matching LiteLLM port on the same host.
 */
export function liteLlmBaseForApi(baseUrl: string): string {
  try {
    const u = new URL(baseUrl.includes('://') ? baseUrl : `http://${baseUrl}`);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (LITELLM_PORTS.has(port)) return baseUrl.replace(/\/+$/, '');
    if (!OWUI_PORTS.has(port) && port !== '') return baseUrl.replace(/\/+$/, '');
    // Lab twin OWUI :30080 → LiteLLM :30400; compose :3080 → :4000.
    u.port = port === '3080' || port === '80' || port === '443' ? '4000' : '30400';
    return u.toString().replace(/\/+$/, '');
  } catch {
    return baseUrl.replace(/\/+$/, '');
  }
}

/** Loopback, lab env, or RFC1918 — safe to use LITELLM_MASTER_KEY from shell. */
function allowsEnvMasterKey(baseUrl: string): boolean {
  if (process.env.SPOCKIFY_LAB_TWIN === '1') return true;
  if (process.env.SPOCKIFY_LAB_HOST?.trim()) return true;
  const host = hostKey(baseUrl).split(':')[0] || '';
  if (host === '127.0.0.1' || host === 'localhost') return true;
  const parts = host.split('.').map((p) => Number(p));
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    const a = parts[0]!;
    const b = parts[1]!;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/**
 * Resolve API key for the active base URL.
 * Saved device keys are host-scoped — ignore them when pointing at a different stack.
 * Local compose / lab twin often has LITELLM_MASTER_KEY in the shell env.
 */
export function resolveApiKey(
  explicit?: string,
  baseUrl?: string,
): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  const fromEnv = process.env.SPOCKIFY_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const master = process.env.LITELLM_MASTER_KEY?.trim();
  if (master && baseUrl && allowsEnvMasterKey(baseUrl)) {
    return master;
  }
  const creds = loadCredentials();
  if (!creds?.accessToken) return undefined;
  // Host-scoped, but OWUI (:30080/:3080) keys are valid on same-host LiteLLM.
  if (baseUrl && !sameCredentialStack(creds.baseUrl, baseUrl)) {
    return undefined;
  }
  return creds.accessToken;
}

/** Sync resolver (env + saved creds only). Prefer discoverBaseUrl() at startup. */
export function resolveBaseUrl(explicit?: string): string {
  const fromEnv = process.env.SPOCKIFY_BASE_URL?.trim();
  // Compose / OWUI often export WEBUI_URL on OSS self-host boxes.
  const fromWebui = process.env.WEBUI_URL?.trim();
  if (explicit?.trim()) return explicit.trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (fromWebui) return fromWebui.replace(/\/+$/, '');
  return loadCredentials()?.baseUrl || DEFAULT_BASE_URL;
}
