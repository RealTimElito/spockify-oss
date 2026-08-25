/**
 * @web / @docs / Web Search chip — spockify.eu SearXNG + browser fetch
 * (same backends as web chat / OWUI).
 */

import * as vscode from 'vscode';
import { getApiKey } from '../auth';

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface WebFetchResult {
  ok: boolean;
  url: string;
  title?: string;
  text?: string;
  chars?: number;
  error?: string;
}

function baseUrl(): string {
  return (
    vscode.workspace.getConfiguration('spockify').get<string>('baseUrl') ||
    'https://spockify.eu'
  ).replace(/\/$/, '');
}

export async function searchWeb(
  context: vscode.ExtensionContext,
  query: string,
  maxResults = 5,
): Promise<WebSearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  const key = await getApiKey(context);
  if (!key) {
    throw new Error('Sign in to Spockify to use web search');
  }

  const url = `${baseUrl()}/v1/search/spockify-searxng`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: q, max_results: maxResults }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Web search failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results || []).map((r) => ({
    title: r.title || r.url || '(result)',
    url: r.url || '',
    snippet: (r.content || '').slice(0, 800),
  }));
}

/**
 * Fetch page text via OWUI → router `/spockify/browser/fetch`
 * (allowlisted; confirm=true for open allowlist).
 */
export async function fetchWebUrl(
  context: vscode.ExtensionContext,
  pageUrl: string,
  opts?: { maxChars?: number },
): Promise<WebFetchResult> {
  const target = pageUrl.trim();
  if (!target) {
    return { ok: false, url: '', error: 'url required' };
  }

  const key = await getApiKey(context);
  if (!key) {
    return {
      ok: false,
      url: target,
      error: 'Sign in to Spockify to fetch URLs',
    };
  }

  const endpoint = `${baseUrl()}/api/v1/spockify/browser/fetch`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: target,
      confirm: true,
      action: 'navigate',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      ok: false,
      url: target,
      error: `Fetch failed (${res.status}): ${body.slice(0, 300)}`,
    };
  }
  const data = (await res.json()) as {
    ok?: boolean;
    url?: string;
    title?: string;
    text?: string;
    chars?: number;
    error?: string;
  };
  if (data.ok === false) {
    return {
      ok: false,
      url: data.url || target,
      error: data.error || 'fetch failed',
    };
  }
  const maxChars =
    typeof opts?.maxChars === 'number' && opts.maxChars > 0
      ? Math.min(opts.maxChars, 80_000)
      : 24_000;
  const text = (data.text || '').slice(0, maxChars);
  return {
    ok: true,
    url: data.url || target,
    title: data.title || '',
    text,
    chars: text.length,
  };
}

export function formatWebHits(hits: WebSearchHit[]): string {
  if (!hits.length) return '';
  const blocks = hits.map(
    (h, i) =>
      `${i + 1}. **${h.title}**\n   ${h.url}\n   ${h.snippet}`.trim(),
  );
  return `## Web search\n${blocks.join('\n\n')}`;
}
