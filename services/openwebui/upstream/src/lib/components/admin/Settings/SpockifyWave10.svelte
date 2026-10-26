<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import {
		homeBrainIngest,
		listHomeBrainEvents,
		runDream,
		listDreams,
		createRoom,
		listRooms,
		postRoomMessage,
		addVoiceWorldNote,
		voiceWorldReturn,
		startSpectacleDebate,
		voteSpectacle,
		listSpectacleDebates,
		generateBriefingVideo
	} from '$lib/apis/spockify';
	import { user } from '$lib/stores';

	const i18n = getContext('i18n');

	type TabId = 'home' | 'dream' | 'rooms' | 'voice' | 'spectacle' | 'brief';

	const TABS: { id: TabId; label: string; blurb: string; icon: string }[] = [
		{
			id: 'dream',
			label: 'Dream',
			blurb: 'Overnight pass over your projects & memory — insights waiting at breakfast.',
			icon: '☾'
		},
		{
			id: 'rooms',
			label: 'Rooms',
			blurb: 'Live writable rooms for you + agents (not a read-only share link).',
			icon: '⌂'
		},
		{
			id: 'spectacle',
			label: 'Spectacle',
			blurb: 'Two models debate a topic; you vote; a light judge summarizes.',
			icon: '✦'
		},
		{
			id: 'voice',
			label: 'Voice world',
			blurb: 'Leave notes that surface when you return to Call or the app.',
			icon: '◎'
		},
		{
			id: 'home',
			label: 'Home brain',
			blurb: 'Drop a camera or doorbell image URL — get a short local summary.',
			icon: '◉'
		},
		{
			id: 'brief',
			label: 'World brief',
			blurb: 'Turn a morning briefing into a downloadable slides + audio pack.',
			icon: '▷'
		}
	];

	let tab: TabId = 'dream';
	let loading = false;
	let error = '';
	let homeEvents: any[] = [];
	let dreams: any[] = [];
	let rooms: any[] = [];
	let debates: any[] = [];
	let imageUrl = '';
	let dreamFocus = '';
	let roomTitle = 'Spockify room';
	let activeRoom: any = null;
	let roomMsg = '';
	let voiceText = '';
	let dueNotes: any[] = [];
	let debateTopic = 'Local LLMs vs cloud APIs for homelab AI';
	let activeDebate: any = null;
	let briefText = '';
	let status = '';
	let dreamUnread = 0;
	let homeUnread = 0;

	const seenKey = (kind: string) => `spockifyLabSeen:${kind}`;

	const stampOf = (x: any) => {
		const t = Date.parse(String(x?.created_at || x?.updated_at || '')) || 0;
		if (t) return t;
		if (typeof x?.id === 'string') return parseInt(x.id.slice(0, 8), 16) || 0;
		return 0;
	};

	const countUnread = (items: any[], kind: 'dream' | 'home') => {
		let seen = 0;
		try {
			seen = Number(localStorage.getItem(seenKey(kind)) || '0') || 0;
		} catch {
			seen = 0;
		}
		return items.filter((x) => stampOf(x) > seen).length;
	};

	const markSeen = (kind: 'dream' | 'home', items: any[]) => {
		const max = items.reduce((m, x) => Math.max(m, stampOf(x)), Date.now());
		try {
			localStorage.setItem(seenKey(kind), String(max));
		} catch {
			/* ignore */
		}
		if (kind === 'dream') dreamUnread = 0;
		else homeUnread = 0;
	};

	const load = async () => {
		loading = true;
		error = '';
		try {
			const [h, d, r, s] = await Promise.all([
				listHomeBrainEvents(localStorage.token),
				listDreams(localStorage.token),
				listRooms(localStorage.token),
				listSpectacleDebates(localStorage.token)
			]);
			homeEvents = h?.events ?? [];
			dreams = d?.runs ?? [];
			rooms = r?.rooms ?? [];
			debates = s?.debates ?? [];
			dreamUnread = countUnread(dreams, 'dream');
			homeUnread = countUnread(homeEvents, 'home');
		} catch (e) {
			error = `${e}`;
		} finally {
			loading = false;
		}
	};

	onMount(load);

	const selectTab = (id: TabId) => {
		tab = id;
		if (id === 'dream') markSeen('dream', dreams);
		if (id === 'home') markSeen('home', homeEvents);
	};

	const ingestUrl = async () => {
		status = 'Ingesting…';
		try {
			await homeBrainIngest(localStorage.token, {
				image_url: imageUrl,
				note: 'user upload',
				source: 'url'
			});
			status = 'Home brain event stored';
			await load();
			markSeen('home', homeEvents);
		} catch (e) {
			status = `${e}`;
		}
	};

	const doDream = async () => {
		status = 'Dreaming…';
		try {
			await runDream(localStorage.token, { focus: dreamFocus });
			status = 'Dream ready — check insights below';
			await load();
			markSeen('dream', dreams);
		} catch (e) {
			status = `${e}`;
		}
	};

	const doRoom = async () => {
		try {
			const res = await createRoom(localStorage.token, {
				title: roomTitle,
				owner_id: $user?.id
			});
			activeRoom = res?.room;
			status = 'Room created — invite friends with the share code shown below';
			await load();
		} catch (e) {
			status = `${e}`;
		}
	};

	const sendRoom = async () => {
		if (!activeRoom?.id || !roomMsg.trim()) return;
		try {
			const res = await postRoomMessage(localStorage.token, activeRoom.id, {
				text: roomMsg,
				author_id: $user?.id,
				author_name: $user?.name
			});
			activeRoom = res?.room;
			roomMsg = '';
		} catch (e) {
			status = `${e}`;
		}
	};

	const saveVoice = async () => {
		try {
			await addVoiceWorldNote(localStorage.token, {
				text: voiceText,
				user_id: $user?.id,
				surface_on: 'return'
			});
			voiceText = '';
			status = 'Saved — will surface when you return';
		} catch (e) {
			status = `${e}`;
		}
	};

	const signalReturn = async () => {
		try {
			const res = await voiceWorldReturn(localStorage.token, {
				user_id: $user?.id,
				reason: 'visibility'
			});
			dueNotes = res?.due ?? [];
			status = `${dueNotes.length} note(s) due`;
		} catch (e) {
			status = `${e}`;
		}
	};

	const startDebate = async () => {
		status = 'Debating…';
		try {
			const res = await startSpectacleDebate(localStorage.token, {
				topic: debateTopic,
				rounds: 2
			});
			activeDebate = res?.debate;
			status = 'Debate ready — vote below';
			await load();
		} catch (e) {
			status = `${e}`;
		}
	};

	const castVote = async (model: string) => {
		if (!activeDebate?.id) return;
		const res = await voteSpectacle(localStorage.token, {
			debate_id: activeDebate.id,
			model
		});
		activeDebate = res?.debate;
	};

	const doBrief = async () => {
		status = 'Generating world brief…';
		try {
			const blob = await generateBriefingVideo(localStorage.token, {
				text: briefText || 'Good morning. Calendar is light. Focus on shipping.',
				title: 'Spockify morning brief'
			});
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'spockify-world-brief.zip';
			a.click();
			URL.revokeObjectURL(url);
			status = 'Downloaded slides + audio pack';
		} catch (e) {
			status = `${e}`;
		}
	};

	const tabBadge = (id: TabId) => {
		if (id === 'dream') return dreamUnread;
		if (id === 'home') return homeUnread;
		return 0;
	};
