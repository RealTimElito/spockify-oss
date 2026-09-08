/**
 * Local Spark chat catalog — keep aliases in sync with
 * services/router/model_catalog.py. Used when the remote /v1/models list is
 * stale or missing new workers.
 */

export type ThinkingApi = 'effort' | 'boolean' | 'none';

export interface CatalogModel {
  alias: string;
  label: string;
  family: string;
  thinkingApi: ThinkingApi;
  strengths: string[];
  /** Hide from the default picker (still merge if the API returns it). */
  picker?: boolean;
  webAlias?: boolean;
}

/** Orchestrator alias — always first in the picker. */
export const AUTO_MODEL_ID = 'spockify-auto';

/**
 * Chat / vision / web workers the orchestrator may pick.
 * No Kimi :cloud / MiMo-V2.5.
 */
export const CATALOG_MODELS: readonly CatalogModel[] = [
  {
    alias: 'gemma4-12b',
    label: 'Gemma 4 12B',
    family: 'gemma',
    thinkingApi: 'effort',
    strengths: ['english_chat', 'reasoning', 'speed'],
  },
  {
    alias: 'gemma4-26b',
    label: 'Gemma 4 26B',
    family: 'gemma',
    thinkingApi: 'effort',
    strengths: ['english_chat', 'reasoning', 'analysis', 'vision'],
  },
  {
    alias: 'gemma4-31b',
    label: 'Gemma 4 31B',
    family: 'gemma',
    thinkingApi: 'effort',
    strengths: ['english_chat', 'reasoning', 'analysis'],
  },
  {
    alias: 'gpt-oss-20b',
    label: 'gpt-oss 20B',
    family: 'gpt-oss',
    thinkingApi: 'effort',
    strengths: ['code', 'reasoning', 'speed'],
  },
  {
    alias: 'gpt-oss-120b',
    label: 'gpt-oss 120B',
    family: 'gpt-oss',
    thinkingApi: 'effort',
    strengths: ['code', 'architecture', 'deep_reasoning', 'agentic'],
  },
  {
    alias: 'qwen3.5-9b',
    label: 'Qwen 3.5 9B',
    family: 'qwen',
    thinkingApi: 'effort',
    strengths: ['cjk', 'arabic', 'hangul', 'multilingual'],
  },
  {
    alias: 'qwen3.6-27b',
    label: 'Qwen 3.6 27B',
    family: 'qwen',
    thinkingApi: 'effort',
    strengths: ['cjk', 'arabic', 'hangul', 'multilingual'],
  },
  {
    alias: 'qwen3.6-35b',
    label: 'Qwen 3.6 35B',
    family: 'qwen',
    thinkingApi: 'effort',
    strengths: ['cjk', 'arabic', 'hangul', 'multilingual'],
  },
  {
    alias: 'qwen3.6-coder-27b',
    label: 'Qwen 3.6 Coder 27B',
    family: 'qwen',
    thinkingApi: 'effort',
    strengths: ['code'],
  },
  {
    alias: 'codestral',
    label: 'Codestral',
    family: 'codestral',
    thinkingApi: 'none',
    strengths: ['code'],
  },
  {
    alias: 'devstral-small-2',
    label: 'Devstral Small 2',
    family: 'mistral',
    thinkingApi: 'none',
    strengths: ['code', 'agentic', 'vision'],
  },
  {
    alias: 'devstral-2',
    label: 'Devstral 2',
    family: 'mistral',
    thinkingApi: 'none',
    strengths: ['code', 'agentic'],
  },
  {
    alias: 'magistral',
    label: 'Magistral 24B',
    family: 'mistral',
    thinkingApi: 'boolean',
    strengths: ['reasoning', 'english_chat', 'multilingual'],
  },
  {
    alias: 'ministral-3-14b',
    label: 'Ministral 3 14B',
    family: 'mistral',
    thinkingApi: 'none',
    strengths: ['english_chat', 'vision', 'speed'],
  },
  {
    alias: 'llama3.2-3b',
    label: 'Llama 3.2 3B',
    family: 'llama',
    thinkingApi: 'none',
    strengths: ['speed', 'greetings'],
  },
  {
    alias: 'llama3.2-3b-cpu',
    label: 'Llama 3.2 3B (CPU)',
    family: 'llama',
    thinkingApi: 'none',
    strengths: ['speed', 'greetings'],
  },
  {
    alias: 'llama3.1-8b',
    label: 'Llama 3.1 8B',
    family: 'llama',
    thinkingApi: 'none',
    strengths: ['speed', 'voice', 'summaries'],
  },
  {
    alias: 'llama3.3-70b',
    label: 'Llama 3.3 70B',
    family: 'llama',
    thinkingApi: 'none',
    strengths: ['english_chat', 'deep_chat'],
  },
  {
    alias: 'nemotron-nano-4b',
    label: 'Nemotron Nano 4B',
    family: 'nemotron',
    thinkingApi: 'effort',
    strengths: ['routing', 'speed'],
  },
  {
    alias: 'nemotron-mini',
    label: 'Nemotron Mini',
    family: 'nemotron',
    thinkingApi: 'effort',
    strengths: ['speed', 'agentic'],
  },
  {
    alias: 'nemotron-nano-30b',
    label: 'Nemotron Nano 30B',
    family: 'nemotron',
    thinkingApi: 'effort',
    strengths: ['reasoning', 'agentic'],
  },
  {
    alias: 'nemotron-70b',
    label: 'Nemotron 70B',
    family: 'nemotron',
    thinkingApi: 'effort',
    strengths: ['reasoning', 'agentic'],
  },
  {
    alias: 'mathstral',
    label: 'Mathstral',
    family: 'mistral',
    thinkingApi: 'none',
    strengths: ['math'],
  },
  {
    alias: 'mistral-nemo',
    label: 'Mistral Nemo',
    family: 'mistral',
    thinkingApi: 'none',
    strengths: ['english_chat'],
  },
  {
    alias: 'mistral-small3.1',
    label: 'Mistral Small 3.1',
    family: 'mistral',
    thinkingApi: 'none',
    strengths: ['english_chat'],
  },
  {
    alias: 'mistral-small3.2',
    label: 'Mistral Small 3.2',
    family: 'mistral',
    thinkingApi: 'none',
    strengths: ['vision', 'english_chat'],
  },
  {
    alias: 'phi4',
    label: 'Phi 4',
    family: 'phi',
    thinkingApi: 'none',
    strengths: ['stem', 'english_chat'],
  },
  {
    alias: 'phi4-mini',
    label: 'Phi 4 Mini',
    family: 'phi',
    thinkingApi: 'none',
    strengths: ['speed', 'stem'],
  },
  {
    alias: 'web-gemma',
    label: 'Web · Gemma',
    family: 'gemma',
    thinkingApi: 'effort',
    strengths: ['web_search', 'english_chat'],
    webAlias: true,
  },
  {
    alias: 'web-codestral',
    label: 'Web · Codestral',
    family: 'codestral',
    thinkingApi: 'none',
    strengths: ['web_search', 'code'],
    webAlias: true,
  },
  {
    alias: 'web-llama',
    label: 'Web · Llama',
    family: 'llama',
    thinkingApi: 'none',
    strengths: ['web_search', 'voice'],
    webAlias: true,
  },
  {
    alias: 'llava-llama3',
    label: 'LLaVA Llama 3',
    family: 'llava',
    thinkingApi: 'none',
    strengths: ['vision'],
  },
  {
    alias: 'llava-7b',
    label: 'LLaVA 7B',
    family: 'llava',
    thinkingApi: 'none',
    strengths: ['vision'],
  },
  {
    alias: 'llava-13b',
    label: 'LLaVA 13B',
    family: 'llava',
    thinkingApi: 'none',
    strengths: ['vision'],
  },
];

