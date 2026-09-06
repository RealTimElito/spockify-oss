<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { createEventDispatcher, onMount, getContext } from 'svelte';

	import { user, settings, config } from '$lib/stores';
	import { getVoices as _getVoices } from '$lib/apis/audio';
	import {
		getVoiceClone,
		uploadVoiceClone,
		updateVoiceClone,
		deleteVoiceClone,
		xttsCheck
	} from '$lib/apis/spockify';
	import { EDGE_TTS_VOICE_OPTIONS, isServerEdgeTtsEngine } from '$lib/utils/detectSpeechLanguage';

	import Switch from '$lib/components/common/Switch.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	const dispatch = createEventDispatcher();

	const i18n = getContext('i18n');

	export let saveSettings: Function;

	// Audio
	let conversationMode = false;
	let speechAutoSend = false;
	let responseAutoPlayback = false;
	let nonLocalVoices = false;

	let STTEngine = '';
	let STTLanguage = '';

	let TTSEngine = '';
	let TTSEngineConfig = {};

	let TTSModel = null;
	let TTSModelProgress = null;
	let TTSModelLoading = false;

	let voices = [];
	let voice = '';
	/** Per-language edge-tts overrides (`sv` / `en` → Neural id, empty = auto). */
	let edgeVoiceByLang: Record<string, string> = {};

	/** W6.3 voice-clone profile (server-stored; wired into Call/read-aloud). */
	let cloneVoiceLabel = '';
	let cloneVoiceSampleName = '';
	let cloneEnabled = false;
	let cloneEdgeVoice = '';
	let cloneUploading = false;

	// Audio speed control
	let playbackRate = 1;

	const NEURAL_LANG_PICKERS = [
		{ base: 'sv', label: 'Swedish' },
		{ base: 'en', label: 'English' },
		{ base: 'de', label: 'German' },
		{ base: 'fr', label: 'French' },
		{ base: 'es', label: 'Spanish' },
		{ base: 'nb', label: 'Norwegian' },
		{ base: 'da', label: 'Danish' }
	];

	const getVoices = async () => {
		if (TTSEngine === 'browser-kokoro') {
			if (!TTSModel) {
				await loadKokoro();
			}

			voices = Object.entries(TTSModel.voices).map(([key, value]) => {
				return {
					id: key,
					name: value.name,
					localService: false
				};
			});
		} else {
			if ($config.audio.tts.engine === '') {
				const getVoicesLoop = setInterval(async () => {
					voices = await speechSynthesis.getVoices();

					// do your loop
					if (voices.length > 0) {
						clearInterval(getVoicesLoop);
					}
				}, 100);
			} else {
				const res = await _getVoices(localStorage.token).catch((e) => {
					toast.error(`${e}`);
				});

				if (res) {
					console.log(res);
					voices = res.voices;
				}
			}
		}
	};

	const toggleResponseAutoPlayback = async () => {
		responseAutoPlayback = !responseAutoPlayback;
		saveSettings({ responseAutoPlayback: responseAutoPlayback });
	};

	const toggleSpeechAutoSend = async () => {
		speechAutoSend = !speechAutoSend;
		saveSettings({ speechAutoSend: speechAutoSend });
	};

	onMount(async () => {
		playbackRate = $settings.audio?.tts?.playbackRate ?? 1;
		conversationMode = $settings.conversationMode ?? false;
		speechAutoSend = $settings.speechAutoSend ?? false;
		responseAutoPlayback = $settings.responseAutoPlayback ?? false;

		STTEngine = $settings?.audio?.stt?.engine ?? '';
		STTLanguage = $settings?.audio?.stt?.language ?? '';

		TTSEngine = $settings?.audio?.tts?.engine ?? '';
		TTSEngineConfig = $settings?.audio?.tts?.engineConfig ?? {};

		if ($settings?.audio?.tts?.defaultVoice === $config.audio.tts.voice) {
			voice = $settings?.audio?.tts?.voice ?? $config.audio.tts.voice ?? '';
		} else {
			voice = $config.audio.tts.voice ?? '';
		}

		edgeVoiceByLang = {
			sv: '',
			en: '',
			de: '',
			fr: '',
			es: '',
			nb: '',
			da: '',
			...($settings?.audio?.tts?.edgeVoiceByLang ?? {})
		};
		try {
			if (!Object.keys(edgeVoiceByLang).length) {
				const raw = localStorage.getItem('spockifyEdgeVoiceByLang');
				if (raw) {
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === 'object') {
						edgeVoiceByLang = { ...parsed };
					}
				}
			}
		} catch {
			/* ignore */
		}

		try {
			const clone = await getVoiceClone(localStorage.token);
			if (clone?.profile) {
				cloneVoiceLabel = clone.profile.label || '';
				cloneVoiceSampleName = clone.profile.sample_name || '';
				cloneEnabled = !!clone.enabled;
				cloneEdgeVoice = clone.profile.edge_voice || '';
			} else {
				cloneVoiceLabel = '';
				cloneVoiceSampleName = '';
				cloneEnabled = false;
				cloneEdgeVoice = '';
			}
		} catch {
			try {
				const rawClone = localStorage.getItem('spockifyVoiceClonePref');
				if (rawClone) {
					const parsed = JSON.parse(rawClone);
					if (parsed && typeof parsed === 'object') {
						cloneVoiceLabel = parsed.label || '';
						cloneVoiceSampleName = parsed.sampleName || '';
					}
				}
			} catch {
				/* ignore */
			}
		}

		nonLocalVoices = $settings.audio?.tts?.nonLocalVoices ?? false;

		await getVoices();
	});

	$: if (TTSEngine && TTSEngineConfig) {
		onTTSEngineChange();
	}

	const onTTSEngineChange = async () => {
		if (TTSEngine === 'browser-kokoro') {
			await loadKokoro();
		}
	};

	const loadKokoro = async () => {
		if (TTSEngine === 'browser-kokoro') {
			voices = [];

			if (TTSEngineConfig?.dtype) {
				TTSModel = null;
				TTSModelProgress = null;
				TTSModelLoading = true;

				const model_id = 'onnx-community/Kokoro-82M-v1.0-ONNX';

				const { KokoroTTS } = await import('kokoro-js');
				TTSModel = await KokoroTTS.from_pretrained(model_id, {
					dtype: TTSEngineConfig.dtype, // Options: "fp32", "fp16", "q8", "q4", "q4f16"
					device: !!navigator?.gpu ? 'webgpu' : 'wasm', // Detect WebGPU
					progress_callback: (e) => {
						TTSModelProgress = e;
						console.log(e);
					}
				});

				await getVoices();

				// const rawAudio = await tts.generate(inputText, {
				// 	// Use `tts.list_voices()` to list all available voices
				// 	voice: voice
				// });

				// const blobUrl = URL.createObjectURL(await rawAudio.toBlob());
				// const audio = new Audio(blobUrl);

				// audio.play();
			}
		}
	};
