<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { getCalendarEvents } from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	type CalEvent = {
		title?: string;
		when?: string;
		end?: string;
		start_at?: string;
		end_at?: string;
		location?: string;
		uid?: string;
		source?: string;
		note?: string;
	};

	type ViewMode = 'list' | 'month' | 'week';

	let loading = true;
	let events: CalEvent[] = [];
	let configured = false;
	let enabled = false;
	let note = '';
	let error = '';
	let view: ViewMode = 'list';
	let cursor = new Date();
	/** Day selected in month/week grid — drives the detail list below. */
	let selectedDay: Date | null = null;

	const startOfDay = (d: Date) => {
		const x = new Date(d);
		x.setHours(0, 0, 0, 0);
		return x;
	};

	const addDays = (d: Date, n: number) => {
		const x = new Date(d);
		x.setDate(x.getDate() + n);
		return x;
	};

	const startOfWeek = (d: Date) => {
		const x = startOfDay(d);
		const day = x.getDay(); // 0 Sun
		const diff = day === 0 ? -6 : 1 - day; // Monday start
		return addDays(x, diff);
	};

	const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

	const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

	const rangeForView = (): { start: Date; end: Date } => {
		if (view === 'week') {
			const s = startOfWeek(cursor);
			return { start: s, end: addDays(s, 7) };
		}
		if (view === 'month') {
			const s = startOfMonth(cursor);
			const gridStart = startOfWeek(s);
			return { start: gridStart, end: addDays(gridStart, 42) };
		}
		// list focused on a selected day
		if (selectedDay) {
			const s = startOfDay(selectedDay);
			return { start: s, end: addDays(s, 1) };
		}
		// list: from yesterday through ~8 weeks
		const s = addDays(startOfDay(new Date()), -1);
		return { start: s, end: addDays(s, 56) };
	};

	const eventStart = (e: CalEvent): Date | null => {
		if (e.start_at) {
			const d = new Date(e.start_at);
			return Number.isNaN(d.getTime()) ? null : d;
		}
		if (e.when) {
			const raw = e.when;
			if (/^\d{8}$/.test(raw)) {
				return new Date(
					Number(raw.slice(0, 4)),
					Number(raw.slice(4, 6)) - 1,
					Number(raw.slice(6, 8))
				);
			}
			if (/^\d{8}T\d{6}/.test(raw)) {
				const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}${raw.endsWith('Z') ? 'Z' : ''}`;
				const d = new Date(iso);
				return Number.isNaN(d.getTime()) ? null : d;
			}
		}
		return null;
	};

	const isAllDay = (e: CalEvent) => !!(e.when && !String(e.when).includes('T'));

	const formatWhen = (e: CalEvent) => {
		const d = eventStart(e);
		if (!d) return e.when || '';
		return isAllDay(e)
			? d.toLocaleDateString(undefined, {
					weekday: 'short',
					month: 'short',
					day: 'numeric'
				})
			: d.toLocaleString(undefined, {
					weekday: 'short',
					month: 'short',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				});
	};

	/** Compact time for week-view cards (title + time + location). */
	const formatTimeShort = (e: CalEvent) => {
		const d = eventStart(e);
		if (!d) return e.when || '';
		if (isAllDay(e)) return $i18n.t('All day');
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	};

	/** Soften legacy API error strings so empty calendars don't feel broken. */
	const softStatus = (msg: string) => {
		if (/no VEVENT|empty feed|empty or unreadable/i.test(msg)) {
			return $i18n.t('No events in this calendar yet');
		}
		return msg;
	};

	const sameDay = (a: Date, b: Date) =>
		a.getFullYear() == b.getFullYear() &&
		a.getMonth() == b.getMonth() &&
		a.getDate() == b.getDate();

	const eventsOnDay = (day: Date) =>
		events.filter((e) => {
			const s = eventStart(e);
			return s && sameDay(s, day);
		});

	const monthCells = (): Date[] => {
		const { start } = rangeForView();
		return Array.from({ length: 42 }, (_, i) => addDays(start, i));
	};

	const weekDays = (): Date[] => {
		const { start } = rangeForView();
		return Array.from({ length: 7 }, (_, i) => addDays(start, i));
	};

	const heading = () => {
		if (view === 'week') {
			const days = weekDays();
			const a = days[0];
			const b = days[6];
			return `${a.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
		}
		return cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
	};

	const shift = (dir: number) => {
		if (view === 'week') cursor = addDays(cursor, dir * 7);
		else if (view === 'month')
			cursor = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1);
		else cursor = addDays(cursor, dir * 14);
		load();
	};

	const setView = (v: ViewMode) => {
		view = v;
		if (v === 'list') selectedDay = null;
		load();
	};

	const selectDay = (day: Date) => {
		selectedDay = startOfDay(day);
	};

	const openSelectedInList = () => {
		if (!selectedDay) return;
		// Keep selectedDay so list view focuses on that date.
		view = 'list';
		load();
	};

	const load = async () => {
		loading = true;
		error = '';
		note = '';
		try {
			const { start, end } = rangeForView();
			const res = await getCalendarEvents(localStorage.token, {
				start: start.toISOString(),
				end: end.toISOString(),
				limit: 300
			});
			events = res?.events || [];
			configured = !!res?.configured;
			enabled = !!res?.enabled;
			note = res?.note || '';
			if (res?.error) error = res.error;
			if (res?.ok === false && res?.error) error = res.error;
		} catch (e) {
			toast.error(`${e}`);
			error = `${e}`;
		}
		loading = false;
	};

	onMount(load);

	$: upcoming = events
		.map((e) => ({ e, t: eventStart(e) }))
		.filter((x) => x.t && x.t >= addDays(startOfDay(new Date()), -1))
		.sort((a, b) => (a.t!.getTime() || 0) - (b.t!.getTime() || 0));

	$: selectedDayEvents = selectedDay ? eventsOnDay(selectedDay) : [];

	$: listEvents =
		view === 'list' && selectedDay
			? selectedDayEvents
					.map((e) => ({ e, t: eventStart(e) }))
					.filter((x): x is { e: CalEvent; t: Date } => !!x.t)
					.sort((a, b) => a.t.getTime() - b.t.getTime())
			: upcoming;</script>

