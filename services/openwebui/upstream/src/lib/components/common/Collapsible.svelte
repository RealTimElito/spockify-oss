<script lang="ts">
	import { decode } from 'html-entities';
	import { v4 as uuidv4 } from 'uuid';

	import { getContext, onDestroy } from 'svelte';
	const i18n = getContext('i18n');

	import dayjs from '$lib/dayjs';
	import duration from 'dayjs/plugin/duration';
	import relativeTime from 'dayjs/plugin/relativeTime';

	dayjs.extend(duration);
	dayjs.extend(relativeTime);

	async function loadLocale(locales) {
		if (!locales || !Array.isArray(locales)) {
			return;
		}
		for (const locale of locales) {
			try {
				dayjs.locale(locale);
				break; // Stop after successfully loading the first available locale
			} catch (error) {
				console.error(`Could not load locale '${locale}':`, error);
			}
		}
	}

	// Assuming $i18n.languages is an array of language codes
	$: loadLocale($i18n.languages);

	import { slide } from 'svelte/transition';
	import { quintOut } from 'svelte/easing';

	import ChevronUp from '../icons/ChevronUp.svelte';
	import ChevronDown from '../icons/ChevronDown.svelte';
	import Spinner from './Spinner.svelte';

	export let open = false;

	export let className = '';
	export let buttonClassName =
		'w-fit text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition';

	export let id = '';
	export let title = null;
	export let attributes = null;

	export let chevron = false;
	export let grow = false;

	export let disabled = false;
	export let messageDone = false;
	export let hide = false;

	export let onChange: Function = () => {};

	$: onChange(open);

	const collapsibleId = uuidv4();

	/** Live thinking elapsed seconds (Cursor-like stream status). */
	let thinkingStartedAt: number | null = null;
	let thinkingElapsed = 0;
	let thinkingTimer: ReturnType<typeof setInterval> | null = null;

	$: isThinking =
		attributes?.type === 'reasoning' &&
		attributes?.done !== 'true' &&
		!messageDone;

	/**
	 * Start/stop the thinking timer from isThinking only.
	 * Guard cleanup so we do not assign locals every reactive tick — that
	 * infinite $$invalidate loop froze message streaming until the next send.
	 */
	$: {
		if (isThinking) {
			if (thinkingStartedAt == null) thinkingStartedAt = Date.now();
			if (!thinkingTimer) {
				thinkingTimer = setInterval(() => {
					if (thinkingStartedAt != null) {
						thinkingElapsed = Math.max(
							0,
							Math.floor((Date.now() - thinkingStartedAt) / 1000)
						);
					}
				}, 250);
			}
		} else if (thinkingTimer || thinkingStartedAt != null) {
			if (thinkingTimer) {
				clearInterval(thinkingTimer);
				thinkingTimer = null;
			}
			thinkingStartedAt = null;
			thinkingElapsed = 0;
		}
	}

	onDestroy(() => {
		if (thinkingTimer) clearInterval(thinkingTimer);
	});
</script>

<div {id} class={className}>
	{#if title !== null}
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<div
			class="{buttonClassName} {disabled ? '' : 'cursor-pointer'}"
			on:pointerup={() => {
				if (!disabled) {
					open = !open;
				}
			}}
		>
			<div
				class=" w-full flex items-center justify-between gap-2 text-xs {attributes?.done &&
				attributes?.done !== 'true' &&
				!messageDone
					? 'shimmer'
					: ''}
			"
			>
				{#if attributes?.done && attributes?.done !== 'true' && !messageDone}
					<div>
						<Spinner className="size-3.5" />
					</div>
				{/if}

				<div class="italic opacity-90">
					{#if attributes?.type === 'reasoning'}
						{#if (attributes?.done === 'true' || messageDone) && attributes?.duration}
							{#if attributes.duration < 1}
								{$i18n.t('Thought for less than a second')}
							{:else if attributes.duration < 60}
								{$i18n.t('Thought for {{DURATION}} seconds', {
									DURATION: attributes.duration
								})}
							{:else}
								{$i18n.t('Thought for {{DURATION}}', {
									DURATION: dayjs.duration(attributes.duration, 'seconds').humanize()
								})}
							{/if}
						{:else if attributes?.done === 'true' || messageDone}
							{$i18n.t('Thought')}
						{:else}
							Thinking{thinkingElapsed > 0 ? ` · ${thinkingElapsed}s` : '…'}
						{/if}
					{:else if attributes?.type === 'code_interpreter'}
						{#if attributes?.done === 'true' || messageDone}
							{$i18n.t('Analyzed')}
						{:else}
							{$i18n.t('Analyzing...')}
						{/if}
					{:else}
						{title}
					{/if}
				</div>

				{#if !disabled}
					<div class="flex self-center translate-y-[1px]">
						{#if open}
							<ChevronUp strokeWidth="3.5" className="size-3.5" />
						{:else}
							<ChevronDown strokeWidth="3.5" className="size-3.5" />
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<div
			class="{buttonClassName} cursor-pointer"
			on:click={(e) => {
				e.stopPropagation();
			}}
			on:pointerup={(e) => {
				if (!disabled) {
					open = !open;
				}
			}}
		>
			<div>
				<div class="flex items-start justify-between">
					<slot />

					{#if chevron}
						<div class="flex self-start translate-y-1">
							{#if open}
								<ChevronUp strokeWidth="3.5" className="size-3.5" />
							{:else}
								<ChevronDown strokeWidth="3.5" className="size-3.5" />
							{/if}
						</div>
					{/if}
				</div>

				{#if grow}
					{#if open && !hide}
						<div
							transition:slide={{ duration: 300, easing: quintOut, axis: 'y' }}
							on:pointerup={(e) => {
								e.stopPropagation();
							}}
						>
							<slot name="content" />
						</div>
					{/if}
				{/if}
			</div>
		</div>
	{/if}

	{#if !grow}
		{#if open && !hide}
			<div transition:slide={{ duration: 300, easing: quintOut, axis: 'y' }}>
				<slot name="content" />
			</div>
		{/if}
	{/if}
</div>
