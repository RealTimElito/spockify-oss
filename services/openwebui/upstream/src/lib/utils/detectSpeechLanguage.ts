/**
 * Lightweight spoken-language detection for browser SpeechSynthesis.
 * Prefers character heuristics + common function words; no heavy deps.
 *
 * Voice selection prefers Chrome's Google neural voices (e.g. "Google Svenska",
 * "Google US English") when available — closest to WaveNet/Neural2 without
 * cloud TTS credentials.
 *
 * Critical: never attach an English (or other mismatched) voice to Swedish
 * (or other) content with utterance.lang overridden — that produces the
 * classic "American trying to speak Swedish" accent.
 */

export type SpeechLangTag = 'sv-SE' | 'en-US' | 'de-DE' | 'fr-FR' | 'es-ES' | 'nb-NO' | 'da-DK';

const LANG_WORD_SETS: { lang: SpeechLangTag; words: RegExp }[] = [
	{
		lang: 'sv-SE',
		words: /\b(?:och|att|det|är|som|för|med|på|av|den|ett|inte|om|har|kan|ska|var|från|till|men|eller|när|vad|hur|vilken|vilket|vilka|hej|tack|spännande|intressant|berlinmuren|sverige|svenska)\b/gi
	},
	{
		lang: 'nb-NO',
		words: /\b(?:og|at|det|er|som|for|med|på|av|den|et|ikke|om|har|kan|skal|var|fra|til|men|eller|når|hva|hvordan|hei|takk|norsk|norge)\b/gi
	},
	{
		lang: 'da-DK',
		words: /\b(?:og|at|det|er|som|for|med|på|af|den|et|ikke|om|har|kan|skal|var|fra|til|men|eller|når|hvad|hvordan|hej|tak|dansk|danmark)\b/gi
	},
	{
		lang: 'de-DE',
		words: /\b(?:und|der|die|das|ist|nicht|mit|von|zu|ein|eine|auch|auf|für|sich|dass|oder|aber|wie|was|warum|hallo|danke|deutsch|deutschland)\b/gi
	},
	{
		lang: 'fr-FR',
		// Avoid short articles (le/la/les/des/un/et/est/pas) — they collide with English/other Latin text.
		words: /\b(?:avec|pour|dans|bonjour|merci|français|france|ça|vous|nous|très|aussi|parce|aujourd|maintenant|toujours|jamais|pourquoi|comment|beaucoup)\b/gi
	},
	{
		lang: 'es-ES',
		// Distinctive Spanish only — y/el/la/de/en/un/es/no/con flip short English ("No problem!") to es-ES.
		words: /\b(?:hola|gracias|español|españa|también|está|están|aquí|ahora|porque|después|siempre|nunca|usted|nosotros|quiero|necesito|cómo|dónde|cuándo|más|bueno|bien|muy|tiene|hacer|puede)\b/gi
	},
	{
		lang: 'en-US',
		words: /\b(?:the|and|that|have|for|not|with|you|this|but|from|they|what|when|which|would|could|should|about|hello|hey|thanks|thank|english|there|here|are|is|was|were|your|you're|it's|don't|can't|will|just|like|really|problem|please|yes|okay|tips|some|these|those|than|then|them|their|our|into|over|after|before|because|while|where|who|how|why|can|need|want|know|think|make|get|look|see|come|going|good|great|well|also|very|much|more|most|other|only|even|still|right|sure|help|let|does|did|been|being|had|has|am)\b/gi
	}
];

/** Weak Romance tokens — only counted when strong Spanish/French evidence already exists. */
const ES_WEAK_WORDS =
	/\b(?:y|el|la|los|las|de|que|en|un|una|es|no|con|por|para|como)\b/gi;
const FR_WEAK_WORDS = /\b(?:et|le|la|les|des|un|une|est|pas|que|qui|sur)\b/gi;

