/** Spockify per-turn video Model / Length / Resolution (ComfyUI LTX + friends). */

/** Default matches VIDEO_GENERATION_MODEL / OpenAI /v1/videos default. */
export const DEFAULT_VIDEO_MODEL_ID = 'ltxv-2b-0.9.8-distilled-fp8.safetensors';

/** Two-stage Layout-To-Render id; only model that takes a clay layout video. */
export const LAYOUT_TO_RENDER_MODEL_ID = 'ltx-2.5-layout-to-render';

export type VideoModelCatalogRow = {
	id: string;
	name: string;
	seconds?: number[] | null;
	sizes?: string[] | null;
	resolutions?: string[] | null;
	max_seconds?: number | null;
	default_seconds?: number | null;
	default_size?: string | null;
	fps?: number[] | null;
	default_fps?: number | null;
	audio_supported?: boolean;
	default_audio?: boolean;
	extend_supported?: boolean;
	dual_input_only?: boolean;
	notes?: string;
	aliases?: string[];
	workflow?: string;
};

/** Static fallback when the cold catalog is empty or unreachable. */
export const DEFAULT_VIDEO_MODELS: VideoModelCatalogRow[] = [
	{
		id: DEFAULT_VIDEO_MODEL_ID,
		name: 'LTX Video 2B',
		max_seconds: 10,
		seconds: [1, 3, 5, 10],
		sizes: ['704x480', '768x512', '512x768', '768x768', '640x384'],
		default_seconds: 3,
		default_size: '704x480',
		fps: [16, 24],
		default_fps: 24,
		audio_supported: false,
		default_audio: false,
		extend_supported: true,
		dual_input_only: false,
		notes: 'LTX 2B distilled: 1/3/5/10s; sizes up to 768 edge; fps 16/24; extend I2V.'
	},
	{
		id: 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
		name: 'LTX-2.5 Fast',
		max_seconds: 10,
		seconds: [1, 3, 5, 10],
		sizes: ['704x480', '768x512', '512x768', '768x768', '640x384'],
		default_seconds: 3,
		default_size: '704x480',
		fps: [16, 24],
		default_fps: 24,
		audio_supported: false,
		default_audio: false,
		extend_supported: true,
		dual_input_only: false,
		notes: 'LTX-2.5 Fast: 1/3/5/10s, ≤768-edge, fps 16/24, extend I2V (not 4K/50).'
	},
	{
		id: 'ltx-2.5-22b-dev-transformer-comfy-int8-convrot.safetensors',
		name: 'LTX-2.5 Pro',
		max_seconds: 10,
		seconds: [1, 3, 5, 10],
		sizes: ['704x480', '768x512', '512x768', '768x768', '640x384'],
		default_seconds: 3,
		default_size: '704x480',
		fps: [16, 24],
		default_fps: 24,
		audio_supported: false,
		default_audio: false,
		extend_supported: true,
		dual_input_only: false,
		notes: 'LTX-2.5 Pro: 1/3/5/10s, ≤768-edge, fps 16/24, extend I2V (not 4K/50).'
	},
	{
		id: 'ltx-2.5-layout-to-render',
		name: 'LTX-2.5 Layout-To-Render',
		max_seconds: 10,
		seconds: [1, 3, 5, 10],
		sizes: ['1920x1088', '1280x768', '1280x704', '768x768', '768x512', '512x768', '704x448', '640x384'],
		default_seconds: 3,
		default_size: '1280x704',
		fps: [16, 24, 48],
		default_fps: 24,
		audio_supported: false,
		default_audio: false,
		extend_supported: false,
		dual_input_only: false,
		notes: 'Two-stage distilled + upscaler: 1920×1088 @ 24fps (1080p stand-in), 1280×704 (720p). fps 16/24/48 (default 24).'
	},
	{
		id: 'ltx-2.5-union-control',
		name: 'LTX-2.5 Union Control',
		max_seconds: 10,
		seconds: [1, 3, 5, 10],
		sizes: ['1920x1024', '1280x768', '1024x1024', '896x512', '768x768', '640x384'],
		default_seconds: 3,
		default_size: '1280x768',
		fps: [16, 24, 48],
		default_fps: 24,
		audio_supported: false,
		default_audio: false,
		extend_supported: false,
		dual_input_only: false,
		notes: 'Union Control IC-LoRA: 1920×1024 @ 24fps (/128; 1080p stand-in), 1280×768 (720p). fps 16/24/48 (default 24). Needs a control clip.'
	},
	{
		id: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
		name: 'MiniMax H3',
		max_seconds: 15,
		seconds: [1, 3, 5, 10, 15],
		sizes: ['1344x768', '1280x704', '768x512', '704x480', '512x768'],
		default_seconds: 5,
		default_size: '1344x768',
		fps: [16, 24],
		default_fps: 24,
		audio_supported: true,
		default_audio: true,
		extend_supported: true,
		dual_input_only: false,
		notes: 'MiniMax H3 local: max 15s @ ~1344×768; 720p is 1280×704; native audio; fps 16/24; extend I2V.'
	},
	{
		id: 'wan2.2-t2v-a14b',
		name: 'Wan 2.2 T2V-A14B',
		max_seconds: 5,
		seconds: [1, 3, 5],
		sizes: ['832x480', '480x832', '640x640', '704x480'],
		default_seconds: 5,
		default_size: '832x480',
		fps: [16],
		default_fps: 16,
		audio_supported: false,
		default_audio: false,
		extend_supported: false,
		dual_input_only: false,
		notes: 'Wan 2.2 T2V-A14B fp8 MoE; ~16fps only; no extend.'
	},
	{
		id: 'wan2.2_ti2v_5B_fp16.safetensors',
		name: 'Wan 2.2 TI2V-5B',
		max_seconds: 5,
		seconds: [1, 3, 5],
		sizes: ['1280x704', '704x1280', '832x480', '704x480'],
		default_seconds: 5,
		default_size: '1280x704',
		fps: [16],
		default_fps: 16,
		audio_supported: false,
		default_audio: false,
		extend_supported: true,
		dual_input_only: false,
		notes: 'Wan 2.2 TI2V-5B; ~16fps; extend via last-frame I2V.'
	}
];

