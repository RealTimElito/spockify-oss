export type CodingPool = 'spark' | 'lab' | 'eval';

export type CodingModelRow = {
  id: string;
  role: string;
  pool: CodingPool;
  think_allowed: string[];
  promoted: boolean;
  /** Eval-host Ollama tag when this catalog id is served locally. */
  ollama_tag?: string;
};

export type CodingCatalogV1 = {
  version: number;
  note?: string;
  models: CodingModelRow[];
  /** Unpublished candidates (promoted:false). Not prod pins; do not pull weights. */
  lab_models: CodingModelRow[];
};

/** Prod coding pins — keep in sync with catalog/coding-models.v1.json. */
export const CODING_CATALOG_V1: CodingCatalogV1 = {
  version: 1,
  note: 'Prod coding pins: gpt-oss-20b / gpt-oss-120b only. lab_models lists unpublished candidates (promoted:false). qwen3-coder-30b-a3b maps to Instruct Q4/Q8 (not fp16). Selecting devstral-2 evicts 120b-hot. Do not add lab candidates to the prod dropdown.',
  models: [
    {
      id: 'gpt-oss-20b',
      role: 'coder',
      pool: 'spark',
      think_allowed: ['off', 'low', 'medium', 'high'],
      promoted: true,
    },
    {
      id: 'gpt-oss-120b',
      role: 'coder',
      pool: 'spark',
      think_allowed: ['off', 'low', 'medium', 'high'],
      promoted: true,
    },
  ],
  lab_models: [
    {
      id: 'devstral-small-2',
      role: 'coder',
      pool: 'lab',
      think_allowed: ['off'],
      promoted: false,
    },
    {
      id: 'devstral-2',
      role: 'coder',
      pool: 'lab',
      think_allowed: ['off'],
      promoted: false,
    },
    {
      id: 'qwen3-coder-30b-a3b',
      role: 'coder',
      pool: 'eval',
      think_allowed: ['off', 'low', 'medium', 'high'],
      promoted: false,
      ollama_tag: 'qwen3-coder:30b-a3b-q4_K_M',
    },
  ],
};

const WRITE_TOOLS = new Set(['apply_patch', 'write_file', 'edit_file']);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

export function promotedCodingIds(
  catalog: CodingCatalogV1 = CODING_CATALOG_V1,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of catalog.models) {
    if (!row.promoted || !row.id || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row.id);
  }
  return out;
}

export function isProdCodingPin(id: string): boolean {
  const n = (id || '').trim().toLowerCase().replace(/:/g, '-');
  return promotedCodingIds().some((p) => p.toLowerCase() === n);
}

export function isAutoModelId(id: string): boolean {
  const n = (id || '').trim().toLowerCase();
  return n === 'auto' || n === 'spockify-auto' || n.endsWith('-auto');
}

/** After the first write, Auto must stick to the resolved worker for the session. */
export function pinModelAfterWrite(current: string, resolved?: string): string {
  if (!isAutoModelId(current)) return current;
  const r = (resolved || '').trim();
  return r || current;
}

export function filterToCodingPins<T extends { id: string }>(rows: T[]): T[] {
  return rows.filter((r) => isProdCodingPin(r.id));
}

/** Unpublished lab/eval candidates — not selectable prod pins. */
export function unpublishedLabModels(
  catalog: CodingCatalogV1 = CODING_CATALOG_V1,
): CodingModelRow[] {
  return catalog.lab_models.filter((row) => !row.promoted);
}

function normCatalogId(id: string): string {
  return (id || '').trim().toLowerCase().replace(/:/g, '-');
}

/** True for unpublished catalog rows (Devstral / Qwen). Auto must never pick these. */
export function isLabCatalogId(id: string): boolean {
  const n = normCatalogId(id);
  if (!n) return false;
  return unpublishedLabModels().some((row) => {
    const rid = normCatalogId(row.id);
    return rid === n || n.startsWith(`${rid}-`) || row.pool === 'lab' && rid === n;
  });
}

export type CodingPickerSection = 'auto' | 'prod' | 'lab';

export type CodingPickerItem = {
  id: string;
  blurb: string;
  section: CodingPickerSection;
};

/** Same picker: Auto + prod 20b/120b + Lab models (promoted:false). */
export function codingPickerItems(
  catalog: CodingCatalogV1 = CODING_CATALOG_V1,
): CodingPickerItem[] {
  const out: CodingPickerItem[] = [
    {
      id: 'spockify-auto',
      blurb: 'session picker · 20b or 120b',
      section: 'auto',
    },
  ];
  for (const id of promotedCodingIds(catalog)) {
    out.push({ id, blurb: 'prod coding pin', section: 'prod' });
  }
  for (const row of unpublishedLabModels(catalog)) {
    let blurb = 'lab · unpublished';
    if (row.id === 'devstral-2') blurb = 'lab · evicts 120b-hot';
    else if (row.id === 'qwen3-coder-30b-a3b') blurb = 'lab · Instruct Q4/Q8';
    out.push({ id: row.id, blurb, section: 'lab' });
  }
  return out;
}

function findLabRow(id: string): CodingModelRow | undefined {
  const n = normCatalogId(id);
  if (!n) return undefined;
  return unpublishedLabModels().find((row) => normCatalogId(row.id) === n);
}

/** Ollama tags to probe for a lab catalog id (canonical first). */
export function catalogOllamaTags(id: string): string[] {
  const tag = findLabRow(id)?.ollama_tag?.trim();
  return tag ? [tag] : [];
}

