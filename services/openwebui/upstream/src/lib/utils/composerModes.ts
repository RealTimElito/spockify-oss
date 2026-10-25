/**
 * Composer UI modes for Open WebUI / Spockify chat (web).
 * Regular is default — Plan and Multitask are opt-in from the + menu.
 */

export type ComposerUiMode = 'regular' | 'plan' | 'multitask';

export const COMPOSER_UI_MODES: readonly ComposerUiMode[] = [
	'regular',
	'plan',
	'multitask'
] as const;

export interface ComposerModeMeta {
	id: ComposerUiMode;
	label: string;
	hint: string;
}

export const COMPOSER_MODE_META: readonly ComposerModeMeta[] = [
	{
		id: 'regular',
		label: 'Regular',
		hint: 'Plain chat — no plan or parallel agents'
	},
	{
		id: 'plan',
		label: 'Plan',
		hint: 'Draft a clear plan first, then act'
	},
	{
		id: 'multitask',
		label: 'Multitask',
		hint: 'Up to 4 worker agents in parallel, then synthesize'
	}
];

export function isComposerUiMode(value: unknown): value is ComposerUiMode {
	return value === 'regular' || value === 'plan' || value === 'multitask';
}

export function normalizeComposerUiMode(
	value: unknown,
	fallback: ComposerUiMode = 'regular'
): ComposerUiMode {
	if (isComposerUiMode(value)) return value;
	// Legacy / removed modes → plain chat (not plan)
	if (
		value === 'agent' ||
		value === 'debug' ||
		value === 'ask' ||
		value === 'strict'
	) {
		return 'regular';
	}
	return fallback;
}

/** Extra system text for Plan / Multitask only. */
export function composerUiModeAddon(mode: ComposerUiMode): string {
	switch (mode) {
		case 'plan':
			return [
				'Composer UI mode: PLAN.',
				'Draft a clear numbered plan before mutating actions.',
				'Prefer reading and searching first; do not edit files until the user approves (implement / go / approve).',
				'Cite paths and line ranges when referring to code.'
			].join(' ');
		case 'multitask':
			return [
				'Composer UI mode: MULTITASK.',
				'Prefer the normal single-agent loop for ordinary questions.',
				'Use parallel workers only when the task clearly benefits from concurrent exploration.'
			].join(' ');
		default:
			return '';
	}
}

export function metaForComposerMode(mode: ComposerUiMode): ComposerModeMeta {
	return COMPOSER_MODE_META.find((m) => m.id === mode) ?? COMPOSER_MODE_META[0];
}
