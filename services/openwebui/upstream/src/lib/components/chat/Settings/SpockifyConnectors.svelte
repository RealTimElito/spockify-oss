<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import {
		getConnectors,
		putConnectors,
		getConnectorsBriefing,
		testConnector
	} from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	let loading = true;
	let saving = false;
	let connectors: any[] = [];
	let briefingPreview = '';
	let demoNote = '';
	let testBusy: Record<string, boolean> = {};
	let testResults: Record<string, { ok: boolean; message: string }> = {};

	const fieldHelp: Record<string, { token: string; account: string; extra?: string }> = {
		calendar: {
			token: 'ICS URL (Google “secret address in iCal format”, or any https://…ics)',
			account: 'Optional label'
		},
		email: {
			token: 'IMAP app password (not your login password)',
			account: 'Email address',
			extra: 'Host defaults to imap.gmail.com — set IMAP host below if needed'
		},
		telegram: {
			token: 'Bot token from @BotFather',
			account: 'Optional @bot username',
			extra: 'Optional chat id to filter updates'
		}
	};

	const ensureExtra = (c: any) => {
		if (!c.extra || typeof c.extra !== 'object') c.extra = {};
		return c;
	};

	const load = async () => {
		loading = true;
		try {
			const res = await getConnectors(localStorage.token);
			connectors = (res?.connectors || []).map((c) => {
				const extra = { ...(c.extra || {}) };
				return ensureExtra({
					...c,
					token: '',
					refresh_token: '',
					extra,
					imap_host: extra.host || '',
					chat_id: extra.chat_id || ''
				});
			});
			if (!connectors.length) {
				connectors = [
					{ kind: 'calendar', enabled: false, label: 'Calendar', token: '', account: '', extra: {} },
					{ kind: 'email', enabled: false, label: 'Email', token: '', account: '', extra: {} },
					{ kind: 'telegram', enabled: false, label: 'Telegram', token: '', account: '', extra: {} }
				];
			}
		} catch (e) {
			toast.error(`${e}`);
		}
		loading = false;
	};

	const save = async () => {
		saving = true;
		try {
			const res = await putConnectors(localStorage.token, {
				connectors: connectors.map((c) => ({
					kind: c.kind,
					enabled: !!c.enabled,
					label: c.label || c.kind,
					token: c.token || '',
					refresh_token: c.refresh_token || '',
					account: c.account || '',
					extra: {
						...(c.extra || {}),
						...(c.kind === 'email' && c.imap_host ? { host: c.imap_host } : {}),
						...(c.kind === 'telegram' && c.chat_id ? { chat_id: c.chat_id } : {})
					}
				}))
			});
			connectors = (res?.connectors || connectors).map((c) =>
				ensureExtra({ ...c, token: '', refresh_token: '' })
			);
			toast.success($i18n.t('Saved privately to your account'));
		} catch (e) {
			toast.error(`${e}`);
		}
		saving = false;
	};

	const previewBriefing = async () => {
		try {
			const res = await getConnectorsBriefing(localStorage.token);
			briefingPreview = res?.text || '(empty)';
			demoNote = res?.demo
				? 'Demo mode — paste real secrets below to replace sample digest.'
				: res?.note || '';
		} catch (e) {
			toast.error(`${e}`);
		}
	};

	const runTest = async (kind: string) => {
		testBusy = { ...testBusy, [kind]: true };
		try {
			const res = await testConnector(localStorage.token, kind);
			const ok = !!res?.ok;
			const message = res?.message || (ok ? 'OK' : 'Failed');
			testResults = { ...testResults, [kind]: { ok, message } };
			if (ok) toast.success(message);
			else toast.error(message);
		} catch (e: any) {
			const message =
				(typeof e === 'object' && (e?.detail || e?.message)) || `${e}` || 'Test failed';
			testResults = { ...testResults, [kind]: { ok: false, message: String(message) } };
			toast.error(String(message));
		} finally {
			testBusy = { ...testBusy, [kind]: false };
		}
	};

	onMount(load);
</script>