/** Preferred picker order (quality chat → code → Qwen → Mistral → rest). */
const PICKER_ORDER: readonly string[] = [
  'gemma4-31b',
  'gemma4-26b',
  'gemma4-12b',
  'gpt-oss-120b',
  'gpt-oss-20b',
  'qwen3.6-coder-27b',
  'codestral',
  'devstral-2',
  'devstral-small-2',
  'qwen3.5-9b',
  'qwen3.6-27b',
  'qwen3.6-35b',
  'magistral',
  'ministral-3-14b',
  'llama3.3-70b',
  'llama3.1-8b',
  'llama3.2-3b',
  'nemotron-70b',
  'nemotron-nano-30b',
  'nemotron-mini',
  'nemotron-nano-4b',
  'mistral-small3.2',
  'mistral-small3.1',
  'mistral-nemo',
  'mathstral',
  'phi4',
  'phi4-mini',
  'web-gemma',
  'web-codestral',
  'web-llama',
  'llava-llama3',
  'llava-7b',
  'llava-13b',
];

/** IDE coding picker order (matches LiteLLM `model_group_alias.code` + agents). */
const CODING_PICKER_ORDER: readonly string[] = [
  'gpt-oss-120b',
  'gpt-oss-20b',
  'codestral',
  'qwen3.6-coder-27b',
  'devstral-2',
  'devstral-small-2',
  'mathstral',
  'web-codestral',
];

