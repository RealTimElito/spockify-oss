<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import {
		getEvalSets,
		getEvalRuns,
		runEvalBoard,
		saveEvalSet
	} from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	let loading = true;
	let running = false;
	let sets: any[] = [];
	let runs: any[] = [];
	let selectedSetId = '';
	let lastLeaderboard: any[] = [];

	const load = async () => {
		loading = true;
		try {
			const [s, r] = await Promise.all([
				getEvalSets(localStorage.token),
				getEvalRuns(localStorage.token, 20)
			]);
			sets = s?.sets || [];
			runs = r?.runs || [];
			if (!selectedSetId && sets[0]?.id) selectedSetId = sets[0].id;
		} catch (e) {
			toast.error(`${e}`);
		}
		loading = false;
	};

	const ensureDefault = async () => {
		if (sets.length) return;
		await saveEvalSet(localStorage.token, {
			name: 'Spockify smoke prompts',
			prompts: [
				{ text: 'What is 17 * 19?', label: 'math' },
				{ text: 'Write a Python one-liner to reverse a string.', label: 'code' },
				{
					text: 'Summarize why local LLMs matter for privacy in two sentences.',
					label: 'chat'
				}
			],
			models: ['llama3.2-3b', 'gemma4-12b']
		});
		await load();
	};

	const run = async () => {
		if (!selectedSetId) {
			toast.error($i18n.t('Select a prompt set'));
			return;
		}
		running = true;
		try {
			const res = await runEvalBoard(localStorage.token, { set_id: selectedSetId });
			lastLeaderboard = res?.run?.leaderboard || [];
			toast.success($i18n.t('Eval run finished'));
			await load();
		} catch (e) {
			toast.error(`${e}`);
		}
		running = false;
	};

	onMount(async () => {
		await load();
		await ensureDefault();
	});
</script>

<div class="flex flex-col h-full justify-between text-sm">
	<div class="space-y-4 overflow-y-scroll scrollbar-hidden h-full pb-4">
		<div>
			<div class="text-sm font-medium">{$i18n.t('Eval board')}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
				{$i18n.t('Run a saved prompt set against models and store heuristic scores.')}
			</div>
		</div>

		{#if loading}
			<div class="py-6 flex justify-center"><Spinner /></div>
		{:else}
			<section class="space-y-2">
				<label class="text-xs text-gray-500" for="eval-set">{$i18n.t('Prompt set')}</label>
				<select
					id="eval-set"
					class="w-full text-xs rounded-lg bg-transparent border border-gray-200 dark:border-gray-700 px-2 py-1.5"
					bind:value={selectedSetId}
				>
					{#each sets as s}
						<option value={s.id}>{s.name} ({(s.prompts || []).length} prompts)</option>
					{/each}
				</select>
				<button
					class="px-3 py-1.5 text-xs rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-50"
					disabled={running || !selectedSetId}
					on:click={run}
				>
					{running ? $i18n.t('Running…') : $i18n.t('Run eval')}
				</button>
			</section>

			{#if lastLeaderboard.length}
				<section class="space-y-1">
					<div class="font-medium text-xs">{$i18n.t('Latest leaderboard')}</div>
					<ul class="text-xs space-y-1">
						{#each lastLeaderboard as row}
							<li class="flex justify-between gap-2 border-b border-gray-100 dark:border-gray-800 py-1">
								<span>{row.model}</span>
								<span class="text-gray-500"
									>score {row.avg_score} · {row.avg_latency_ms} ms</span
								>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="space-y-1 pt-2">
				<div class="font-medium text-xs">{$i18n.t('Recent runs')}</div>
				{#if !runs.length}
					<div class="text-xs text-gray-500">{$i18n.t('No runs yet.')}</div>
				{:else}
					<ul class="text-xs space-y-1">
						{#each runs as r}
							<li class="border-b border-gray-100 dark:border-gray-800 py-1">
								<div class="font-medium">{r.set_name || r.set_id}</div>
								<div class="text-gray-500">{r.created_at}</div>
								{#if (r.leaderboard || [])[0]}
									<div class="text-gray-500">
										top: {r.leaderboard[0].model} ({r.leaderboard[0].avg_score})
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</div>
</div>
