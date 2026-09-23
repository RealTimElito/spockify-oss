/**
 * Lab closed-loop harness talks OpenAI-compat to LiteLLM, not OWUI HTML.
 * Map product `spockify.baseUrl` (OWUI) → LiteLLM NodePort / compose port.
 */

const DEFAULT_LAB_LLM = 'http://127.0.0.1:30400';

/** Known OWUI → LiteLLM port remaps (twin NodePort + local compose). */
const OWUI_TO_LLM: Record<string, string> = {
  '30080': '30400',
  '3080': '4000',
  '30100': '30400',
};

export function resolveLabLlmBaseUrl(productBaseUrl?: string): string {
  const raw = (productBaseUrl || '').trim().replace(/\/+$/, '');
  if (!raw) {
    return DEFAULT_LAB_LLM;
  }
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    const port = u.port || (u.protocol === 'https:' ? '443' : '80');
    if (port === '30400' || port === '4000' || port === '4100') {
      return `${u.protocol}//${u.hostname}:${port}`;
    }
    const mapped = OWUI_TO_LLM[port];
    if (mapped) {
      return `${u.protocol}//${u.hostname}:${mapped}`;
    }
    // Private / twin-ish HTTP without a known OWUI port: prefer LiteLLM NodePort.
    if (u.protocol === 'http:' && looksLikeLanOrLoopback(u.hostname)) {
      return `${u.protocol}//${u.hostname}:30400`;
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return raw || DEFAULT_LAB_LLM;
  }
}

function looksLikeLanOrLoopback(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) {
    return true;
  }
  const parts = h.split('.').map((p) => Number(p));
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    const a = parts[0]!;
    const b = parts[1]!;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}
