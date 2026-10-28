import { describe, expect, it } from 'vitest';
import {
	detectSpeechLanguage,
	edgeVoiceForLang,
	hasEdgeVoiceOverride,
	resolveEdgeVoice
} from './detectSpeechLanguage';

describe('detectSpeechLanguage', () => {
	it('keeps clear English as en-US (not es-ES)', () => {
		expect(detectSpeechLanguage('Hey there Spockify!')).toBe('en-US');
		expect(detectSpeechLanguage('No problem!')).toBe('en-US');
		expect(detectSpeechLanguage('Here are some Cursor IDE tips.')).toBe('en-US');
		expect(detectSpeechLanguage('Thanks for the help with this.')).toBe('en-US');
	});

	it('still detects clear Spanish as es-ES', () => {
		expect(detectSpeechLanguage('Hola, ¿cómo estás?')).toBe('es-ES');
		expect(detectSpeechLanguage('Gracias por tu ayuda con el proyecto.')).toBe('es-ES');
	});

	it('still detects Swedish via åäö / function words', () => {
		expect(detectSpeechLanguage('Hej! Det är spännande att testa detta.')).toBe('sv-SE');
	});
});

describe('resolveEdgeVoice / hasEdgeVoiceOverride', () => {
	it('defaults sv→Sofie and en→Ava Multilingual', () => {
		expect(edgeVoiceForLang('sv-SE')).toBe('sv-SE-SofieNeural');
		expect(edgeVoiceForLang('en-US')).toBe('en-US-AvaMultilingualNeural');
		expect(resolveEdgeVoice('sv-SE')).toBe('sv-SE-SofieNeural');
		expect(resolveEdgeVoice('en-US')).toBe('en-US-AvaMultilingualNeural');
	});

	it('honors per-lang neural override', () => {
		const byLang = { sv: 'sv-SE-MattiasNeural', en: 'en-US-GuyNeural' };
		expect(resolveEdgeVoice('sv-SE', byLang)).toBe('sv-SE-MattiasNeural');
		expect(resolveEdgeVoice('en-US', byLang)).toBe('en-US-GuyNeural');
		expect(hasEdgeVoiceOverride('sv-SE', byLang)).toBe(true);
		expect(hasEdgeVoiceOverride('de-DE', byLang)).toBe(false);
	});

	it('honors global neural only when lang matches', () => {
		expect(resolveEdgeVoice('sv-SE', null, 'sv-SE-MattiasNeural')).toBe('sv-SE-MattiasNeural');
		expect(resolveEdgeVoice('en-US', null, 'sv-SE-MattiasNeural')).toBe(
			'en-US-AvaMultilingualNeural'
		);
		expect(hasEdgeVoiceOverride('sv-SE', null, 'sv-SE-MattiasNeural')).toBe(true);
		expect(hasEdgeVoiceOverride('en-US', null, 'sv-SE-MattiasNeural')).toBe(false);
	});
});