<div class="flex flex-col h-full justify-between text-sm">
	<div class="space-y-4 overflow-y-scroll scrollbar-hidden h-full pb-4">
		<div>
			<div class="text-sm font-medium">{$i18n.t('Your connectors')}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
				{$i18n.t(
					'Personal calendar (ICS), email (IMAP app password), and Telegram (bot token) for your morning briefing. Saved privately to your account — admins cannot read other users’ tokens.'
				)}
			</div>
			<p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
				<a href="/spockify/calendar" class="text-sky-700 dark:text-sky-400 hover:underline"
					>{$i18n.t('Open Calendar')}</a
				>
				{$i18n.t('to view upcoming events from your ICS feed.')}
			</p>
		</div>

		{#if loading}
			<div class="py-6 flex justify-center"><Spinner /></div>
		{:else}
			{#each connectors as c}
				{@const help = fieldHelp[c.kind] || fieldHelp.calendar}
				{@const result = testResults[c.kind]}
				<section class="space-y-2 border-b border-gray-100 dark:border-gray-800 pb-3">
					<div class="flex items-center justify-between gap-2">
						<div class="font-medium capitalize">{c.label || c.kind}</div>
						<label class="flex items-center gap-1.5 text-xs">
							<input type="checkbox" bind:checked={c.enabled} />
							{$i18n.t('Enabled')}
						</label>
					</div>
					{#if c.configured}
						<div class="text-[11px] text-emerald-700 dark:text-emerald-300">
							{$i18n.t('Configured')} (leave token blank to keep existing secret)
						</div>
					{/if}
					<input
						class="w-full text-xs rounded-lg bg-transparent border border-gray-200 dark:border-gray-700 px-2 py-1.5"
						placeholder={help.account}
						bind:value={c.account}
					/>
					<input
						class="w-full text-xs rounded-lg bg-transparent border border-gray-200 dark:border-gray-700 px-2 py-1.5"
						placeholder={help.token}
						type="password"
						bind:value={c.token}
					/>
					{#if c.kind === 'email'}
						<input
							class="w-full text-xs rounded-lg bg-transparent border border-gray-200 dark:border-gray-700 px-2 py-1.5"
							placeholder="IMAP host (default imap.gmail.com)"
							bind:value={c.imap_host}
						/>
					{:else if c.kind === 'telegram'}
						<input
							class="w-full text-xs rounded-lg bg-transparent border border-gray-200 dark:border-gray-700 px-2 py-1.5"
							placeholder="Optional chat id"
							bind:value={c.chat_id}
						/>
					{/if}
					{#if help.extra}
						<div class="text-[11px] text-gray-500 dark:text-gray-400">{help.extra}</div>
					{/if}
					<div class="flex flex-wrap items-center gap-2">
						<button
							type="button"
							class="px-2.5 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-50"
							disabled={!!testBusy[c.kind]}
							on:click={() => runTest(c.kind)}
						>
							{testBusy[c.kind]
								? $i18n.t('Testing…')
								: $i18n.t(`Test ${c.kind === 'calendar' ? 'calendar' : c.kind === 'email' ? 'email' : 'Telegram'}`)}
						</button>
						{#if result}
							<span
								class="text-[11px] {result.ok
									? 'text-emerald-700 dark:text-emerald-300'
									: 'text-red-600 dark:text-red-400'}"
							>
								{result.ok ? '✓' : '✗'}
								{result.message}
							</span>
						{/if}
					</div>
				</section>
			{/each}

			<div class="flex flex-wrap gap-2 pt-1">
				<button
					class="px-3 py-1.5 text-xs rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-50"
					disabled={saving}
					on:click={save}
				>
					{saving ? $i18n.t('Saving…') : $i18n.t('Save')}
				</button>
				<button
					class="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700"
					on:click={previewBriefing}
				>
					{$i18n.t('Preview briefing digest')}
				</button>
			</div>

			{#if demoNote}
				<div class="text-[11px] text-amber-700 dark:text-amber-300 mt-2">{demoNote}</div>
			{/if}
			{#if briefingPreview}
				<pre
					class="text-[11px] whitespace-pre-wrap rounded-lg bg-gray-50 dark:bg-gray-900/50 p-3 mt-2 border border-gray-100 dark:border-gray-800"
				>{briefingPreview}</pre>
			{/if}
		{/if}
	</div>
</div>