/** Romance langs that need a clear win over English (shared Latin vocabulary). */
const ROMANCE_LANGS: SpeechLangTag[] = ['es-ES', 'fr-FR'];

/** Preferred display-name hints per language (Chrome Google TTS / natural voices). */
const NATURAL_NAME_HINTS: Partial<Record<SpeechLangTag, RegExp[]>> = {
	'sv-SE': [
		/google\s*svenska/i,
		/google.*swedish/i,
		/microsoft.*hedda/i,
		/\bhedda\b/i,
		/swedish/i,
		/svenska/i
	],
	'en-US': [/google\s*us\s*english/i, /google\s*english/i, /google.*en[-_]?us/i],
	'de-DE': [/google\s*deutsch/i, /google.*de/i],
	'fr-FR': [/google\s*français/i, /google\s*francais/i, /google.*fr/i],
	'es-ES': [/google\s*español/i, /google\s*espanol/i, /google.*es/i],
	'nb-NO': [/google.*norsk/i, /google.*nb/i],
	'da-DK': [/google.*dansk/i, /google.*da/i]
};

/**
 * Microsoft Edge neural voices (edge-tts) used by server TTS when the browser
 * has no matching SpeechSynthesis voice for the detected language.
 *
 * English defaults to Ava Multilingual (newer conversational Neural).
 * Swedish stays on Sofie (best free native sv voice via edge-tts).
 */
export const EDGE_TTS_VOICES: Record<SpeechLangTag, string> = {
	'sv-SE': 'sv-SE-SofieNeural',
	'en-US': 'en-US-AvaMultilingualNeural',
	'de-DE': 'de-DE-KatjaNeural',
	'fr-FR': 'fr-FR-DeniseNeural',
	'es-ES': 'es-ES-ElviraNeural',
	'nb-NO': 'nb-NO-PernilleNeural',
	'da-DK': 'da-DK-ChristelNeural'
};

/** Curated picker options (must stay aligned with backend `_EDGE_CURATED_VOICES`). */
export const EDGE_TTS_VOICE_OPTIONS: { id: string; label: string; langBase: string }[] = [
	{ id: 'sv-SE-SofieNeural', label: 'Sofie (Swedish)', langBase: 'sv' },
	{ id: 'sv-SE-MattiasNeural', label: 'Mattias (Swedish)', langBase: 'sv' },
	{ id: 'en-US-AvaMultilingualNeural', label: 'Ava Multilingual (US)', langBase: 'en' },
	{ id: 'en-US-EmmaMultilingualNeural', label: 'Emma Multilingual (US)', langBase: 'en' },
	{ id: 'en-US-AndrewMultilingualNeural', label: 'Andrew Multilingual (US)', langBase: 'en' },
	{ id: 'en-US-BrianMultilingualNeural', label: 'Brian Multilingual (US)', langBase: 'en' },
	{ id: 'en-US-JennyNeural', label: 'Jenny (US English)', langBase: 'en' },
	{ id: 'en-US-GuyNeural', label: 'Guy (US English)', langBase: 'en' },
	{ id: 'en-US-AriaNeural', label: 'Aria (US English)', langBase: 'en' },
	{ id: 'en-GB-SoniaNeural', label: 'Sonia (British English)', langBase: 'en' },
	{ id: 'de-DE-KatjaNeural', label: 'Katja (German)', langBase: 'de' },
	{ id: 'de-DE-SeraphinaMultilingualNeural', label: 'Seraphina Multilingual (DE)', langBase: 'de' },
	{ id: 'fr-FR-DeniseNeural', label: 'Denise (French)', langBase: 'fr' },
	{ id: 'fr-FR-VivienneMultilingualNeural', label: 'Vivienne Multilingual (FR)', langBase: 'fr' },
	{ id: 'es-ES-ElviraNeural', label: 'Elvira (Spanish)', langBase: 'es' },
	{ id: 'nb-NO-PernilleNeural', label: 'Pernille (Norwegian)', langBase: 'nb' },
	{ id: 'da-DK-ChristelNeural', label: 'Christel (Danish)', langBase: 'da' }
];