<div class="flex flex-col gap-3 text-sm max-w-4xl">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<div>
			<div class="text-lg font-medium">{$i18n.t('Calendar')}</div>
			<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
				{$i18n.t('Your ICS feed from Connectors — private to your account.')}
			</p>
		</div>
		<div class="flex flex-wrap gap-1">
			{#each ['list', 'week', 'month'] as v}
				<button
					type="button"
					class="px-2.5 py-1 text-xs rounded-lg border {view === v
						? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 border-transparent'
						: 'border-gray-200 dark:border-gray-700'}"
					on:click={() => setView(/** @type {ViewMode} */ (v))}
				>
					{$i18n.t(v === 'list' ? 'List' : v === 'week' ? 'Week' : 'Month')}
				</button>
			{/each}
			<button
				type="button"
				class="px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700"
				on:click={load}
			>
				{$i18n.t('Refresh')}
			</button>
		</div>
	</div>

	{#if view !== 'list'}
		<div class="flex items-center justify-between gap-2">
			<button
				type="button"
				class="px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700"
				on:click={() => shift(-1)}>←</button
			>
			<div class="text-sm font-medium">{heading()}</div>
			<button
				type="button"
				class="px-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700"
				on:click={() => shift(1)}>→</button
			>
		</div>
	{/if}

	{#if loading}
		<div class="py-8 flex justify-center"><Spinner /></div>
	{:else if !configured}
		<div
			class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4 space-y-2"
		>
			<p class="text-sm">
				{$i18n.t('No calendar connected yet.')}
			</p>
			<p class="text-xs text-gray-500 dark:text-gray-400">
				{$i18n.t(
					'Paste your calendar’s ICS URL under Connectors (Settings → Your connectors). Saved privately to your account.'
				)}
			</p>
			<a
				href="/spockify/connectors"
				class="inline-block text-xs text-sky-700 dark:text-sky-400 hover:underline"
			>
				{$i18n.t('Open Connectors')}
			</a>
		</div>
	{:else if !enabled}
		<div class="text-xs text-amber-700 dark:text-amber-300">
			{$i18n.t('Calendar connector is disabled — enable it in Connectors.')}
			<a class="underline ml-1" href="/spockify/connectors">{$i18n.t('Connectors')}</a>
		</div>
	{:else}
		{#if error}
			<div
				class="text-xs rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 px-3 py-2"
			>
				{softStatus(error)}
			</div>
		{:else if note || !events.length}
			<div class="text-xs text-gray-500 dark:text-gray-400">
				{softStatus(note || $i18n.t('No events in this calendar yet'))}
			</div>
		{/if}

		{#if view === 'list'}
			{#if selectedDay}
				<div class="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
					<span>
						{$i18n.t('Events for')}
						{selectedDay.toLocaleDateString(undefined, {
							weekday: 'long',
							month: 'short',
							day: 'numeric'
						})}
					</span>
					<button
						type="button"
						class="underline hover:text-gray-800 dark:hover:text-gray-200"
						on:click={() => {
							selectedDay = null;
							load();
						}}
					>
						{$i18n.t('Show all')}
					</button>
				</div>
			{/if}
			{#if !listEvents.length}
				{#if selectedDay}
					<div class="text-xs text-gray-500">{$i18n.t('No events on this day.')}</div>
				{/if}
			{:else}
				<ul class="divide-y divide-gray-100 dark:divide-gray-800">
					{#each listEvents as row}
						<li class="py-2.5 flex flex-col gap-0.5">
							<div class="font-medium text-sm">{row.e.title || $i18n.t('Event')}</div>
							<div class="text-xs text-gray-500 dark:text-gray-400">{formatWhen(row.e)}</div>
							{#if row.e.location}
								<div class="text-[11px] text-gray-400">{row.e.location}</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else if view === 'week'}
			<div class="grid grid-cols-1 sm:grid-cols-7 gap-2">
				{#each weekDays() as day}
					<button
						type="button"
						class="min-h-[12rem] sm:min-h-[14rem] rounded-lg border p-2.5 text-left transition flex flex-col gap-1.5
							{selectedDay && sameDay(day, selectedDay)
								? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-400/50'
								: sameDay(day, new Date())
									? 'border-gray-100 dark:border-gray-800 bg-sky-50/60 dark:bg-sky-950/30'
									: 'border-gray-100 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-600'}"
						on:click={() => selectDay(day)}
					>
						<div class="text-xs font-medium text-gray-600 dark:text-gray-300 shrink-0">
							{day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
						</div>
						<div class="flex flex-col gap-1.5 flex-1 min-h-0">
							{#each eventsOnDay(day) as e}
								<div
									class="rounded-md px-2 py-1.5 bg-gray-100 dark:bg-gray-800/90 space-y-0.5"
									title={[e.title, formatTimeShort(e), e.location].filter(Boolean).join(' · ')}
								>
									<div class="text-xs font-medium leading-snug line-clamp-2">
										{e.title || $i18n.t('Event')}
									</div>
									<div class="text-[11px] text-gray-500 dark:text-gray-400">
										{formatTimeShort(e)}
									</div>
									{#if e.location}
										<div class="text-[11px] text-gray-400 line-clamp-2">{e.location}</div>
									{/if}
								</div>
							{/each}
						</div>
					</button>
				{/each}
			</div>
		{:else}
			<div class="grid grid-cols-7 gap-1 text-[11px]">
				{#each ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as wd}
					<div class="text-center text-gray-400 py-1">{wd}</div>
				{/each}
				{#each monthCells() as day}
					{@const inMonth = day.getMonth() === cursor.getMonth()}
					{@const isSelected = selectedDay && sameDay(day, selectedDay)}
					<button
						type="button"
						class="min-h-[4.5rem] rounded border p-1 text-left transition
							{inMonth ? '' : 'opacity-40'}
							{isSelected
								? 'border-sky-500 bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-400/50'
								: sameDay(day, new Date())
									? 'border-gray-100 dark:border-gray-800 ring-1 ring-sky-400/60'
									: 'border-gray-100 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-600'}"
						on:click={() => selectDay(day)}
					>
						<div
							class="mb-0.5 {isSelected
								? 'font-semibold text-sky-700 dark:text-sky-300'
								: 'text-gray-500'}"
						>
							{day.getDate()}
						</div>
						{#each eventsOnDay(day).slice(0, 3) as e}
							<div class="truncate text-[10px] leading-tight" title={e.title}>{e.title}</div>
						{/each}
						{#if eventsOnDay(day).length > 3}
							<div class="text-[10px] text-gray-400">+{eventsOnDay(day).length - 3}</div>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	{/if}

	{#if (view === 'month' || view === 'week') && selectedDay}
		<div
			class="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-2"
		>
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="text-sm font-medium">
					{selectedDay.toLocaleDateString(undefined, {
						weekday: 'long',
						month: 'long',
						day: 'numeric',
						year: 'numeric'
					})}
				</div>
				<div class="flex gap-2">
					<button
						type="button"
						class="text-xs text-sky-700 dark:text-sky-400 hover:underline"
						on:click={openSelectedInList}
					>
						{$i18n.t('Open in List')}
					</button>
					<button
						type="button"
						class="text-xs text-gray-500 hover:underline"
						on:click={() => {
							selectedDay = null;
						}}
					>
						{$i18n.t('Clear')}
					</button>
				</div>
			</div>
			{#if !selectedDayEvents.length}
				<div class="text-xs text-gray-500">{$i18n.t('No events on this day.')}</div>
			{:else}
				<ul class="divide-y divide-gray-100 dark:divide-gray-800">
					{#each selectedDayEvents as e}
						<li class="py-2 flex flex-col gap-0.5">
							<div class="font-medium text-sm">{e.title || $i18n.t('Event')}</div>
							<div class="text-xs text-gray-500 dark:text-gray-400">{formatWhen(e)}</div>
							{#if e.location}
								<div class="text-[11px] text-gray-400">{e.location}</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
