<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import {
		getSpockifyMemory,
		updateSpockifyProjectSummary,
		deleteSpockifySessionDigest
	} from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	type ProjectRow = {
		id: string;
		name: string;
		project_summary: string;
		has_summary: boolean;
	};

	type SessionRow = {
		id: string;
		updated_at?: string;
		message_count?: number;
		preview?: string;
		content?: string;
		used_in_last_chat?: boolean;
	};

	let loading = true;
	let projects: ProjectRow[] = [];
	let sessions: SessionRow[] = [];
	let routerOk = false;
	let routerError = '';
	let drafts: Record<string, string> = {};
	let savingId = '';
	let expandedSession = '';
	let searchQuery = '';
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	const load = async (q = searchQuery) => {
		loading = true;
		try {
			const res = await getSpockifyMemory(localStorage.token, {
				q: q.trim() || undefined
			});
			projects = res?.projects ?? [];
			sessions = res?.sessions ?? [];
			routerOk = !!res?.router?.ok;
			routerError = res?.router?.error || '';
			drafts = {};
			for (const p of projects) {
				drafts[p.id] = p.project_summary || '';
			}
		} catch (e) {
			toast.error(`${e}`);
		} finally {
			loading = false;
		}
	};

	const onSearchInput = () => {
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => load(searchQuery), 250);
	};

	const saveProject = async (id: string) => {
		savingId = id;
		try {
			await updateSpockifyProjectSummary(localStorage.token, id, drafts[id] || '');
			toast.success($i18n.t('Project summary saved'));
			await load();
		} catch (e) {
			toast.error(`${e}`);
		} finally {
			savingId = '';
		}
	};

	const clearProject = async (id: string) => {
		drafts[id] = '';
		await saveProject(id);
	};

	const deleteSession = async (id: string) => {
		try {
			await deleteSpockifySessionDigest(localStorage.token, id);
			toast.success($i18n.t('Session digest deleted'));
			sessions = sessions.filter((s) => s.id !== id);
		} catch (e) {
			toast.error(`${e}`);
		}
	};

	onMount(() => load());
</script>

<div class="flex flex-col gap-5 text-sm">
	<div>
		<div class="text-base font-medium mb-1">{$i18n.t('Spockify Memory')}</div>
		<div class="text-xs text-gray-500 dark:text-gray-400">
			{$i18n.t(
				'View and edit Project (folder) summaries and router session digests injected into chats.'
			)}
		</div>
		<input
			class="mt-2 w-full text-xs rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2.5 py-1.5"
			placeholder={$i18n.t('Search projects and digests…')}
			bind:value={searchQuery}
			on:input={onSearchInput}
		/>
	</div>

	{#if loading}
		<div class="py-8 flex justify-center"><Spinner /></div>
	{:else}
		<section>
			<div class="font-medium mb-2">{$i18n.t('Projects')}</div>
			{#if !projects.length}
				<div
					class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-2"
				>
					<p class="text-sm">
						{#if searchQuery.trim()}
							{$i18n.t('No projects match your search.')}
						{:else}
							{$i18n.t('No projects yet — create one from the sidebar Projects list.')}
						{/if}
					</p>
					{#if !searchQuery.trim()}
						<p class="text-xs text-gray-500">
							{$i18n.t('Projects hold summaries that Spockify injects into chats in that folder.')}
						</p>
					{/if}
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each projects as p}
						<div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
							<div class="flex items-center justify-between gap-2 mb-2">
								<div class="font-medium truncate">{p.name}</div>
								{#if p.has_summary}
									<span
										class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
										>summary</span
									>
								{:else}
									<span
										class="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-600 dark:text-gray-300"
										>empty</span
									>
								{/if}
							</div>
							<textarea
								class="w-full text-xs rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 p-2 min-h-[72px]"
								bind:value={drafts[p.id]}
								placeholder={$i18n.t('Project summary (injected into chats in this project)')}
							></textarea>
							<div class="flex gap-2 mt-2">
								<button
									type="button"
									class="px-2.5 py-1 text-xs rounded-lg bg-black text-white dark:bg-white dark:text-black disabled:opacity-50"
									disabled={savingId === p.id}
									on:click={() => saveProject(p.id)}
								>
									{$i18n.t('Save')}
								</button>
								<button
									type="button"
									class="px-2.5 py-1 text-xs rounded-lg text-gray-600 dark:text-gray-300 hover:underline"
									on:click={() => clearProject(p.id)}
								>
									{$i18n.t('Clear')}
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section>
			<div class="flex items-center justify-between mb-2">
				<div class="font-medium">{$i18n.t('Session digests')}</div>
				<span class="text-[10px] text-gray-500">
					{#if routerOk}
						router ok
					{:else}
						router: {routerError || 'unreachable'}
					{/if}
				</span>
			</div>
			{#if !sessions.length}
				<div
					class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-2"
				>
					<p class="text-sm">
						{#if searchQuery.trim()}
							{$i18n.t('No digests match your search.')}
						{:else}
							{$i18n.t('No condensed session digests yet.')}
						{/if}
					</p>
					{#if !searchQuery.trim()}
						<p class="text-xs text-gray-500">
							{$i18n.t('Have a long chat — Spockify summarizes earlier turns for context.')}
						</p>
						<a href="/" class="text-xs text-sky-700 dark:text-sky-400 hover:underline"
							>{$i18n.t('Open a chat')}</a
						>
					{/if}
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each sessions as s}
						<div class="rounded-lg border border-gray-200 dark:border-gray-700 p-3">
							<div class="flex justify-between gap-2 text-xs mb-1">
								<div class="flex items-center gap-2 min-w-0">
									<code class="text-[11px] opacity-70 truncate">{s.id}</code>
									{#if s.used_in_last_chat}
										<span
											class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-800 dark:text-sky-200"
											>{$i18n.t('used in last chat')}</span
										>
									{/if}
								</div>
								<span class="text-gray-500 shrink-0">{s.updated_at || ''}</span>
							</div>
							<pre class="text-[11px] whitespace-pre-wrap text-gray-700 dark:text-gray-300 max-h-28 overflow-auto">{expandedSession === s.id
									? s.content || s.preview
									: s.preview}</pre>
							<div class="flex gap-2 mt-2">
								<button
									type="button"
									class="text-[11px] hover:underline"
									on:click={() =>
										(expandedSession = expandedSession === s.id ? '' : s.id)}
								>
									{expandedSession === s.id ? $i18n.t('Collapse') : $i18n.t('Expand')}
								</button>
								<button
									type="button"
									class="text-[11px] text-red-600 dark:text-red-400 hover:underline"
									on:click={() => deleteSession(s.id)}
								>
									{$i18n.t('Delete')}
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</div>