/** True when server TTS is edge-tts (forced) or hybrid empty engine (browser + edge fallback). */
export function isServerEdgeTtsEngine(engine?: string | null): boolean {
	return engine === 'edge' || engine === '';
}

/** Per-language neural override map: language base (`sv`, `en`, …) → Neural voice id. */
export type EdgeVoiceByLang = Partial<Record<string, string>>;

export function isEdgeNeuralVoice(voice?: string | null): boolean {
	return !!voice && /Neural/i.test(voice);
}

/** Language base for an edge-tts id (`sv-SE-SofieNeural` → `sv`). */
export function edgeNeuralLangBase(voiceId: string): string {
	const parts = (voiceId || '').split('-');
	return (parts[0] || 'en').toLowerCase();
}

/** Map a BCP-47 / SpeechLangTag to an edge-tts Neural voice id. */
export function edgeVoiceForLang(lang: string): string {
	const normalized = (lang || 'en-US').replace(/_/g, '-') as SpeechLangTag;
	if (EDGE_TTS_VOICES[normalized]) {
		return EDGE_TTS_VOICES[normalized];
	}
	const base = speechLangBase(normalized);
	const byBase = (Object.entries(EDGE_TTS_VOICES) as [SpeechLangTag, string][]).find(
		([tag]) => speechLangBase(tag) === base
	);
	return byBase?.[1] ?? EDGE_TTS_VOICES['en-US'];
}

/**
 * Resolve edge-tts voice for a spoken language.
 * Prefers per-lang override, then a global Neural preference that matches the lang,
 * otherwise the auto default (sv→Sofie, en→Ava Multilingual, …).
 */
export function resolveEdgeVoice(
	lang: string,
	edgeVoiceByLang?: EdgeVoiceByLang | null,
	globalVoice?: string | null
): string {
	const base = speechLangBase(lang);
	const byLang = edgeVoiceByLang?.[base];
	if (byLang && isEdgeNeuralVoice(byLang)) {
		return byLang;
	}
	if (globalVoice && isEdgeNeuralVoice(globalVoice) && edgeNeuralLangBase(globalVoice) === base) {
		return globalVoice;
	}
	return edgeVoiceForLang(lang);
}

/**
 * True when the user explicitly picked a neural voice for this language.
 * Forces server edge-tts even if the browser has a matching SpeechSynthesis voice.
 */
export function hasEdgeVoiceOverride(
	lang: string,
	edgeVoiceByLang?: EdgeVoiceByLang | null,
	globalVoice?: string | null
): boolean {
	const base = speechLangBase(lang);
	const byLang = edgeVoiceByLang?.[base];
	if (byLang && isEdgeNeuralVoice(byLang)) {
		return true;
	}
	return !!(
		globalVoice &&
		isEdgeNeuralVoice(globalVoice) &&
		edgeNeuralLangBase(globalVoice) === base
	);
}

function countMatches(text: string, re: RegExp): number {
	const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
	const global = new RegExp(re.source, flags);
	return (text.match(global) ?? []).length;
}

function swedishCharScore(text: string): number {
	return (text.match(/[åäöÅÄÖ]/g) ?? []).length;
}

function germanCharScore(text: string): number {
	return (text.match(/[äöüßÄÖÜ]/g) ?? []).length;
}

function spanishCharScore(text: string): number {
	return (text.match(/[ñÑ¿¡]/g) ?? []).length;
}

/**
 * Detect a BCP-47 language tag suitable for SpeechSynthesisUtterance.lang.
 */