/** Alias → canonical id for the static fallback map. */
const VIDEO_MODEL_ALIASES: Record<string, string> = {
	'minimax-h3': 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
	minimax_h3: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
	'minimax-h3-2k': 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
	minimax_h3_2k: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
	'ltx-2.5-fast': 'ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors',
	'ltx-2.5-pro': 'ltx-2.5-22b-dev-transformer-comfy-int8-convrot.safetensors',
	'ltx-2.5-layout-to-render': 'ltx-2.5-layout-to-render',
	'layout-to-render': 'ltx-2.5-layout-to-render',
	'ltx-2.5-union-control': 'ltx-2.5-union-control',
	'union-control': 'ltx-2.5-union-control',
	'wan2.2-t2v': 'wan2.2-t2v-a14b',
	'wan2.2-t2v-a14b': 'wan2.2-t2v-a14b',
	'wan22-t2v': 'wan2.2-t2v-a14b',
	'wan2.2-ti2v-5b': 'wan2.2_ti2v_5B_fp16.safetensors',
	'wan2.2-ti2v': 'wan2.2_ti2v_5B_fp16.safetensors',
	'wan22-ti2v-5b': 'wan2.2_ti2v_5B_fp16.safetensors',
	'wan-2.2-5b': 'wan2.2_ti2v_5B_fp16.safetensors'
};

/** Length chips → API ``seconds`` (router snap_length → 8n+1 / MiniMax grid). */
export type SpockifyVideoSeconds = '1' | '3' | '5' | '10' | '15';

/** @deprecated Prefer SpockifyVideoSeconds; kept for localStorage migration. */
export type SpockifyVideoDuration = 'short' | 'default' | 'long' | SpockifyVideoSeconds;

export const VIDEO_SECONDS_OPTIONS: { id: SpockifyVideoSeconds; label: string }[] = [
	{ id: '1', label: '1s' },
	{ id: '3', label: '~3s' },
	{ id: '5', label: '5s' },
	{ id: '10', label: '10s' },
	{ id: '15', label: '15s' }
];

/** Legacy alias used by older MessageInput imports. */
export const VIDEO_DURATION_OPTIONS = VIDEO_SECONDS_OPTIONS;

