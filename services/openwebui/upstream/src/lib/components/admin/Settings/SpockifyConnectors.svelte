<script lang="ts">
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { migrateLegacyConnectors } from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	let claiming = false;
	let claimResult = '';

	const claimLegacy = async () => {
		claiming = true;
		claimResult = '';
		try {
			const res = await migrateLegacyConnectors(localStorage.token);
			if (res?.migrated) {
                claimResult = `Moved legacy connectors into your account (${(res.kinds || []).join(', ') || 'ok'}).`;
				toast.success($i18n.t('Legacy connectors claimed'));
			} else {
				claimResult = res?.reason
					? `No migrate: ${res.reason}`
					: 'No legacy global connector files found.';
				toast.message(claimResult);
			}
		} catch (e) {
			toast.error(`${e}`);
		}
		claiming = false;
	};
</script>

<div class="flex flex-col h-full justify-between text-sm">
	<div class="space-y-4 overflow-y-scroll scrollbar-hidden h-full pb-4">
		<div>
			<div class="text-sm font-medium">{$i18n.t('Spockify Connectors')}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
				{$i18n.t(
					'Connector secrets are per-user for privacy. Admins cannot view other users’ tokens.'
				)}
			</div>
		</div>

		<div
			class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3 space-y-2"
		>
			<div class="text-xs font-medium">{$i18n.t('Your connectors')}</div>
			<p class="text-xs text-gray-600 dark:text-gray-400">
				{$i18n.t(
					'Each user configures calendar / email / Telegram under Settings → Your connectors. Morning briefing uses only that user’s secrets.'
				)}
			</p>
			<p class="text-[11px] text-gray-500 dark:text-gray-500">
				Open the user Settings modal (profile menu → Settings), then the
				<strong>Your connectors</strong> tab — or
				<a class="underline" href="/spockify/connectors">/spockify/connectors</a>
				/
				<a class="underline" href="/spockify/calendar">Calendar</a>.
			</p>
		</div>

		<div class="space-y-2 border-t border-gray-100 dark:border-gray-800 pt-3">
			<div class="text-xs font-medium">{$i18n.t('Legacy instance files')}</div>
			<p class="text-xs text-gray-600 dark:text-gray-400">
				If older global connector files still exist on this instance, claim them into
				<strong>your</strong> account (other users never see them). Prefer setting
				<code class="text-[11px]">CONNECTORS_BOOTSTRAP_USER_ID</code> to your user id before
				rollout.
			</p>
			<button
				class="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-50"
				disabled={claiming}
				on:click={claimLegacy}
			>
				{claiming ? $i18n.t('Claiming…') : $i18n.t('Claim legacy connectors into my account')}
			</button>
			{#if claimResult}
				<div class="text-[11px] text-gray-500 dark:text-gray-400">{claimResult}</div>
			{/if}
		</div>
	</div>
</div>
