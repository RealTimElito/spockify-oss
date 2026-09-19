<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { getFamilyMode, putFamilyMode } from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	let loading = true;
	let saving = false;
	let enabled = false;
	let allowedModels = 'spockify-auto,llama3.2-3b,gemma4-12b';
	let familyCap = 200000;
	let guestCap = 50000;
	let notes = '';

	const load = async () => {
		loading = true;
		try {
			const res = await getFamilyMode(localStorage.token);
			const cfg = res?.config || res || {};
			enabled = !!cfg.enabled;
			allowedModels = (cfg.allowed_models || []).join(',') || allowedModels;
			familyCap = cfg.family_token_cap ?? familyCap;
			guestCap = cfg.guest_token_cap ?? guestCap;
			notes = cfg.notes || res?.notes || '';
		} catch (e) {
			toast.error(`${e}`);
		}
		loading = false;
	};

	const save = async () => {
		saving = true;
		try {
			await putFamilyMode(localStorage.token, {
				enabled,
				allowed_models: allowedModels
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean),
				family_token_cap: Number(familyCap) || 200000,
				guest_token_cap: Number(guestCap) || 50000,
				blocked_tools: ['admin', 'pipelines', 'databases', 'workspace_apply'],
				notes:
					notes ||
					'guest/family roles: limited models + daily token caps; no admin tools.'
			});
			toast.success($i18n.t('Family mode saved'));
			await load();
		} catch (e) {
			toast.error(`${e}`);
		}
		saving = false;
	};

	onMount(load);
</script>

<div class="flex flex-col h-full justify-between text-sm">
	<div class="space-y-4 overflow-y-scroll scrollbar-hidden h-full pb-4">
		<div>
			<div class="text-sm font-medium">{$i18n.t('Family / guest mode')}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
				{$i18n.t(
					'Limit models and daily tokens for guest/family roles. Assign role in Users.'
				)}
			</div>
		</div>

		{#if loading}
			<div class="py-6 flex justify-center"><Spinner /></div>
		{:else}
			<label class="flex items-center gap-2 text-xs">
				<input type="checkbox" bind:checked={enabled} />
				{$i18n.t('Enable family mode enforcement')}
			</label>

			<label class="block text-xs space-y-1">
				<span class="text-gray-500">{$i18n.t('Allowed models (comma)')}</span>
				<input
					class="w-full rounded-lg bg-transparent border border-gray-200 dark:border-gray-700 px-2 py-1.5"
					bind:value={allowedModels}
				/>
			</label>

			<div class="grid grid-cols-2 gap-2">
				<label class="block text-xs space-y-1">
					<span class="text-gray-500">{$i18n.t('Family token cap / day')}</span>
					<input
						type="number"
						class="w-full rounded-lg bg-transparent border border-gray-200 dark:border-gray-700 px-2 py-1.5"
						bind:value={familyCap}
					/>
				</label>
				<label class="block text-xs space-y-1">
					<span class="text-gray-500">{$i18n.t('Guest token cap / day')}</span>
					<input
						type="number"
						class="w-full rounded-lg bg-transparent border border-gray-200 dark:border-gray-700 px-2 py-1.5"
						bind:value={guestCap}
					/>
				</label>
			</div>

			{#if notes}
				<div class="text-[11px] text-gray-500">{notes}</div>
			{/if}

			<button
				class="px-3 py-1.5 text-xs rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-50"
				disabled={saving}
				on:click={save}
			>
				{saving ? $i18n.t('Saving…') : $i18n.t('Save')}
			</button>
		{/if}
	</div>
</div>
