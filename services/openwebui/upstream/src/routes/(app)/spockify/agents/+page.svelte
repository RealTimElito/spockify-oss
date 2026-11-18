<script lang="ts">
	import { getContext } from 'svelte';
	import SpockifyScheduledAgents from '$lib/components/admin/Settings/SpockifyScheduledAgents.svelte';

	const i18n = getContext('i18n');
</script>

<div class="flex flex-col gap-2 py-2 max-w-3xl">
	<div class="text-lg font-medium">{$i18n.t('Scheduled agents')}</div>
	<p class="text-sm text-gray-500 dark:text-gray-400">
		{$i18n.t('Your scheduled Spockify jobs (morning briefing, presets). Also in Settings.')}
	</p>
	<SpockifyScheduledAgents />
</div>