/**
 * Pick the id to send to /v1/chat/completions from a host's model list.
 * Prefers the catalog id, then the mapped Ollama tag, then a same-stem tag
 * (Q4 vs Q8). Returns undefined when the host has none of them.
 */
export function matchLabUpstreamId(
  catalogId: string,
  available: string[],
): string | undefined {
  const want = [catalogId, ...catalogOllamaTags(catalogId)]
    .map((s) => s.trim())
    .filter(Boolean);
  const lower = new Map(
    available
      .map((id) => [id.trim().toLowerCase(), id.trim()] as const)
      .filter(([k, v]) => k && v),
  );
  for (const w of want) {
    const hit = lower.get(w.toLowerCase());
    if (hit) return hit;
  }
  const tag = catalogOllamaTags(catalogId)[0];
  if (!tag) return undefined;
  const stem = tag.replace(/-[qQ]\d.*$/, '').toLowerCase();
  if (stem.length < 8) return undefined;
  for (const [k, v] of lower) {
    if (k === stem || k.startsWith(`${stem}-`) || k.startsWith(`${stem}:`)) {
      return v;
    }
  }
  return undefined;
}

/** Catalog id → Ollama tag when mapped; otherwise the id unchanged. */
export function resolveUpstreamModelId(id: string): string {
  return catalogOllamaTags(id)[0] || (id || '').trim();
}

/**
 * gpt-oss / Qwen 3.5–3.6 / Gemma / Nemotron / Magistral accept a think flag.
 * qwen3-coder Instruct, llama, codestral, devstral, ministral do not —
 * never send think= (including off) to those.
 */
export function modelAcceptsThinkFlag(id: string): boolean {
  const n = normCatalogId(id);
  if (!n) return false;
  if (n.includes('gpt-oss')) return true;
  if (/qwen3[.-]?[5-8]/.test(n)) return true;
  if (n.includes('gemma') || n.includes('nemotron') || n.includes('magistral')) {
    return true;
  }
  return false;
}

/** Fields for the chat body. Off and unsupported models omit think entirely. */
export function thinkingRequestFields(
  model: string,
  thinking?: string,
): { spockify_thinking?: string } {
  const t = (thinking || '').trim().toLowerCase();
  if (!t || t === 'off') return {};
  if (!modelAcceptsThinkFlag(model)) return {};
  return { spockify_thinking: t };
}

export function isPublicProdHost(url: string): boolean {
  try {
    const raw = (url || '').trim();
    const u = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return /^(www\.)?spockify\.eu$/i.test(u.hostname);
  } catch {
    return /spockify\.eu/i.test(url || '');
  }
}

/** Clear error when a lab pin is aimed at an API that does not serve it. */
export function formatLabModelMissingError(id: string, host: string): string {
  const tag = catalogOllamaTags(id)[0] || id;
  const shown = (host || 'the configured API').replace(/\/+$/, '');
  if (isPublicProdHost(shown)) {
    return (
      `${id} is a lab model; not on ${shown}. ` +
      `Point --base-url at local Ollama (http://127.0.0.1:11434) or LiteLLM ` +
      `on the box that has ${tag}.`
    );
  }
  return (
    `${id} is not on ${shown}. ` +
    `Eval hosts serve it as ${tag}. ` +
    `Use --base-url http://127.0.0.1:11434 when Ollama has the weights.`
  );
}

/** --model / dropdown may pin Auto, prod, or unpublished lab ids. */
export function isSelectableCodingId(id: string): boolean {
  const n = normCatalogId(id);
  if (!n) return false;
  if (isAutoModelId(id)) return true;
  if (isProdCodingPin(id)) return true;
  return unpublishedLabModels().some((row) => normCatalogId(row.id) === n);
}

/** Honest no-op: nothing is promoted without a green fixture CARD. */
export function promoteLabModelHint(id?: string): string {
  const rows = unpublishedLabModels();
  const want = (id || '').trim();
  const row = want
    ? rows.find((r) => r.id.toLowerCase() === want.toLowerCase())
    : rows[0];
  const tag = row?.id || want || 'lab candidate';
  return (
    `Promote is a no-op until a fixture CARD exists for ${tag}. ` +
    'It stays unpublished (promoted:false). ' +
    'Pulling weights is a human + eval-host job after a green fixture card.'
  );
}

/** Session HUD: harness=<id> · <model tag> · think=<level>. */
export function formatSessionPin(opts: {
  harnessId?: string;
  model: string;
  thinking?: string;
  /** After the session picker resolved Auto to a real tag. */
  auto?: boolean;
  resolved?: string;
}): string {
  const harness = (opts.harnessId || 'spockify').trim() || 'spockify';
  const model = (opts.model || '').trim() || 'gpt-oss-20b';
  const think = (opts.thinking || 'off').trim() || 'off';
  const tag = (opts.resolved || model).trim() || 'gpt-oss-20b';
  const shown =
    opts.auto || isAutoModelId(model)
      ? `auto → ${isAutoModelId(tag) ? 'gpt-oss-20b' : tag} think=${think}`
      : `${model} · think=${think}`;
  const pin = `harness=${harness} · ${shown}`;
  const n = tag.toLowerCase().replace(/:/g, '-');
  if (n === 'devstral-2' || n.startsWith('devstral-2-')) {
    return `${pin} · evicts 120b-hot`;
  }
  return pin;
}
