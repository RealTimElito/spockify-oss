import type { ModelTransport } from '@spockify/ide-client';
import { isAutoModelId, isLabCatalogId } from './catalog';
import type { ThinkingEffort } from './types';

export type SessionPin = {
  model: string;
  think: ThinkingEffort;
};

export const DEFAULT_SESSION_PIN: SessionPin = {
  model: 'gpt-oss-20b',
  think: 'off',
};

export const COMPLEX_SESSION_PIN: SessionPin = {
  model: 'gpt-oss-120b',
  think: 'high',
};

const AUTO_OK = new Set(['gpt-oss-20b', 'gpt-oss-120b']);
const THINK_OK = new Set<ThinkingEffort>([
  'off',
  'low',
  'medium',
  'high',
  'heavy',
]);

export const RECOMMEND_SYSTEM = `You pick a coding worker for this session. Reply with one JSON object and nothing else:
{"model":"gpt-oss-20b","think":"off"}
or
{"model":"gpt-oss-120b","think":"high"}

Rules:
- Only those two model ids.
- Never recommend lab, unpublished, Devstral, Qwen, DeepSeek, or any other tag.
- Prefer gpt-oss-120b think=high when the task is multi-file, has failing tests, or is architecture/refactor across a package.
- Prefer gpt-oss-20b think=off for single-file edits, explanations, or small local fixes.
No tools. No prose.`;

export type RecommendFn = (
  prompt: string,
) => Promise<{ model?: string; think?: string } | null>;

export function isUserPinnedModel(id?: string): boolean {
  const n = (id || '').trim();
  if (!n) return false;
  return !isAutoModelId(n);
}

function normModelId(id: string): string {
  return (id || '').trim().toLowerCase().replace(/:/g, '-');
}

function asThink(value?: string): ThinkingEffort | undefined {
  const n = (value || '').trim().toLowerCase();
  return THINK_OK.has(n as ThinkingEffort) ? (n as ThinkingEffort) : undefined;
}

/** Drop lab ids and any worker Auto is not allowed to choose. */
export function sanitizeAutoPin(
  raw?: { model?: string; think?: string } | null,
): SessionPin {
  const model = normModelId(raw?.model || '');
  if (!model || isLabCatalogId(model) || !AUTO_OK.has(model)) {
    return { ...DEFAULT_SESSION_PIN };
  }
  return {
    model,
    think: asThink(raw?.think) || DEFAULT_SESSION_PIN.think,
  };
}

export function parseRecommendJson(
  text: string,
): { model?: string; think?: string } | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as {
      model?: unknown;
      think?: unknown;
    };
    if (!parsed || typeof parsed !== 'object') return null;
    const model = typeof parsed.model === 'string' ? parsed.model : undefined;
    const think = typeof parsed.think === 'string' ? parsed.think : undefined;
    if (!model && !think) return null;
    return { model, think };
  } catch {
    return null;
  }
}

/**
 * Session-start pin. User `--model` wins. Auto uses a tool-less recommend
 * call; if LiteLLM is unreachable, return 20b think=off (never keyword-route).
 */
export async function pickSessionModel(opts: {
  userModel?: string;
  userThink?: string;
  prompt?: string;
  recommend?: RecommendFn;
}): Promise<SessionPin> {
  if (isUserPinnedModel(opts.userModel)) {
    return {
      model: (opts.userModel || '').trim(),
      think: asThink(opts.userThink) || 'off',
    };
  }
  const overlay = asThink(opts.userThink);
  if (opts.recommend && (opts.prompt || '').trim()) {
    try {
      const rec = await opts.recommend(opts.prompt!.trim());
      const pin = sanitizeAutoPin(rec);
      return overlay ? { ...pin, think: overlay } : pin;
    } catch {
      // LiteLLM / recommend down → default, not regex routing.
    }
  }
  return overlay
    ? { ...DEFAULT_SESSION_PIN, think: overlay }
    : { ...DEFAULT_SESSION_PIN };
}

export async function recommendViaTransport(
  transport: Pick<ModelTransport, 'chatCompletions'>,
  prompt: string,
): Promise<{ model?: string; think?: string } | null> {
  const model =
    (process.env.SPOCKIFY_RECOMMEND_MODEL || '').trim() || 'llama3.2-3b-cpu';
  const resp = await transport.chatCompletions({
    model,
    messages: [
      { role: 'system', content: RECOMMEND_SYSTEM },
      { role: 'user', content: prompt.slice(0, 6000) },
    ],
    stream: false,
    temperature: 0,
    max_tokens: 80,
  });
  const content = resp.choices?.[0]?.message?.content;
  const text = typeof content === 'string' ? content : '';
  return parseRecommendJson(text);
}
