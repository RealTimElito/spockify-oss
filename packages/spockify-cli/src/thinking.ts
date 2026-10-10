/** Off → Low → Medium → High → Heavy → Off (matches web/IDE chips). */

export type ThinkingMode = 'off' | 'low' | 'medium' | 'high' | 'heavy';

export const THINKING_MODES: readonly ThinkingMode[] = [
  'off',
  'low',
  'medium',
  'high',
  'heavy',
] as const;

export const DEFAULT_THINKING_MODE: ThinkingMode = 'medium';

export function isThinkingMode(value: unknown): value is ThinkingMode {
  return (
    value === 'off' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'heavy'
  );
}

export function normalizeThinkingMode(
  value: unknown,
  fallback: ThinkingMode = DEFAULT_THINKING_MODE,
): ThinkingMode {
  if (isThinkingMode(value)) return value;
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'light') return 'low';
  if (raw === 'think-off' || raw === 'disabled' || raw === 'none') return 'off';
  return fallback;
}

export function nextThinkingMode(mode: ThinkingMode): ThinkingMode {
  const idx = THINKING_MODES.indexOf(mode);
  return THINKING_MODES[(idx + 1) % THINKING_MODES.length];
}

export function thinkingModeLabel(mode: ThinkingMode): string {
  switch (mode) {
    case 'off':
      return 'Off';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'heavy':
      return 'Heavy';
    default:
      return 'Medium';
  }
}

export function resolveInitialThinkingMode(): ThinkingMode {
  return normalizeThinkingMode(process.env.SPOCKIFY_THINKING);
}
