<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { page } from '$app/stores';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { getAgentRun, listAgentRuns, forkAgentRun } from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	let loading = true;
	let runs: any[] = [];
	let selected: any = null;
	let error = '';
	let scrub = 0;
	let whatIf = '';
	let forkStatus = '';

	const timelineEvents = (run: any) => {
		const ev: { t: number; label: string; worker?: any }[] = [];
		ev.push({ t: 0, label: `run created · ${run?.status || '?'}` });
		(run?.workers || []).forEach((w: any, i: number) => {
			ev.push({
				t: i + 1,
				label: `${w.name || w.id} · ${w.status}${w.duration_ms != null ? ` · ${w.duration_ms}ms` : ''}`,
				worker: w
			});
		});
		if (run?.synthesis) {
			ev.push({ t: (run.workers?.length || 0) + 1, label: 'synthesis ready' });
		}
		if (run?.forked_from) {
			ev.push({
				t: -1,
				label: `forked from ${run.forked_from.run_id} / ${run.forked_from.worker_id}`
			});
		}
		return ev;
	};

	$: events = selected ? timelineEvents(selected) : [];
	$: scrubIdx = Math.min(Math.max(0, scrub), Math.max(0, events.length - 1));
	$: visibleWorkers = (() => {
		if (!selected) return [];
		const cut = events[scrubIdx];
		if (!cut || cut.t < 0) return selected.workers || [];
		return (selected.workers || []).slice(0, Math.max(0, cut.t));
	})();

	const load = async () => {
		loading = true;
		error = '';
		try {
			const res = await listAgentRuns(localStorage.token, 50);
			runs = res?.runs ?? [];
			let q = $page.url.searchParams.get('run');
			if (!q) {
				try {
					q = sessionStorage.getItem('spockifyReplayRun') || '';
					if (q) sessionStorage.removeItem('spockifyReplayRun');
				} catch {
					/* ignore */
				}
			}
			if (q) {
				selected = await getAgentRun(localStorage.token, q);
			} else if (runs.length) {
				selected = runs[0];
			}
			scrub = Math.max(0, (selected?.workers?.length || 1) - 1);
		} catch (e) {
			error = `${e}`;
		} finally {
			loading = false;
		}
	};

	const openRun = async (id: string) => {
		try {
			selected = await getAgentRun(localStorage.token, id);
			scrub = Math.max(0, (selected?.workers?.length || 1) - 1);
			const url = new URL(window.location.href);
			url.searchParams.set('run', id);
			history.replaceState({}, '', url.toString());
		} catch (e) {
			error = `${e}`;
		}
	};

	const doFork = async (workerId: string) => {
		if (!selected?.id) return;
		forkStatus = 'Forking…';
		try {
			const res = await forkAgentRun(localStorage.token, selected.id, {
				worker_id: workerId,
				what_if: whatIf || undefined
			});
			forkStatus = `Forked → ${res?.run?.id || '?'}`;
			await load();
			if (res?.run?.id) await openRun(res.run.id);
		} catch (e) {
			forkStatus = `${e}`;
		}
	};

	onMount(load);
</script>

<div class="flex flex-col gap-4 text-sm">
	<div>
		<div class="text-base font-medium mb-1">{$i18n.t('Agent run replay')}</div>
		<div class="text-xs text-gray-500 dark:text-gray-400">
			Time-travel scrub + what-if fork (Wave 10.4). Shareable via
			<code class="text-[11px]">?run=&lt;id&gt;</code>.
		</div>
	</div>

	{#if loading}
		<div class="py-6 flex justify-center"><Spinner /></div>
	{:else if error}
		<div class="text-xs text-red-600">{error}</div>
	{:else}
		<div class="grid gap-3 md:grid-cols-[220px_1fr]">
			<div class="flex flex-col gap-1 max-h-[70vh] overflow-auto">
				{#each runs as r}
					<button
						type="button"
						class="text-left px-2 py-1.5 rounded border text-xs {selected?.id === r.id
							? 'border-gray-400 dark:border-gray-500 bg-gray-50 dark:bg-gray-900'
							: 'border-gray-200 dark:border-gray-700'}"
						on:click={() => openRun(r.id)}
					>
						<div class="font-medium truncate">{r.id}</div>
						<div class="text-gray-500 truncate">
							{r.status} · {(r.parent_prompt || '').slice(0, 48)}
						</div>
					</button>
				{/each}
				{#if !runs.length}
					<div class="text-xs text-gray-500">No runs persisted yet.</div>
				{/if}
			</div>

			{#if selected}
				<div class="flex flex-col gap-2 min-w-0">
					<div class="text-xs text-gray-500">
						status={selected.status}
						{#if selected.synced_from_peer} · synced from peer{/if}
						{#if selected.forked_from}
							· forked from {selected.forked_from.run_id}/{selected.forked_from.worker_id}{/if}
						{#if selected.created_at} · {selected.created_at}{/if}
					</div>

					<label class="text-xs text-gray-500 flex flex-col gap-1">
						Timeline scrub ({scrubIdx + 1}/{events.length || 1})
						<input
							type="range"
							min="0"
							max={Math.max(0, events.length - 1)}
							bind:value={scrub}
						/>
					</label>
					<div class="text-[11px] text-sky-700 dark:text-sky-300">
						{events[scrubIdx]?.label || '—'}
					</div>

					<pre
						class="text-[11px] whitespace-pre-wrap break-words rounded border border-gray-200 dark:border-gray-700 p-2 max-h-28 overflow-auto">{selected.parent_prompt}</pre
					>

					<div class="flex flex-col gap-1">
						<input
							class="text-xs rounded border px-2 py-1 dark:bg-gray-900"
							placeholder="What if… (fork prompt override)"
							bind:value={whatIf}
						/>
						{#if forkStatus}<div class="text-[11px] text-gray-500">{forkStatus}</div>{/if}
					</div>

					{#each visibleWorkers as w}
						<details class="rounded border border-gray-200 dark:border-gray-700" open>
							<summary
								class="px-2 py-1.5 cursor-pointer flex flex-wrap gap-2 items-center list-none text-xs"
							>
								<span class="font-medium">{w.name || w.id}</span>
								<span class="text-gray-400">{w.status}</span>
								{#if w.duration_ms != null}<span class="text-gray-400">{w.duration_ms}ms</span
									>{/if}
								<button
									type="button"
									class="underline text-sky-700"
									on:click|stopPropagation={() => doFork(w.id)}>Fork what-if</button
								>
							</summary>
							<pre
								class="px-2 pb-2 text-[11px] whitespace-pre-wrap break-words max-h-56 overflow-auto">{w.output || w.error || '(empty)'}</pre
							>
						</details>
					{/each}
					{#if selected.synthesis}
						<details class="rounded border border-gray-200 dark:border-gray-700">
							<summary class="px-2 py-1.5 text-xs font-medium">Synthesis</summary>
							<pre
								class="px-2 pb-2 text-[11px] whitespace-pre-wrap break-words max-h-56 overflow-auto">{selected.synthesis}</pre
							>
						</details>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
