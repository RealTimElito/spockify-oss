/** Spockify per-turn image aspect / style chips (ComfyUI Flux). */

export type SpockifyImageAspect = 'square' | 'wide' | 'tall';
export type SpockifyImageStyle = '' | 'photo' | 'illustration';

export const IMAGE_ASPECT_OPTIONS: { id: SpockifyImageAspect; label: string }[] = [
	{ id: 'square', label: 'Square' },
	{ id: 'wide', label: 'Wide' },
	{ id: 'tall', label: 'Tall' }
];

export const IMAGE_STYLE_OPTIONS: { id: SpockifyImageStyle; label: string }[] = [
	{ id: '', label: 'Default' },
	{ id: 'photo', label: 'Photo' },
	{ id: 'illustration', label: 'Illustration' }
];

/** Light client mirror of backend image_intent — show chips when typing draw/generate. */
const IMAGE_INTENT_RE =
	/(?:^|\b)(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:draw|paint|sketch)\s+(?:me\b|a\b|an\b|the\b)|(?:generate|create|make|render)\s+(?:me\s+|us\s+)?(?:an?\s+)?(?:image|picture|photo|illustration|drawing|painting|artwork|logo|icon|poster)|(?:image|picture)\s+variation|make\s+another\s+(?:like\s+this|variation)|text[\s-]?to[\s-]?image|\b(?:flux|comfyui)\b/i;

export function promptSuggestsImageGeneration(text: string | null | undefined): boolean {
	if (!text || typeof text !== 'string') return false;
	const stripped = text.trim();
	if (!stripped || stripped.length > 4000) return false;
	if (/^\s*(?:how\s+(?:do|can|to)|what\s+is|why\s+|explain\b)/i.test(stripped)) return false;
	return IMAGE_INTENT_RE.test(stripped);
}

export function normalizeAspect(value: string | null | undefined): SpockifyImageAspect {
	if (value === 'wide' || value === 'tall' || value === 'square') return value;
	return 'square';
}

export function normalizeStyle(value: string | null | undefined): SpockifyImageStyle {
	if (value === 'photo' || value === 'illustration') return value;
	return '';
}
