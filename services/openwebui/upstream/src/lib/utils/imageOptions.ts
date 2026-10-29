/** Spockify per-turn image aspect / style chips (ComfyUI Flux). */

/** Checkpoint the stack can run today (ComfyUI CheckpointLoaderSimple). */
export const DEFAULT_IMAGE_MODEL_ID = 'flux1-schnell-fp8.safetensors';
export const QWEN_IMAGE_MODEL_ID = 'qwen-image-2.1';

export const DEFAULT_IMAGE_MODELS: { id: string; name: string }[] = [
	{ id: DEFAULT_IMAGE_MODEL_ID, name: 'FLUX.1 schnell' }
];

/** Composer / localStorage aliases that must stay Qwen, not reset to Flux. */
export function remapComposerImageModel(id: string | null | undefined): string | null {
	if (!id || typeof id !== 'string') return null;
	const raw = id.trim();
	if (!raw) return null;
	const low = raw.toLowerCase();
	if (
		low === 'qwen-image-2.1' ||
		low === 'qwen-image-2.1-turbo' ||
		low === 'qwen-image-2.1-turbo-gguf' ||
		low === 'qwen_image' ||
		low === 'qwen2.1' ||
		low === 'qwen-2.1' ||
		low === 'qwen2.1-image' ||
		low === 'qwen-2.1-image' ||
		low === 'qwen-image21' ||
		low.includes('qwen-image') ||
		low.includes('qwen_image')
	) {
		return QWEN_IMAGE_MODEL_ID;
	}
	return raw;
}

export type SpockifyImageAspect = 'square' | 'wide' | 'tall';
export type SpockifyImageStyle = '' | 'photo' | 'illustration';
export type SpockifyImageResolution = '1k' | '2k';

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

/** Long-edge tier. 2K is Qwen-Image 2.1; Flux stays on 1K. */
export const IMAGE_RESOLUTION_OPTIONS: { id: SpockifyImageResolution; label: string }[] = [
	{ id: '1k', label: '1K' },
	{ id: '2k', label: '2K' }
];

const QWEN_RESOLUTIONS: SpockifyImageResolution[] = ['1k', '2k'];

export function resolutionsForImageModel(
	modelId: string | null | undefined,
	catalog?: { id: string; resolutions?: string[] }[] | null
): { id: SpockifyImageResolution; label: string }[] {
	const id = remapComposerImageModel(modelId) || modelId || '';
	const row = (catalog || []).find((item) => item.id === id);
	const fromCatalog = (row?.resolutions || [])
		.map((value) => String(value).toLowerCase())
		.filter((value): value is SpockifyImageResolution => value === '1k' || value === '2k');
	const ids =
		fromCatalog.length > 0
			? fromCatalog
			: id === QWEN_IMAGE_MODEL_ID
				? QWEN_RESOLUTIONS
				: (['1k'] as SpockifyImageResolution[]);
	return IMAGE_RESOLUTION_OPTIONS.filter((opt) => ids.includes(opt.id));
}

export function snapImageResolution(
	value: string | null | undefined,
	modelId: string | null | undefined,
	catalog?: { id: string; resolutions?: string[] }[] | null
): SpockifyImageResolution {
	const allowed = resolutionsForImageModel(modelId, catalog);
	const wanted = value === '2k' ? '2k' : '1k';
	return allowed.some((opt) => opt.id === wanted) ? wanted : allowed[0]?.id || '1k';
}

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
