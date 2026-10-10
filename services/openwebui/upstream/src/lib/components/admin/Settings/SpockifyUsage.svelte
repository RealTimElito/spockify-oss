<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { getSpockifyUsage } from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	type Totals = {
		spend?: number;
		requests?: number;
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};

	type DailyRow = {
		day?: string;
		spend?: number;
		requests?: number;
		prompt_tokens?: number;
		completion_tokens?: number;
	};

	type ModelRow = {
		model?: string;
		requests?: number;
		spend?: number;
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};

	type UsagePayload = {
		ok?: boolean;
		checked_at?: string;
		error?: string;
		note?: string;
		totals?: Totals;
		daily?: DailyRow[];
		by_model?: ModelRow[];
	};

	let loading = true;
	let usage: UsagePayload | null = null;

	const fmt = (n: number | undefined | null, digits = 4) => {
		if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
		return Number(n).toLocaleString(undefined, {
			maximumFractionDigits: digits
		});
	};

	const load = async () => {
		loading = true;
		try {
			usage = await getSpockifyUsage(localStorage.token);
		} catch (error) {
			usage = null;
			toast.error(typeof error === 'string' ? error : $i18n.t('Failed to load usage'));
		} finally {
			loading = false;
		}
	};

	onMount(load);
</script>

<div class="flex flex-col gap-4 text-sm">
	<div class="flex items-center justify-between gap-2">
		<div>
			<div class="text-lg font-medium">{$i18n.t('Spockify usage')}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400">
				{$i18n.t('Read-only LiteLLM spend (does not change the database).')}
			</div>
		</div>
		<button
			type="button"
			class="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
			on:click={load}
			disabled={loading}
		>
			{$i18n.t('Refresh')}
		</button>
	</div>

	{#if loading}
		<div class="flex justify-center py-8"><Spinner /></div>
	{:else if !usage?.ok}
		<div class="text-red-600 dark:text-red-400 text-sm">
			{usage?.error || $i18n.t('Usage unavailable')}
			{#if usage?.note}
				<div class="mt-1 text-xs text-gray-500">{usage.note}</div>
			{/if}
		</div>
	{:else}
		{#if usage.checked_at}
			<div class="text-xs text-gray-500">{$i18n.t('Checked')}: {usage.checked_at}</div>
		{/if}

		<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
			<div class="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
				<div class="text-xs text-gray-500">{$i18n.t('Spend')}</div>
				<div class="text-lg font-medium">{fmt(usage.totals?.spend)}</div>
			</div>
			<div class="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
				<div class="text-xs text-gray-500">{$i18n.t('Requests')}</div>
				<div class="text-lg font-medium">{fmt(usage.totals?.requests, 0)}</div>
			</div>
			<div class="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
				<div class="text-xs text-gray-500">{$i18n.t('Prompt tokens')}</div>
				<div class="text-lg font-medium">{fmt(usage.totals?.prompt_tokens, 0)}</div>
			</div>
			<div class="rounded-lg border border-gray-100 dark:border-gray-800 p-3">
				<div class="text-xs text-gray-500">{$i18n.t('Completion tokens')}</div>
				<div class="text-lg font-medium">{fmt(usage.totals?.completion_tokens, 0)}</div>
			</div>
		</div>

		<div>
			<div class="font-medium mb-2">{$i18n.t('By model')}</div>
			{#if (usage.by_model || []).length === 0}
				<div class="text-xs text-gray-500">{$i18n.t('No spend logs yet')}</div>
			{:else}
				<div class="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
					<table class="min-w-full text-xs">
						<thead class="bg-gray-50 dark:bg-gray-900 text-left">
							<tr>
								<th class="px-3 py-2">{$i18n.t('Model')}</th>
								<th class="px-3 py-2">{$i18n.t('Requests')}</th>
								<th class="px-3 py-2">{$i18n.t('Spend')}</th>
								<th class="px-3 py-2">{$i18n.t('Tokens')}</th>
							</tr>
						</thead>
						<tbody>
							{#each usage.by_model || [] as row}
								<tr class="border-t border-gray-100 dark:border-gray-800">
									<td class="px-3 py-2 font-medium">{row.model}</td>
									<td class="px-3 py-2">{fmt(row.requests, 0)}</td>
									<td class="px-3 py-2">{fmt(row.spend)}</td>
									<td class="px-3 py-2">{fmt(row.total_tokens, 0)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<div>
			<div class="font-medium mb-2">{$i18n.t('Daily (30d)')}</div>
			{#if (usage.daily || []).length === 0}
				<div class="text-xs text-gray-500">{$i18n.t('No daily aggregates yet')}</div>
			{:else}
				<div class="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-800">
					<table class="min-w-full text-xs">
						<thead class="bg-gray-50 dark:bg-gray-900 text-left">
							<tr>
								<th class="px-3 py-2">{$i18n.t('Day')}</th>
								<th class="px-3 py-2">{$i18n.t('Requests')}</th>
								<th class="px-3 py-2">{$i18n.t('Spend')}</th>
							</tr>
						</thead>
						<tbody>
							{#each usage.daily || [] as row}
								<tr class="border-t border-gray-100 dark:border-gray-800">
									<td class="px-3 py-2">{row.day}</td>
									<td class="px-3 py-2">{fmt(row.requests, 0)}</td>
									<td class="px-3 py-2">{fmt(row.spend)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		{#if usage.note}
			<div class="text-xs text-gray-500">{usage.note}</div>
		{/if}
	{/if}
</div>