</script>

<div class="flex flex-col gap-3 text-sm">
	<div>
		<div class="text-base font-medium mb-1">{$i18n.t('Lab')}</div>
		<div class="text-xs text-gray-500 dark:text-gray-400">
			{$i18n.t('Experiments & live tools')} — pick a tool below. Code editing lives in
			<a class="underline" href="/spockify/ghost">Ghost</a>.
		</div>
	</div>

	<div class="grid gap-2 sm:grid-cols-2">
		{#each TABS as t}
			{@const badge = tabBadge(t.id)}
			<button
				type="button"
				class="text-left rounded-lg border px-3 py-2 transition {tab === t.id
					? 'border-gray-500 bg-gray-100 dark:bg-gray-800'
					: 'border-gray-200 dark:border-gray-700 hover:border-gray-400'}"
				on:click={() => selectTab(t.id)}
			>
				<div class="flex items-center gap-2">
					<span class="text-sm opacity-70" aria-hidden="true">{t.icon}</span>
					<span class="font-medium text-xs">{t.label}</span>
					{#if badge > 0}
						<span
							class="ml-auto text-[10px] min-w-[1.1rem] text-center px-1 py-0.5 rounded-full bg-sky-500/20 text-sky-800 dark:text-sky-200"
						>
							{badge > 9 ? '9+' : badge}
						</span>
					{/if}
				</div>
				<p class="text-[11px] text-gray-500 dark:text-gray-400 mt-1 leading-snug">{t.blurb}</p>
			</button>
		{/each}
	</div>

	{#if status}
		<div class="text-xs text-sky-700 dark:text-sky-300">{status}</div>
	{/if}
	{#if error}
		<div class="text-xs text-red-600">{error}</div>
	{/if}
	{#if loading}
		<div class="py-4 flex justify-center"><Spinner /></div>
	{:else if tab === 'home'}
		<div class="flex flex-col gap-2">
			<p class="text-xs text-gray-500">
				{$i18n.t('Paste an image URL from a camera or doorbell feed. Summaries stay on your account.')}
			</p>
			<input
				class="w-full text-xs rounded border px-2 py-1 dark:bg-gray-900"
				placeholder="Image URL"
				bind:value={imageUrl}
			/>
			<button type="button" class="text-xs underline self-start" on:click={ingestUrl}
				>Ingest URL</button
			>
			{#if !homeEvents.length}
				<div
					class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3 space-y-1"
				>
					<p class="text-xs">{$i18n.t('No home events yet.')}</p>
					<button type="button" class="text-xs text-sky-700 dark:text-sky-400 underline" on:click={ingestUrl}
						>{$i18n.t('Ingest your first image URL')}</button
					>
				</div>
			{:else}
				{#each homeEvents as ev}
					<pre class="text-[11px] whitespace-pre-wrap border rounded p-2">{ev.summary}</pre>
				{/each}
			{/if}
		</div>
	{:else if tab === 'dream'}
		<p class="text-xs text-gray-500">
			{$i18n.t('Runs a pass over project notes and memory digests, then lists insights here.')}
		</p>
		<input
			class="w-full text-xs rounded border px-2 py-1 dark:bg-gray-900"
			placeholder="Focus (optional)"
			bind:value={dreamFocus}
		/>
		<button type="button" class="text-xs underline self-start" on:click={doDream}>Run dream</button>
		{#if !dreams.length}
			<div
				class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3 space-y-1"
			>
				<p class="text-xs">{$i18n.t('No dream runs yet.')}</p>
				<button type="button" class="text-xs text-sky-700 dark:text-sky-400 underline" on:click={doDream}
					>{$i18n.t('Run your first dream')}</button
				>
			</div>
		{:else}
			{#each dreams as d}
				<details class="border rounded text-xs">
					<summary class="px-2 py-1">{d.id} · {d.insights?.length || 0} insights</summary>
					<ul class="px-3 pb-2 list-disc">
						{#each d.insights || [] as tip}
							<li>{tip}</li>
						{/each}
					</ul>
				</details>
			{/each}
		{/if}
	{:else if tab === 'rooms'}
		<p class="text-xs text-gray-500">
			{$i18n.t('Create a room, invite others, chat with agents in the same thread.')}
		</p>
		<input
			class="w-full text-xs rounded border px-2 py-1 dark:bg-gray-900"
			bind:value={roomTitle}
		/>
		<button type="button" class="text-xs underline self-start" on:click={doRoom}>Create room</button>
		{#if activeRoom}
			<div class="text-[11px] text-gray-500">
				Room ready · invite code {activeRoom.invite_token || '—'}
			</div>
			<div class="max-h-40 overflow-auto border rounded p-2 text-[11px] space-y-1">
				{#each activeRoom.messages || [] as m}
					<div><b>{m.author_name || m.author_id || m.role}:</b> {m.text}</div>
				{/each}
			</div>
			<div class="flex gap-2">
				<input class="flex-1 text-xs rounded border px-2 py-1" bind:value={roomMsg} />
				<button type="button" class="text-xs underline" on:click={sendRoom}>Send</button>
			</div>
		{:else if !rooms.length}
			<div
				class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3"
			>
				<button type="button" class="text-xs text-sky-700 dark:text-sky-400 underline" on:click={doRoom}
					>{$i18n.t('Create your first room')}</button
				>
			</div>
		{/if}
		{#each rooms as r}
			<button
				type="button"
				class="text-left text-xs underline"
				on:click={() => (activeRoom = r)}>{r.title} · {r.id}</button
			>
		{/each}
	{:else if tab === 'voice'}
		<p class="text-xs text-gray-500">
			{$i18n.t('Notes wait quietly until you signal that you’re back.')}
		</p>
		<textarea
			class="w-full text-xs rounded border px-2 py-1 dark:bg-gray-900"
			rows="3"
			placeholder="Remind me when I'm back…"
			bind:value={voiceText}
		/>
		<div class="flex gap-3">
			<button type="button" class="text-xs underline" on:click={saveVoice}>Save note</button>
			<button type="button" class="text-xs underline" on:click={signalReturn}>I'm back</button>
		</div>
		{#if !dueNotes.length && !voiceText}
			<div class="text-xs text-gray-500">
				{$i18n.t('No notes due — save one above.')}
			</div>
		{/if}
		{#each dueNotes as n}
			<div class="text-xs border rounded p-2">{n.text}</div>
		{/each}
	{:else if tab === 'spectacle'}
		<p class="text-xs text-gray-500">
			{$i18n.t('Popcorn mode: models take turns arguing; cast your vote.')}
		</p>
		<input
			class="w-full text-xs rounded border px-2 py-1 dark:bg-gray-900"
			bind:value={debateTopic}
		/>
		<button type="button" class="text-xs underline self-start" on:click={startDebate}
			>Start debate</button
		>
		{#if activeDebate}
			<div class="text-[11px] text-gray-500">{activeDebate.judge?.summary}</div>
			{#each activeDebate.turns || [] as t}
				<div class="border rounded p-2 text-[11px]">
					<div class="font-medium">{t.model} · {t.stance} · r{t.round}</div>
					<div>{t.text}</div>
				</div>
			{/each}
			<div class="flex flex-wrap gap-2">
				{#each activeDebate.models || [] as m}
					<button type="button" class="text-xs underline" on:click={() => castVote(m)}
						>Vote {m} ({activeDebate.votes?.[m] || 0})</button
					>
				{/each}
			</div>
		{:else}
			<div
				class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-3"
			>
				<button type="button" class="text-xs text-sky-700 dark:text-sky-400 underline" on:click={startDebate}
					>{$i18n.t('Start your first debate')}</button
				>
			</div>
		{/if}
	{:else if tab === 'brief'}
		<p class="text-xs text-gray-500">
			{$i18n.t('Downloads a zip with slides.json and two-voice audio — play or mux locally.')}
		</p>
		<textarea
			class="w-full text-xs rounded border px-2 py-1 dark:bg-gray-900"
			rows="5"
			placeholder="Morning briefing text…"
			bind:value={briefText}
		/>
		<button type="button" class="text-xs underline self-start" on:click={doBrief}
			>Download brief pack</button
		>
	{/if}
</div>
