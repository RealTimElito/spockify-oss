/** Spockify Canvas helpers — extend OWUI Artifacts for docs/code side panel. */

export const CANVAS_DOC_LANGS = new Set(['canvas', 'document', 'markdown', 'md']);

/** Auto-open the side panel when these fence langs stream in. */
export const CANVAS_AUTO_OPEN_LANGS = new Set([
	'html',
	'svg',
	'canvas',
	'document',
	'markdown',
	'md'
]);

/** Min lines before a generic code fence is offered as Canvas content. */
export const CODE_CANVAS_MIN_LINES = 8;

const HTML_ARTIFACT_LANGS = new Set(['html', 'css', 'javascript', 'js', 'svg']);

export function normalizeFenceLang(lang: string): string {
	return (lang || '').trim().toLowerCase();
}

export function isCanvasDocLang(lang: string): boolean {
	return CANVAS_DOC_LANGS.has(normalizeFenceLang(lang));
}

/** Substantial non-HTML code worth listing in the Canvas version strip. */
export function isSubstantialCodeCanvas(lang: string, code: string): boolean {
	const l = normalizeFenceLang(lang);
	if (!l || CANVAS_DOC_LANGS.has(l) || HTML_ARTIFACT_LANGS.has(l)) return false;
	if (l === 'xml' && code.includes('<svg')) return false;
	return code.split('\n').length >= CODE_CANVAS_MIN_LINES;
}

/** Long unlabeled / plaintext fences — treat as docs when Canvas mode is on. */
export function isLongPlainFence(lang: string, code: string): boolean {
	const l = normalizeFenceLang(lang);
	if (l && l !== 'text' && l !== 'plaintext' && l !== 'txt') return false;
	return code.split('\n').length >= CODE_CANVAS_MIN_LINES;
}

/**
 * Whether streaming a fence should open the side panel.
 * When `includeSubstantial` is true (Integrations Canvas or Settings auto-open),
 * also open for long code / plain fences — not only ```canvas / HTML / SVG.
 */
export function shouldAutoOpenCanvas(
	lang: string,
	code = '',
	opts?: { includeSubstantial?: boolean }
): boolean {
	const l = normalizeFenceLang(lang);
	if (CANVAS_AUTO_OPEN_LANGS.has(l)) return true;
	if (l === 'xml' && code.includes('<svg')) return true;
	if (opts?.includeSubstantial) {
		if (isSubstantialCodeCanvas(lang, code) || isLongPlainFence(lang, code)) return true;
	}
	return false;
}

export function canvasTitleFromContent(type: string, content: string, lang = ''): string {
	if (type === 'iframe') return 'HTML preview';
	if (type === 'svg') return 'SVG';
	if (type === 'code') return lang ? lang : 'Code';
	const first = (content || '').split('\n').find((ln) => ln.trim()) || '';
	const heading = first.match(/^#{1,6}\s+(.+)$/);
	if (heading) return heading[1].trim().slice(0, 48);
	return 'Document';
}

export function downloadExtForCanvas(item: {
	type: string;
	lang?: string;
	content?: string;
}): string {
	if (item.type === 'iframe') return 'html';
	if (item.type === 'svg') return 'svg';
	if (item.type === 'code') {
		const l = normalizeFenceLang(item.lang || '');
		if (l === 'python' || l === 'py') return 'py';
		if (l === 'typescript' || l === 'ts') return 'ts';
		if (l === 'javascript' || l === 'js') return 'js';
		if (l === 'rust' || l === 'rs') return 'rs';
		if (l === 'go') return 'go';
		if (l === 'json') return 'json';
		if (l === 'yaml' || l === 'yml') return 'yml';
		if (l === 'sql') return 'sql';
		return l || 'txt';
	}
	return 'md';
}
