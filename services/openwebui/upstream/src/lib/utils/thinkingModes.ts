/**
 * Spockify thinking cycle: Off → Low → Medium → High → Heavy → Off.
 * Off never sends think=. Low/Medium/High are effort caps (single worker).
 * Heavy is high effort plus the 4-agent ensemble.
 */

export type ThinkingMode = 'off' | 'low' | 'medium' | 'high' | 'heavy';

export const THINKING_MODES: readonly ThinkingMode[] = [
	'off',
	'low',
	'medium',
	'high',
	'heavy'
] as const;

export const DEFAULT_THINKING_MODE: ThinkingMode = 'medium';

const NON_LATIN_RE =
	/[\u0600-\u06ff\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;
const NON_LATIN_MIN = 4;
const LONG_CJK_CHARS = 240;

/** Families that accept Ollama think= (matches router model_catalog). */
const THINKING_FAMILY_RE = /gemma|gpt-oss|nemotron|qwen|kimi/i;
const NO_THINK_FAMILY_RE = /llama|codestral|mistral|phi|llava/i;

export function looksNonLatinScript(text: string): boolean {
	if (!text) return false;
	const hits = text.match(NON_LATIN_RE);
	return (hits?.length ?? 0) >= NON_LATIN_MIN;
}

export function modelSupportsThinking(model: string): boolean {
	const name = String(model || '').toLowerCase();
	if (!name) return false;
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
		hint: 'Never send think= — any model is OK'
	},
	{
		id: 'low',
		label: 'Low',
		hint: 'Low effort, fast/cheap single worker'
	},
	{
		id: 'medium',
		label: 'Medium',
		hint: 'Balanced auto route with live-fact search (default)'
	},
	{
		id: 'high',
		label: 'High',
		hint: 'High effort, best single thinking model'
	},
	{
		id: 'heavy',
		label: 'Heavy',
		hint: 'High effort + parallel agents → synthesis → critique'
	}
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

/** Persist four/five-way chip; migrate Light/think-off. */
export function normalizeThinkingMode(
	value: unknown,
	fallback: ThinkingMode = DEFAULT_THINKING_MODE
): ThinkingMode {
	if (isThinkingMode(value)) return value;
	const raw = String(value || '')
		.trim()
		.toLowerCase();
	if (raw === 'light') return 'low';
	if (raw === 'think-off' || raw === 'disabled' || raw === 'none') return 'off';
	return fallback;
}

/** Old think-off chip wins over a stored Light/Medium/Heavy value. */
export function migratePersistedThinking(
	thinkingRaw: unknown,
	thinkEnabledRaw: unknown
): ThinkingMode {
	const enabled = String(thinkEnabledRaw ?? '').trim().toLowerCase();
	if (enabled === '0' || enabled === 'false' || enabled === 'off') {
		return 'off';
	}
	return normalizeThinkingMode(thinkingRaw);
}

export function nextThinkingMode(mode: ThinkingMode): ThinkingMode {
	const idx = THINKING_MODES.indexOf(mode);
	return THINKING_MODES[(idx + 1) % THINKING_MODES.length];
}

export function metaForThinkingMode(mode: ThinkingMode): ThinkingModeMeta {
	return THINKING_MODE_META.find((m) => m.id === mode) ?? THINKING_MODE_META[2];
}

export function thinkingModeLabel(mode: ThinkingMode): string {
	return metaForThinkingMode(mode).label;
}

function unescapeReasoningText(text: string): string {
	return text
		.replace(/&gt;/g, '>')
		.replace(/&lt;/g, '<')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/^>\s?/gm, '')
		.trim();
}

/** Pull model chain-of-thought from dedicated field, <think> tags, or reasoning details. */
export function extractReasoningText(message: Record<string, unknown> | null | undefined): string {
	if (!message) return '';
	const dedicated = String(message.spockifyModelReasoning || '').trim();
	if (dedicated) return dedicated;

	const parts: string[] = [];
	const content = String(message.content || '');
	const detailsRe = /<details\s+[^>]*type="reasoning"[^>]*>[\s\S]*?<\/details>/gi;
	const thinkRe = /<think>([\s\S]*?)<\/think>/gi;
	const summaryRe = /<summary>[\s\S]*?<\/summary>/i;
	const blocks = content.match(detailsRe) || [];
	for (const block of blocks) {
		const inner = block
			.replace(/<details[^>]*>/i, '')
			.replace(/<\/details>/i, '')
			.replace(summaryRe, '');
		const text = unescapeReasoningText(inner);
		if (text) parts.push(text);
	}
	for (const match of content.matchAll(thinkRe)) {
		const text = unescapeReasoningText(match[1] || '');
		if (text) parts.push(text);
	}

	const output = message.output;
	if (Array.isArray(output)) {
		for (const item of output as Record<string, unknown>[]) {
			if (item?.type !== 'reasoning') continue;
			const chunks = (item.content || item.summary || []) as { text?: string }[];
			if (!Array.isArray(chunks)) continue;
			const text = chunks.map((c) => c.text || '').join('');
			if (text.trim()) parts.push(text.trim());
		}
	}

	return parts.join('\n\n').trim();
}

