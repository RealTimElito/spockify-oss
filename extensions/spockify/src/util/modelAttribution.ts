/**
 * Display helpers for which model generated chat / code.
 * Provenance must say "routed via spockify" — never homelab infra or internal hosts.
 */

export const ROUTED_VIA_SPOCKIFY = 'routed via spockify';

const FORBIDDEN_IN_UI =
  /\b(spark|[a-z0-9][a-z0-9-]*\.local|localhost|127\.0\.0\.1|homelab|litellm)\b/i;

export function isAutoModelId(id: string | undefined): boolean {
  if (!id) return false;
  return id === 'spockify-auto' || id.endsWith('-auto');
}

/** Prefer response model; fall back to requested id. */
export function pickResolvedModel(
  requested: string,
  fromResponse?: string,
): string {
  const res = sanitizeModelId(fromResponse || '');
  if (res) return res;
  return sanitizeModelId(requested) || (requested || '').trim();
}

/** Strip vendor path noise; drop forbidden infra names from display. */
export function sanitizeModelId(id: string | undefined): string {
  let t = (id || '').trim();
  if (!t) return '';
  if (FORBIDDEN_IN_UI.test(t)) {
    t = t
      .replace(/spark/gi, '')
      .replace(/[a-z0-9][a-z0-9-]*\.local/gi, '')
      .replace(/localhost/gi, '')
      .replace(/127\.0\.0\.1/gi, '')
      .replace(/homelab/gi, '')
      .replace(/litellm/gi, '')
      .replace(/[/\s._-]+$/g, '')
      .replace(/^[/\s._-]+/g, '')
      .trim();
  }
  const parts = t.split('/');
  return parts[parts.length - 1] || t;
}

export function shortModelId(id: string): string {
  return sanitizeModelId(id);
}

/**
 * Compact model label (chip body before provenance suffix).
 * Auto + distinct resolved → `Auto · qwen2.5-coder`.
 */
export function formatModelLabel(
  requested?: string,
  resolved?: string,
): string {
  const req = sanitizeModelId(requested);
  const res = sanitizeModelId(resolved);
  if (res && req && isAutoModelId(requested) && res !== req) {
    return `Auto · ${res}`;
  }
  const id = res || req;
  if (!id) return '';
  if (isAutoModelId(requested || id)) {
    return res && res !== req ? `Auto · ${res}` : 'Auto';
  }
  return id;
}

/**
 * Full provenance for assistant chips / toasts.
 * Exact pattern: `{model} · routed via spockify`
 */
export function formatModelAttribution(
  requested?: string,
  resolved?: string,
): string {
  const label = formatModelLabel(requested, resolved);
  if (!label) return ROUTED_VIA_SPOCKIFY;
  return `${label} · ${ROUTED_VIA_SPOCKIFY}`;
}

/** Guard: never leak homelab infra or internal hostnames in any UI string we emit. */
export function assertNoSparkLeak(text: string): string {
  if (!FORBIDDEN_IN_UI.test(text)) return text;
  return text
    .replace(/\b[Ss]park\b/g, 'spockify')
    .replace(/\b[a-z0-9][a-z0-9-]*\.local\b/gi, 'spockify.eu')
    .replace(/\blocalhost\b/gi, 'spockify.eu')
    .replace(/\b127\.0\.0\.1\b/g, 'spockify.eu')
    .replace(/\bhomelab\b/gi, 'spockify')
    .replace(/\blitellm\b/gi, 'spockify');
}