export type SpockifyVideoSize = string;

export const VIDEO_SIZE_OPTIONS: { id: string; label: string }[] = [
	{ id: '704x480', label: '704×480' },
	{ id: '768x512', label: 'Wide' },
	{ id: '512x768', label: 'Tall' },
	{ id: '1344x768', label: 'HD' }
];

const SIZE_LABELS: Record<string, string> = {
	'704x480': '704×480',
	'768x512': 'Wide',
	'512x768': 'Tall',
	'768x768': 'Square',
	'640x384': '640×384',
	'704x448': '704×448',
	'1280x704': '720p',
	'1280x768': '720p',
	'1344x768': 'HD',
	'1920x1024': '1080p',
	'1920x1088': '1080p',
	'1024x1024': 'Square HD',
	'896x512': '896×512',
	'832x480': '832×480',
	'480x832': '480×832',
	'640x640': '640×640',
	'704x1280': '704×1280'
};

export const DEFAULT_VIDEO_SECONDS: SpockifyVideoSeconds = '3';
export const DEFAULT_VIDEO_SIZE: SpockifyVideoSize = '704x480';
export const DEFAULT_VIDEO_FPS = 24;
export const DEFAULT_VIDEO_AUDIO = false;

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

const LEGACY_DURATION_TO_SECONDS: Record<string, SpockifyVideoSeconds> = {
	short: '1',
	default: '3',
	long: '10'
};

const ALL_SECONDS = new Set(['1', '3', '5', '10', '15']);

export function normalizeVideoSeconds(value: string | null | undefined): SpockifyVideoSeconds {
	const raw = (value || '').trim().toLowerCase();
	if (ALL_SECONDS.has(raw)) return raw as SpockifyVideoSeconds;
	if (raw in LEGACY_DURATION_TO_SECONDS) return LEGACY_DURATION_TO_SECONDS[raw];
	return DEFAULT_VIDEO_SECONDS;
}

/** @deprecated Use normalizeVideoSeconds. */
export function normalizeDuration(value: string | null | undefined): SpockifyVideoDuration {
	return normalizeVideoSeconds(value);
}

export function normalizeVideoSize(value: string | null | undefined): SpockifyVideoSize {
	const raw = (value || '').trim().toLowerCase();
	if (/^\d+x\d+$/.test(raw)) return raw;
	return DEFAULT_VIDEO_SIZE;
}

export function resolveVideoModelRow(
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): VideoModelCatalogRow {
	const raw = (modelId || '').trim();
	const aliased = VIDEO_MODEL_ALIASES[raw] || raw;
	const hit =
		catalog.find((row) => row.id === aliased || row.id === raw) ||
		catalog.find((row) => (row.aliases || []).includes(raw) || (row.aliases || []).includes(aliased)) ||
		DEFAULT_VIDEO_MODELS.find((row) => row.id === aliased || row.id === raw) ||
		DEFAULT_VIDEO_MODELS[0];
	return hit;
}

function sizeLabel(id: string): string {
	return SIZE_LABELS[id] || id.replace('x', '×');
}

export function secondsOptionsForModel(
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): { id: SpockifyVideoSeconds; label: string }[] {
	const row = resolveVideoModelRow(modelId, catalog);
	if (row.dual_input_only) return [];
	const allowed = (row.seconds || []).map(String).filter((s) => ALL_SECONDS.has(s)) as SpockifyVideoSeconds[];
	const ids = allowed.length ? allowed : (['1', '3', '5', '10'] as SpockifyVideoSeconds[]);
	return ids.map((id) => {
		const stock = VIDEO_SECONDS_OPTIONS.find((opt) => opt.id === id);
		return stock || { id, label: `${id}s` };
	});
}

export function sizeOptionsForModel(
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): { id: string; label: string }[] {
	const row = resolveVideoModelRow(modelId, catalog);
	if (row.dual_input_only) return [];
	const sizes = (row.sizes || row.resolutions || []).map(String).filter(Boolean);
	const ids = sizes.length ? sizes : ['704x480', '768x512', '512x768'];
	return ids.map((id) => ({ id, label: sizeLabel(id) }));
}

