<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { getFolders } from '$lib/apis/folders';
	import {
		createAutomation,
		getAutomationItems,
		runAutomationById,
		toggleAutomationById,
		deleteAutomationById,
		type AutomationResponse
	} from '$lib/apis/automations';

	const i18n = getContext('i18n');

	let loading = true;
	let creating = false;
	let agents: AutomationResponse[] = [];
	let folders: { id: string; name: string }[] = [];

	let name = '';
	let prompt = '';
	let folderId = '';
	let schedulePreset: 'morning' | 'evening' | 'hourly' = 'morning';

	const MORNING_BRIEFING_PROMPT = `You are Spockify Morning Briefing.

Produce a concise daily digest for me:
1) Overnight / calendar-relevant highlights (if unknown, say so)
2) Top 3 actionable items from my recent project context / session memory if available
3) Optional: one short web-aware tech or news nugget (use search if enabled)

Keep it under 250 words. Use bullets. End with one clarifying question if needed.

{{CONNECTOR_DIGEST}}`;

	const rruleForPreset = (preset: typeof schedulePreset) => {
		if (preset === 'hourly') return 'RRULE:FREQ=HOURLY;BYMINUTE=0';
		if (preset === 'evening') return 'RRULE:FREQ=DAILY;BYHOUR=18;BYMINUTE=0';
		return 'RRULE:FREQ=DAILY;BYHOUR=8;BYMINUTE=0';
	};

	const formatWhen = (ts: number | null | undefined): string => {
		if (ts == null) return '—';
		const ms = ts > 1e12 ? ts : ts * 1000;
		try {
			return new Date(ms).toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return '—';
		}
	};

	const lastResultLabel = (a: AutomationResponse): string => {
		const run = a.last_run;
		if (!run) {
			return a.last_run_at ? `Last run ${formatWhen(a.last_run_at)}` : 'Never run';
		}
		const status = run.status || 'unknown';
		const when = formatWhen(run.created_at || a.last_run_at);
		if (run.error) return `${status} · ${when}`;
		return `${status} · ${when}`;
	};

	const useMorningBriefingTemplate = async () => {
		name = name.trim() || 'Morning briefing';
		schedulePreset = 'morning';
		let digest =
			'Connectors: none configured for your account. Settings → Your connectors to add calendar/email/Telegram.';
		try {
			const { getConnectorsBriefing } = await import('$lib/apis/spockify');
			const res = await getConnectorsBriefing(localStorage.token);
			if (res?.text) digest = res.text;
		} catch {
			/* ignore — keep empty-state copy */
		}
		prompt = MORNING_BRIEFING_PROMPT.replace('{{CONNECTOR_DIGEST}}', digest);
	};

	const load = async () => {
		loading = true;
		try {
			const [autoRes, folderRes] = await Promise.all([
				getAutomationItems(localStorage.token, '', 'all', 1),
				getFolders(localStorage.token)
			]);
			agents = (autoRes?.items ?? []).filter(
				(a) => a?.meta?.spockify_scheduled_agent || a?.data?.model_id === 'spockify-auto'
			);
			// Also show all if none tagged yet
			if (!agents.length && autoRes?.items?.length) {
				agents = autoRes.items;
			}
			folders = (folderRes ?? []).map((f: any) => ({ id: f.id, name: f.name }));
		} catch (e) {
			toast.error(`${e}`);
		} finally {
			loading = false;
		}
	};

	const createAgent = async () => {
		if (!name.trim() || !prompt.trim()) {
			toast.error($i18n.t('Name and prompt are required'));
			return;
		}
		creating = true;
		try {
			await createAutomation(localStorage.token, {
				name: name.trim(),
				data: {
					prompt: prompt.trim(),
					model_id: 'spockify-auto',
					rrule: rruleForPreset(schedulePreset)
				},
				meta: {
					spockify_scheduled_agent: true,
					spockify_morning_briefing:
						prompt.includes('Morning Briefing') || name.toLowerCase().includes('morning'),
					...(folderId ? { folder_id: folderId } : {})
				},
				is_active: true
			});
			toast.success($i18n.t('Scheduled agent created'));
			name = '';
			prompt = '';
			folderId = '';
			await load();
		} catch (e: any) {
			toast.error(e?.detail ?? `${e}`);
		} finally {
			creating = false;
		}
	};

	onMount(load);
</script>

