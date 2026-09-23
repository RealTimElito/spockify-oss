/** Spockify per-turn video length chips (ComfyUI LTX @ 24fps). */

export type SpockifyVideoDuration = 'short' | 'default' | 'long';

/** Labels match image-chip style; backend maps ids → 8n+1 frame counts @ 24fps. */
export const VIDEO_DURATION_OPTIONS: { id: SpockifyVideoDuration; label: string }[] = [
	{ id: 'short', label: 'Short' },
	{ id: 'default', label: '~2.7s' },
	{ id: 'long', label: '10s' }
];

/** Light client mirror of backend video_intent — show chips when typing video/animate. */
const VIDEO_INTENT_RE =
	/(?:^|\b)(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?animate\s+(?:me\s+|us\s+)?(?:a|an|the|this|that)\b|\b(?:generate|create|make|render)\s+(?:me\s+|us\s+)?(?:an?\s+)?(?:video|clip|animation)\b|\btext[\s-]?to[\s-]?video\b|\bltx[\s-]?v(?:ideo)?\b/i;

export function promptSuggestsVideoGeneration(text: string | null | undefined): boolean {
	if (!text || typeof text !== 'string') return false;
	const stripped = text.trim();
	if (!stripped || stripped.length > 4000) return false;
	if (/^\s*(?:how\s+(?:do|can|to)|what\s+is|why\s+|explain\b)/i.test(stripped)) return false;
	return VIDEO_INTENT_RE.test(stripped);
}

export function normalizeDuration(value: string | null | undefined): SpockifyVideoDuration {
	if (value === 'short' || value === 'default' || value === 'long') return value;
	return 'default';
}
