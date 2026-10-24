<script lang="ts">
	import { getContext } from 'svelte';
	import SpockifyMemory from '$lib/components/admin/Settings/SpockifyMemory.svelte';

	const i18n = getContext('i18n');
</script>

<div class="flex flex-col gap-2 py-2 max-w-3xl">
	<div class="text-lg font-medium">{$i18n.t('Memory')}</div>
	<p class="text-sm text-gray-500 dark:text-gray-400">
		{$i18n.t('Project summaries and session digests. Also in Settings.')}
	</p>
	<SpockifyMemory />
</div>