function nearestNumber(target: number, allowed: number[]): number {
	if (!allowed.length) return target;
	let best = allowed[0];
	let bestDist = Math.abs(best - target);
	for (const n of allowed) {
		const dist = Math.abs(n - target);
		if (dist < bestDist) {
			best = n;
			bestDist = dist;
		}
	}
	return best;
}

function pixelArea(size: string): number {
	const [w, h] = size.toLowerCase().split('x').map((n) => parseInt(n, 10));
	if (!Number.isFinite(w) || !Number.isFinite(h)) return 0;
	return w * h;
}

/** Snap Length to an allowed chip for the model (nearest seconds). */
export function snapSecondsForModel(
	value: string | null | undefined,
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): SpockifyVideoSeconds {
	const opts = secondsOptionsForModel(modelId, catalog);
	if (!opts.length) return DEFAULT_VIDEO_SECONDS;
	const current = normalizeVideoSeconds(value);
	if (opts.some((opt) => opt.id === current)) return current;
	const row = resolveVideoModelRow(modelId, catalog);
	const fallback = row.default_seconds != null ? String(row.default_seconds) : opts[0].id;
	const target = Number(ALL_SECONDS.has(String(value)) ? value : fallback);
	const nearest = nearestNumber(
		Number.isFinite(target) ? target : Number(fallback),
		opts.map((opt) => Number(opt.id))
	);
	return String(nearest) as SpockifyVideoSeconds;
}

/** Snap Resolution to an allowed size for the model (nearest pixel area). */
export function snapSizeForModel(
	value: string | null | undefined,
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): SpockifyVideoSize {
	const opts = sizeOptionsForModel(modelId, catalog);
	if (!opts.length) return DEFAULT_VIDEO_SIZE;
	const current = normalizeVideoSize(value);
	if (opts.some((opt) => opt.id === current)) return current;
	const row = resolveVideoModelRow(modelId, catalog);
	const fallback = row.default_size || opts[0].id;
	const targetArea = pixelArea(current) || pixelArea(fallback);
	let best = opts[0].id;
	let bestDist = Math.abs(pixelArea(best) - targetArea);
	for (const opt of opts) {
		const dist = Math.abs(pixelArea(opt.id) - targetArea);
		if (dist < bestDist) {
			best = opt.id;
			bestDist = dist;
		}
	}
	return best;
}

export function modelComposerNote(
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): string {
	const row = resolveVideoModelRow(modelId, catalog);
	if (row.dual_input_only) {
		return row.notes || 'Dual-input Comfy workflow; Length/Resolution N/A.';
	}
	return '';
}

export function fpsOptionsForModel(
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): { id: number; label: string }[] {
	const row = resolveVideoModelRow(modelId, catalog);
	const allowed = (row.fps || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
	const ids = allowed.length ? allowed : [row.default_fps || DEFAULT_VIDEO_FPS];
	return ids.map((id) => ({ id, label: `${id}fps` }));
}

export function snapFpsForModel(
	value: number | string | null | undefined,
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): number {
	const opts = fpsOptionsForModel(modelId, catalog);
	if (!opts.length) return DEFAULT_VIDEO_FPS;
	const n = Number(value);
	if (opts.some((opt) => opt.id === n)) return n;
	const row = resolveVideoModelRow(modelId, catalog);
	const fallback = Number(row.default_fps ?? opts[0].id);
	return nearestNumber(Number.isFinite(n) ? n : fallback, opts.map((opt) => opt.id));
}

export function audioSupportedForModel(
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): boolean {
	return Boolean(resolveVideoModelRow(modelId, catalog).audio_supported);
}

export function defaultAudioForModel(
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): boolean {
	const row = resolveVideoModelRow(modelId, catalog);
	return row.audio_supported ? Boolean(row.default_audio) : false;
}

export function extendSupportedForModel(
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): boolean {
	return Boolean(resolveVideoModelRow(modelId, catalog).extend_supported);
}

/** True only for Layout-To-Render, which takes an optional clay layout video. */
export function clayReferenceSupportedForModel(
	modelId: string | null | undefined,
	catalog: VideoModelCatalogRow[] = DEFAULT_VIDEO_MODELS
): boolean {
	return resolveVideoModelRow(modelId, catalog).id === LAYOUT_TO_RENDER_MODEL_ID;
}
