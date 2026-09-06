import { describe, expect, it } from 'vitest';
import {
	HEAVY_ENSEMBLE_PLAN,
	buildEnsembleRows,
	formatEnsembleHeader,
	migratePersistedThinking,
	modelSupportsThinking,
	nextThinkingMode,
	normalizeThinkingMode,
	pickHeavyRunForPoll,
	isSpockifyRouterModel,
	planHeavyEnsemble,
	plannedHeavyWorkers,
	spockifyModelSuffix
} from './thinkingModes';

describe('buildEnsembleRows', () => {
	it('shows all four Heavy roles before any live workers', () => {
		const rows = buildEnsembleRows('heavy', []);
		expect(rows.map((r) => r.role)).toEqual(['Explorer', 'Analyst', 'Builder', 'Skeptic']);
		expect(rows.map((r) => r.model)).toEqual(HEAVY_ENSEMBLE_PLAN.map((p) => p.model));
		expect(rows.every((r) => r.status === 'pending')).toBe(true);
	});

	it('overlays the live router model and status per role', () => {
		const rows = buildEnsembleRows('heavy', [
			{ id: 'analyst', name: 'Analyst', model: 'qwen3.5-9b', status: 'running', preview: '…' }
		]);
		expect(rows[1]).toMatchObject({
			role: 'Analyst',
			model: 'qwen3.5-9b',
			status: 'running',
			preview: '…'
		});
		expect(rows[0].model).toBe('gpt-oss-20b');
		expect(rows[0].status).toBe('pending');
	});

	it('maps non-heavy workers as-is', () => {
		const rows = buildEnsembleRows('medium', [
			{ id: 'w1', name: 'Researcher', model: 'gemma4-12b', status: 'done' }
		]);
		expect(rows).toEqual([
			{
				role: 'Researcher',
				model: 'gemma4-12b',
				status: 'done',
				output: '',
				preview: ''
			}
		]);
	});
});

describe('formatEnsembleHeader', () => {
	it('joins role · model for the collapsed line', () => {
		expect(formatEnsembleHeader(buildEnsembleRows('heavy'))).toBe(
			'Explorer · gpt-oss-20b · Analyst · gemma4-12b · Builder · gemma4-26b · Skeptic · gemma4-12b'
		);
	});
});

describe('plannedHeavyWorkers / pickHeavyRunForPoll', () => {
	it('seeds pending workers matching the plan', () => {
		expect(plannedHeavyWorkers('')).toEqual([
			{ id: 'explorer', name: 'Explorer', model: 'gpt-oss-20b', status: 'pending' },
			{ id: 'analyst', name: 'Analyst', model: 'gemma4-12b', status: 'pending' },
			{ id: 'builder', name: 'Builder', model: 'gemma4-26b', status: 'pending' },
			{ id: 'skeptic', name: 'Skeptic', model: 'gemma4-12b', status: 'pending' }
		]);
	});

	it('prefers the by-message run, else the newest Heavy-looking listed run', () => {
		const live = { id: 'r1', workers: [{ name: 'Explorer' }] };
		expect(pickHeavyRunForPoll(live, [])).toBe(live);
		expect(
			pickHeavyRunForPoll(null, [
				{ id: 'old', status: 'done', workers: [{ name: 'Explorer' }] },
				{
					id: 'hot',
					status: 'running',
					workers: [{ id: 'explorer', model: 'gpt-oss-20b' }]
				}
			])
		).toMatchObject({ id: 'hot' });
		expect(pickHeavyRunForPoll(null, [{ id: 'x', status: 'running', workers: [] }])).toBeNull();
	});

	it('seeds Qwen for CJK Heavy turns without replacing Explorer', () => {
		const short = plannedHeavyWorkers('请用中文解释一下什么是递归算法');
		expect(short[0].model).toBe('gpt-oss-20b');
		expect(short[1].model).toBe('qwen3.5-9b');
		expect(short[3].model).toBe('qwen3.5-9b');
		const long = '请详细比较'.repeat(80);
		expect(planHeavyEnsemble(long)[2].model).toBe('qwen3.6-35b');
	});
});

describe('isSpockifyRouterModel', () => {
	it('matches bare ids and LiteLLM/OWUI prefixes', () => {
		expect(isSpockifyRouterModel('spockify-auto')).toBe(true);
		expect(isSpockifyRouterModel('openai.spockify-auto')).toBe(true);
		expect(isSpockifyRouterModel('litellm/spockify-auto')).toBe(true);
		expect(isSpockifyRouterModel('openai.spockify-agents')).toBe(true);
		expect(isSpockifyRouterModel('spockify-heavy')).toBe(true);
		expect(spockifyModelSuffix('openai.spockify-auto')).toBe('spockify-auto');
		expect(isSpockifyRouterModel('gpt-oss-20b')).toBe(false);
		expect(isSpockifyRouterModel('llama3.2-3b')).toBe(false);
	});
});

describe('modelSupportsThinking', () => {
	it('marks Qwen/Gemma/gpt-oss/Nemotron yes and llama/codestral no', () => {
		expect(modelSupportsThinking('qwen3.5-9b')).toBe(true);
		expect(modelSupportsThinking('gemma4-12b')).toBe(true);
		expect(modelSupportsThinking('gpt-oss-20b')).toBe(true);
		expect(modelSupportsThinking('llama3.2-3b')).toBe(false);
		expect(modelSupportsThinking('codestral')).toBe(false);
		expect(modelSupportsThinking('web-llama')).toBe(false);
	});
});

describe('normalizeThinkingMode / migratePersistedThinking', () => {
	it('keeps the five-way chip values', () => {
		expect(normalizeThinkingMode('off')).toBe('off');
		expect(normalizeThinkingMode('low')).toBe('low');
		expect(normalizeThinkingMode('high')).toBe('high');
		expect(normalizeThinkingMode('heavy')).toBe('heavy');
	});

	it('cycles Off → Low → Medium → High → Heavy → Off', () => {
		expect(nextThinkingMode('off')).toBe('low');
		expect(nextThinkingMode('low')).toBe('medium');
		expect(nextThinkingMode('medium')).toBe('high');
		expect(nextThinkingMode('high')).toBe('heavy');
		expect(nextThinkingMode('heavy')).toBe('off');
	});

	it('maps light → low and think-off → off', () => {
		expect(normalizeThinkingMode('light')).toBe('low');
		expect(migratePersistedThinking('medium', '0')).toBe('off');
		expect(migratePersistedThinking('heavy', 'false')).toBe('off');
		expect(migratePersistedThinking('light', '1')).toBe('low');
		expect(migratePersistedThinking('medium', '1')).toBe('medium');
	});
});