<div class="flex flex-col gap-5 text-sm">
	<div>
		<div class="text-base font-medium mb-1">{$i18n.t('Scheduled agents')}</div>
		<div class="text-xs text-gray-500 dark:text-gray-400">
			{$i18n.t(
				'Cron-like jobs via Automations. Default model is spockify-auto; results appear as new chats.'
			)}
			<a class="underline ml-1" href="/automations">{$i18n.t('All automations')}</a>
		</div>
	</div>

	<section class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex flex-col gap-2">
		<div class="font-medium flex flex-wrap items-center gap-2">
			<span>{$i18n.t('New agent')}</span>
			<button
				type="button"
				class="text-[11px] px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800"
				on:click={useMorningBriefingTemplate}
			>
				{$i18n.t('Morning briefing')} template
			</button>
		</div>
		<input
			class="w-full text-sm rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2 py-1.5"
			placeholder={$i18n.t('Name')}
			bind:value={name}
		/>
		<textarea
			class="w-full text-sm rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2 py-1.5 min-h-[80px]"
			placeholder={$i18n.t('Prompt')}
			bind:value={prompt}
		></textarea>
		<div class="flex flex-wrap gap-2 items-center">
			<label class="text-xs text-gray-500">{$i18n.t('Schedule')}</label>
			<select
				class="text-xs rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2 py-1"
				bind:value={schedulePreset}
			>
				<option value="morning">{$i18n.t('Daily morning')} (08:00)</option>
				<option value="evening">{$i18n.t('Daily evening')} (18:00)</option>
				<option value="hourly">{$i18n.t('Hourly')}</option>
			</select>
			<label class="text-xs text-gray-500 ml-2">{$i18n.t('Project')}</label>
			<select
				class="text-xs rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2 py-1"
				bind:value={folderId}
			>
				<option value="">{$i18n.t('None')}</option>
				{#each folders as f}
					<option value={f.id}>{f.name}</option>
				{/each}
			</select>
			<span class="text-[11px] text-gray-500">model: spockify-auto</span>
		</div>
		<button
			type="button"
			class="self-start px-3 py-1.5 text-xs rounded-lg bg-black text-white dark:bg-white dark:text-black disabled:opacity-50"
			disabled={creating}
			on:click={createAgent}
		>
			{$i18n.t('Create')}
		</button>
	</section>

	{#if loading}
		<div class="py-6 flex justify-center"><Spinner /></div>
	{:else if !agents.length}
		<div
			class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-2"
		>
			<p class="text-sm">{$i18n.t('No scheduled agents yet.')}</p>
			<p class="text-xs text-gray-500 dark:text-gray-400">
				{$i18n.t('Create a morning briefing above, or browse all automations.')}
			</p>
			<button
				type="button"
				class="inline-block text-xs text-sky-700 dark:text-sky-400 hover:underline"
				on:click={useMorningBriefingTemplate}
			>
				{$i18n.t('Use morning briefing template')}
			</button>
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each agents as a}
				{@const chatId = a.last_run?.chat_id}
				<div
					class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex flex-wrap items-center justify-between gap-2"
				>
					<div class="min-w-0 flex-1">
						<div class="font-medium truncate">{a.name}</div>
						<div class="text-[11px] text-gray-500 dark:text-gray-400 space-y-0.5 mt-0.5">
							<div>
								{$i18n.t('Next')}: {formatWhen(a.next_runs?.[0] ?? a.next_run_at)}
								· {a.is_active ? $i18n.t('active') : $i18n.t('paused')}
							</div>
							<div class="truncate">{$i18n.t('Last')}: {lastResultLabel(a)}</div>
						</div>
					</div>
					<div class="flex flex-wrap gap-2">
						{#if chatId}
							<button
								type="button"
								class="text-xs px-2 py-1 rounded bg-sky-100 dark:bg-sky-900/40 text-sky-800 dark:text-sky-200"
								on:click={() => goto(`/c/${chatId}`)}
							>
								{$i18n.t('Open chat')}
							</button>
						{/if}
						<button
							type="button"
							class="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800"
							on:click={async () => {
								try {
									await runAutomationById(localStorage.token, a.id);
									toast.success($i18n.t('Run started — check sidebar for new chat'));
									await load();
								} catch (e) {
									toast.error(`${e}`);
								}
							}}>{$i18n.t('Run now')}</button
						>
						<button
							type="button"
							class="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-800"
							on:click={async () => {
								await toggleAutomationById(localStorage.token, a.id);
								await load();
							}}>{a.is_active ? $i18n.t('Pause') : $i18n.t('Resume')}</button
						>
						<button
							type="button"
							class="text-xs px-2 py-1 text-red-600 dark:text-red-400"
							on:click={async () => {
								await deleteAutomationById(localStorage.token, a.id);
								await load();
							}}>{$i18n.t('Delete')}</button
						>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
