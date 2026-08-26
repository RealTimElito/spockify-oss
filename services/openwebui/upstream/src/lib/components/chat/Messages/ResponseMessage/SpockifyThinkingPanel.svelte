<script lang="ts">
	import StatusHistory from './StatusHistory.svelte';
	import { thinkingModeLabel, HEAVY_ENSEMBLE_PLAN } from '$lib/utils/thinkingModes';

	export let message: Record<string, unknown> = {};
	export let messageDone = false;
	export let agentsCancelBusy = false;
	export let onCancelRun: () => void = () => {};
	export let onCancelWorker: (workerId: string) => void = () => {};
	export let onOpenReplay: () => void = () => {};

	const agentsRunActive = (status?: string) =>
		['pending', 'running', 'synthesizing'].includes(status || '');

	$: thinking = (message.spockifyThinking as string | undefined) || '';
	$: agents = message.spockifyAgents as Record<string, unknown> | undefined;
	$: workers = (agents?.workers as Record<string, unknown>[] | undefined) || [];
	$: critique = message.spockifyCritique as
		| { level?: string; notes?: string; model?: string }
		| undefined;
	$: statusHistory = (message.statusHistory as unknown[] | undefined) || [];
	$: routingPath = message.spockifyRoutingPath as string | undefined;
	$: routingReason = message.spockifyReason as string | undefined;
	$: worker = message.spockifyWorker as string | undefined;
	$: webSearch = Boolean(message.spockifyWebSearch);
	$: hud = (message.spockifyHud || agents?.hud) as Record<string, unknown> | undefined;

	$: ensembleRows = (() => {
		const liveByKey = new Map<string, Record<string, unknown>>();
		for (const w of workers) {
			const key = String(w.name || w.id || '').toLowerCase();
			if (key) liveByKey.set(key, w);
		}
		if (thinking === 'heavy') {
			return HEAVY_ENSEMBLE_PLAN.map((p) => {
				const w = liveByKey.get(p.role.toLowerCase());
				if (w) {
					return {
						role: p.role,
						model: String(w.model || p.model),
						status: String(w.status || ''),
						output: String(w.output || w.error || ''),
						preview: String(w.preview || '')
					};
				}
				return { ...p, status: 'pending', output: '', preview: '' };
			});
		}
		if (workers.length > 0) {
			return workers.map((w) => ({
				role: String(w.name || w.id || 'Agent'),
				model: String(w.model || '—'),
				status: String(w.status || ''),
				output: String(w.output || w.error || ''),
				preview: String(w.preview || '')
			}));
		}
		return [];
	})();

	$: hasPanel =
		Boolean(thinking) ||
		statusHistory.length > 0 ||
		workers.length > 0 ||
		Boolean(critique?.level || critique?.notes) ||
		Boolean(routingPath || routingReason || worker);

	$: runActive = agentsRunActive(agents?.status as string | undefined);
	$: doneWorkers = workers.filter((w) =>
		['done', 'failed', 'cancelled'].includes((w.status as string) || '')
	).length;

	$: latestStatus = statusHistory.length
		? (statusHistory.at(-1) as { description?: string; done?: boolean } | undefined)
		: null;
	$: phaseLabel =
		(latestStatus?.description as string | undefined) ||
		(runActive ? 'Running agents…' : agents?.status ? String(agents.status) : '') ||
		(critique?.notes && !messageDone ? 'Verifying answer…' : '') ||
		(thinking === 'heavy' && !messageDone ? 'Heavy thinking…' : '');

	let panelOpen = false;
	let userToggled = false;

	// Auto-open while heavy/multitask is streaming; respect manual collapse.
	$: if (hasPanel && !userToggled) {
		panelOpen =
			!messageDone &&
			(thinking === 'heavy' || workers.length > 0 || Boolean(phaseLabel) || Boolean(critique?.notes));
	}

	const togglePanel = () => {
		userToggled = true;
		panelOpen = !panelOpen;
	};

	$: modeChipClass =
		thinking === 'heavy'
			? 'text-violet-700 dark:text-violet-200 bg-violet-50 dark:bg-violet-400/10 border-violet-200/50 dark:border-violet-500/20'
			: thinking === 'light'
				? 'text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-400/10 border-amber-200/50 dark:border-amber-500/20'
				: 'text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-800/60 border-gray-200/60 dark:border-gray-700/60';

	$: critiqueClass =
		critique?.level === 'low'
			? 'text-amber-700 dark:text-amber-300'
			: critique?.level === 'high'
				? 'text-emerald-700 dark:text-emerald-300'
				: 'text-gray-600 dark:text-gray-300';
</script>

