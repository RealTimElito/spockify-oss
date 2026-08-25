import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_BASE_URL = 'https://spockify.eu';
/** Primary coding model (orchestrator routes code → gpt-oss-20b; codestral is fallback). */
export const DEFAULT_MODEL = 'gpt-oss-20b';

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

export function resolveApiKey(explicit?: string): string | undefined {
  const fromEnv = process.env.SPOCKIFY_API_KEY?.trim();
  if (explicit?.trim()) return explicit.trim();
  if (fromEnv) return fromEnv;
  return loadCredentials()?.accessToken;
}

export function resolveBaseUrl(explicit?: string): string {
  const fromEnv = process.env.SPOCKIFY_BASE_URL?.trim();
  if (explicit?.trim()) return explicit.trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  return loadCredentials()?.baseUrl || DEFAULT_BASE_URL;
}
