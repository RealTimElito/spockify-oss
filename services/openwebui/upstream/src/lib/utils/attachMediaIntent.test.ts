import { describe, expect, it } from 'vitest';
import {
	filesHaveImageAttach,
	promptSuggestsI2VMotion,
	promptSuggestsImageEdit,
	resolveAttachMediaIntent
} from './attachMediaIntent';

describe('attachMediaIntent', () => {
	it('detects I2V motion phrases', () => {
		expect(promptSuggestsI2VMotion('make it move')).toBe(true);
		expect(promptSuggestsI2VMotion('make her walk')).toBe(true);
		expect(promptSuggestsI2VMotion('camera pan across the scene')).toBe(true);
		expect(promptSuggestsI2VMotion('turn this into a video')).toBe(true);
		expect(promptSuggestsI2VMotion('how do I make it move')).toBe(false);
	});

	it('detects image edit phrases', () => {
		expect(promptSuggestsImageEdit('change the background to blue')).toBe(true);
		expect(promptSuggestsImageEdit('remove the hat')).toBe(true);
		expect(promptSuggestsImageEdit('restyle as watercolor')).toBe(true);
		expect(promptSuggestsImageEdit('how do I remove the background')).toBe(false);
	});

	it('resolves clear I2V / edit only with this-turn attach', () => {
		expect(
			resolveAttachMediaIntent('make it walk', { hasThisTurnAttach: true })
		).toBe('i2v');
		expect(
			resolveAttachMediaIntent('remove the background', { hasThisTurnAttach: true })
		).toBe('edit');
		expect(
			resolveAttachMediaIntent('make it walk', { hasThisTurnAttach: false })
		).toBe('none');
	});

	it('ambiguous honors active composer toggle', () => {
		expect(
			resolveAttachMediaIntent('make it cooler', {
				hasThisTurnAttach: true,
				videoToggle: true
			})
		).toBe('i2v');
		expect(
			resolveAttachMediaIntent('make it cooler', {
				hasThisTurnAttach: true,
				imageToggle: true
			})
		).toBe('edit');
		expect(
			resolveAttachMediaIntent('make it cooler', { hasThisTurnAttach: true })
		).toBe('none');
	});

	it('detects image files in composer attach list', () => {
		expect(filesHaveImageAttach([{ type: 'image', content_type: 'image/png' }])).toBe(true);
		expect(filesHaveImageAttach([{ type: 'file', content_type: 'application/pdf' }])).toBe(
			false
		);
	});
});
