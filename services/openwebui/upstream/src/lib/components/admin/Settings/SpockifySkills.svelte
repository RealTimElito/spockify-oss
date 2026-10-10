<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { getSkillsPacks } from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	let loading = true;
	let packs: any[] = [];
	let selected: string[] = [];

	const load = async () => {
		loading = true;
		try {
			const res = await getSkillsPacks(localStorage.token);
			packs = res?.packs || [];
			try {
				selected = JSON.parse(localStorage.getItem('spockifySkillIds') || '[]');
			} catch {
				selected = [];
			}
		} catch (e) {
			toast.error(`${e}`);
		}
		loading = false;
	};

	const toggle = (id: string) => {
		if (selected.includes(id)) selected = selected.filter((x) => x !== id);
		else selected = [...selected, id];
		localStorage.setItem('spockifySkillIds', JSON.stringify(selected));
		toast.success($i18n.t('Skill packs attached for new chats'));
	};

	onMount(load);
</script>

<div class="flex flex-col h-full justify-between text-sm">
	<div class="space-y-4 overflow-y-scroll scrollbar-hidden h-full pb-4">
		<div>
			<div class="text-sm font-medium">{$i18n.t('Skills / prompt packs')}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
				{$i18n.t(
					'Cursor-style SKILL.md packs. Attached packs inject into router system context. Encrypted on this instance.'
				)}
			</div>
		</div>

		{#if loading}
			<div class="py-6 flex justify-center"><Spinner /></div>
		{:else if !packs.length}
			<div class="text-xs text-gray-500">
				{$i18n.t('No packs found — ask an admin to add skill packs on this instance.')}
			</div>
		{:else}
			<ul class="space-y-2">
				{#each packs as p}
					<li
						class="flex items-start justify-between gap-2 border-b border-gray-100 dark:border-gray-800 pb-2"
					>
						<div>
							<div class="font-medium text-xs">{p.name}</div>
							<div class="text-[11px] text-gray-500">{p.description || p.id}</div>
						</div>
						<button
							class="text-xs px-2 py-1 rounded border {selected.includes(p.id)
								? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
								: 'border-gray-200 dark:border-gray-700'}"
							on:click={() => toggle(p.id)}
						>
							{selected.includes(p.id) ? $i18n.t('Attached') : $i18n.t('Attach')}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