</script>

<form
	id="tab-audio"
	class="flex flex-col h-full justify-between space-y-3 text-sm"
	on:submit|preventDefault={async () => {
		const cleanedEdge: Record<string, string> = {};
		for (const [k, v] of Object.entries(edgeVoiceByLang)) {
			if (v) {
				cleanedEdge[k] = v;
			}
		}
		try {
			localStorage.setItem('spockifyEdgeVoiceByLang', JSON.stringify(cleanedEdge));
		} catch {
			/* ignore */
		}
		saveSettings({
			audio: {
				stt: {
					engine: STTEngine !== '' ? STTEngine : undefined,
					language: STTLanguage !== '' ? STTLanguage : undefined
				},
				tts: {
					engine: TTSEngine !== '' ? TTSEngine : undefined,
					engineConfig: TTSEngineConfig,
					playbackRate: playbackRate,
					voice: voice !== '' ? voice : undefined,
					defaultVoice: $config?.audio?.tts?.voice ?? '',
					nonLocalVoices: $config.audio.tts.engine === '' ? nonLocalVoices : undefined,
					edgeVoiceByLang: cleanedEdge
				}
			}
		});
		dispatch('save');
	}}
>
	<div class=" space-y-3 overflow-y-scroll max-h-[28rem] md:max-h-full">
		<div>
			<div class=" mb-1 text-sm font-medium">{$i18n.t('STT Settings')}</div>

			{#if $config.audio.stt.engine !== 'web'}
				<div class=" py-0.5 flex w-full justify-between">
					<div class=" self-center text-xs font-medium">{$i18n.t('Speech-to-Text Engine')}</div>
					<div class="flex items-center relative">
						<select
							class="w-fit pr-8 rounded-sm px-2 p-1 text-xs bg-transparent outline-hidden text-right"
							bind:value={STTEngine}
							aria-label={$i18n.t('Speech-to-Text Engine')}
							placeholder={$i18n.t('Select an engine')}
						>
							<option value="">{$i18n.t('Default')}</option>
							<option value="web">{$i18n.t('Web API')}</option>
						</select>
					</div>
				</div>

				<div class=" py-0.5 flex w-full justify-between">
					<div class=" self-center text-xs font-medium">{$i18n.t('Language')}</div>

					<div class="flex items-center relative text-xs px-3">
						<Tooltip
							content={$i18n.t(
								'The language of the input audio. Supplying the input language in ISO-639-1 (e.g. en) format will improve accuracy and latency. Leave blank to automatically detect the language.'
							)}
							placement="top"
						>
							<input
								type="text"
								bind:value={STTLanguage}
								aria-label={$i18n.t('Speech-to-Text Language')}
								placeholder={$i18n.t('e.g. en')}
								class=" text-sm text-right bg-transparent dark:text-gray-300 outline-hidden"
							/>
						</Tooltip>
					</div>
				</div>
			{/if}

			<div class=" py-0.5 flex w-full justify-between">
				<div class=" self-center text-xs font-medium">
					{$i18n.t('Instant Auto-Send After Voice Transcription')}
				</div>

				<button
					class="p-1 px-3 text-xs flex rounded-sm transition"
					on:click={() => {
						toggleSpeechAutoSend();
					}}
					type="button"
					role="switch"
					aria-checked={speechAutoSend}
				>
					{#if speechAutoSend === true}
						<span class="ml-2 self-center">{$i18n.t('On')}</span>
					{:else}
						<span class="ml-2 self-center">{$i18n.t('Off')}</span>
					{/if}
				</button>
			</div>
		</div>

		<div>
			<div class=" mb-1 text-sm font-medium">{$i18n.t('TTS Settings')}</div>

			<div class=" py-0.5 flex w-full justify-between">
				<div class=" self-center text-xs font-medium">{$i18n.t('Text-to-Speech Engine')}</div>
				<div class="flex items-center relative">
					<select
						class="w-fit pr-8 rounded-sm px-2 p-1 text-xs bg-transparent outline-hidden text-right"
						bind:value={TTSEngine}
						aria-label={$i18n.t('Text-to-Speech Engine')}
						placeholder={$i18n.t('Select an engine')}
					>
						<option value="">{$i18n.t('Default')}</option>
						<option value="browser-kokoro">{$i18n.t('Kokoro.js (Browser)')}</option>
					</select>
				</div>
			</div>

			{#if TTSEngine === 'browser-kokoro'}
				<div class=" py-0.5 flex w-full justify-between">
					<div class=" self-center text-xs font-medium">{$i18n.t('Kokoro.js Dtype')}</div>
					<div class="flex items-center relative">
						<select
							class="w-fit pr-8 rounded-sm px-2 p-1 text-xs bg-transparent outline-hidden text-right"
							bind:value={TTSEngineConfig.dtype}
							aria-label={$i18n.t('Kokoro.js Dtype')}
							placeholder={$i18n.t('Select dtype')}
						>
							<option value="" disabled selected>{$i18n.t('Select dtype')}</option>
							<option value="fp32">fp32</option>
							<option value="fp16">fp16</option>
							<option value="q8">q8</option>
							<option value="q4">q4</option>
						</select>
					</div>
				</div>
			{/if}

			<div class=" py-0.5 flex w-full justify-between">
				<div class=" self-center text-xs font-medium">{$i18n.t('Auto-playback response')}</div>

				<button
					class="p-1 px-3 text-xs flex rounded-sm transition"
					on:click={() => {
						toggleResponseAutoPlayback();
					}}
					type="button"
					role="switch"
					aria-checked={responseAutoPlayback}
				>
					{#if responseAutoPlayback === true}
						<span class="ml-2 self-center">{$i18n.t('On')}</span>
					{:else}
						<span class="ml-2 self-center">{$i18n.t('Off')}</span>
					{/if}
				</button>
			</div>

			<div class=" py-0.5 flex w-full justify-between">
				<div class=" self-center text-xs font-medium">{$i18n.t('Speech Playback Speed')}</div>

				<div class="flex items-center relative text-xs px-3">
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={playbackRate}
						aria-label={$i18n.t('Speech Playback Speed')}
						class=" text-sm text-right bg-transparent dark:text-gray-300 outline-hidden"
					/>
					x
				</div>
			</div>
		</div>

		<hr class=" border-gray-100/30 dark:border-gray-850/30" />

		{#if TTSEngine === 'browser-kokoro'}
			{#if TTSModel}
				<div>
					<div class=" mb-2.5 text-sm font-medium">{$i18n.t('Set Voice')}</div>
					<div class="flex w-full">
						<div class="flex-1">
							<input
								list="voice-list"
								class="w-full text-sm bg-transparent dark:text-gray-300 outline-hidden"
								bind:value={voice}
								aria-label={$i18n.t('Voice')}
								placeholder={$i18n.t('Select a voice')}
							/>

							<datalist id="voice-list">
								{#each voices as voice}
									<option value={voice.id}>{voice.name}</option>
								{/each}
							</datalist>
						</div>
					</div>
				</div>
			{:else}
				<div>
					<div class=" mb-2.5 text-sm font-medium flex gap-2 items-center">
						<Spinner className="size-4" />

						<div class=" text-sm font-medium shimmer">
							{$i18n.t('Loading Kokoro.js...')}
							{TTSModelProgress && TTSModelProgress.status === 'progress'
								? `(${Math.round(TTSModelProgress.progress * 10) / 10}%)`
								: ''}
						</div>
					</div>

					<div class="text-xs text-gray-500">
						{$i18n.t('Please do not close the settings page while loading the model.')}
					</div>
				</div>
			{/if}
		{:else if isServerEdgeTtsEngine($config.audio.tts.engine)}
			<div>
				<div class="mb-1 text-sm font-medium">Neural voices (edge-tts)</div>
				<div class="text-xs text-gray-500 dark:text-gray-400 mb-2">
					Server Microsoft Neural TTS (no API key). Auto: Sofie (Swedish) / Ava Multilingual
					(English). Call mode and Read aloud always use the server.
				</div>
				{#each NEURAL_LANG_PICKERS as picker}
					<div class="py-0.5 flex w-full justify-between gap-2">
						<div class="self-center text-xs font-medium">{picker.label}</div>
						<div class="flex items-center relative">
							<select
								class="w-fit max-w-[14rem] pr-8 rounded-sm px-2 p-1 text-xs bg-transparent outline-hidden text-right"
								bind:value={edgeVoiceByLang[picker.base]}
								aria-label={`${picker.label} neural voice`}
							>
								<option value="">Auto</option>
								{#each EDGE_TTS_VOICE_OPTIONS.filter((v) => v.langBase === picker.base) as opt}
									<option value={opt.id}>{opt.label}</option>
								{/each}
							</select>
						</div>
					</div>
				{/each}
			</div>
		{:else if $config.audio.tts.engine !== ''}
			<div>
				<div class=" mb-2.5 text-sm font-medium">{$i18n.t('Set Voice')}</div>
				<div class="flex w-full">
					<div class="flex-1">
						<input
							list="voice-list"
							class="w-full text-sm bg-transparent dark:text-gray-300 outline-hidden"
							bind:value={voice}
							aria-label={$i18n.t('Voice')}
							placeholder={$i18n.t('Select a voice')}
						/>

						<datalist id="voice-list">
							{#each voices as voice}
								<option value={voice.id}>{voice.name}</option>
							{/each}
						</datalist>
					</div>
				</div>
			</div>
		{/if}

		<div class="pt-2">
			<div class="mb-1 text-sm font-medium">{$i18n.t('Clone voice')}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400 mb-2">
				{$i18n.t(
					'Upload a short sample (stored privately). When XTTS sidecar is up, Call/read-aloud uses real voice cloning; otherwise an edge-tts Neural profile is used.'
				)}
			</div>
			{#if cloneVoiceLabel}
				<div class="text-xs mb-2 text-emerald-700 dark:text-emerald-300">
					{$i18n.t('Active profile')}: {cloneVoiceLabel}
					{#if cloneVoiceSampleName}
						<span class="text-gray-500 dark:text-gray-400">({cloneVoiceSampleName})</span>
					{/if}
					{#if cloneEdgeVoice}
						<span class="text-gray-500 dark:text-gray-400">→ {cloneEdgeVoice}</span>
					{/if}
					{#if cloneEnabled}
						<span class="ml-1 text-[10px] px-1 rounded bg-emerald-500/20">ON</span>
					{:else}
						<span class="ml-1 text-[10px] px-1 rounded bg-gray-500/20">OFF</span>
					{/if}
				</div>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<input
					id="spockify-voice-clone-input"
					type="file"
					accept="audio/*,.wav,.mp3,.ogg,.m4a"
					class="hidden"
					on:change={async (e) => {
						const input = e.currentTarget as HTMLInputElement;
						const file = input?.files?.[0];
						if (!file) return;
						cloneUploading = true;
						try {
							const res = await uploadVoiceClone(localStorage.token, file, { enabled: true });
							cloneVoiceLabel = res?.profile?.label || file.name;
							cloneVoiceSampleName = res?.profile?.sample_name || file.name;
							cloneEdgeVoice = res?.profile?.edge_voice || '';
							cloneEnabled = !!res?.enabled;
							toast.success($i18n.t('Voice profile saved — Call/read-aloud will use it'));
						} catch (err) {
							toast.error(`${err}`);
						} finally {
							cloneUploading = false;
							input.value = '';
						}
					}}
				/>
				<button
					type="button"
					class="px-3 py-1.5 text-xs rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition disabled:opacity-50"
					disabled={cloneUploading}
					on:click={() => document.getElementById('spockify-voice-clone-input')?.click()}
				>
					{cloneUploading ? $i18n.t('Uploading…') : $i18n.t('Upload sample')}
				</button>
				<button
					type="button"
					class="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-xs"
					on:click={async () => {
						try {
							const res = await xttsCheck(localStorage.token);
							toast.info(res?.note || res?.engine || 'XTTS check done');
						} catch (err) {
							toast.error(`${err}`);
						}
					}}
				>
					{$i18n.t('Check XTTS')}
				</button>
				{#if cloneVoiceLabel}
					<button
						type="button"
						class="px-2 py-1 text-[11px] rounded bg-gray-100 dark:bg-gray-800"
						on:click={async () => {
							cloneEnabled = !cloneEnabled;
							try {
								await updateVoiceClone(localStorage.token, { enabled: cloneEnabled });
								toast.success(
									cloneEnabled
										? $i18n.t('Clone profile enabled')
										: $i18n.t('Clone profile disabled')
								);
							} catch (err) {
								toast.error(`${err}`);
							}
						}}
					>
						{cloneEnabled ? $i18n.t('Disable') : $i18n.t('Enable')}
					</button>
					<button
						type="button"
						class="px-2 py-1 text-[11px] text-gray-500 hover:underline"
						on:click={async () => {
							cloneVoiceLabel = '';
							cloneVoiceSampleName = '';
							cloneEdgeVoice = '';
							cloneEnabled = false;
							try {
								await deleteVoiceClone(localStorage.token);
								localStorage.removeItem('spockifyVoiceClonePref');
							} catch {
								/* ignore */
							}
						}}
					>
						{$i18n.t('Clear')}
					</button>
				{/if}
			</div>
		</div>
	</div>

	<div class="flex justify-end text-sm font-medium">
		<button
			class="px-3.5 py-1.5 text-sm font-medium bg-black hover:bg-gray-900 text-white dark:bg-white dark:text-black dark:hover:bg-gray-100 transition rounded-full"
			type="submit"
		>
			{$i18n.t('Save')}
		</button>
	</div>
</form>
