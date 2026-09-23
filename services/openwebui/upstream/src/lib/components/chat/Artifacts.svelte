<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { onMount, getContext, createEventDispatcher } from 'svelte';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import hljs from 'highlight.js';

	const i18n = getContext('i18n');
	const dispatch = createEventDispatcher();

	import {
		artifactCode,
		chatId,
		config,
		settings,
		showArtifacts,
		showControls,
		artifactContents
	} from '$lib/stores';
	import { copyToClipboard } from '$lib/utils';
	import { injectCsp } from '$lib/utils/csp';
	import {
		canvasTitleFromContent,
		downloadExtForCanvas
	} from '$lib/utils/spockifyCanvas';

	import XMark from '../icons/XMark.svelte';
	import ArrowsPointingOut from '../icons/ArrowsPointingOut.svelte';
	import Tooltip from '../common/Tooltip.svelte';
	import SvgPanZoom from '../common/SVGPanZoom.svelte';
	import Download from '../icons/Download.svelte';
	import CodeEditor from '../common/CodeEditor.svelte';

	export let overlay = false;

	type CanvasItem = {
		type: string;
		content: string;
		lang?: string;
		title?: string;
	};

	let contents: CanvasItem[] = [];
	let selectedContentIdx = 0;
	let viewMode: 'preview' | 'source' = 'preview';
	let localEdit = '';
	let copied = false;
	let iframeElement: HTMLIFrameElement;

	$: current = contents[selectedContentIdx];
	$: title = current
		? current.title || canvasTitleFromContent(current.type, current.content, current.lang)
		: 'Canvas';

	let lastCanvasKey = '';
	$: {
		const key = current
			? `${selectedContentIdx}:${current.type}:${current.content?.length ?? 0}`
			: '';
		if (key && key !== lastCanvasKey) {
			lastCanvasKey = key;
			localEdit = current.content;
			viewMode = current.type === 'code' ? 'source' : 'preview';
		}
	}

	function navigateContent(direction: 'prev' | 'next') {
		selectedContentIdx =
			direction === 'prev'
				? Math.max(selectedContentIdx - 1, 0)
				: Math.min(selectedContentIdx + 1, contents.length - 1);
	}

	const iframeLoadHandler = () => {
		iframeElement.contentWindow.addEventListener(
			'click',
			function (e) {
				const target = e.target.closest('a');
				if (target && target.href) {
					e.preventDefault();
					const url = new URL(target.href, iframeElement.baseURI);
					if (url.origin === window.location.origin) {
						iframeElement.contentWindow.history.pushState(
							null,
							'',
							url.pathname + url.search + url.hash
						);
					} else {
						console.info('External navigation blocked:', url.href);
					}
				}
			},
			true
		);

		iframeElement.contentWindow.addEventListener('mouseenter', function (e) {
			e.preventDefault();
			iframeElement.contentWindow.addEventListener('dragstart', (event) => {
				event.preventDefault();
			});
		});
	};

	const showFullScreen = () => {
		if (iframeElement.requestFullscreen) {
			iframeElement.requestFullscreen();
		} else if (iframeElement.webkitRequestFullscreen) {
			iframeElement.webkitRequestFullscreen();
		} else if (iframeElement.msRequestFullscreen) {
			iframeElement.msRequestFullscreen();
		}
	};

	const renderedMarkdown = (src: string) => {
		try {
			return DOMPurify.sanitize(marked.parse(src || '') as string);
		} catch {
			return DOMPurify.sanitize(src || '');
		}
	};

	const highlightedCode = (src: string, lang = '') => {
		try {
			if (lang && hljs.getLanguage(lang)) {
				return hljs.highlight(src, { language: lang }).value;
			}
			return hljs.highlightAuto(src).value;
		} catch {
			return src;
		}
	};

	const downloadArtifact = () => {
		const item = contents[selectedContentIdx];
		if (!item) return;
		const ext = downloadExtForCanvas(item);
		const mime =
			item.type === 'iframe'
				? 'text/html'
				: item.type === 'svg'
					? 'image/svg+xml'
					: item.type === 'code'
						? 'text/plain'
						: 'text/markdown';
		const blob = new Blob([item.content], { type: mime });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `canvas-${$chatId}-${selectedContentIdx}.${ext}`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	const artifactAsPatch = () => {
		const item = contents[selectedContentIdx];
		const content = item?.content ?? '';
		const ext = item ? downloadExtForCanvas(item) : 'txt';
		const name = `canvas-${$chatId}-${selectedContentIdx}.${ext}`;
		const lines = content.split('\n');
		const body = [
			`--- /dev/null`,
			`+++ b/${name}`,
			`@@ -0,0 +1,${lines.length} @@`,
			...lines.map((ln) => `+${ln}`)
		].join('\n');
		return body + '\n';
	};

	const copyPatch = async () => {
		await copyToClipboard(artifactAsPatch());
		copied = true;
		setTimeout(() => {
			copied = false;
		}, 2000);
		toast.success($i18n.t('Patch copied'));
	};

	const downloadDiff = () => {
		const blob = new Blob([artifactAsPatch()], { type: 'text/x-diff' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `canvas-${$chatId}-${selectedContentIdx}.diff`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	};

	onMount(() => {
		const unsubscribeArtifactCode = artifactCode.subscribe((value) => {
			if (contents && value) {
				const codeIdx = contents.findIndex((content) => content.content.includes(value));
				selectedContentIdx = codeIdx !== -1 ? codeIdx : 0;
			}
		});

		const unsubscribeArtifactContents = artifactContents.subscribe((value) => {
			const newContents = (value ?? []) as CanvasItem[];

			if (newContents.length === 0) {
				showControls.set(false);
				showArtifacts.set(false);
				selectedContentIdx = 0;
			} else if (newContents.length > contents.length) {
				selectedContentIdx = newContents.length - 1;
			}

			contents = newContents;
		});

		return () => {
			unsubscribeArtifactCode();
			unsubscribeArtifactContents();
		};
	});
</script>

<div
	class="w-full h-full relative flex flex-col bg-[#f7f6f3] dark:bg-gray-850"
	id="artifacts-container"
	data-spockify-canvas="1"
>
	<div class="w-full h-full flex flex-col flex-1 relative min-h-0">
		{#if contents.length > 0}
			<div
				class="pointer-events-auto z-20 flex justify-between items-center gap-2 px-3 py-2 border-b border-black/5 dark:border-white/10 text-gray-900 dark:text-white"
			>
				<div class="flex-1 flex items-center justify-between min-w-0 pr-1 gap-2">
					<div class="flex items-center gap-2 min-w-0">
						<div
							class="text-[11px] font-semibold tracking-[0.14em] uppercase text-stone-600 dark:text-stone-300 shrink-0"
						>
							Canvas
						</div>
						<div class="text-xs truncate text-stone-700 dark:text-stone-200" title={title}>
							{title}
						</div>
						<div class="flex items-center gap-0.5 self-center min-w-fit" dir="ltr">
							<button
								class="self-center p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition disabled:cursor-not-allowed"
								on:click={() => navigateContent('prev')}
								disabled={contents.length <= 1}
								aria-label="Previous canvas"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2.5"
									class="size-3.5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="M15.75 19.5 8.25 12l7.5-7.5"
									/>
								</svg>
							</button>

							<div class="text-xs self-center dark:text-gray-100 min-w-fit tabular-nums">
								{selectedContentIdx + 1}/{contents.length}
							</div>

							<button
								class="self-center p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-md transition disabled:cursor-not-allowed"
								on:click={() => navigateContent('next')}
								disabled={contents.length <= 1}
								aria-label="Next canvas"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									stroke-width="2.5"
									class="size-3.5"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										d="m8.25 4.5 7.5 7.5-7.5 7.5"
									/>
								</svg>
							</button>
						</div>
					</div>

					<div class="flex items-center gap-1.5 shrink-0">
						{#if current?.type === 'markdown' || current?.type === 'code'}
							<button
								class="bg-none border-none text-xs bg-stone-200/70 hover:bg-stone-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition rounded-md px-1.5 py-0.5"
								on:click={() =>
									(viewMode = viewMode === 'preview' ? 'source' : 'preview')}
							>
								{viewMode === 'preview' ? 'Source' : 'Preview'}
							</button>
						{/if}

						<button
							class="copy-code-button bg-none border-none text-xs bg-stone-200/70 hover:bg-stone-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition rounded-md px-1.5 py-0.5"
							on:click={() => {
								copyToClipboard(contents[selectedContentIdx].content);
								copied = true;
								setTimeout(() => {
									copied = false;
								}, 2000);
							}}>{copied ? $i18n.t('Copied') : $i18n.t('Copy')}</button
						>

						<button
							class="bg-none border-none text-xs bg-stone-200/70 hover:bg-stone-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition rounded-md px-1.5 py-0.5"
							on:click={copyPatch}
							title="Copy as unified diff"
						>
							{$i18n.t('Copy patch')}
						</button>

						<button
							class="bg-none border-none text-xs bg-stone-200/70 hover:bg-stone-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition rounded-md px-1.5 py-0.5"
							on:click={downloadDiff}
							title="Download .diff"
						>
							.diff
						</button>

						<Tooltip content={$i18n.t('Download')}>
							<button
								class="bg-none border-none text-xs bg-stone-200/70 hover:bg-stone-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition rounded-md p-0.5"
								on:click={downloadArtifact}
							>
								<Download className="size-3.5" />
							</button>
						</Tooltip>

						{#if current?.type === 'iframe'}
							<Tooltip content={$i18n.t('Open in full screen')}>
								<button
									class="bg-none border-none text-xs bg-stone-200/70 hover:bg-stone-200 dark:bg-gray-800 dark:hover:bg-gray-700 transition rounded-md p-0.5"
									on:click={showFullScreen}
								>
									<ArrowsPointingOut className="size-3.5" />
								</button>
							</Tooltip>
						{/if}
					</div>
				</div>

				<button
					class="self-center pointer-events-auto p-1 rounded-full bg-transparent hover:bg-black/5 dark:hover:bg-white/5"
					on:click={() => {
						dispatch('close');
						showControls.set(false);
						showArtifacts.set(false);
					}}
					aria-label="Close canvas"
				>
					<XMark className="size-3.5 text-gray-900 dark:text-white" />
				</button>
			</div>
		{/if}

		{#if overlay}
			<div class="absolute top-0 left-0 right-0 bottom-0 z-10"></div>
		{/if}

		<div class="flex-1 w-full h-full min-h-0 overflow-hidden">
			<div class="h-full flex flex-col min-h-0">
				{#if contents.length > 0 && current}
					<div class="max-w-full w-full h-full min-h-0 overflow-auto">
						{#if current.type === 'iframe'}
							<iframe
								bind:this={iframeElement}
								title="Canvas HTML"
								srcdoc={injectCsp(current.content, $config?.ui?.iframe_csp ?? '')}
								class="w-full border-0 h-full rounded-none"
								sandbox="allow-scripts allow-downloads{($settings?.iframeSandboxAllowForms ?? false)
									? ' allow-forms'
									: ''}{($settings?.iframeSandboxAllowSameOrigin ?? false)
									? ' allow-same-origin'
									: ''}"
								on:load={iframeLoadHandler}
							></iframe>
						{:else if current.type === 'svg'}
							<SvgPanZoom
								className="w-full h-full max-h-full overflow-hidden"
								svg={current.content}
							/>
						{:else if current.type === 'markdown'}
							{#if viewMode === 'source'}
								<div class="h-full min-h-[12rem]">
									<CodeEditor
										value={localEdit}
										id={`canvas-md-${selectedContentIdx}`}
										lang="markdown"
										onChange={(value) => {
											localEdit = value;
										}}
									/>
								</div>
							{:else}
								<article
									class="spockify-canvas-prose px-5 py-4 max-w-3xl mx-auto text-[15px] leading-7 text-stone-800 dark:text-stone-100"
								>
									{@html renderedMarkdown(current.content)}
								</article>
							{/if}
						{:else if current.type === 'code'}
							{#if viewMode === 'preview'}
								<pre
									class="hljs p-4 overflow-x-auto text-sm h-full m-0 rounded-none bg-[#1e1e1e] text-stone-100"
								><code class="language-{current.lang || ''}"
										>{@html highlightedCode(current.content, current.lang || '')}</code
									></pre>
							{:else}
								<div class="h-full min-h-[12rem]">
									<CodeEditor
										value={localEdit}
										id={`canvas-code-${selectedContentIdx}`}
										lang={current.lang || ''}
										onChange={(value) => {
											localEdit = value;
										}}
									/>
								</div>
							{/if}
						{/if}
					</div>
				{:else}
					<div
						class="m-auto max-w-sm px-6 text-center space-y-2 text-stone-700 dark:text-stone-200"
					>
						<div class="text-[11px] font-semibold tracking-[0.14em] uppercase text-stone-500">
							Canvas
						</div>
						<p class="text-sm leading-relaxed">
							Long docs and code open here beside chat. Ask for a document in a
							<code class="text-xs px-1 py-0.5 rounded bg-stone-200/80 dark:bg-gray-800"
								>```canvas</code
							>
							fence, or use <strong>Canvas</strong> on a code block.
						</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	:global(.spockify-canvas-prose h1) {
		font-size: 1.75rem;
		font-weight: 650;
		letter-spacing: -0.02em;
		margin: 0 0 0.75rem;
	}
	:global(.spockify-canvas-prose h2) {
		font-size: 1.25rem;
		font-weight: 600;
		margin: 1.5rem 0 0.5rem;
	}
	:global(.spockify-canvas-prose h3) {
		font-size: 1.05rem;
		font-weight: 600;
		margin: 1.25rem 0 0.4rem;
	}
	:global(.spockify-canvas-prose p) {
		margin: 0 0 0.85rem;
	}
	:global(.spockify-canvas-prose ul),
	:global(.spockify-canvas-prose ol) {
		margin: 0 0 0.85rem;
		padding-left: 1.25rem;
	}
	:global(.spockify-canvas-prose pre) {
		overflow-x: auto;
		padding: 0.75rem 1rem;
		border-radius: 0.5rem;
		background: #1e1e1e;
		color: #f5f5f4;
		margin: 0 0 0.85rem;
		font-size: 0.85rem;
	}
	:global(.spockify-canvas-prose code) {
		font-size: 0.9em;
	}
	:global(.spockify-canvas-prose a) {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	:global(.spockify-canvas-prose blockquote) {
		border-left: 3px solid #a8a29e;
		padding-left: 0.85rem;
		margin: 0 0 0.85rem;
		color: #57534e;
	}
</style>
