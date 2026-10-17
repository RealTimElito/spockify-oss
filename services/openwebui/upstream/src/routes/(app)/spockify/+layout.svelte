<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { WEBUI_NAME, showSidebar, mobile, user } from '$lib/stores';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Sidebar from '$lib/components/icons/Sidebar.svelte';

	const i18n = getContext('i18n');

	const VERIFIED = new Set(['admin', 'user', 'family', 'guest']);

	const tabs = [
		{ href: '/spockify', label: 'Home', matchExact: '/spockify' },
		{ href: '/spockify/agents', label: 'Agents', match: '/spockify/agents' },
		{ href: '/spockify/calendar', label: 'Calendar', match: '/spockify/calendar' },
		{ href: '/spockify/lab', label: 'Lab', match: '/spockify/lab' },
		{ href: '/spockify/ghost', label: 'Ghost · AI IDE', match: '/spockify/ghost' },
		{ href: '/spockify/connectors', label: 'Connectors', match: '/spockify/connectors' },
		{ href: '/spockify/memory', label: 'Memory', match: '/spockify/memory' }
	];

	const isActive = (tab: (typeof tabs)[0], path: string) => {
		if (tab.matchExact) return path === tab.matchExact || path === `${tab.matchExact}/`;
		return !!tab.match && path.includes(tab.match);
	};

	let loaded = false;

	onMount(async () => {
		if (!VERIFIED.has($user?.role ?? '')) {
			goto('/');
			return;
		}
		loaded = true;
	});
</script>

<svelte:head>
	<title>
		{$i18n.t('Spockify')} • {$WEBUI_NAME}
	</title>
</svelte:head>

{#if loaded}
	<div
		class=" relative flex flex-col w-full h-screen max-h-[100dvh] transition-width duration-200 ease-in-out {$showSidebar
			? 'md:max-w-[calc(100%-var(--sidebar-width))]'
			: ''} max-w-full"
	>
		<nav class="   px-2.5 pt-1.5 backdrop-blur-xl drag-region select-none">
			<div class=" flex items-center gap-1">
				{#if $mobile}
					<div class="{$showSidebar ? 'md:hidden' : ''} self-center flex flex-none items-center">
						<Tooltip
							content={$showSidebar ? $i18n.t('Close Sidebar') : $i18n.t('Open Sidebar')}
							interactive={true}
						>
							<button
								id="sidebar-toggle-button"
								class=" cursor-pointer flex rounded-lg hover:bg-gray-100 dark:hover:bg-gray-850 transition cursor-"
								aria-label={$showSidebar ? $i18n.t('Close Sidebar') : $i18n.t('Open Sidebar')}
								on:click={() => {
									showSidebar.set(!$showSidebar);
								}}
							>
								<div class=" self-center p-1.5">
									<Sidebar />
								</div>
							</button>
						</Tooltip>
					</div>
				{/if}

				<div class="">
					<div
						class="flex gap-1 scrollbar-none overflow-x-auto w-fit text-center text-sm font-medium rounded-full bg-transparent py-1 touch-auto pointer-events-auto"
					>
						{#each tabs as tab}
							<a
								draggable="false"
								aria-current={isActive(tab, $page.url.pathname) ? 'page' : null}
								class="min-w-fit p-1.5 {isActive(tab, $page.url.pathname)
									? ''
									: 'text-gray-300 dark:text-gray-600 hover:text-gray-700 dark:hover:text-white'} transition select-none"
								href={tab.href}>{$i18n.t(tab.label)}</a
							>
						{/each}
					</div>
				</div>
			</div>
		</nav>

		<div class=" pb-1 px-3 md:px-[18px] flex-1 max-h-full overflow-y-auto" id="spockify-container">
			<slot />
		</div>
	</div>
{/if}
