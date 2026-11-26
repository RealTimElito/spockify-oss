<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { listDreams, listHomeBrainEvents } from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	type HubCard = {
		href: string;
		title: string;
		blurb: string;
		badgeKey?: 'dream' | 'home';
		external?: boolean;
	};

	const cards: HubCard[] = [
		{
			href: '/spockify/agents',
			title: 'Agents',
			blurb: 'Schedule jobs like a morning briefing. Run now or on a cron.'
		},
		{
			href: '/spockify/calendar',
			title: 'Calendar',
			blurb: 'See upcoming events from your private ICS feed.'
		},
		{
			href: '/spockify/lab',
			title: 'Lab',
			blurb: 'Experiments & live tools — dream insights, rooms, home camera notes, and more.',
			badgeKey: 'dream'
		},
		{
			href: '/spockify/ghost',
			title: 'Ghost',
			blurb: 'AI IDE — files, tabs, tab-complete, and Ghost chat (Monaco).'
		},
		{
			href: '/ide',
			title: 'Spockify IDE',
			blurb: 'Desktop IDE — chat, Ctrl+K, Remote SSH, Open VSX. Releases & download on /ide.'
		},
		{
			href: '/spockify/connectors',
			title: 'Connectors',
			blurb: 'Wire calendar, email, and Telegram for briefings — secrets stay yours.'
		},
		{
			href: '/spockify/memory',
			title: 'Memory',
			blurb: 'Project summaries and session digests used in chats.'
		}
	];

	let dreamUnread = 0;
	let homeUnread = 0;

	const seenKey = (kind: string) => `spockifyLabSeen:${kind}`;

	const countUnread = (items: any[], kind: 'dream' | 'home') => {
		let seen = 0;
		try {
			seen = Number(localStorage.getItem(seenKey(kind)) || '0') || 0;
		} catch {
			seen = 0;
		}
		return items.filter((x) => {
			const t = Date.parse(String(x?.created_at || x?.updated_at || x?.id || '')) || 0;
			const fallback = typeof x?.id === 'string' ? parseInt(x.id.slice(0, 8), 16) || 0 : 0;
			const stamp = t || fallback;
			return stamp > seen;
		}).length;
	};

	onMount(async () => {
		try {
			const [d, h] = await Promise.all([
				listDreams(localStorage.token),
				listHomeBrainEvents(localStorage.token)
			]);
			dreamUnread = countUnread(d?.runs || [], 'dream');
			homeUnread = countUnread(h?.events || [], 'home');
		} catch {
			/* ignore — hub still works offline */
		}
	});
</script>

<div class="flex flex-col gap-4 py-3 max-w-3xl">
	<div>
		<div class="text-2xl font-medium tracking-tight">{$i18n.t('Spockify')}</div>
		<p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
			{$i18n.t('Your agents, calendar, experiments, and memory — one place.')}
		</p>
	</div>

	<div class="grid gap-3 sm:grid-cols-2">
		{#each cards as card}
			{@const badge =
				card.badgeKey === 'dream'
					? dreamUnread + homeUnread
					: 0}
			<a
				href={card.href}
				{...(card.external
					? {
							// download is a string attr — `true` becomes download="true" → saves as "true"
							download: card.href.split('/').pop() || '',
							rel: 'noopener'
						}
					: {})}
				class="group rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/40 p-4 hover:border-gray-400 dark:hover:border-gray-500 transition"
			>
				<div class="flex items-center justify-between gap-2">
					<div class="text-base font-medium group-hover:underline">{card.title}</div>
					{#if badge > 0}
						<span
							class="text-[10px] min-w-[1.25rem] text-center px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-800 dark:text-sky-200"
							title="Unread Dream / Home brain"
						>
							{badge > 9 ? '9+' : badge}
						</span>
					{/if}
				</div>
				<p class="text-xs text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
					{card.blurb}
				</p>
			</a>
		{/each}
	</div>
</div>
