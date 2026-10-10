<script lang="ts">
	import { getContext } from 'svelte';
	import SpockifyConnectors from '$lib/components/chat/Settings/SpockifyConnectors.svelte';

	const i18n = getContext('i18n');
</script>

<div class="flex flex-col gap-2 py-2 max-w-3xl">
	<div class="text-lg font-medium">{$i18n.t('Your connectors')}</div>
	<p class="text-sm text-gray-500 dark:text-gray-400">
		{$i18n.t('Calendar, email, and Telegram for briefings. Also in Settings.')}
	</p>
	<SpockifyConnectors />
</div>
