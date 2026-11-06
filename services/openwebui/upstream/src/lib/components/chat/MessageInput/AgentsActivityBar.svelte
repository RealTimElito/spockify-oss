<script lang="ts">
	/**
	 * Compact multitask / agents HUD above the composer (outside message bubbles).
	 */
	export let run: {
		id?: string;
		status?: string;
		workers?: Array<{
			id?: string;
			name?: string;
			status?: string;
		}>;
	} | null = null;
	export let onCancel: (() => void) | null = null;
	export let cancelBusy = false;

	$: workers = run?.workers ?? [];
	$: doneN = workers.filter((w) =>
		['done', 'failed', 'cancelled'].includes(w.status || '')
	).length;
	$: active = ['pending', 'running', 'synthesizing'].includes(run?.status || '');
	$: pct = workers.length ? Math.round((doneN / workers.length) * 100) : 0;
</script>

{#if run && workers.length > 0}
	<div
		class="spockify-agents-bar mx-auto w-full md:max-w-3xl px-2 mb-1.5"
		aria-label="Agents activity"
	>
		<div
			class="flex items-center gap-2 flex-wrap rounded-lg border border-amber-200/50 dark:border-amber-500/25 bg-amber-50/60 dark:bg-amber-950/30 px-2.5 py-1.5 text-[11px]"
		>
			<span class="font-medium text-amber-900/90 dark:text-amber-100/90 shrink-0">
				{#if active}Agents · {doneN}/{workers.length}{:else}Agents · {run.status || 'done'}{/if}
			</span>
			{#if active}
				<div
					class="flex-1 min-w-[3.5rem] h-1 rounded-full bg-amber-200/60 dark:bg-amber-800/50 overflow-hidden"
					aria-hidden="true"
				>
					<div
						class="h-full rounded-full bg-amber-500/85 dark:bg-amber-400/75 transition-all duration-500"
						style="width: {pct}%"
					></div>
				</div>
			{/if}
			<div class="flex flex-wrap gap-1 min-w-0 flex-1">
				{#each workers.slice(0, 6) as w (w.id || w.name)}
					<span
						class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-amber-200/40 dark:border-amber-600/30 text-amber-900/80 dark:text-amber-100/80 truncate max-w-[7rem]"
						title="{w.name || w.id}: {w.status}"
					>
						<span
							class="size-1.5 rounded-full shrink-0 {['done'].includes(w.status || '')
								? 'bg-emerald-500'
								: ['failed', 'cancelled'].includes(w.status || '')
									? 'bg-red-400'
									: 'bg-amber-400 animate-pulse'}"
						></span>
						<span class="truncate">{w.name || w.id || 'worker'}</span>
					</span>
				{/each}
			</div>
			{#if active && onCancel && run?.id}
				<button
					type="button"
					class="shrink-0 px-2 py-0.5 rounded-md border border-red-200/70 dark:border-red-500/30 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
					disabled={cancelBusy}
					aria-label="Cancel parallel agents run"
					on:click|preventDefault={() => onCancel?.()}
				>
					{cancelBusy ? 'Cancelling…' : 'Cancel'}
				</button>
			{/if}
		</div>
	</div>
{/if}
