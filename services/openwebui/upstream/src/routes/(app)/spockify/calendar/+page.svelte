<script lang="ts">
	import { getContext } from 'svelte';
	import SpockifyCalendar from '$lib/components/chat/Settings/SpockifyCalendar.svelte';

	const i18n = getContext('i18n');
</script>

<div class="flex flex-col gap-2 py-2">
	<SpockifyCalendar />
</div>
