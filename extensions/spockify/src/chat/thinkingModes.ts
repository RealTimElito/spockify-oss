/**
 * Spockify thinking cycle: Off → Low → Medium → High → Heavy → Off.
 * Off never sends think=. Low/Medium/High are effort caps (single worker).
 * Heavy is high effort plus the 4-agent ensemble (router-side).
 *
 * Matches OWUI thinkingModes + router model_catalog.
 */

export type ThinkingMode = 'off' | 'low' | 'medium' | 'high' | 'heavy';

export const THINKING_MODES: readonly ThinkingMode[] = [
  'off',
  'low',
  'medium',
  'high',
  'heavy',
] as const;

/** IDE Agent default: High (code → gpt-oss-120b). Web chat stays Medium. */
export const DEFAULT_THINKING_MODE: ThinkingMode = 'high';

const THINKING_FAMILY_RE = /gemma|gpt-oss|nemotron|qwen|kimi|magistral/i;
const NO_THINK_FAMILY_RE = /llama|codestral|mistral|phi|llava|devstral|ministral|mathstral/i;

export function modelSupportsThinking(model: string): boolean {
  const name = String(model || '').toLowerCase();
  if (!name) return false;
  if (/magistral/.test(name)) return true;
  if (NO_THINK_FAMILY_RE.test(name) && !/nemotron|gemma/.test(name)) {
    return false;
  }
  return THINKING_FAMILY_RE.test(name);
}

export interface ThinkingModeMeta {
  id: ThinkingMode;
  label: string;
  hint: string;
}

export const THINKING_MODE_META: readonly ThinkingModeMeta[] = [
  {
    id: 'off',
    label: 'Off',
    hint: 'Never send think= — any model is OK',
  },
  {
    id: 'low',
    label: 'Low',
    hint: 'Low effort, fast/cheap single worker',
  },
  {
    id: 'medium',
    label: 'Medium',
    hint: 'Balanced auto route (single worker)',
  },
  {
    id: 'high',
    label: 'High',
    hint: 'High effort, best single thinking model (default for Agent)',
  },
  {
    id: 'heavy',
    label: 'Heavy',
    hint: 'High effort + 4-agent ensemble (Explorer/Analyst/Builder → Skeptic)',
  },
];

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return (
    value === 'off' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'heavy'
  );
}

/** Persist five-way chip; migrate Light / think-off. */
export function normalizeThinkingMode(
  value: unknown,
  fallback: ThinkingMode = DEFAULT_THINKING_MODE,
): ThinkingMode {
  if (isThinkingMode(value)) return value;
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === 'light') return 'low';
  if (raw === 'think-off' || raw === 'disabled' || raw === 'none') return 'off';
  return fallback;
}

/** Old think-off / MAX Mode win over a missing five-way value. */
export function migratePersistedThinking(
  thinkingRaw: unknown,
  thinkEnabledRaw?: unknown,
  maxModeRaw?: unknown,
): ThinkingMode {
  const enabled = String(thinkEnabledRaw ?? '')
    .trim()
    .toLowerCase();
  if (enabled === '0' || enabled === 'false' || enabled === 'off') {
    return 'off';
  }
  const raw = String(thinkingRaw ?? '')
    .trim()
    .toLowerCase();
  if (
    isThinkingMode(raw) ||
    raw === 'light' ||
    raw === 'think-off' ||
    raw === 'disabled' ||
    raw === 'none'
  ) {
    return normalizeThinkingMode(raw, DEFAULT_THINKING_MODE);
  }
  if (maxModeRaw === true || String(maxModeRaw).toLowerCase() === 'true') {
    return 'high';
  }
  return DEFAULT_THINKING_MODE;
}

export function nextThinkingMode(mode: ThinkingMode): ThinkingMode {
  const idx = THINKING_MODES.indexOf(mode);
  return THINKING_MODES[(idx + 1) % THINKING_MODES.length];
}

export function metaForThinkingMode(mode: ThinkingMode): ThinkingModeMeta {
  return THINKING_MODE_META.find((m) => m.id === mode) ?? THINKING_MODE_META[3];
}

export function thinkingModeLabel(mode: ThinkingMode): string {
  return metaForThinkingMode(mode).label;
}

const THINKING_MARKER_RE =
  /^\s*\[spockify_thinking:(off|low|light|medium|high|heavy)\]\s*$/i;

export function thinkingMarker(mode: ThinkingMode): string {
  return `[spockify_thinking:${mode}]`;
}

export function isThinkingMarkerMessage(content: unknown): boolean {
  return typeof content === 'string' && THINKING_MARKER_RE.test(content);
}

/** Body fields the router reads (also mirrored as HTTP headers by the client). */
export function thinkingRequestFields(
  mode: ThinkingMode,
): Record<string, unknown> {
  return {
    spockify_thinking: mode,
    spockify_think_enabled: mode !== 'off',
  };
}

export function withThinkingMarker<
  T extends { role: string; content: unknown },
>(messages: T[], mode: ThinkingMode): T[] {
  const rest = messages.filter(
    (m) => !(m.role === 'system' && isThinkingMarkerMessage(m.content)),
  );
  return [
    { role: 'system', content: thinkingMarker(mode) } as T,
    ...rest,
  ];
}
