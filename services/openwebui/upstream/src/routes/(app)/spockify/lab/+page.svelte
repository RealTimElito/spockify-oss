<script lang="ts">
	import { getContext } from 'svelte';
	import SpockifyWave10 from '$lib/components/admin/Settings/SpockifyWave10.svelte';

	const i18n = getContext('i18n');
</script>

<div class="flex flex-col gap-2 py-2 max-w-4xl">
	<div class="text-lg font-medium">{$i18n.t('Lab')}</div>
	<p class="text-sm text-gray-500 dark:text-gray-400">
		{$i18n.t(
			'Experiments & live tools — overnight insights, shared rooms, camera notes, debates, and briefing packs.'
		)}
	</p>
	<SpockifyWave10 />
</div>