const DENY_PICKER_RE = /(?:^|[-/:])(kimi|mimo)(?:$|[-/:])/i;

/**
 * Non-coding surfaces: embeddings, TTS, vision-only, greeting micros, orchestrator.
 * Coding models that also do vision (devstral-small-2) stay via allow prefixes.
 */
const CODING_DENY_RE =
  /(?:^|[-/:_.])(embed|embedding|tts|whisper|bark|speech|llava|granite-vision|orchestrator)(?:$|[-/:_.])/i;

/** Tiny greeting / CPU-only chat workers — not IDE coding targets. */
const GREETING_ONLY_IDS = new Set([
  'llama3.2-1b',
  'llama3.2-3b',
  'llama3.2-3b-cpu',
  'spockify-chat',
]);

/**
 * Defaults aligned with Spark LiteLLM `code` group + ROOM_CODER / agent entrypoints.
 * Users can extend via `spockify.models.codingAllowPrefixes`.
 */
export const DEFAULT_CODING_ALLOW_PREFIXES: readonly string[] = [
  'codestral',
  'spockify-coder',
  'spockify-auto',
  'spockify-room',
  'spockify-agents',
  'gpt-oss-',
  'gpt-oss:',
  'devstral',
  'mathstral',
  'codellama',
  'codegemma',
  'codeqwen',
  'starcoder',
  'deepseek-coder',
  'web-codestral',
  // Lab twin dual-role aliases (lab-orchestrator / lab-executor / …)
  'lab-',
];

/** Exact ids always kept when coding-only (beyond prefix match). */
export const DEFAULT_CODING_ALLOW_IDS: ReadonlySet<string> = new Set([
  AUTO_MODEL_ID,
  'spockify-coder',
  'spockify-room',
  'spockify-agents',
  'mathstral',
  'codestral',
  'codestral-latest',
  'codestral-22b',
  'codestral-vllm',
  'qwen3.6-coder-27b',
  'qwen3.6-27b-coding',
  'lab-orchestrator',
  'lab-executor',
  'lab-plan',
  'lab-code',
]);

/** Name heuristics for coder-tagged remotes (qwen*coder*, *coder*). */
const CODING_NAME_RE =
  /(?:^|[-/:_.])(coder|codestral|codellama|codegemma|codeqwen|devstral|mathstral|starcoder|deepseek-coder)(?:$|[-/:_.])/i;

export interface PickerModel {
  id: string;
  label: string;
  family?: string;
  oss?: boolean;
}

export interface MergePickerOptions {
  /**
   * Prefer coding-relevant models for IDE chat/composer/agent.
   * Default true. Set false to show the full chat catalog.
   */
  codingOnly?: boolean;
  /** Extra / override allow prefixes (matched case-insensitively). */
  allowPrefixes?: readonly string[];
  /** Extra / override exact allow ids. */
  allowIds?: readonly string[];
}

const BY_ALIAS = new Map(CATALOG_MODELS.map((m) => [m.alias, m]));

export function getCatalogModel(alias: string): CatalogModel | undefined {
  const raw = (alias || '').trim().toLowerCase();
  if (!raw) return undefined;
  if (BY_ALIAS.has(raw)) return BY_ALIAS.get(raw);
  const hyphen = raw.replace(/:/g, '-');
  return BY_ALIAS.get(hyphen);
}