export function detectSpeechLanguage(text: string): SpeechLangTag {
	const sample = (text || '').slice(0, 4000).trim();
	if (!sample) {
		return 'en-US';
	}

	const scores: Partial<Record<SpeechLangTag, number>> = {};

	const svChars = swedishCharScore(sample);
	if (svChars > 0) {
		scores['sv-SE'] = (scores['sv-SE'] ?? 0) + svChars * 3;
	}
	const deChars = germanCharScore(sample);
	if (deChars > 0) {
		scores['de-DE'] = (scores['de-DE'] ?? 0) + deChars * 2;
	}
	const esChars = spanishCharScore(sample);
	if (esChars > 0) {
		scores['es-ES'] = (scores['es-ES'] ?? 0) + esChars * 3;
	}

	for (const { lang, words } of LANG_WORD_SETS) {
		const n = countMatches(sample, words);
		if (n > 0) {
			scores[lang] = (scores[lang] ?? 0) + n;
		}
	}

	// Weak Romance tokens only reinforce an already-positive Spanish/French score.
	if ((scores['es-ES'] ?? 0) > 0) {
		scores['es-ES'] = (scores['es-ES'] ?? 0) + countMatches(sample, ES_WEAK_WORDS);
	}
	if ((scores['fr-FR'] ?? 0) > 0) {
		scores['fr-FR'] = (scores['fr-FR'] ?? 0) + countMatches(sample, FR_WEAK_WORDS);
	}

	// å/ä/ö without strong German markers → prefer Swedish over German.
	if (svChars > 0 && (scores['sv-SE'] ?? 0) >= (scores['de-DE'] ?? 0)) {
		scores['de-DE'] = Math.min(scores['de-DE'] ?? 0, (scores['sv-SE'] ?? 0) - 1);
	}

	// Stronger English bias when Nordic chars are absent and English function words appear.
	const enHits = scores['en-US'] ?? 0;
	if (svChars === 0 && enHits > 0) {
		scores['en-US'] = enHits + 2;
	}

	let best: SpeechLangTag = 'en-US';
	let bestScore = -1;
	for (const [lang, score] of Object.entries(scores) as [SpeechLangTag, number][]) {
		if (score > bestScore) {
			best = lang;
			bestScore = score;
		}
	}

	if (bestScore <= 0) {
		return 'en-US';
	}

	// Raise Spanish/French threshold: need a clear win when English also scored.
	const enScore = scores['en-US'] ?? 0;
	if (ROMANCE_LANGS.includes(best) && enScore > 0 && bestScore <= enScore + 1) {
		return 'en-US';
	}

	return best;
}

/** Normalize BCP-47 / underscore voice.lang to lowercase base (e.g. sv). */
export function speechLangBase(lang: string): string {
	return (lang || 'en').split(/[-_]/)[0]?.toLowerCase() ?? 'en';
}

/**
 * True only when voice.lang matches the requested language base
 * (sv-SE / sv-FI / sv → sv). English voices never match Swedish.
 */
export function voiceMatchesLang(voice: SpeechSynthesisVoice, lang: string): boolean {
	const want = speechLangBase(lang);
	const vLang = (voice.lang || '').toLowerCase().replace(/_/g, '-');
	if (!vLang || !want) {
		return false;
	}
	return vLang === lang.toLowerCase().replace(/_/g, '-') || vLang.startsWith(`${want}-`) || vLang === want;
}

/**
 * Higher = more natural. Prefer Google cloud voices in Chromium, then Microsoft
 * Natural/Neural / Hedda, then other remote voices; deprioritize eSpeak/robotic locals.
 */
