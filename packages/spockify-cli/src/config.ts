import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://spockify.eu';
/** Primary coding model (orchestrator routes code → gpt-oss-20b; codestral is fallback). */
export const DEFAULT_MODEL = 'gpt-oss-20b';

/** Local OSS compose probes when SPOCKIFY_BASE_URL / WEBUI_URL are unset. */
export const LOCAL_BASE_CANDIDATES = [
  'http://127.0.0.1:3080',
  'http://127.0.0.1:4000',
] as const;

export function formatUnreachableHint(baseUrl: string): string {
  return (
    `For local OSS compose use --base-url http://127.0.0.1:3080 ` +
    `(or export SPOCKIFY_BASE_URL / WEBUI_URL). Tried host: ${baseUrl}. ` +
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

/**
 * Resolve API key for the active base URL.
 * Saved device keys are host-scoped — ignore them when pointing at a different stack.
 * Local compose often has LITELLM_MASTER_KEY in the shell env.
 */
export function resolveApiKey(
  explicit?: string,
  baseUrl?: string,
): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  const fromEnv = process.env.SPOCKIFY_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const master = process.env.LITELLM_MASTER_KEY?.trim();
  if (master && baseUrl) {
    const local =
      hostKey(baseUrl).startsWith('127.0.0.1:') ||
      hostKey(baseUrl).startsWith('localhost:');
    if (local) return master;
  }
  const creds = loadCredentials();
  if (!creds?.accessToken) return undefined;
  if (baseUrl && hostKey(creds.baseUrl) !== hostKey(baseUrl)) {
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
