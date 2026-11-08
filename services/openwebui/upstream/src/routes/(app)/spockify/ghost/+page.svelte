<script lang="ts">
	import { getContext } from 'svelte';
	import SpockifyGhostWriter from '$lib/components/chat/SpockifyGhostWriter.svelte';

	const i18n = getContext('i18n');
</script>

<div class="flex flex-col gap-2 py-2 max-w-6xl w-full">
	<div class="text-lg font-medium">{$i18n.t('Ghost')} · AI IDE</div>
	<p class="text-sm text-gray-500 dark:text-gray-400">
		{$i18n.t(
			'Private file workspace with Monaco, tab completions, and Ghost AI. Select code in a chat → Open in Ghost to bring it here.'
		)}
	</p>
	<div class="mt-1">
		<SpockifyGhostWriter open={true} />
	</div>
</div>
