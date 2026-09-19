<script lang="ts">
	import { config, models, settings, showCallOverlay, TTSWorker, user } from '$lib/stores';
	import { onMount, tick, getContext, onDestroy, createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	import { blobToFile } from '$lib/utils';
	import {
		detectSpeechLanguage,
		EDGE_TTS_VOICE_OPTIONS,
		isServerEdgeTtsEngine,
		logSpeechVoiceChoice,
		resolveEdgeVoice
	} from '$lib/utils/detectSpeechLanguage';
	import { generateEmoji } from '$lib/apis';
	import { synthesizeOpenAISpeech, transcribeAudio } from '$lib/apis/audio';
	import { updateUserSettings } from '$lib/apis/users';

	import { toast } from 'svelte-sonner';

	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import VideoInputMenu from './CallOverlay/VideoInputMenu.svelte';
	import { KokoroWorker } from '$lib/workers/KokoroWorker';
	import { WEBUI_API_BASE_URL } from '$lib/constants';
	import { submitScreenFrames, voiceWorldReturn } from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	export let eventTarget: EventTarget;
	export let submitPrompt: Function;
	export let stopResponse: Function;
	export let files;
	export let chatId;
	export let modelId;

	let wakeLock = null;

	let model = null;

	let loading = false;
	let confirmed = false;
	let interrupted = false;
	let assistantSpeaking = false;
	let muted = false;
	/** Hold-to-talk instead of always-listen (persisted). */
	let pushToTalk = false;
	let pttHeld = false;
	/** Wave 8.8: optional wake word via Web Speech API. */
	let wakeWordEnabled = false;
	let wakeWordPhrase = 'hey spockify';
	let wakeWordSupported = false;
	let wakeWordListening = false;
	let wakeWordStatus = '';
	let wakeWordRecognition: any = null;
	/** Wave 9.2: duplex Call — barge-in + partial STT display. */
	let duplexMode = true;
	let partialTranscript = '';
	/** W4.12 TTS prosody: default | calm | excited */
	let ttsStyle: 'default' | 'calm' | 'excited' = 'default';
	/** W4.5 waveform avatar levels (0–1) while TTS plays. */
	let ttsWaveLevels: number[] = Array(24).fill(0.08);
	let spatialPresence = true;

	const persistSpatialPresence = (on: boolean) => {
		spatialPresence = on;
		try {
			localStorage.setItem('spockifySpatialPresence', on ? '1' : '0');
		} catch {
			/* ignore */
		}
	};
	let screenAgentStatus = '';
	let screenShareTimer: any = null;
	let mouthOpen = 0.08;
	let ttsAnalyser: AnalyserNode | null = null;
	let ttsAudioCtx: AudioContext | null = null;
	let ttsWaveRaf = 0;
	/** Session language lock for Call TTS (badge + sticky voice). */
	let languageLock: string | null = null;
	let languageLockLabel = '';

	const LANG_LOCK_LABELS: Record<string, string> = {
		'sv-SE': 'SV',
		'en-US': 'EN',
		'de-DE': 'DE',
		'fr-FR': 'FR',
		'es-ES': 'ES',
		'nb-NO': 'NB',
		'da-DK': 'DA'
	};

	const persistLanguageLock = (lang: string | null) => {
		languageLock = lang;
		languageLockLabel = lang ? LANG_LOCK_LABELS[lang] || lang.slice(0, 2).toUpperCase() : '';
		try {
			if (lang) localStorage.setItem('spockifyLanguageLock', lang);
			else localStorage.removeItem('spockifyLanguageLock');
		} catch {
			/* ignore */
		}
	};

	const noteSpeechLanguage = (content: string) => {
		const detected = detectSpeechLanguage(content);
		if (!detected) return detected;
		if (!languageLock) {
			persistLanguageLock(detected);
		}
		return languageLock || detected;
	};

	const TTS_STYLE_PROSODY: Record<
		'default' | 'calm' | 'excited',
		{ rate?: string; pitch?: string }
	> = {
		default: {},
		calm: { rate: '-8%', pitch: '-2Hz' },
		excited: { rate: '+8%', pitch: '+3Hz' }
	};

	const getTtsSpeechOptions = (stream = true) => ({
		...TTS_STYLE_PROSODY[ttsStyle],
		stream
	});

	const persistTtsStyle = (style: 'default' | 'calm' | 'excited') => {
		ttsStyle = style;
		try {
			localStorage.setItem('spockifyTtsStyle', style);
		} catch {
			/* ignore */
		}
		settings.set({ ...$settings, spockifyTtsStyle: style });
	};

	const stopTtsWave = () => {
		if (ttsWaveRaf) {
			cancelAnimationFrame(ttsWaveRaf);
			ttsWaveRaf = 0;
		}
		ttsWaveLevels = Array(24).fill(0.08);
	};

	const startTtsWave = (audioEl: HTMLAudioElement) => {
		if (ttsWaveRaf) {
			cancelAnimationFrame(ttsWaveRaf);
			ttsWaveRaf = 0;
		}
		try {
			if (!ttsAudioCtx) {
				ttsAudioCtx = new AudioContext();
			}
			const ctx = ttsAudioCtx;
			if (!ttsAnalyser) {
				const source = ctx.createMediaElementSource(audioEl);
				const analyser = ctx.createAnalyser();
				analyser.fftSize = 64;
				source.connect(analyser);
				analyser.connect(ctx.destination);
				ttsAnalyser = analyser;
			}
			if (ctx.state === 'suspended') {
				ctx.resume().catch(() => {});
			}
			const data = new Uint8Array(ttsAnalyser.frequencyBinCount);
			const tick = () => {
				if (!ttsAnalyser) return;
				ttsAnalyser.getByteFrequencyData(data);
				const bars = 24;
				const step = Math.max(1, Math.floor(data.length / bars));
				ttsWaveLevels = Array.from({ length: bars }, (_, i) => {
					const v = data[i * step] ?? 0;
					return Math.max(0.08, Math.min(1, v / 180));
				});
				mouthOpen =
					ttsWaveLevels.reduce((a, b) => a + b, 0) / Math.max(1, ttsWaveLevels.length);
				ttsWaveRaf = requestAnimationFrame(tick);
			};
			ttsWaveRaf = requestAnimationFrame(tick);
		} catch (err) {
			console.warn('TTS waveform unavailable', err);
			const pulse = () => {
				const t = Date.now() / 200;
				ttsWaveLevels = Array.from({ length: 24 }, (_, i) => {
					return 0.2 + 0.55 * Math.abs(Math.sin(t + i * 0.35));
				});
				ttsWaveRaf = requestAnimationFrame(pulse);
			};
			ttsWaveRaf = requestAnimationFrame(pulse);
		}
	};

	/** Progressive play for streamed MPEG — start audio after the first buffer, keep appending. */
	const playStreamingSpeechResponse = async (res: Response) => {
		if (!res.body) {
			const blob = await res.blob();
			await playAudio(new Audio(URL.createObjectURL(blob)));
			return;
		}

		const canMse =
			typeof MediaSource !== 'undefined' &&
			typeof MediaSource.isTypeSupported === 'function' &&
			MediaSource.isTypeSupported('audio/mpeg');

		if (!canMse) {
			const parts: Uint8Array[] = [];
			const reader = res.body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value?.length) parts.push(value);
			}
			await playAudio(
				new Audio(URL.createObjectURL(new Blob(parts as BlobPart[], { type: 'audio/mpeg' })))
			);
			return;
		}

		const mediaSource = new MediaSource();
		const objectUrl = URL.createObjectURL(mediaSource);
		const audio = new Audio(objectUrl);
		let playPromise: Promise<unknown> = Promise.resolve();
		let started = false;

		await new Promise<void>((resolve) => {
			mediaSource.addEventListener(
				'sourceopen',
				async () => {
					try {
						const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
						const reader = res.body!.getReader();
						const append = (chunk: Uint8Array) =>
							new Promise<void>((resAppend, rejAppend) => {
								const onUpdate = () => {
									sourceBuffer.removeEventListener('updateend', onUpdate);
									resAppend();
								};
								sourceBuffer.addEventListener('updateend', onUpdate);
								try {
									sourceBuffer.appendBuffer(
										chunk.buffer.slice(
											chunk.byteOffset,
											chunk.byteOffset + chunk.byteLength
										) as ArrayBuffer
									);
								} catch (err) {
									sourceBuffer.removeEventListener('updateend', onUpdate);
									rejAppend(err);
								}
							});

						while (true) {
							const { done, value } = await reader.read();
							if (done) break;
							if (value?.length) {
								await append(value);
								// First audio bytes ready → start playback immediately (overlap with rest of stream).
								if (!started) {
									started = true;
									playPromise = playAudio(audio);
								}
							}
						}
						if (mediaSource.readyState === 'open') {
							mediaSource.endOfStream();
						}
					} catch (err) {
						console.warn('MSE TTS stream failed', err);
					}
					resolve();
				},
				{ once: true }
			);
		});

		await playPromise;
	};
	/** True after user utterance submitted until assistant chat/TTS cycle begins. */
	let awaitingAssistant = false;
	/** Don't reopen STT until this timestamp (ms) — post-TTS echo guard. */
	let listenCooldownUntil = 0;
	/** Recent assistant TTS texts for light echo rejection. */
	let recentTtsTexts: string[] = [];

	let emoji = null;
	let camera = false;
	let cameraStream = null;

	let chatStreaming = false;
	let rmsLevel = 0;
	let hasStartedSpeaking = false;
	let mediaRecorder;
	let audioStream = null;
	let audioChunks = [];

	/** Resolve in-flight playAudio / utterance waiters when TTS is stopped. */
	let pendingTtsResolve: ((value?: unknown) => void) | null = null;

	/**
	 * Duplex VAD / barge-in knobs (override via localStorage).
	 * RMS+hold starts barge *capture* only; TTS stops after STT confirms speech.
	 * Tuned so ambient noise / speaker bleed does not steal listening time.
	 */
	const CALL_VAD = {
		/** End-of-utterance silence before STT (ms). */
		silenceMs: 650,
		/** RMS to start recording while idle/listening. */
		rmsSpeak: 0.028,
		/** RMS to start barge capture while assistant speaks (higher = less sensitive). */
		rmsBarge: 0.11,
		/** Sustained energy required before barge capture (ms). */
		bargeHoldMs: 550,
		/** Ignore barge capture after TTS starts playing (ms). */
		bargeGraceMs: 1600,
		/** Post-TTS echo guard (ms). */
		listenCooldownMs: 450,
		/** Min alphanumeric chars in STT before barge interrupt. */
		bargeMinChars: 6,
		/** Min captured barge audio before EOU→STT (ms). */
		bargeMinCaptureMs: 700
	};

	let ttsProtectUntil = 0;
	let bargeSpeechStartedAt = 0;
	/** When barge capture actually began (for min-duration gate). */
	let bargeCaptureStartedAt = 0;
	/** True while current MediaRecorder session is a barge attempt over TTS. */
	let bargeCaptureActive = false;

	const readCallNum = (key: string, fallback: number, min: number, max: number) => {
		try {
			const raw = localStorage.getItem(key);
			const n = raw ? Number(raw) : NaN;
			if (Number.isFinite(n) && n >= min && n <= max) return n;
		} catch {
			/* ignore */
		}
		return fallback;
	};

	const armTtsProtect = (ms?: number) => {
		const grace = ms ?? readCallNum('spockifyCallBargeGraceMs', CALL_VAD.bargeGraceMs, 0, 4000);
		ttsProtectUntil = Math.max(ttsProtectUntil, Date.now() + grace);
		bargeSpeechStartedAt = 0;
	};

	const bargeInEnabled = () =>
		(duplexMode || ($settings?.voiceInterruption ?? false)) && !pushToTalk && !muted;

	/** Pause mic VAD/STT while thinking, streaming, speaking, or (PTT) not holding.
	 * Barge-in / duplex (W9.2): duplexMode or voiceInterruption keeps mic open during TTS. */
	const shouldPauseStt = () => {
		const bargeIn = bargeInEnabled();
		return (
			muted ||
			(pushToTalk && !pttHeld) ||
			loading ||
			awaitingAssistant ||
			// Keep mic open for gated barge-in while assistant audio plays (even mid-LLM stream).
			(chatStreaming && !(bargeIn && assistantSpeaking)) ||
			(assistantSpeaking && !bargeIn) ||
			Date.now() < listenCooldownUntil
		);
	};

	const rememberTtsText = (content: string) => {
		const t = (content || '').trim();
		if (!t) return;
		recentTtsTexts = [...recentTtsTexts.slice(-8), t];
	};

	/** Drop transcripts that heavily overlap recent TTS (speaker echo). */
	const isLikelyEchoTranscript = (transcript: string): boolean => {
		const t = (transcript || '')
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (t.length < 6) return false;
		const tWords = t.split(' ').filter(Boolean);
		if (!tWords.length) return false;
		for (const recent of recentTtsTexts) {
			const r = recent
				.toLowerCase()
				.replace(/[^\p{L}\p{N}\s]/gu, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			if (!r) continue;
			if (r.includes(t) || t.includes(r.slice(0, Math.min(r.length, 80)))) {
				return true;
			}
			const overlap = tWords.filter((w) => r.includes(w)).length;
			if (tWords.length >= 3 && overlap / tWords.length >= 0.6) {
				return true;
			}
		}
		return false;
	};

	/** Common Whisper empty-room / bleed hallucinations — never interrupt TTS for these. */
	const WHISPER_NOISE_PHRASES = new Set([
		'thank you',
		'thanks',
		'thanks for watching',
		'thank you for watching',
		'you',
		'the',
		'a',
		'um',
		'uh',
		'hmm',
		'mm',
		'mhm',
		'ah',
		'oh',
		'ok',
		'okay',
		'ja',
		'nej',
		'hej',
		'hi',
		'hey'
	]);

	/**
	 * Barge-in must be intentional speech, not RMS noise or Whisper hallucinations.
	 * Idle listening stays permissive; barge requires longer / multi-word text.
	 */
	const isMeaningfulSpeechTranscript = (transcript: string, forBarge = false): boolean => {
		const t = (transcript || '').trim();
		if (!t) return false;
		const normalized = t
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, ' ')
			.replace(/\s+/g, ' ')
			.trim();
		if (!normalized) return false;
		if (forBarge && WHISPER_NOISE_PHRASES.has(normalized)) return false;

		const minChars = forBarge
			? readCallNum('spockifyCallBargeMinChars', CALL_VAD.bargeMinChars, 1, 32)
			: 1;
		const alnum = t.replace(/[^\p{L}\p{N}]+/gu, '');
		if (alnum.length < minChars) return false;

		if (forBarge) {
			const words = normalized.split(' ').filter(Boolean);
			// Single short tokens ("ja", "ok") are too often bleed/hallucination.
			if (words.length < 2 && alnum.length < 10) return false;
		}
		return true;
	};

	const discardInProgressUtterance = () => {
		hasStartedSpeaking = false;
		confirmed = false;
		bargeCaptureActive = false;
		bargeCaptureStartedAt = 0;
		bargeSpeechStartedAt = 0;
		audioChunks = [];
		try {
			if (mediaRecorder && mediaRecorder.state === 'recording') {
				mediaRecorder.stop();
			}
		} catch {
			/* ignore */
		}
	};

	const getBargeMinCaptureMs = () =>
		readCallNum('spockifyCallBargeMinCaptureMs', CALL_VAD.bargeMinCaptureMs, 200, 3000);

	/** Post-TTS echo guard; duplex uses a shorter default so turns feel snappier. */
	const beginListenCooldown = (ms?: number) => {
		const fallback = duplexMode ? CALL_VAD.listenCooldownMs : 700;
		listenCooldownUntil = Date.now() + (ms ?? fallback);
	};

	/** End-of-utterance silence before STT (ms). Duplex default 650; override via localStorage. */
	const getSilenceMs = () => {
		if (!duplexMode) return 2000;
		return readCallNum('spockifyCallSilenceMs', CALL_VAD.silenceMs, 400, 3000);
	};

	const getSpeakRms = () => readCallNum('spockifyCallSpeakRms', CALL_VAD.rmsSpeak, 0.01, 0.2);

	const getBargeRms = () => readCallNum('spockifyCallBargeRms', CALL_VAD.rmsBarge, 0.02, 0.3);

	const getBargeHoldMs = () =>
		readCallNum('spockifyCallBargeHoldMs', CALL_VAD.bargeHoldMs, 100, 1500);

	let videoInputDevices = [];
	let selectedVideoInputDeviceId = null;

	const getVideoInputDevices = async () => {
		const devices = await navigator.mediaDevices.enumerateDevices();
		videoInputDevices = devices.filter((device) => device.kind === 'videoinput');

		if (!!navigator.mediaDevices.getDisplayMedia) {
			videoInputDevices = [
				...videoInputDevices,
				{
					deviceId: 'screen',
					label: 'Screen Share'
				}
			];
		}

		console.log(videoInputDevices);
		if (selectedVideoInputDeviceId === null && videoInputDevices.length > 0) {
			const savedDeviceId = localStorage.getItem('selectedVideoInputDeviceId');
			if (savedDeviceId && videoInputDevices.some((d) => d.deviceId === savedDeviceId)) {
				selectedVideoInputDeviceId = savedDeviceId;
			} else {
				selectedVideoInputDeviceId = videoInputDevices[0].deviceId;
			}
		}
	};

	const startCamera = async () => {
		await getVideoInputDevices();

		if (cameraStream === null) {
			camera = true;
			await tick();
			try {
				await startVideoStream();
			} catch (err) {
				console.error('Error accessing webcam: ', err);
			}
		}
	};

	const startVideoStream = async () => {
		const video = document.getElementById('camera-feed');
		if (video) {
			if (selectedVideoInputDeviceId === 'screen') {
				cameraStream = await navigator.mediaDevices.getDisplayMedia({
					video: {
						cursor: 'always'
					},
					audio: false
				});
			} else {
				cameraStream = await navigator.mediaDevices.getUserMedia({
					video: {
						deviceId: selectedVideoInputDeviceId ? { exact: selectedVideoInputDeviceId } : undefined
					}
				});
			}

			if (cameraStream) {
				await getVideoInputDevices();
				video.srcObject = cameraStream;
				await video.play();
				if (selectedVideoInputDeviceId === 'screen') {
					startScreenShareAgent();
				}
			}
		}
	};

	const startScreenShareAgent = () => {
		stopScreenShareAgent();
		screenAgentStatus = 'Screen share → agent listening…';
		screenShareTimer = setInterval(async () => {
			try {
				const dataURL = takeScreenshot();
				if (!dataURL) return;
				const res = await submitScreenFrames(localStorage.token, {
					frames: [{ image_b64: dataURL, mime: 'image/png' }],
					chat_id: chatId,
					prompt: 'Narrate the shared screen and suggest Playwright actions',
					drive_playwright: false
				});
				screenAgentStatus = res?.live_status || res?.narration?.slice(0, 120) || 'ok';
			} catch (e) {
				screenAgentStatus = `screen agent: ${e}`;
			}
		}, 4000);
	};

	const stopScreenShareAgent = () => {
		if (screenShareTimer) {
			clearInterval(screenShareTimer);
			screenShareTimer = null;
		}
	};

	const stopVideoStream = async () => {
		if (cameraStream) {
			const tracks = cameraStream.getTracks();
			tracks.forEach((track) => track.stop());
		}

		cameraStream = null;
	};

	const takeScreenshot = () => {
		const video = document.getElementById('camera-feed');
		const canvas = document.getElementById('camera-canvas');

		if (!canvas) {
			return;
		}

		const context = canvas.getContext('2d');

		// Make the canvas match the video dimensions
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;

		// Draw the image from the video onto the canvas
		context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

		// Convert the canvas to a data base64 URL and console log it
		const dataURL = canvas.toDataURL('image/png');
		console.log(dataURL);

		return dataURL;
	};

	const stopCamera = async () => {
		stopScreenShareAgent();
		screenAgentStatus = '';
		await stopVideoStream();
		camera = false;
	};

	const MIN_DECIBELS = -55;
	const VISUALIZER_BUFFER_LENGTH = 300;

	const transcribeHandler = async (audioBlob) => {
		// Create a blob from the audio chunks
		if (!audioBlob || audioBlob.size < 100) {
			console.log('Audio blob too small or empty, skipping transcription');
			return;
		}

		// Capture before await — barge attempts must not cut TTS on empty STT.
		const wasBargeAttempt = assistantSpeaking || chatStreaming;

		await tick();
		const file = blobToFile(audioBlob, 'recording.wav');

		// Prefer Call language lock (sv-SE → sv) over settings STT language.
		const lockRaw = (languageLock || '').toString().trim();
		const settingsLang = ($settings?.audio?.stt?.language || '').toString().trim();
		const sttLanguage =
			(lockRaw ? lockRaw.slice(0, 2).toLowerCase() : '') ||
			(settingsLang ? settingsLang.slice(0, 2).toLowerCase() : '') ||
			undefined;

		const res = await transcribeAudio(
			localStorage.token,
			file,
			sttLanguage
		).catch((error) => {
			toast.error(`${error}`);
			return null;
		});

		if (res) {
			console.log(res.text);
			partialTranscript = res.text || '';

			const text = (res.text || '').trim();

			if (text && isMeaningfulSpeechTranscript(text, wasBargeAttempt)) {
				if (isLikelyEchoTranscript(text)) {
					console.info('[Spockify Call] Ignoring likely TTS echo transcript:', text);
					awaitingAssistant = false;
					partialTranscript = '';
					return;
				}
				// Confirmed speech: only now cancel TTS / generation (not on loud noise alone).
				if (wasBargeAttempt) {
					console.info('[Spockify Call] Barge-in confirmed by STT:', text);
					await stopSpeaking();
				}
				// Keep STT paused until assistant starts streaming / speaking.
				awaitingAssistant = true;
				partialTranscript = '';
				await submitPrompt(text, { _raw: true });
			} else {
				if (wasBargeAttempt) {
					console.info(
						`[Spockify Call] Ignoring barge noise (no meaningful STT): "${text || ''}"`
					);
				}
				awaitingAssistant = false;
				partialTranscript = '';
			}
		} else {
			awaitingAssistant = false;
		}
	};

	const stopRecordingCallback = async (_continue = true) => {
		if ($showCallOverlay) {
			console.log('%c%s', 'color: red; font-size: 20px;', '🚨 stopRecordingCallback 🚨');

			// deep copy the audioChunks array
			const _audioChunks = audioChunks.slice(0);

			audioChunks = [];
			mediaRecorder = false;

			// Pause STT before restarting the recorder when we are about to think/speak.
			if (confirmed) {
				loading = true;
			}

			if (_continue) {
				startRecording();
			}

			if (confirmed) {
				emoji = null;

				if (cameraStream) {
					const imageUrl = takeScreenshot();

					files = [
						{
							type: 'image',
							url: imageUrl
						}
					];
				}

				const audioBlob = new Blob(_audioChunks, { type: 'audio/wav' });
				bargeCaptureActive = false;
				bargeCaptureStartedAt = 0;
				await transcribeHandler(audioBlob);

				confirmed = false;
				loading = false;
			}
		} else {
			audioChunks = [];
			mediaRecorder = false;

			if (audioStream) {
				const tracks = audioStream.getTracks();
				tracks.forEach((track) => track.stop());
			}
			audioStream = null;
		}
	};

	const startRecording = async () => {
		if ($showCallOverlay) {
			if (!audioStream) {
				audioStream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true
					}
				});
			}

			if (audioStream) {
				// hardware track muting disabled to prevent backend translation errors with malformed WebM files
			}

			mediaRecorder = new MediaRecorder(audioStream);

			mediaRecorder.onstart = () => {
				console.log('Recording started');
				audioChunks = [];
			};

			mediaRecorder.ondataavailable = (event) => {
				if (hasStartedSpeaking) {
					audioChunks.push(event.data);
				}
			};

			mediaRecorder.onstop = (e) => {
				console.log('Recording stopped', audioStream, e);
				stopRecordingCallback();
			};

			analyseAudio(audioStream);
		}
	};

	const stopAudioStream = async () => {
		try {
			if (mediaRecorder) {
				mediaRecorder.stop();
			}
		} catch (error) {
			console.log('Error stopping audio stream:', error);
		}

		if (!audioStream) return;

		audioStream.getAudioTracks().forEach(function (track) {
			track.stop();
		});

		audioStream = null;
	};

	// Function to calculate the RMS level from time domain data
	const calculateRMS = (data: Uint8Array) => {
		let sumSquares = 0;
		for (let i = 0; i < data.length; i++) {
			const normalizedValue = (data[i] - 128) / 128; // Normalize the data
			sumSquares += normalizedValue * normalizedValue;
		}
		return Math.sqrt(sumSquares / data.length);
	};

	const analyseAudio = (stream) => {
		const audioContext = new AudioContext();
		const audioStreamSource = audioContext.createMediaStreamSource(stream);

		const analyser = audioContext.createAnalyser();
		analyser.minDecibels = MIN_DECIBELS;
		audioStreamSource.connect(analyser);

		const bufferLength = analyser.frequencyBinCount;

		const domainData = new Uint8Array(bufferLength);
		const timeDomainData = new Uint8Array(analyser.fftSize);

		let lastSoundTime = Date.now();
		hasStartedSpeaking = false;

		console.log('🔊 Sound detection started', lastSoundTime, hasStartedSpeaking);

		const detectSound = () => {
			const processFrame = () => {
				if (!mediaRecorder || !$showCallOverlay) {
					return;
				}

				// Pause listening while thinking; during TTS only if barge-in is off.
				// Barge-in keeps the mic open; RMS only starts capture — STT confirms interrupt.
				if (shouldPauseStt()) {
					analyser.maxDecibels = 0;
					analyser.minDecibels = -1;
					rmsLevel = 0;
					bargeSpeechStartedAt = 0;
					window.requestAnimationFrame(processFrame);
					return;
				}

				analyser.minDecibels = MIN_DECIBELS;
				analyser.maxDecibels = -30;

				analyser.getByteTimeDomainData(timeDomainData);
				analyser.getByteFrequencyData(domainData);

				rmsLevel = calculateRMS(timeDomainData);
				const now = Date.now();
				const barging = bargeInEnabled() && assistantSpeaking;
				const rmsNeed = barging ? getBargeRms() : getSpeakRms();
				const hasSound = rmsLevel >= rmsNeed;

				if (barging) {
					// RMS + hold only starts capturing interrupt audio. TTS keeps playing
					// until STT returns a meaningful transcript (see transcribeHandler).
					if (now < ttsProtectUntil) {
						if (!hasStartedSpeaking) {
							bargeSpeechStartedAt = 0;
						}
					} else if (hasSound) {
						if (!bargeSpeechStartedAt) {
							bargeSpeechStartedAt = now;
						}
						if (now - bargeSpeechStartedAt >= getBargeHoldMs()) {
							if (!hasStartedSpeaking) {
								console.info(
									`[Spockify Call] Barge capture start (rms=${rmsLevel.toFixed(3)} hold=${now - bargeSpeechStartedAt}ms)`
								);
								hasStartedSpeaking = true;
								bargeCaptureActive = true;
								bargeCaptureStartedAt = now;
								if (mediaRecorder && mediaRecorder.state !== 'recording') {
									mediaRecorder.start();
								}
							} else if (mediaRecorder && mediaRecorder.state !== 'recording') {
								mediaRecorder.start();
							}
							lastSoundTime = now;
						}
					} else if (!hasStartedSpeaking) {
						bargeSpeechStartedAt = 0;
					} else if (now - lastSoundTime > getSilenceMs()) {
						const captureMs = bargeCaptureStartedAt ? now - bargeCaptureStartedAt : 0;
						if (captureMs < getBargeMinCaptureMs()) {
							// Too short — cough / click / bleed blip; keep TTS, drop capture.
							console.info(
								`[Spockify Call] Discarding short barge capture (${captureMs}ms < ${getBargeMinCaptureMs()}ms)`
							);
							discardInProgressUtterance();
							window.requestAnimationFrame(processFrame);
							return;
						}
						confirmed = true;
						bargeSpeechStartedAt = 0;
						if (mediaRecorder) {
							console.info('[Spockify Call] Barge EOU → STT confirm (TTS still playing)');
							mediaRecorder.stop();
							return;
						}
					}
					window.requestAnimationFrame(processFrame);
					return;
				}

				if (hasSound) {
					if (!hasStartedSpeaking) {
						console.log('%c%s', 'color: red; font-size: 20px;', '🔊 Speech detected');
						hasStartedSpeaking = true;
						if (mediaRecorder && mediaRecorder.state !== 'recording') {
							mediaRecorder.start();
						}
					} else if (mediaRecorder && mediaRecorder.state !== 'recording') {
						mediaRecorder.start();
					}
					lastSoundTime = now;
				}

				// End-of-utterance silence → STT (duplex default ~650ms).
				if (hasStartedSpeaking) {
					if (now - lastSoundTime > getSilenceMs()) {
						confirmed = true;

						if (mediaRecorder) {
							console.log('%c%s', 'color: red; font-size: 20px;', '🔇 Silence detected');
							mediaRecorder.stop();
							return;
						}
					}
				}

				window.requestAnimationFrame(processFrame);
			};

			window.requestAnimationFrame(processFrame);
		};

		detectSound();
	};

	let finishedMessages = {};
	let currentMessageId = null;
	let currentUtterance = null;

	// Get voice: model-specific > user settings > config default
	const getVoiceId = () => {
		// Check for model-specific TTS voice first
		if (model?.info?.meta?.tts?.voice) {
			return model.info.meta.tts.voice;
		}
		// Fall back to user settings or config default
		if ($settings?.audio?.tts?.defaultVoice === $config.audio.tts.voice) {
			return $settings?.audio?.tts?.voice ?? $config?.audio?.tts?.voice;
		}
		return $config?.audio?.tts?.voice;
	};

	const getEdgeVoiceByLang = () => $settings?.audio?.tts?.edgeVoiceByLang ?? {};

	const persistEdgeVoiceByLang = async (langBase: string, voiceId: string) => {
		const next = { ...getEdgeVoiceByLang() };
		if (!voiceId) {
			delete next[langBase];
		} else {
			next[langBase] = voiceId;
		}
		const nextSettings = {
			...$settings,
			audio: {
				...($settings?.audio ?? {}),
				tts: {
					...($settings?.audio?.tts ?? {}),
					edgeVoiceByLang: next
				}
			}
		};
		await settings.set(nextSettings);
		await updateUserSettings(localStorage.token, { ui: nextSettings });
		try {
			localStorage.setItem('spockifyEdgeVoiceByLang', JSON.stringify(next));
		} catch {
			/* ignore quota / private mode */
		}
	};

	$: callSvVoice = $settings?.audio?.tts?.edgeVoiceByLang?.sv ?? '';
	$: callEnVoice = $settings?.audio?.tts?.edgeVoiceByLang?.en ?? '';

	const speakSpeechSynthesisHandler = (content) => {
		if (!$showCallOverlay) {
			return Promise.resolve();
		}
		return new Promise((resolve) => {
			(async () => {
				const speechLang = noteSpeechLanguage(content);
				const voiceId = getVoiceId();
				const edgeByLang = getEdgeVoiceByLang();
				rememberTtsText(content);
				try {
					const edgeVoice = resolveEdgeVoice(speechLang, edgeByLang, voiceId);
					logSpeechVoiceChoice(speechLang, undefined, edgeVoice);
					const res = await synthesizeOpenAISpeech(
						localStorage.token,
						edgeVoice,
						content,
						undefined,
						getTtsSpeechOptions(true)
					);
					if (!res) {
						resolve(null);
						return;
					}
					if (res.headers.get('X-Spockify-TTS-Stream') === '1' || res.body) {
						await playStreamingSpeechResponse(res);
					} else {
						const blob = await res.blob();
						const blobUrl = URL.createObjectURL(blob);
						await playAudio(new Audio(blobUrl));
					}
					resolve(null);
				} catch (error) {
					console.error('edge-tts speak failed:', error);
					resolve(null);
				}
			})();
		});
	};

	const playAudio = (audio) => {
		if ($showCallOverlay) {
			return new Promise((resolve) => {
				pendingTtsResolve = resolve;
				// Protect before play() so early RMS spikes cannot start capture.
				armTtsProtect();
				const audioElement = document.getElementById('audioElement') as HTMLAudioElement;

				if (audioElement) {
					audioElement.src = audio.src;
					audioElement.muted = true;
					audioElement.playbackRate = $settings.audio?.tts?.playbackRate ?? 1;
					startTtsWave(audioElement);

					audioElement
						.play()
						.then(() => {
							audioElement.muted = false;
							// Re-arm from actual audible start (MSE first buffer can lag).
							armTtsProtect();
						})
						.catch((error) => {
							console.error(error);
							stopTtsWave();
							if (pendingTtsResolve === resolve) {
								pendingTtsResolve = null;
								resolve(null);
							}
						});

					audioElement.onended = async (e) => {
						stopTtsWave();
						await new Promise((r) => setTimeout(r, duplexMode ? 30 : 100));
						if (pendingTtsResolve === resolve) {
							pendingTtsResolve = null;
							resolve(e);
						}
					};
				} else {
					pendingTtsResolve = null;
					resolve(null);
				}
			});
		} else {
			return Promise.resolve();
		}
	};

	const stopAllAudio = async () => {
		assistantSpeaking = false;
		interrupted = true;

		if (chatStreaming) {
			stopResponse();
			chatStreaming = false;
		}

		if (currentUtterance) {
			speechSynthesis.cancel();
			currentUtterance = null;
		}
		speechSynthesis.cancel();

		const audioElement = document.getElementById('audioElement');
		if (audioElement) {
			audioElement.onended = null;
			audioElement.muted = true;
			audioElement.pause();
			audioElement.currentTime = 0;
			audioElement.removeAttribute('src');
			audioElement.load();
		}

		if (pendingTtsResolve) {
			const resolve = pendingTtsResolve;
			pendingTtsResolve = null;
			resolve(null);
		}
	};

	/** Stop TTS (browser + edge-tts), drop queued sentences, resume listening cleanly. */
	const stopSpeaking = async () => {
		if (currentMessageId && messages[currentMessageId]) {
			messages[currentMessageId] = [];
		}
		if (currentMessageId) {
			finishedMessages[currentMessageId] = true;
		}
		if (audioAbortController) {
			audioAbortController.abort();
			audioAbortController = new AbortController();
		}
		await stopAllAudio();
		awaitingAssistant = false;
		beginListenCooldown(400);
		console.info('[Spockify Call] Stop speaking — TTS cleared, listening resumes');
	};

	let audioAbortController = new AbortController();

	// Audio cache: HTMLAudioElement when ready, 'loading' while prefetching, 'spoken' after stream-play.
	const audioCache = new Map();
	const emojiCache = new Map();

	const isPlayableAudio = (v: unknown): v is HTMLAudioElement =>
		!!v && typeof v === 'object' && typeof (v as HTMLAudioElement).play === 'function';

	const sentenceGapMs = () => (duplexMode ? 50 : 200);

	const fetchAudio = async (content) => {
		if (audioCache.has(content)) {
			return audioCache.get(content);
		}
		audioCache.set(content, 'loading');
		try {
			// Set the emoji for the content if needed
			if ($settings?.showEmojiInCall ?? false) {
				const emoji = await generateEmoji(localStorage.token, modelId, content, chatId);
				if (emoji) {
					emojiCache.set(content, emoji);
				}
			}

			if ($settings.audio?.tts?.engine === 'browser-kokoro') {
				const url = await $TTSWorker
					.generate({
						text: content,
						voice: getVoiceId()
					})
					.catch((error) => {
						console.error(error);
						toast.error(`${error}`);
					});

				if (url && audioCache.get(content) === 'loading') {
					audioCache.set(content, new Audio(url));
				}
			} else if (isServerEdgeTtsEngine($config.audio.tts.engine)) {
				// Prefetch full MP3 for *upcoming* sentences while current plays.
				// Head-of-queue uses stream speak instead (see monitorAndPlayAudio).
				const speechLang = noteSpeechLanguage(content);
				const voiceId = getVoiceId();
				const edgeByLang = getEdgeVoiceByLang();
				const edgeVoice = resolveEdgeVoice(speechLang, edgeByLang, voiceId);
				console.info(
					`[Spockify TTS] prefetch lang=${speechLang} edge-tts voice=${edgeVoice}`
				);
				const res = await synthesizeOpenAISpeech(
					localStorage.token,
					edgeVoice,
					content,
					undefined,
					getTtsSpeechOptions(false)
				).catch((error) => {
					console.error(error);
					return null;
				});
				if (res && audioCache.get(content) === 'loading') {
					const blob = await res.blob();
					const blobUrl = URL.createObjectURL(blob);
					audioCache.set(content, new Audio(blobUrl));
				} else if (!res && audioCache.get(content) === 'loading') {
					audioCache.delete(content);
				}
			} else {
				const res = await synthesizeOpenAISpeech(localStorage.token, getVoiceId(), content).catch(
					(error) => {
						console.error(error);
						return null;
					}
				);

				if (res && audioCache.get(content) === 'loading') {
					const blob = await res.blob();
					const blobUrl = URL.createObjectURL(blob);
					audioCache.set(content, new Audio(blobUrl));
				} else if (!res && audioCache.get(content) === 'loading') {
					audioCache.delete(content);
				}
			}
		} catch (error) {
			console.error('Error synthesizing speech:', error);
			if (audioCache.get(content) === 'loading') {
				audioCache.delete(content);
			}
		}

		return audioCache.get(content);
	};

	let messages = {};

	const monitorAndPlayAudio = async (id, signal) => {
		while (!signal.aborted) {
			if (messages[id] && messages[id].length > 0) {
				// Retrieve the next content string from the queue
				const content = messages[id].shift(); // Dequeues the content for playing

				// Prefetch the *next* sentence while we speak this one.
				const upcoming = messages[id]?.[0];
				if (upcoming && !audioCache.has(upcoming)) {
					void fetchAudio(upcoming);
				}

				// Set the emoji for the content if available
				if (($settings?.showEmojiInCall ?? false) && emojiCache.has(content)) {
					emoji = emojiCache.get(content);
				} else {
					emoji = null;
				}

				const cached = audioCache.get(content);
				rememberTtsText(content);

				try {
					console.log(
						'%c%s',
						'color: red; font-size: 20px;',
						`Playing audio for content: ${content}`
					);

					if (isPlayableAudio(cached)) {
						await playAudio(cached);
					} else if (isServerEdgeTtsEngine($config.audio.tts.engine)) {
						// Not ready yet (or still prefetching): stream first audio bytes immediately.
						// Avoids waiting for a full non-streaming /speech download before playback.
						audioCache.set(content, 'spoken');
						await speakSpeechSynthesisHandler(content);
					} else if ($settings.audio?.tts?.engine === 'browser-kokoro') {
						// Wait briefly for kokoro prefetch, else generate+play.
						if (cached === 'loading') {
							for (let i = 0; i < 50 && audioCache.get(content) === 'loading'; i++) {
								await new Promise((r) => setTimeout(r, 40));
								if (signal.aborted) break;
							}
						}
						const ready = audioCache.get(content);
						if (isPlayableAudio(ready)) {
							await playAudio(ready);
						} else {
							await speakSpeechSynthesisHandler(content);
						}
					} else {
						await speakSpeechSynthesisHandler(content);
					}

					if (signal.aborted) break;
					console.log(`Played audio for content: ${content}`);
					await new Promise((resolve) => setTimeout(resolve, sentenceGapMs()));
				} catch (error) {
					console.error('Error playing audio:', error);
				}
			} else if (finishedMessages[id] && messages[id] && messages[id].length === 0) {
				// If the message is finished and there are no more messages to process, break the loop
				assistantSpeaking = false;
				beginListenCooldown();
				break;
			} else {
				// No messages to process, sleep for a bit
				await new Promise((resolve) => setTimeout(resolve, duplexMode ? 40 : 200));
			}
		}
		console.log(`Audio monitoring and playing stopped for message ID ${id}`);
	};

	const chatStartHandler = async (e) => {
		const { id } = e.detail;

		chatStreaming = true;
		awaitingAssistant = false;
		discardInProgressUtterance();
		armTtsProtect();

		if (currentMessageId !== id) {
			console.log(`Received chat start event for message ID ${id}`);

			currentMessageId = id;
			if (audioAbortController) {
				audioAbortController.abort();
			}
			audioAbortController = new AbortController();

			assistantSpeaking = true;
			// Start monitoring and playing audio for the message ID
			monitorAndPlayAudio(id, audioAbortController.signal);
		}
	};

	const chatEventHandler = async (e) => {
		const { id, content } = e.detail;
		// "id" here is message id
		// if "id" is not the same as "currentMessageId" then do not process
		// "content" here is a speakable unit from the streaming LLM → TTS pipeline

		if (currentMessageId === id) {
			console.log(`Received chat event for message ID ${id}: ${content}`);

			try {
				if (messages[id] === undefined) {
					messages[id] = [content];
				} else {
					messages[id].push(content);
				}

				// Prefetch only units *behind* the head. Head-of-queue streams via
				// speakSpeechSynthesisHandler so we don't race a full /speech download.
				if ((messages[id]?.length ?? 0) > 1 && !audioCache.has(content)) {
					void fetchAudio(content);
				}
			} catch (error) {
				console.error('Failed to fetch or play audio:', error);
			}
		}
	};

	const chatFinishHandler = async (e) => {
		const { id, content } = e.detail;
		// "content" here is the entire message from the assistant
		finishedMessages[id] = true;

		chatStreaming = false;
	};

	const toggleMute = () => {
		muted = !muted;
		if (muted && hasStartedSpeaking) {
			// Abort the ongoing recording so it doesn't accidentally send a partial sentence
			discardInProgressUtterance();
		}
	};

	const persistPushToTalk = async (enabled: boolean) => {
		pushToTalk = enabled;
		pttHeld = false;
		if (!enabled) {
			// Leaving PTT: discard any partial hold utterance.
			discardInProgressUtterance();
		}
		const nextSettings = {
			...$settings,
			audio: {
				...($settings?.audio ?? {}),
				stt: {
					...($settings?.audio?.stt ?? {}),
					pushToTalk: enabled
				}
			}
		};
		await settings.set(nextSettings);
		await updateUserSettings(localStorage.token, { ui: nextSettings });
		try {
			localStorage.setItem('spockifyPushToTalk', enabled ? '1' : '0');
		} catch {
			/* ignore */
		}
	};

	const normalizeWakePhrase = (s: string) =>
		(s || '')
			.toLowerCase()
			.replace(/[^a-z0-9\s]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim();

	const stopWakeWord = () => {
		wakeWordListening = false;
		try {
			wakeWordRecognition?.stop?.();
		} catch {
			/* ignore */
		}
		wakeWordRecognition = null;
	};

	const onWakeWordHeard = () => {
		wakeWordStatus = 'Heard — listening';
		if (muted) {
			muted = false;
		}
		if (pushToTalk) {
			pttHeld = true;
			setTimeout(() => {
				pttHeld = false;
			}, 8000);
		}
		toast.success($i18n.t('Wake word heard'));
	};

	const startWakeWord = () => {
		const SR =
			(typeof window !== 'undefined' &&
				((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
			null;
		wakeWordSupported = Boolean(SR);
		if (!SR) {
			wakeWordStatus = 'Web Speech unavailable in this browser';
			toast.error($i18n.t('Wake word needs Web Speech (Chrome/Edge)'));
			wakeWordEnabled = false;
			return;
		}
		stopWakeWord();
		const rec = new SR();
		rec.continuous = true;
		rec.interimResults = true;
		rec.lang = languageLock || 'en-US';
		const phrase = normalizeWakePhrase(wakeWordPhrase || 'hey spockify');
		rec.onresult = (event: any) => {
			let transcript = '';
			for (let i = event.resultIndex; i < event.results.length; i++) {
				transcript += event.results[i][0]?.transcript || '';
			}
			const norm = normalizeWakePhrase(transcript);
			if (norm.includes(phrase)) {
				onWakeWordHeard();
			}
		};
		rec.onerror = (e: any) => {
			wakeWordStatus = e?.error || 'wake word error';
			if (e?.error === 'not-allowed') {
				wakeWordEnabled = false;
				stopWakeWord();
			}
		};
		rec.onend = () => {
			if (wakeWordEnabled && wakeWordListening) {
				try {
					rec.start();
				} catch {
					/* ignore */
				}
			}
		};
		wakeWordRecognition = rec;
		wakeWordListening = true;
		wakeWordStatus = `Listening for “${wakeWordPhrase}”`;
		try {
			rec.start();
		} catch (e) {
			wakeWordStatus = `${e}`;
			wakeWordEnabled = false;
		}
	};

	const persistWakeWord = (enabled: boolean) => {
		wakeWordEnabled = enabled;
		try {
			localStorage.setItem('spockifyWakeWord', enabled ? '1' : '0');
			localStorage.setItem('spockifyWakeWordPhrase', wakeWordPhrase || 'hey spockify');
		} catch {
			/* ignore */
		}
		if (enabled) startWakeWord();
		else {
			stopWakeWord();
			wakeWordStatus = '';
		}
	};

	const onPttPointerDown = (e: PointerEvent) => {
		if (!pushToTalk || muted) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
		pttHeld = true;
	};

	const onPttPointerUp = (e: PointerEvent) => {
		if (!pushToTalk) return;
		e.preventDefault();
		pttHeld = false;
		if (hasStartedSpeaking && mediaRecorder && mediaRecorder.state === 'recording') {
			confirmed = true;
			try {
				mediaRecorder.stop();
			} catch {
				/* ignore */
			}
		} else {
			discardInProgressUtterance();
		}
	};

	let wasAssistantSpeaking = false;
	$: {
		if (assistantSpeaking && !wasAssistantSpeaking) {
			wasAssistantSpeaking = true;
			discardInProgressUtterance();
			// Don't keep PTT latched across assistant speech.
			pttHeld = false;
		} else if (!assistantSpeaking && wasAssistantSpeaking) {
			wasAssistantSpeaking = false;
			// Drop barge capture that never reached EOU while TTS played — usually
			// speaker bleed recorded for the whole reply, which would STT→kill the next turn.
			if (bargeCaptureActive || hasStartedSpeaking) {
				console.info('[Spockify Call] TTS ended — discarding unfinished barge capture');
				discardInProgressUtterance();
			}
			beginListenCooldown();
			// Auto unmute when AI finishes speaking (always-listen convenience).
			if (muted && !pushToTalk) {
				muted = false;
			}
		}
	}

	const handleKeydown = (e: KeyboardEvent) => {
		// Only handle M key when not typing in an input/textarea
		if (e.key === 'm' || e.key === 'M') {
			const target = e.target as HTMLElement;
			if (
				target.tagName !== 'INPUT' &&
				target.tagName !== 'TEXTAREA' &&
				!target.isContentEditable
			) {
				e.preventDefault();
				toggleMute();
			}
		}
	};

	onMount(async () => {
		// Voice world (W10.9): surface "when I'm back" notes on Call open / visibility.
		const onVis = async () => {
			if (document.visibilityState !== 'visible') return;
			try {
				const uid = $user?.id;
				if (!uid) return;
				const res = await voiceWorldReturn(localStorage.token, {
					user_id: uid,
					reason: 'call'
				});
				const due = res?.due || [];
				if (due.length) {
					toast.message(
						due.map((n: any) => n.text).join(' · ').slice(0, 200)
					);
				}
			} catch {
				/* ignore */
			}
		};
		document.addEventListener('visibilitychange', onVis);
		onVis();

		// Hydrate neural voice prefs from localStorage when user settings lack them.
		try {
			const raw = localStorage.getItem('spockifyEdgeVoiceByLang');
			if (raw && !$settings?.audio?.tts?.edgeVoiceByLang) {
				const parsed = JSON.parse(raw);
				if (parsed && typeof parsed === 'object') {
					const nextSettings = {
						...$settings,
						audio: {
							...($settings?.audio ?? {}),
							tts: {
								...($settings?.audio?.tts ?? {}),
								edgeVoiceByLang: parsed
							}
						}
					};
					await settings.set(nextSettings);
				}
			}
		} catch {
			/* ignore */
		}

		// Push-to-talk: settings first, else localStorage.
		try {
			const fromSettings = $settings?.audio?.stt?.pushToTalk;
			if (typeof fromSettings === 'boolean') {
				pushToTalk = fromSettings;
			} else {
				const rawPtt = localStorage.getItem('spockifyPushToTalk');
				if (rawPtt === '1') pushToTalk = true;
				if (rawPtt === '0') pushToTalk = false;
			}
			const rawWake = localStorage.getItem('spockifyWakeWord');
			const rawPhrase = localStorage.getItem('spockifyWakeWordPhrase');
			if (rawPhrase) wakeWordPhrase = rawPhrase;
			if (rawWake === '1') {
				wakeWordEnabled = true;
			}
			const rawDuplex = localStorage.getItem('spockifyDuplexCall');
			if (rawDuplex === '0') duplexMode = false;
			else if (rawDuplex === '1') duplexMode = true;
			const rawSpatial = localStorage.getItem('spockifySpatialPresence');
			if (rawSpatial === '0') spatialPresence = false;
			else if (rawSpatial === '1') spatialPresence = true;
			const rawLang = localStorage.getItem('spockifyLanguageLock');
			if (rawLang) persistLanguageLock(rawLang);
			const rawStyle = localStorage.getItem('spockifyTtsStyle');
			if (rawStyle === 'calm' || rawStyle === 'excited' || rawStyle === 'default') {
				ttsStyle = rawStyle;
			} else if (
				$settings?.spockifyTtsStyle === 'calm' ||
				$settings?.spockifyTtsStyle === 'excited' ||
				$settings?.spockifyTtsStyle === 'default'
			) {
				ttsStyle = $settings.spockifyTtsStyle;
			}
		} catch {
			/* ignore */
		}

		const setWakeLock = async () => {
			try {
				wakeLock = await navigator.wakeLock.request('screen');
			} catch (err) {
				// The Wake Lock request has failed - usually system related, such as battery.
				console.log(err);
			}

			if (wakeLock) {
				// Add a listener to release the wake lock when the page is unloaded
				wakeLock.addEventListener('release', () => {
					// the wake lock has been released
					console.log('Wake Lock released');
				});
			}
		};

		if ('wakeLock' in navigator) {
			await setWakeLock();

			document.addEventListener('visibilitychange', async () => {
				// Re-request the wake lock if the document becomes visible
				if (wakeLock !== null && document.visibilityState === 'visible') {
					await setWakeLock();
				}
			});
		}

		model = $models.find((m) => m.id === modelId);

		startRecording();
		if (wakeWordEnabled) {
			startWakeWord();
		}

		eventTarget.addEventListener('chat:start', chatStartHandler);
		eventTarget.addEventListener('chat', chatEventHandler);
		eventTarget.addEventListener('chat:finish', chatFinishHandler);

		document.addEventListener('keydown', handleKeydown);

		return async () => {
			stopWakeWord();
			await stopAllAudio();

			stopAudioStream();

			eventTarget.removeEventListener('chat:start', chatStartHandler);
			eventTarget.removeEventListener('chat', chatEventHandler);
			eventTarget.removeEventListener('chat:finish', chatFinishHandler);

			document.removeEventListener('keydown', handleKeydown);

			audioAbortController.abort();
			await tick();

			await stopAllAudio();

			await stopRecordingCallback(false);
			await stopCamera();
		};
	});

	onDestroy(async () => {
		stopWakeWord();
		await stopAllAudio();
		await stopRecordingCallback(false);
		await stopCamera();

		await stopAudioStream();
		eventTarget.removeEventListener('chat:start', chatStartHandler);
		eventTarget.removeEventListener('chat', chatEventHandler);
		eventTarget.removeEventListener('chat:finish', chatFinishHandler);

		document.removeEventListener('keydown', handleKeydown);

		audioAbortController.abort();

		await tick();

		await stopAllAudio();
	});
</script>

{#if $showCallOverlay}
	<div class="max-w-lg w-full h-full max-h-[100dvh] flex flex-col justify-between p-3 md:p-6">
		{#if camera}
			<div class="flex justify-center items-center w-full h-20 min-h-20">
				{#if emoji}
					<div
						class="  transition-all rounded-full"
						style="font-size:{rmsLevel * 100 > 4
							? '4.5'
							: rmsLevel * 100 > 2
								? '4.25'
								: rmsLevel * 100 > 1
									? '3.75'
									: '3.5'}rem;width: 100%; text-align:center;"
					>
						{emoji}
					</div>
				{:else if loading || assistantSpeaking}
					<svg
						class="size-12 text-gray-900 dark:text-gray-400"
						viewBox="0 0 24 24"
						fill="currentColor"
						xmlns="http://www.w3.org/2000/svg"
						><style>
							.spinner_qM83 {
								animation: spinner_8HQG 1.05s infinite;
							}
							.spinner_oXPr {
								animation-delay: 0.1s;
							}
							.spinner_ZTLf {
								animation-delay: 0.2s;
							}
							@keyframes spinner_8HQG {
								0%,
								57.14% {
									animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
									transform: translate(0);
								}
								28.57% {
									animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
									transform: translateY(-6px);
								}
								100% {
									transform: translate(0);
								}
							}
						</style><circle class="spinner_qM83" cx="4" cy="12" r="3" /><circle
							class="spinner_qM83 spinner_oXPr"
							cx="12"
							cy="12"
							r="3"
						/><circle class="spinner_qM83 spinner_ZTLf" cx="20" cy="12" r="3" /></svg
					>
				{:else}
					<div
						class=" {rmsLevel * 100 > 4
							? ' size-[4.5rem]'
							: rmsLevel * 100 > 2
								? ' size-16'
								: rmsLevel * 100 > 1
									? 'size-14'
									: 'size-12'}  transition-all rounded-full bg-cover bg-center bg-no-repeat"
						style={`background-image: url('${WEBUI_API_BASE_URL}/models/model/profile/image?id=${model?.id}&lang=${$i18n.language}&voice=true');`}
					/>
				{/if}
			</div>
		{/if}

		<div class="flex justify-center items-center flex-1 h-full w-full max-h-full">
			{#if !camera}
				<div class="flex justify-center items-center" aria-live="polite">
					{#if emoji}
						<div
							class="  transition-all rounded-full"
							style="font-size:{rmsLevel * 100 > 4
								? '13'
								: rmsLevel * 100 > 2
									? '12'
									: rmsLevel * 100 > 1
										? '11.5'
										: '11'}rem;width:100%;text-align:center;"
						>
							{emoji}
						</div>
					{:else if loading || assistantSpeaking}
						{#if assistantSpeaking && spatialPresence}
							<div
								class="relative flex flex-col items-center justify-center h-44 w-56 mx-auto"
								aria-label={$i18n.t('Speaking')}
							>
								<!-- Spatial Call MVP: canvas/CSS avatar + lip-sync from TTS levels -->
								<svg viewBox="0 0 120 120" class="w-40 h-40">
									<circle
										cx="60"
										cy="60"
										r="52"
										class="fill-amber-100 dark:fill-amber-900/40 stroke-amber-700/40"
										stroke-width="2"
									/>
									<circle
										cx="42"
										cy="48"
										r="5"
										class={emoji ? 'fill-rose-500' : 'fill-gray-800 dark:fill-gray-200'}
									/>
									<circle
										cx="78"
										cy="48"
										r="5"
										class={emoji ? 'fill-rose-500' : 'fill-gray-800 dark:fill-gray-200'}
									/>
									<ellipse
										cx="60"
										cy="78"
										rx={10 + mouthOpen * 18}
										ry={3 + mouthOpen * 14}
										class="fill-gray-900 dark:fill-gray-100"
									/>
									{#if emoji}
										<text x="60" y="28" text-anchor="middle" font-size="16">{emoji}</text>
									{/if}
								</svg>
								<div class="flex items-end justify-center gap-0.5 h-8 w-40 mt-1">
									{#each ttsWaveLevels.slice(0, 12) as level, i (i)}
										<div
											class="w-1 rounded-full bg-amber-700/70 dark:bg-amber-300/70"
											style={`height: ${Math.round(level * 100)}%`}
										></div>
									{/each}
								</div>
							</div>
						{:else if assistantSpeaking}
							<div
								class="flex items-end justify-center gap-1 h-40 w-56 mx-auto"
								aria-label={$i18n.t('Speaking')}
							>
								{#each ttsWaveLevels as level, i (i)}
									<div
										class="w-1.5 rounded-full bg-gray-800 dark:bg-gray-200 transition-[height] duration-75"
										style={`height: ${Math.round(level * 100)}%`}
									></div>
								{/each}
							</div>
						{:else}
						<svg
							class="size-44 text-gray-900 dark:text-gray-400"
							viewBox="0 0 24 24"
							fill="currentColor"
							xmlns="http://www.w3.org/2000/svg"
							><style>
								.spinner_qM83 {
									animation: spinner_8HQG 1.05s infinite;
								}
								.spinner_oXPr {
									animation-delay: 0.1s;
								}
								.spinner_ZTLf {
									animation-delay: 0.2s;
								}
								@keyframes spinner_8HQG {
									0%,
									57.14% {
										animation-timing-function: cubic-bezier(0.33, 0.66, 0.66, 1);
										transform: translate(0);
									}
									28.57% {
										animation-timing-function: cubic-bezier(0.33, 0, 0.66, 0.33);
										transform: translateY(-6px);
									}
									100% {
										transform: translate(0);
									}
								}
							</style><circle class="spinner_qM83" cx="4" cy="12" r="3" /><circle
								class="spinner_qM83 spinner_oXPr"
								cx="12"
								cy="12"
								r="3"
							/><circle class="spinner_qM83 spinner_ZTLf" cx="20" cy="12" r="3" /></svg
						>
						{/if}
					{:else}
						<div
							class=" {rmsLevel * 100 > 4
								? ' size-52'
								: rmsLevel * 100 > 2
									? 'size-48'
									: rmsLevel * 100 > 1
										? 'size-44'
										: 'size-40'} transition-all rounded-full bg-cover bg-center bg-no-repeat"
							style={`background-image: url('${WEBUI_API_BASE_URL}/models/model/profile/image?id=${model?.id}&lang=${$i18n.language}&voice=true');`}
						/>
					{/if}
				</div>
			{:else}
				<div class="relative flex video-container w-full max-h-full pt-2 pb-4 md:py-6 px-2 h-full">
					<!-- svelte-ignore a11y-media-has-caption -->
					<video
						id="camera-feed"
						autoplay
						class="rounded-2xl h-full min-w-full object-cover object-center"
						playsinline
					/>

					<canvas id="camera-canvas" style="display:none;" />

					{#if screenAgentStatus}
						<div
							class="absolute bottom-6 left-4 right-4 text-[11px] text-white/90 bg-black/50 rounded px-2 py-1 backdrop-blur"
						>
							{screenAgentStatus}
						</div>
					{/if}

					<div class=" absolute top-4 md:top-8 left-4">
						<button
							type="button"
							class="p-1.5 text-white cursor-pointer backdrop-blur-xl bg-black/10 rounded-full"
							on:click={() => {
								stopCamera();
							}}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 16 16"
								fill="currentColor"
								class="size-6"
							>
								<path
									d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z"
								/>
							</svg>
						</button>
					</div>
				</div>
			{/if}
		</div>

		<div class="flex flex-col items-center gap-3 pb-[max(1rem,env(safe-area-inset-bottom))] w-full">
			{#if assistantSpeaking || (loading && !pushToTalk)}
				<button
					type="button"
					class="z-10 w-full max-w-sm min-h-14 px-6 py-4 rounded-2xl text-base font-semibold tracking-wide bg-red-500 text-white shadow-lg active:scale-[0.98] hover:bg-red-600 transition-transform"
					aria-label={$i18n.t('Stop speaking')}
					on:click={() => stopSpeaking()}
				>
					{$i18n.t('Stop speaking')}
				</button>
			{:else if pushToTalk && !muted}
				<p class="z-10 text-sm font-medium text-gray-600 dark:text-gray-300">
					{pttHeld ? $i18n.t('Listening...') : $i18n.t('Hold mic to talk')}
				</p>
			{:else if muted}
				<p class="z-10 text-sm font-medium text-red-600 dark:text-red-400">{$i18n.t('Muted')}</p>
			{/if}

			<details class="z-10 w-full max-w-sm group">
				<summary
					class="cursor-pointer list-none text-center text-xs text-gray-500 dark:text-gray-400 py-1 select-none [&::-webkit-details-marker]:hidden"
				>
					<span class="underline-offset-2 group-open:underline">{$i18n.t('Call options')}</span>
				</summary>
				<div class="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
					{#if languageLockLabel}
						<button
							type="button"
							class="rounded-md px-2.5 py-1 border bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200"
							aria-label={$i18n.t('Language lock')}
							title={$i18n.t('Locked to {{lang}} — click to clear', {
								lang: languageLock || languageLockLabel
							})}
							on:click={() => persistLanguageLock(null)}
						>
							{$i18n.t('Lang')}: {languageLockLabel}
						</button>
					{/if}
					<button
						type="button"
						class="rounded-md px-2.5 py-1 border transition-colors {pushToTalk
							? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
							: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}"
						aria-pressed={pushToTalk}
						aria-label={$i18n.t('Push to talk')}
						on:click={() => persistPushToTalk(!pushToTalk)}
					>
						{pushToTalk ? $i18n.t('Hold to talk') : $i18n.t('Always listen')}
					</button>
					<button
						type="button"
						class="rounded-md px-2.5 py-1 border transition-colors {wakeWordEnabled
							? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
							: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}"
						aria-pressed={wakeWordEnabled}
						aria-label={$i18n.t('Wake word')}
						title={wakeWordStatus ||
							'Optional: say “hey Spockify” (Web Speech; Chrome/Edge best). Needs mic permission; stops when tab is hidden.'}
						on:click={() => persistWakeWord(!wakeWordEnabled)}
					>
						{wakeWordEnabled ? $i18n.t('Wake on') : $i18n.t('Wake word')}
					</button>
					{#if wakeWordEnabled}
						<input
							class="rounded-md px-2 py-1 border bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 max-w-[9rem]"
							aria-label="Wake phrase"
							bind:value={wakeWordPhrase}
							on:change={() => persistWakeWord(true)}
						/>
					{/if}
					{#each (['default', 'calm', 'excited'] as const) as styleOpt}
						<button
							type="button"
							class="rounded-md px-2.5 py-1 border transition-colors {ttsStyle === styleOpt
								? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
								: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}"
							aria-pressed={ttsStyle === styleOpt}
							aria-label={`TTS ${styleOpt}`}
							on:click={() => persistTtsStyle(styleOpt)}
						>
							{styleOpt === 'default'
								? $i18n.t('Voice')
								: styleOpt === 'calm'
									? $i18n.t('Calm')
									: $i18n.t('Excited')}
						</button>
					{/each}
					<button
						type="button"
						class="rounded-md px-2.5 py-1 border transition-colors {duplexMode
							? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-100 dark:text-gray-900'
							: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700'}"
						aria-pressed={duplexMode}
						title={$i18n.t('Speak to interrupt TTS (duplex)')}
						on:click={() => {
							duplexMode = !duplexMode;
							try {
								localStorage.setItem('spockifyDuplexCall', duplexMode ? '1' : '0');
							} catch {
								/* ignore */
							}
						}}
					>
						{duplexMode ? $i18n.t('Duplex on') : $i18n.t('Duplex')}
					</button>
					<button
						type="button"
						class="rounded-md px-2.5 py-1 border transition-colors {spatialPresence
							? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-100 dark:text-gray-900'
							: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700'}"
						aria-pressed={spatialPresence}
						title={$i18n.t('Show spatial avatar while speaking')}
						on:click={() => persistSpatialPresence(!spatialPresence)}
					>
						{$i18n.t('Spatial')}
					</button>
				</div>

				{#if isServerEdgeTtsEngine($config?.audio?.tts?.engine)}
					<div
						class="mt-2 flex flex-wrap items-center justify-center gap-2 text-xs text-gray-600 dark:text-gray-300"
					>
						<label class="flex items-center gap-1.5">
							<span class="opacity-80">SV</span>
							<select
								class="rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2 py-1 outline-hidden max-w-[10rem]"
								aria-label="Swedish voice"
								value={callSvVoice}
								on:change={(e) => persistEdgeVoiceByLang('sv', e.currentTarget.value)}
							>
								<option value="">Auto</option>
								{#each EDGE_TTS_VOICE_OPTIONS.filter((v) => v.langBase === 'sv') as opt}
									<option value={opt.id}>{opt.label}</option>
								{/each}
							</select>
						</label>
						<label class="flex items-center gap-1.5">
							<span class="opacity-80">EN</span>
							<select
								class="rounded-md bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2 py-1 outline-hidden max-w-[10rem]"
								aria-label="English voice"
								value={callEnVoice}
								on:change={(e) => persistEdgeVoiceByLang('en', e.currentTarget.value)}
							>
								<option value="">Auto</option>
								{#each EDGE_TTS_VOICE_OPTIONS.filter((v) => v.langBase === 'en') as opt}
									<option value={opt.id}>{opt.label}</option>
								{/each}
							</select>
						</label>
					</div>
				{/if}
			</details>

			{#if partialTranscript && !assistantSpeaking}
				<div class="z-10 text-center text-xs text-gray-500 dark:text-gray-400 px-4 max-w-md mx-auto">
					{$i18n.t('Hearing')}: {partialTranscript}
				</div>
			{/if}

			<div class="flex items-center justify-center gap-5 z-10 pt-1">
				{#if camera}
					<VideoInputMenu
						devices={videoInputDevices}
						on:change={async (e) => {
							console.log(e.detail);
							selectedVideoInputDeviceId = e.detail;
							localStorage.setItem('selectedVideoInputDeviceId', e.detail);
							await stopVideoStream();
							await startVideoStream();
						}}
					>
						<button class="p-3 rounded-full bg-gray-50 dark:bg-gray-900" type="button">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 20 20"
								fill="currentColor"
								class="size-5"
							>
								<path
									fill-rule="evenodd"
									d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z"
									clip-rule="evenodd"
								/>
							</svg>
						</button>
					</VideoInputMenu>
				{:else}
					<Tooltip content={$i18n.t('Camera')}>
						<button
							class="p-3 rounded-full bg-gray-50 dark:bg-gray-900"
							type="button"
							on:click={async () => {
								await navigator.mediaDevices.getUserMedia({ video: true });
								startCamera();
							}}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke="currentColor"
								class="size-5"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
								/>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z"
								/>
							</svg>
						</button>
					</Tooltip>
				{/if}

				{#if pushToTalk}
					<Tooltip content={$i18n.t('Hold to talk')}>
						<button
							class="p-5 rounded-full transition-colors duration-200 select-none touch-none shadow-md {pttHeld
								? 'bg-emerald-500 text-white scale-110'
								: muted
									? 'bg-red-500 text-white'
									: 'bg-gray-100 dark:bg-gray-800'}"
							type="button"
							aria-label={$i18n.t('Hold to talk')}
							disabled={muted || assistantSpeaking || loading || awaitingAssistant}
							on:pointerdown={onPttPointerDown}
							on:pointerup={onPttPointerUp}
							on:pointercancel={onPttPointerUp}
							on:pointerleave={(e) => {
								if (pttHeld) onPttPointerUp(e);
							}}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke="currentColor"
								class="size-7"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
								/>
							</svg>
						</button>
					</Tooltip>
				{:else}
					<Tooltip content={muted ? $i18n.t('Unmute') + ' (M)' : $i18n.t('Mute') + ' (M)'}>
						<button
							class="p-5 rounded-full transition-colors duration-200 shadow-md {muted
								? 'bg-red-500 text-white'
								: 'bg-gray-100 dark:bg-gray-800'}"
							type="button"
							aria-label={muted ? $i18n.t('Unmute') : $i18n.t('Mute')}
							on:click={toggleMute}
						>
							{#if muted}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="1.5"
									stroke="currentColor"
									class="size-7"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
									/>
									<line
										x1="3"
										y1="3"
										x2="21"
										y2="21"
										stroke="currentColor"
										stroke-width="1.5"
										stroke-linecap="round"
									/>
								</svg>
							{:else}
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke-width="1.5"
									stroke="currentColor"
									class="size-7"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
									/>
								</svg>
							{/if}
						</button>
					</Tooltip>
				{/if}

				{#if pushToTalk}
					<Tooltip content={muted ? $i18n.t('Unmute') + ' (M)' : $i18n.t('Mute') + ' (M)'}>
						<button
							class="p-3 rounded-full transition-colors duration-200 {muted
								? 'bg-red-500 text-white'
								: 'bg-gray-50 dark:bg-gray-900'}"
							type="button"
							aria-label={muted ? $i18n.t('Unmute') : $i18n.t('Mute')}
							on:click={toggleMute}
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								stroke-width="1.5"
								stroke="currentColor"
								class="size-5"
							>
								{#if muted}
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
									/>
								{:else}
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z"
									/>
								{/if}
							</svg>
						</button>
					</Tooltip>
				{/if}

				<button
					class="p-5 rounded-full bg-red-500/90 hover:bg-red-600 text-white shadow-md"
					on:click={async () => {
						await stopAudioStream();
						await stopVideoStream();

						console.log(audioStream);
						console.log(cameraStream);

						showCallOverlay.set(false);
						dispatch('close');
					}}
					type="button"
					aria-label={$i18n.t('End call')}
					title={$i18n.t('End call')}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						class="size-7"
					>
						<path
							d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z"
						/>
					</svg>
				</button>
			</div>
		</div>
	</div>
{/if}