function naturalnessScore(voice: SpeechSynthesisVoice, lang: SpeechLangTag | string): number {
	const name = `${voice.name} ${voice.voiceURI}`;
	let score = 0;

	if (/google/i.test(name)) {
		score += 100;
	}
	if (/microsoft/i.test(name) && /natural|neural|hedda/i.test(name)) {
		score += 80;
	} else if (/microsoft/i.test(name)) {
		score += 40;
	}
	if (/natural|neural|wavenet|studio|premium/i.test(name)) {
		score += 30;
	}
	if (voice.localService === false) {
		score += 15;
	}
	if (/espeak|festival|robot|compact/i.test(name)) {
		score -= 50;
	}

	const hints = NATURAL_NAME_HINTS[lang as SpeechLangTag];
	if (hints) {
		for (let i = 0; i < hints.length; i++) {
			if (hints[i].test(name)) {
				score += 50 - i * 5;
				break;
			}
		}
	}

	const wantFull = lang.toLowerCase().replace(/_/g, '-');
	const vLang = (voice.lang || '').toLowerCase().replace(/_/g, '-');
	if (vLang === wantFull) {
		score += 10;
	}

	if (voice.default) {
		score += 2;
	}

	return score;
}

function sortByNaturalness(
	voices: SpeechSynthesisVoice[],
	lang: string
): SpeechSynthesisVoice[] {
	return [...voices].sort((a, b) => naturalnessScore(b, lang) - naturalnessScore(a, lang));
}

function warnMissingLangVoice(_lang: string, _voices: SpeechSynthesisVoice[]): void {
	// Intentionally silent — callers fall back to server edge-tts and log once via
	// logSpeechVoiceChoice(). Avoid console.warn spam on every CallOverlay sentence.
}

/**
 * Pick a SpeechSynthesis voice for lang, preferring Google / neural voices.
 * Uses preferredVoiceURI only when it already matches the language.
 *
 * Never returns a voice whose lang base differs from `lang` — especially never
 * en-US/en-GB for Swedish content.
 */
export function pickSpeechVoice(
	voices: SpeechSynthesisVoice[],
	lang: string,
	preferredVoiceURI?: string
): SpeechSynthesisVoice | undefined {
	if (!voices?.length) {
		return undefined;
	}

	const langBase = speechLangBase(lang);
	const candidates = voices.filter((v) => voiceMatchesLang(v, lang));

	if (preferredVoiceURI) {
		const preferred = voices.find((v) => v.voiceURI === preferredVoiceURI);
		if (preferred && voiceMatchesLang(preferred, lang)) {
			// Keep user preference only if it is at least as natural as the best
			// Google/neural option for this language (avoid locking to a robotic voice).
			const bestNatural = sortByNaturalness(candidates, lang)[0];
			if (
				!bestNatural ||
				naturalnessScore(preferred, lang) + 20 >= naturalnessScore(bestNatural, lang)
			) {
				return preferred;
			}
		}
	}

	if (candidates.length) {
		return sortByNaturalness(candidates, lang)[0];
	}

	// Extra Swedish recovery: name hints if a voice is mis-tagged but clearly Swedish.
	if (langBase === 'sv') {
		const byName = voices.filter((v) => {
			const n = `${v.name} ${v.voiceURI}`;
			if (!/svenska|swedish|\bhedda\b/i.test(n)) {
				return false;
			}
			// Never accept an explicitly English-tagged voice.
			const vBase = speechLangBase(v.lang);
			return !v.lang || vBase === 'sv';
		});
		if (byName.length) {
			return sortByNaturalness(byName, lang)[0];
		}
	}

	warnMissingLangVoice(lang, voices);
	// Never fall back to preferredVoiceURI or default English — that is the accent bug.
	return undefined;
}

/** Dev-friendly log of the voice actually used for speak(). */
export function logSpeechVoiceChoice(
	lang: string,
	voice: SpeechSynthesisVoice | undefined,
	edgeVoice?: string
): void {
	if (voice) {
		console.info(
			`[Spockify TTS] speaking lang=${lang} voice="${voice.name}" voice.lang=${voice.lang} local=${voice.localService}`
		);
	} else {
		console.info(
			`[Spockify TTS] speaking lang=${lang} via server edge-tts voice=${edgeVoice ?? edgeVoiceForLang(lang)}`
		);
	}
}
