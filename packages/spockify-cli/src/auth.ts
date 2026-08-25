import { spawn } from 'node:child_process';
import { DEFAULT_BASE_URL, saveCredentials, type SpockifyCredentials } from './config';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface TokenSuccess {
  access_token: string;
  token_type?: string;
  user?: { id?: string; email?: string; name?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function postJson<T>(
  url: string,
  body: unknown,
): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: T;
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
  }
  return { status: res.status, data };
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* ignore */
  }
}

/**
 * Device link+code login (Claude Code–style).
 * Opens the verification URL and polls until a LiteLLM virtual key is minted.
 */
export async function deviceLogin(options: {
  baseUrl?: string;
  open?: boolean;
  onStatus?: (msg: string) => void;
}): Promise<SpockifyCredentials> {
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const say = options.onStatus ?? (() => undefined);

  const started = await postJson<DeviceCodeResponse>(
    `${baseUrl}/api/v1/spockify/cli/device/code`,
    {},
  );
  if (started.status >= 400) {
    throw new Error(
      `Failed to start device login (${started.status}): ${JSON.stringify(started.data)}`,
    );
  }
  const dc = started.data;
  const link = dc.verification_uri_complete || dc.verification_uri;
  say('');
  say('Spockify CLI login');
  say(`  Code:  ${dc.user_code}`);
  say(`  Link:  ${link}`);
  say('');
  say('Open the link, sign in to Spockify if needed, enter the code, Approve.');
  say('Waiting…');

  if (options.open !== false) openBrowser(link);

  const deadline = Date.now() + (dc.expires_in || 900) * 1000;
  let intervalMs = Math.max(2, dc.interval || 5) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const polled = await postJson<TokenSuccess & { detail?: unknown; error?: string }>(
      `${baseUrl}/api/v1/spockify/cli/device/token`,
      {
        device_code: dc.device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
    );

    const body = polled.data as unknown as Record<string, unknown>;
    const detail =
      body.detail && typeof body.detail === 'object'
        ? (body.detail as Record<string, unknown>)
        : body;
    const err = String(detail.error || body.error || '');

    if (polled.status < 400 && typeof body.access_token === 'string') {
      const creds: SpockifyCredentials = {
        accessToken: String(body.access_token),
        baseUrl,
        user: body.user as SpockifyCredentials['user'],
        updatedAt: new Date().toISOString(),
      };
      saveCredentials(creds);
      say('Logged in.');
      return creds;
    }

    if (err === 'authorization_pending' || err === 'slow_down') {
      if (err === 'slow_down') intervalMs += 2000;
      continue;
    }
    if (err === 'access_denied') {
      throw new Error('Login denied in browser.');
    }
    if (err === 'expired_token') {
      throw new Error('Device code expired — run login again.');
    }
    // FastAPI wraps errors in detail
    if (polled.status === 400 && !err) {
      continue;
    }
    throw new Error(
      `Login failed (${polled.status}): ${JSON.stringify(polled.data).slice(0, 300)}`,
    );
  }
  throw new Error('Login timed out — run spockify login again.');
}