export function catalogLabel(id: string): string {
  if (id === AUTO_MODEL_ID || id.endsWith('-auto')) return 'Auto';
  return getCatalogModel(id)?.label || id;
}

export function isDeniedPickerId(id: string): boolean {
  return DENY_PICKER_RE.test(id || '');
}

function normId(id: string): string {
  return (id || '').trim().toLowerCase();
}

function prefixAllowed(id: string, prefixes: readonly string[]): boolean {
  const n = normId(id);
  return prefixes.some((p) => {
    const pref = (p || '').trim().toLowerCase();
    if (!pref) return false;
    return n === pref || n.startsWith(pref);
  });
}

/**
 * True when an id belongs in the IDE coding model picker.
 * Uses catalog `strengths: code`, Spark code-group prefixes, and name heuristics.
 */
export function isCodingPickerId(
  id: string,
  opts: Pick<MergePickerOptions, 'allowPrefixes' | 'allowIds'> = {},
): boolean {
  const n = normId(id);
  if (!n || isDeniedPickerId(n)) return false;
  if (GREETING_ONLY_IDS.has(n)) return false;

  const allowIds = opts.allowIds?.length
    ? new Set([...DEFAULT_CODING_ALLOW_IDS, ...opts.allowIds.map(normId)])
    : DEFAULT_CODING_ALLOW_IDS;
  if (allowIds.has(n)) return true;

  const prefixes = opts.allowPrefixes?.length
    ? [...DEFAULT_CODING_ALLOW_PREFIXES, ...opts.allowPrefixes]
    : DEFAULT_CODING_ALLOW_PREFIXES;
  // Lab dual-role aliases must win over the generic "orchestrator" deny.
  if (prefixAllowed(n, prefixes)) return true;
  if (CODING_DENY_RE.test(n)) return false;

  const catalog = getCatalogModel(n);
  if (catalog?.strengths.includes('code')) return true;

  // qwen*coder* / *coder* remotes not yet in the local catalog
  if (/qwen/i.test(n) && /coder/i.test(n)) return true;
  if (CODING_NAME_RE.test(n)) return true;

  return false;
}

function remoteLabel(
  m: { id: string; label?: string; name?: string },
): string {
  return (m.label || m.name || getCatalogModel(m.id)?.label || m.id).trim();
}

/**
 * Catalog first (stable order), then extra remote ids.
 * Always includes spockify-auto. Strips Kimi/MiMo.
 * When `codingOnly` (default), keeps coding-relevant models only.
 */
export function mergePickerModels(
  remote: Array<{ id: string; label?: string; name?: string; oss?: boolean }> = [],
  options: MergePickerOptions = {},
): PickerModel[] {
  const codingOnly = options.codingOnly !== false;
  const codingOpts = {
    allowPrefixes: options.allowPrefixes,
    allowIds: options.allowIds,
  };
  const seen = new Set<string>();
  const out: PickerModel[] = [];

  const push = (row: PickerModel) => {
    const id = (row.id || '').trim();
    if (!id || seen.has(id) || isDeniedPickerId(id)) return;
    if (codingOnly && !isCodingPickerId(id, codingOpts)) return;
    seen.add(id);
    out.push({ ...row, id, oss: row.oss !== false });
  };

  push({
    id: AUTO_MODEL_ID,
    label: 'Auto (orchestrator)',
    family: 'auto',
    oss: true,
  });

  const order = codingOnly ? CODING_PICKER_ORDER : PICKER_ORDER;
  const ordered = [
    ...order.map((alias) => BY_ALIAS.get(alias)).filter(
      (m): m is CatalogModel => !!m,
    ),
    ...CATALOG_MODELS.filter((m) => !order.includes(m.alias)),
  ];
  for (const m of ordered) {
    push({
      id: m.alias,
      label: m.label,
      family: m.family,
      oss: true,
    });
  }

  for (const m of remote) {
    if (!m?.id) continue;
    const catalog = getCatalogModel(m.id);
    push({
      id: m.id,
      label: catalog?.label || remoteLabel(m),
      family: catalog?.family,
      oss: m.oss !== false,
    });
  }

  return out;
}

export function catalogAliases(): string[] {
  return CATALOG_MODELS.map((m) => m.alias);
}
