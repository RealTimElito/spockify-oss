/** OSS model policy — allowlist / denylist for Spockify desktop. */

/** Known closed / proprietary model id prefixes (case-insensitive). */
export const DENY_PREFIXES: readonly string[] = [
  'gpt-',
  'o1',
  'o3',
  'o4',
  'chatgpt',
  'claude-',
  'anthropic',
  'gemini-',
  'palm-',
  'bard',
  'copilot',
  'davinci',
  'text-davinci',
  'cursor-',
  'kimi',
  'mimo',
];

/** Exact deny ids. */
export const DENY_IDS: ReadonlySet<string> = new Set([
  'gpt-4',
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
  'claude-sonnet-4',
  'claude-opus-4',
]);

/**
 * Known OSS / Spockify router aliases allowed via spockify.eu.
 * Prefix match: ids starting with these (or exact) pass when allowlist is on.
 */
export const ALLOW_PREFIXES: readonly string[] = [
  'spockify-',
  'gpt-oss-',
  'gpt-oss:',
  'codestral',
  'web-codestral',
  'web-gemma',
  'web-llama',
  'orchestrator',
  'gemma',
  'llama',
  'mistral',
  'mixtral',
  'magistral',
  'ministral',
  'mathstral',
  'devstral',
  'nemotron',
  'qwen',
  'deepseek',
  'phi',
  'llava',
  'starcoder',
  'codellama',
  'command-r',
  'ollama/',
  'local/',
];

export const ALLOW_IDS: ReadonlySet<string> = new Set([
  'spockify-auto',
  'spockify-room',
  'spockify-agents',
  'gpt-oss-20b',
  'gpt-oss-120b',
  'gemma4-31b',
  'gemma4-26b',
  'gemma4-12b',
  'qwen3.5-9b',
  'qwen3.6-27b',
  'qwen3.6-35b',
  'qwen3.6-coder-27b',
  'magistral',
  'devstral-small-2',
  'ministral-3-14b',
  'codestral',
  'web-codestral',
  'web-gemma',
  'web-llama',
  'orchestrator',
]);

export interface ModelLike {
  id: string;
  [key: string]: unknown;
}

export interface FilterOptions {
  /** Default true — strip closed models. */
  ossOnly?: boolean;
}

function norm(id: string): string {
  return id.trim().toLowerCase();
}

/** True if id is explicitly denied (closed cloud). */
export function isDeniedModel(id: string): boolean {
  const n = norm(id);
  if (ALLOW_IDS.has(n) || n.startsWith('gpt-oss-') || n.startsWith('gpt-oss:')) {
    return false;
  }
  if (DENY_IDS.has(n)) {
    return true;
  }
  return DENY_PREFIXES.some((p) => n === p || n.startsWith(p));
}

/** True if id matches OSS allowlist (Spockify aliases + open-weight families). */
export function isAllowedOssModel(id: string): boolean {
  const n = norm(id);
  if (isDeniedModel(n)) {
    return false;
  }
  if (ALLOW_IDS.has(n)) {
    return true;
  }
  return ALLOW_PREFIXES.some((p) => n === p || n.startsWith(p));
}

/**
 * Filter a catalog for OSS-only policy.
 * When ossOnly=false, still strips hard denylist (safety).
 */
export function filterOssModels<T extends ModelLike>(
  models: T[],
  options: FilterOptions = {},
): T[] {
  const ossOnly = options.ossOnly !== false;
  return models.filter((m) => {
    const id = m?.id;
    if (!id || typeof id !== 'string') {
      return false;
    }
    if (isDeniedModel(id)) {
      return false;
    }
    if (!ossOnly) {
      return true;
    }
    return isAllowedOssModel(id);
  });
}

/** Validate a model id before sending a completion. */
export function assertOssModel(id: string, ossOnly = true): void {
  if (isDeniedModel(id)) {
    throw new Error(`Model "${id}" is blocked (closed / proprietary)`);
  }
  if (ossOnly && !isAllowedOssModel(id)) {
    throw new Error(
      `Model "${id}" is not on the Spockify OSS allowlist (spockify.models.ossOnly)`,
    );
  }
}