{#if hasPanel}
	<div
		class="my-2 rounded-xl border border-gray-200/70 dark:border-gray-700/70 bg-gray-50/50 dark:bg-gray-900/40 overflow-hidden text-xs"
		aria-label="Spockify thinking details"
	>
		<button
			type="button"
			class="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-gray-100/70 dark:hover:bg-gray-800/50 transition-colors"
			aria-expanded={panelOpen}
			on:click={togglePanel}
		>
			<span
				class="shrink-0 size-2 rounded-full {runActive || (!messageDone && thinking === 'heavy')
					? 'bg-violet-500 animate-pulse'
					: critique?.notes
						? critiqueClass
						: 'bg-emerald-500'}"
				aria-hidden="true"
			></span>
			<span class="font-medium text-gray-800 dark:text-gray-100 shrink-0">Thinking</span>
			{#if thinking}
				<span class="rounded-full px-1.5 py-[1px] border {modeChipClass}">
					{thinkingModeLabel(thinking as import('$lib/utils/thinkingModes').ThinkingMode)}
				</span>
			{/if}
			{#if phaseLabel}
				<span class="text-gray-500 dark:text-gray-400 line-clamp-1">{phaseLabel}</span>
			{/if}
			{#if ensembleRows.length}
				<span class="text-gray-400 dark:text-gray-500 shrink-0 hidden md:inline line-clamp-1"
					>{ensembleRows.map((r) => r.model).join(' · ')}</span
				>
			{/if}
			{#if workers.length}
				<span class="text-gray-400 dark:text-gray-500 shrink-0"
					>{doneWorkers}/{workers.length} agents</span
				>
			{/if}
			{#if critique?.level}
				<span class="ml-auto shrink-0 {critiqueClass}">confidence: {critique.level}</span>
			{/if}
			<svg
				class="size-3.5 shrink-0 text-gray-400 transition-transform {panelOpen ? 'rotate-180' : ''}"
				viewBox="0 0 20 20"
				fill="currentColor"
				aria-hidden="true"
			>
				<path
					fill-rule="evenodd"
					d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.06z"
					clip-rule="evenodd"
				/>
			</svg>
		</button>

		{#if panelOpen}
			<div class="px-3 pb-3 flex flex-col gap-3 border-t border-gray-200/60 dark:border-gray-700/60">
				{#if ensembleRows.length}
					<section>
						<h4 class="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5">
							{thinking === 'heavy' ? 'Heavy ensemble · reasoning' : 'Agent models'}
						</h4>
						<div class="flex flex-col gap-1.5">
							{#each ensembleRows as row (row.role + row.model)}
								<details
									class="rounded-lg border border-violet-200/50 dark:border-violet-500/20 bg-white/60 dark:bg-gray-950/30 overflow-hidden"
									open={row.status === 'running' || Boolean(row.output)}
								>
									<summary
										class="cursor-pointer select-none px-2.5 py-1.5 flex items-center gap-2 list-none"
									>
										<span
											class="shrink-0 size-1.5 rounded-full {row.status === 'done'
												? 'bg-emerald-500'
												: row.status === 'failed' || row.status === 'cancelled'
													? 'bg-red-500'
													: row.status === 'running'
														? 'bg-amber-400 animate-pulse'
														: 'bg-gray-400'}"
										></span>
										<span class="font-medium">{row.role}</span>
										<span class="text-sky-700 dark:text-sky-300 font-mono text-[10px]"
											>{row.model}</span
										>
										<span class="text-gray-400">{row.status || 'pending'}</span>
										{#if row.preview}
											<span class="ml-auto text-gray-500 line-clamp-1 max-w-[45%]"
												>{row.preview}</span
											>
										{/if}
									</summary>
									<pre
										class="px-2.5 pb-2.5 pt-0 whitespace-pre-wrap break-words text-[11px] text-gray-700 dark:text-gray-300 max-h-48 overflow-auto"
									>{row.output || row.preview || '(waiting…)'}</pre>
								</details>
							{/each}
						</div>
					</section>
				{/if}

				{#if thinking === 'heavy' && agents?.synthesis}
					<section>
						<h4 class="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
							Synthesis draft
						</h4>
						<pre
							class="whitespace-pre-wrap break-words text-[11px] text-gray-700 dark:text-gray-300 max-h-40 overflow-auto rounded-lg border border-gray-200/60 dark:border-gray-700/60 bg-white/50 dark:bg-gray-950/30 p-2"
						>{agents.synthesis}</pre>
					</section>
				{/if}

				{#if routingPath || routingReason || worker}
					<section>
						<h4 class="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Routing</h4>
						<div class="text-gray-700 dark:text-gray-300 space-y-0.5">
							{#if worker}
								<div>
									Worker: <span class="font-medium">{worker}</span>{#if webSearch}
										· web search{/if}
								</div>
							{/if}
							{#if routingPath}
								<div>Path: {routingPath}</div>
							{/if}
							{#if routingReason}
								<div class="whitespace-pre-wrap break-words">{routingReason}</div>
							{/if}
						</div>
					</section>
				{/if}

				{#if statusHistory.length}
					<section>
						<h4 class="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Progress</h4>
						<StatusHistory statusHistory={statusHistory} expand={true} />
					</section>
				{/if}

				{#if workers.length && thinking !== 'heavy'}
					<section>
						<div class="flex items-center gap-2 mb-1.5 flex-wrap">
							<h4 class="text-[10px] uppercase tracking-wide text-gray-400">Live agent state</h4>
							{#if runActive && agents?.id}
								<button
									type="button"
									class="px-1.5 py-0.5 rounded text-[10px] border border-red-200/70 dark:border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
									disabled={agentsCancelBusy}
									on:click|preventDefault={onCancelRun}
								>
									{agentsCancelBusy ? 'Cancelling…' : 'Cancel run'}
								</button>
							{:else if agents?.id}
								<button
									type="button"
									class="px-1.5 py-0.5 rounded text-[10px] border border-gray-200/70 dark:border-gray-600/50 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/40"
									on:click|preventDefault={onOpenReplay}
								>
									Replay timeline
								</button>
							{/if}
						</div>
						{#if runActive}
							<div
								class="mb-2 h-1 rounded-full bg-gray-200/70 dark:bg-gray-700/70 overflow-hidden"
								aria-hidden="true"
							>
								<div
									class="h-full rounded-full bg-violet-500/80 transition-all duration-500"
									style="width: {workers.length
										? Math.round((doneWorkers / workers.length) * 100)
										: 0}%"
								></div>
							</div>
						{/if}
						<div class="flex flex-col gap-1.5">
							{#each workers as workerRow (workerRow.id || workerRow.name)}
								<details
									class="rounded-lg border border-gray-200/70 dark:border-gray-700/70 bg-white/60 dark:bg-gray-950/30 overflow-hidden"
								>
									<summary
										class="cursor-pointer select-none px-2.5 py-1.5 flex items-center gap-2 list-none"
									>
										<span
											class="shrink-0 size-1.5 rounded-full {workerRow.status === 'done'
												? 'bg-emerald-500'
												: workerRow.status === 'failed' || workerRow.status === 'cancelled'
													? 'bg-red-500'
													: workerRow.status === 'running'
														? 'bg-amber-400 animate-pulse'
														: 'bg-gray-400'}"
										></span>
										<span class="font-medium">{workerRow.name || workerRow.id}</span>
										{#if workerRow.model}
											<span class="text-sky-700 dark:text-sky-300 font-mono text-[10px]"
												>{workerRow.model}</span
											>
										{/if}
										<span class="text-gray-400">{workerRow.status}</span>
										{#if workerRow.duration_ms != null}
											<span class="text-gray-400">{workerRow.duration_ms}ms</span>
										{/if}
										{#if workerRow.preview}
											<span
												class="ml-auto text-gray-500 line-clamp-1 max-w-[45%]"
												>{workerRow.preview}</span
											>
										{/if}
									</summary>
									<pre
										class="px-2.5 pb-2.5 pt-0 whitespace-pre-wrap break-words text-[11px] text-gray-700 dark:text-gray-300 max-h-48 overflow-auto"
									>{workerRow.output || workerRow.error || '(no output yet)'}</pre>
								</details>
							{/each}
						</div>
						{#if agents?.synthesis}
							<div class="mt-2 pt-2 border-t border-gray-200/50 dark:border-gray-700/50">
								<h5 class="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
									Synthesis draft
								</h5>
								<pre
									class="whitespace-pre-wrap break-words text-[11px] text-gray-700 dark:text-gray-300 max-h-40 overflow-auto"
								>{agents.synthesis}</pre>
							</div>
						{/if}
					</section>
				{/if}

				{#if critique?.notes || critique?.level}
					<section>
						<h4 class="text-[10px] uppercase tracking-wide text-gray-400 mb-1">
							Forced critique{#if critique?.model}
								· {critique.model}{/if}
						</h4>
						{#if critique?.level}
							<div class="mb-1 {critiqueClass} font-medium">
								Confidence: {critique.level}
							</div>
						{/if}
						{#if critique?.notes}
							<pre
								class="whitespace-pre-wrap break-words text-[11px] text-gray-700 dark:text-gray-300 max-h-56 overflow-auto rounded-lg border border-gray-200/60 dark:border-gray-700/60 bg-white/50 dark:bg-gray-950/30 p-2"
							>{critique.notes}</pre>
						{:else if !messageDone}
							<div class="text-gray-400 italic">Waiting for critique…</div>
						{/if}
					</section>
				{/if}

				{#if hud && (hud.latency_ms != null || hud.cost_usd != null || hud.total_tokens)}
					<section>
						<h4 class="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Cost / latency</h4>
						<div class="text-gray-500 dark:text-gray-400">
							{hud.model || hud.worker || 'model'}
							{#if hud.latency_ms != null} · {hud.latency_ms}ms{/if}
							{#if hud.total_tokens} · {hud.total_tokens} tok{/if}
							{#if hud.cost_usd != null} · ~${Number(hud.cost_usd).toFixed(4)}{/if}
						</div>
					</section>
				{/if}
			</div>
		{/if}
	</div>
{/if}