export function stripReasoningDetails(content: string): string {
	return String(content || '')
		.replace(/<details\s+[^>]*type="reasoning"[^>]*>[\s\S]*?<\/details>/gi, '')
		.replace(/<think>[\s\S]*?<\/think>/gi, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/** Default heavy ensemble (English). CJK/Arabic/Hangul overlay via planHeavyEnsemble. */
export const HEAVY_ENSEMBLE_PLAN: readonly { role: string; model: string }[] = [
	{ role: 'Explorer', model: 'gpt-oss-20b' },
	{ role: 'Analyst', model: 'gemma4-12b' },
	{ role: 'Builder', model: 'gemma4-26b' },
	{ role: 'Skeptic', model: 'gemma4-12b' }
];

/** Same role/model plan as router model_catalog.plan_heavy_models. */
export function planHeavyEnsemble(prompt = ''): { role: string; model: string }[] {
	const base = HEAVY_ENSEMBLE_PLAN.map((p) => ({ ...p }));
	if (!looksNonLatinScript(prompt)) return base;
	const qwen = prompt.length >= LONG_CJK_CHARS ? 'qwen3.6-35b' : 'qwen3.5-9b';
	base[1].model = qwen;
	base[3].model = qwen;
	if (prompt.length >= LONG_CJK_CHARS) {
		base[2].model = 'qwen3.6-35b';
	}
	return base;
}

export interface EnsembleRow {
	role: string;
	model: string;
	status: string;
	output: string;
	preview: string;
}

const HEAVY_ROLE_RE = /explorer|analyst|builder|skeptic/i;

function workerLookupKey(worker: Record<string, unknown>): string {
	return String(worker.name || worker.id || '')
		.trim()
		.toLowerCase();
}

/** Planned Heavy workers for the HUD before the first SSE/poll payload. */
export function plannedHeavyWorkers(prompt = ''): Array<{
	id: string;
	name: string;
	model: string;
	status: string;
}> {
	return planHeavyEnsemble(prompt).map((p) => ({
		id: p.role.toLowerCase(),
		name: p.role,
		model: p.model,
		status: 'pending'
	}));
}

/**
 * Heavy always lists the four roles immediately (static plan), then overlays
 * live router workers so the model id/status can diverge from the plan.
 */
export function buildEnsembleRows(
	thinking: string,
	workers: Record<string, unknown>[] = []
): EnsembleRow[] {
	const liveByKey = new Map<string, Record<string, unknown>>();
	for (const w of workers) {
		const nameKey = String(w.name || '')
			.trim()
			.toLowerCase();
		const idKey = String(w.id || '')
			.trim()
			.toLowerCase();
		if (nameKey) liveByKey.set(nameKey, w);
		if (idKey) liveByKey.set(idKey, w);
	}
	if (thinking === 'heavy') {
		const plan = planHeavyEnsemble('');
		return plan.map((p) => {
			const w = liveByKey.get(p.role.toLowerCase());
			if (w) {
				return {
					role: p.role,
					model: String(w.model || p.model),
					status: String(w.status || 'pending'),
					output: String(w.output || w.error || ''),
					preview: String(w.preview || '')
				};
			}
			return { ...p, status: 'pending', output: '', preview: '' };
		});
	}
	return workers.map((w) => ({
		role: String(w.name || w.id || 'Agent'),
		model: String(w.model || '—'),
		status: String(w.status || ''),
		output: String(w.output || w.error || ''),
		preview: String(w.preview || '')
	}));
}

export function formatEnsembleHeader(rows: EnsembleRow[]): string {
	return rows.map((r) => `${r.role} · ${r.model}`).join(' · ');
}

const ACTIVE_RUN = new Set(['pending', 'running', 'synthesizing']);

/** Prefer the by-message run; else the newest listed Heavy-looking run. */
export function pickHeavyRunForPoll(
	byMessage: Record<string, unknown> | null | undefined,
	listed: Record<string, unknown>[] | undefined
): Record<string, unknown> | null {
	const byWorkers = (byMessage?.workers as unknown[] | undefined) || [];
	if (byMessage && (byWorkers.length > 0 || byMessage.id)) {
		return byMessage;
	}
	for (const run of listed || []) {
		const status = String(run.status || '');
		if (!ACTIVE_RUN.has(status)) continue;
		const workers = (run.workers as Record<string, unknown>[]) || [];
		if (workers.some((w) => HEAVY_ROLE_RE.test(workerLookupKey(w)))) {
			return run;
		}
	}
	return null;
}
