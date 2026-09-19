<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/stores';
	import { viewLiveShare } from '$lib/apis/spockify';

	let title = 'Live session';
	let messages: { id?: string; role?: string; content?: string; done?: boolean }[] = [];
	let error = '';
	let updatedAt: number | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	$: token = $page.params.token;

	const load = async () => {
		if (!token) return;
		try {
			const res = await viewLiveShare(token);
			title = res?.title || 'Live session';
			messages = res?.messages || [];
			updatedAt = res?.updated_at ?? null;
			error = '';
		} catch (e: any) {
			error = e?.detail || `${e}` || 'Live link not found';
		}
	};

	onMount(() => {
		load();
		pollTimer = setInterval(load, 2000);
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});
</script>

<svelte:head>
	<title>{title} · Spockify Live</title>
</svelte:head>

<div class="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-6">
	<div class="max-w-2xl mx-auto">
		<div class="mb-4">
			<div class="text-xs uppercase tracking-wide text-zinc-500">Spockify · live (read-only)</div>
			<h1 class="text-xl font-semibold mt-1">{title}</h1>
			{#if updatedAt}
				<div class="text-[11px] text-zinc-500 mt-1">Updated {new Date(updatedAt * 1000).toLocaleString()}</div>
			{/if}
		</div>

		{#if error}
			<div class="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
				{error}
			</div>
		{:else if !messages.length}
			<div class="text-sm text-zinc-400">Waiting for messages…</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each messages as m (m.id)}
					<div
						class="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap {m.role === 'user'
							? 'bg-zinc-800 self-end max-w-[90%]'
							: 'bg-zinc-900 border border-zinc-800'}"
					>
						<div class="text-[10px] uppercase text-zinc-500 mb-1">{m.role}</div>
						{m.content || (m.done === false ? '…' : '')}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
