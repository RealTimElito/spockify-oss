/**
 * Spockify thinking depth for the chat composer.
 * Medium is the default (current impressive auto path). Heavy fans out a
 * parallel role ensemble + synthesis + forced critique; Light stays snappy.
 */

export type ThinkingMode = 'light' | 'medium' | 'heavy';

export const THINKING_MODES: readonly ThinkingMode[] = ['light', 'medium', 'heavy'] as const;

export const DEFAULT_THINKING_MODE: ThinkingMode = 'medium';

export interface ThinkingModeMeta {
	id: ThinkingMode;
	label: string;
	hint: string;
}

export const THINKING_MODE_META: readonly ThinkingModeMeta[] = [
	{
		id: 'light',
		label: 'Light',
		hint: 'Fast single worker — no ensemble or critique'
	},
	{
		id: 'medium',
		label: 'Medium',
		hint: 'Balanced auto route with live-fact search (default)'
	},
	{
		id: 'heavy',
		label: 'Heavy',
		hint: 'Parallel agents → synthesis → forced critique'
	}
];

export function isThinkingMode(value: unknown): value is ThinkingMode {
	return value === 'light' || value === 'medium' || value === 'heavy';
}

export function normalizeThinkingMode(
	value: unknown,
	fallback: ThinkingMode = DEFAULT_THINKING_MODE
): ThinkingMode {
	return isThinkingMode(value) ? value : fallback;
}

export function nextThinkingMode(mode: ThinkingMode): ThinkingMode {
	const idx = THINKING_MODES.indexOf(mode);
	return THINKING_MODES[(idx + 1) % THINKING_MODES.length];
}

export function metaForThinkingMode(mode: ThinkingMode): ThinkingModeMeta {
	return THINKING_MODE_META.find((m) => m.id === mode) ?? THINKING_MODE_META[1];
}

export function thinkingModeLabel(mode: ThinkingMode): string {
	return metaForThinkingMode(mode).label;
}

/** Default heavy ensemble (matches router HEAVY_WORKER_MODELS + plan_heavy_workers roles). */
export const HEAVY_ENSEMBLE_PLAN: readonly { role: string; model: string }[] = [
	{ role: 'Explorer', model: 'gpt-oss-20b' },
	{ role: 'Analyst', model: 'gemma4-12b' },
	{ role: 'Builder', model: 'gemma4-26b' },
	{ role: 'Skeptic', model: 'gemma4-12b' }
];
