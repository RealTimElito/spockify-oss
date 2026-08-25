<script lang="ts">
	import Bolt from './Bolt.svelte';
	import Link from './Link.svelte';
	import Database from './Database.svelte';
	import Sparkles from './Sparkles.svelte';
	import CommandLine from './CommandLine.svelte';
	import Calendar from './Calendar.svelte';
	import FaceSmile from './FaceSmile.svelte';

	export let itemId = '';
	export let className = 'size-4.5';
	export let strokeWidth = '2';
</script>

{#if itemId === 'spockify'}
	<FaceSmile {className} {strokeWidth} />
{:else if itemId === 'spockify_agents'}
	<Bolt {className} {strokeWidth} />
{:else if itemId === 'spockify_calendar'}
	<Calendar {className} {strokeWidth} />
{:else if itemId === 'spockify_connectors'}
	<Link {className} {strokeWidth} />
{:else if itemId === 'spockify_memory'}
	<Database {className} {strokeWidth} />
{:else if itemId === 'spockify_lab'}
	<Sparkles {className} {strokeWidth} />
{:else if itemId === 'spockify_ghost'}
	<CommandLine {className} {strokeWidth} />
{/if}
