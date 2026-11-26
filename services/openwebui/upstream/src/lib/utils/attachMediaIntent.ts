/**
 * This-turn image attach + prompt → I2V vs image edit.
 *
 * Mirrors backend media_attach_intent.py.
 * Ambiguous default: honor the active composer row (video → I2V, image → edit);
 * if neither toggle is on, return none (vision chat — no surprise GPU job).
 */

export type AttachMediaIntent = 'i2v' | 'edit' | 'none';

const HOWTO_RE =
	/^\s*(?:how\s+(?:do|can|to|would|should)|what\s+is|why\s+|explain\b|teach\s+me\b)/i;

/** Explicit video nouns (same idea as videoOptions.promptSuggestsVideoGeneration). */
const VIDEO_NOUN_RE =
	/(?:^|\b)(?:please\s+)?(?:can\s+you\s+|could\s+you\s+|would\s+you\s+)?animate\s+(?:me\s+|us\s+)?(?:a|an|the|this|that)\b|\b(?:generate|create|make|render)\s+(?:me\s+|us\s+)?(?:an?\s+)?(?:video|clip|animation)\b|\btext[\s-]?to[\s-]?video\b|\bltx[\s-]?v(?:ideo)?\b/i;

/** Attach-gated motion / I2V cues. */
const I2V_MOTION_RE =
	/\bmake\s+(?:it|this|her|him|them|the\s+(?:image|photo|picture|drawing))\s+(?:move|walk|run|dance|fly|swim|talk|speak|blink|wave|nod|turn|spin)\b|\banimate\s+(?:it|this|the\s+(?:image|photo|picture|drawing)|me\s+this)\b|\bbring\s+(?:it|this|her|him|them)\s+to\s+life\b|\b(?:add|give\s+(?:it|this))\s+(?:some\s+)?(?:motion|movement|life)\b|\bcamera\s+(?:pan|zoom|dolly|orbit|tracking|push|pull|tilt|truck)\b|\b(?:slow\s+)?(?:pan|dolly|orbit)\s+(?:across|around|in|out|over)\b|\bturn\s+(?:it|this)\s+into\s+(?:an?\s+)?(?:video|clip|animation)\b|\b(?:make|create|render)\s+(?:me\s+|us\s+)?(?:an?\s+)?(?:video|clip|animation)\s+(?:of\s+|from\s+)?(?:this|it)\b|\bimage[\s-]?to[\s-]?video\b|\bi2v\b/i;

/** Explicit image create (same idea as imageOptions.promptSuggestsImageGeneration). */
const IMAGE_GEN_RE =
	/(?:^|\b)(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:draw|paint|sketch)\s+(?:me\b|a\b|an\b|the\b)|(?:generate|create|make|render)\s+(?:me\s+|us\s+)?(?:an?\s+)?(?:image|picture|photo|illustration|drawing|painting|artwork|logo|icon|poster)|(?:image|picture)\s+variation|make\s+another\s+(?:like\s+this|variation)|text[\s-]?to[\s-]?image|\b(?:flux|comfyui)\b/i;

/** Attach-gated still-image edit cues. */
const IMAGE_EDIT_RE =
	/\b(?:change|replace|remove|erase|delete|swap|edit|restyle|recolor|repaint|inpaint|retouch|upscale|enhance|crop)\b|\b(?:add|put)\s+(?:a|an|the|some)\b|\bmake\s+(?:it|this|her|him|them)\s+(?:look|be|more|less|into)\b|\bturn\s+(?:it|this)\s+into\b(?!\s+(?:an?\s+)?(?:video|clip|animation)\b)|\b(?:edit|modify|fix|update)\s+(?:this|the)\s+(?:image|photo|picture|drawing)\b|\b(?:change|replace|remove|swap)\s+(?:the\s+)?(?:background|sky|hair|clothes|clothing|outfit|color|colour)\b|\bimage[\s-]?to[\s-]?image\b|\bimg2img\b/i;

function normalize(text: string | null | undefined): string | null {
	if (!text || typeof text !== 'string') return null;
	const stripped = text.trim();
	if (!stripped || stripped.length > 4000) return null;
	if (HOWTO_RE.test(stripped)) return null;
	return stripped;
}

export function promptSuggestsI2VMotion(text: string | null | undefined): boolean {
	const stripped = normalize(text);
	if (!stripped) return false;
	return VIDEO_NOUN_RE.test(stripped) || I2V_MOTION_RE.test(stripped);
}

export function promptSuggestsImageEdit(text: string | null | undefined): boolean {
	const stripped = normalize(text);
	if (!stripped) return false;
	return IMAGE_GEN_RE.test(stripped) || IMAGE_EDIT_RE.test(stripped);
}

export function filesHaveImageAttach(
	files: Array<{ type?: string; content_type?: string } | null | undefined> | null | undefined
): boolean {
	if (!Array.isArray(files) || files.length === 0) return false;
	return files.some((file) => {
		if (!file) return false;
		return file.type === 'image' || String(file.content_type || '').startsWith('image/');
	});
}

export function resolveAttachMediaIntent(
	text: string | null | undefined,
	opts: {
		hasThisTurnAttach: boolean;
		videoToggle?: boolean;
		imageToggle?: boolean;
	}
): AttachMediaIntent {
	if (!opts.hasThisTurnAttach) return 'none';

	const wantsI2v = promptSuggestsI2VMotion(text);
	const wantsEdit = promptSuggestsImageEdit(text);

	if (wantsI2v && !wantsEdit) return 'i2v';
	if (wantsEdit && !wantsI2v) return 'edit';
	if (wantsI2v && wantsEdit) return 'i2v';

	const videoToggle = !!opts.videoToggle;
	const imageToggle = !!opts.imageToggle;
	if (videoToggle && !imageToggle) return 'i2v';
	if (imageToggle && !videoToggle) return 'edit';
	if (videoToggle && imageToggle) return 'i2v';
	return 'none';
}
