<script lang="ts">
	import { onMount, getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import { getSpockifyStatus, unloadOllamaForGpu } from '$lib/apis/spockify';

	const i18n = getContext('i18n');

	type LoadedModel = {
		name?: string;
		size_bytes?: number | null;
		size_vram_bytes?: number | null;
		expires_at?: string | null;
	};

	type GpuDevice = {
		name?: string;
		type?: string;
		vram_total_bytes?: number | null;
		vram_free_bytes?: number | null;
	};

	type StatusPayload = {
		ok?: boolean;
		checked_at?: string;
		ollama?: {
			up?: boolean;
			loaded_models?: LoadedModel[];
			loaded_count?: number;
			total_size_vram_bytes?: number;
			error?: string;
		};
		comfyui?: {
			up?: boolean;
			error?: string;
			devices?: GpuDevice[];
		};
		memory?: {
			ok?: boolean;
			total_bytes?: number | null;
			available_bytes?: number | null;
			used_bytes?: number | null;
			note?: string;
			error?: string;
		};
		gpu?: {
			source?: string | null;
			devices?: GpuDevice[];
			ollama_vram_bytes?: number;
			note?: string;
		};
		federation?: {
			mode?: string;
			peers?: {
				url?: string;
				ok?: boolean;
				up?: boolean;
				error?: string;
				latency_ms?: number | null;
				status_code?: number;
				probed_path?: string;
			}[];
			note?: string;
		};
		ops?: {
			disk?: {
				ok?: boolean;
				path?: string;
				total_bytes?: number;
				used_bytes?: number;
				free_bytes?: number;
				used_pct?: number | null;
				error?: string;
			};
			queue?: {
				depth?: number;
				active_in_memory?: number;
				durable_running?: number;
				durable_total?: number;
				runs_dir?: string;
			};
			load?: { ok?: boolean; load1?: number; load5?: number; load15?: number };
			hpa?: { note?: string; suggested_checks?: string[]; rolling_update?: any };
			storage_root?: string;
		};
		wave?: number;
	};

	let loading = true;
	let unloading = false;
	let status: StatusPayload | null = null;

	const formatBytes = (value?: number | null) => {
		if (value == null || Number.isNaN(value)) return '—';
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let n = Math.max(0, Number(value));
		let i = 0;
		while (n >= 1024 && i < units.length - 1) {
			n /= 1024;
			i += 1;
		}
		const digits = i === 0 ? 0 : n >= 10 ? 1 : 2;
		return `${n.toFixed(digits)} ${units[i]}`;
	};

	const refresh = async () => {
		loading = true;
		status = await getSpockifyStatus(localStorage.token).catch((error) => {
			toast.error(`${error}`);
			return null;
		});
		loading = false;
	};

	const unloadOllama = async () => {
		unloading = true;
		const res = await unloadOllamaForGpu(localStorage.token).catch((error) => {
			toast.error(`${error}`);
			return null;
		});
		unloading = false;
		if (res) {
			toast.success(res.message || $i18n.t('Ollama models unloaded'));
			await refresh();
		}
	};

	onMount(() => {
		refresh();
	});
</script>

<div class="flex flex-col h-full justify-between text-sm">
	<div class="space-y-4 overflow-y-scroll scrollbar-hidden h-full pb-4">
		<div class="flex items-start justify-between gap-3">
			<div>
				<div class="text-sm font-medium">{$i18n.t('Spockify status')}</div>
				<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
					{$i18n.t('Ollama loaded models, ComfyUI reachability, and free RAM/GPU on the cluster.')}
				</div>
			</div>
			<button
				class="px-3 py-1.5 text-xs rounded-lg bg-gray-100 hover:bg-gray-150 dark:bg-gray-850 dark:hover:bg-gray-800 transition"
				disabled={loading}
				on:click={refresh}
			>
				{$i18n.t('Refresh')}
			</button>
		</div>

		{#if loading && !status}
			<div class="flex justify-center py-10">
				<Spinner />
			</div>
		{:else if status}
			<div class="text-xs text-gray-500 dark:text-gray-400">
				{$i18n.t('Checked')}: {status.checked_at || '—'}
			</div>

			<section class="space-y-2">
				<div class="flex items-center gap-2">
					<div class="font-medium">{$i18n.t('Ollama')}</div>
					<span
						class="text-[11px] px-1.5 py-0.5 rounded {status.ollama?.up
							? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
							: 'bg-rose-500/15 text-rose-700 dark:text-rose-300'}"
					>
						{status.ollama?.up ? $i18n.t('Up') : $i18n.t('Down')}
					</span>
				</div>
				{#if status.ollama?.error}
					<div class="text-xs text-rose-600 dark:text-rose-400">{status.ollama.error}</div>
				{/if}
				{#if (status.ollama?.loaded_models || []).length === 0}
					<div class="text-xs text-gray-500 dark:text-gray-400">
						{$i18n.t('No models currently loaded.')}
					</div>
				{:else}
					<ul class="divide-y divide-gray-100 dark:divide-gray-850 rounded-lg border border-gray-100 dark:border-gray-850">
						{#each status.ollama?.loaded_models || [] as model}
							<li class="flex items-center justify-between gap-3 px-3 py-2">
								<div class="min-w-0 truncate font-mono text-xs">{model.name || '—'}</div>
								<div class="shrink-0 text-xs text-gray-500 dark:text-gray-400">
									VRAM {formatBytes(model.size_vram_bytes)}
								</div>
							</li>
						{/each}
					</ul>
					<div class="text-xs text-gray-500 dark:text-gray-400">
						{$i18n.t('Total Ollama VRAM')}: {formatBytes(status.ollama?.total_size_vram_bytes)}
					</div>
				{/if}
			</section>

			<section class="space-y-2">
				<div class="flex items-center gap-2">
					<div class="font-medium">{$i18n.t('ComfyUI')}</div>
					<span
						class="text-[11px] px-1.5 py-0.5 rounded {status.comfyui?.up
							? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
							: 'bg-rose-500/15 text-rose-700 dark:text-rose-300'}"
					>
						{status.comfyui?.up ? $i18n.t('Up') : $i18n.t('Down')}
					</span>
				</div>
				{#if status.comfyui?.error}
					<div class="text-xs text-rose-600 dark:text-rose-400">{status.comfyui.error}</div>
				{/if}
			</section>

			<section class="space-y-2">
				<div class="font-medium">{$i18n.t('Memory')}</div>
				{#if status.memory?.ok}
					<div class="grid grid-cols-3 gap-2 text-xs">
						<div>
							<div class="text-gray-500 dark:text-gray-400">{$i18n.t('Total')}</div>
							<div>{formatBytes(status.memory.total_bytes)}</div>
						</div>
						<div>
							<div class="text-gray-500 dark:text-gray-400">{$i18n.t('Used')}</div>
							<div>{formatBytes(status.memory.used_bytes)}</div>
						</div>
						<div>
							<div class="text-gray-500 dark:text-gray-400">{$i18n.t('Available')}</div>
							<div>{formatBytes(status.memory.available_bytes)}</div>
						</div>
					</div>
					{#if status.memory.note}
						<div class="text-[11px] text-gray-500 dark:text-gray-400">{status.memory.note}</div>
					{/if}
				{:else}
					<div class="text-xs text-rose-600 dark:text-rose-400">
						{status.memory?.error || $i18n.t('Unavailable')}
					</div>
				{/if}
			</section>

			<section class="space-y-2">
				<div class="font-medium">{$i18n.t('GPU')}</div>
				{#if (status.gpu?.devices || []).length > 0}
					<ul class="space-y-2">
						{#each status.gpu?.devices || [] as device}
							<li class="rounded-lg border border-gray-100 dark:border-gray-850 px-3 py-2 text-xs">
								<div class="font-medium">{device.name || device.type || 'GPU'}</div>
								<div class="mt-1 text-gray-500 dark:text-gray-400">
									{$i18n.t('Free')}: {formatBytes(device.vram_free_bytes)} /
									{formatBytes(device.vram_total_bytes)}
								</div>
							</li>
						{/each}
					</ul>
				{:else if status.gpu?.source === 'ollama_ps_vram'}
					<div class="text-xs text-gray-500 dark:text-gray-400">
						{$i18n.t('Ollama resident VRAM')}: {formatBytes(status.gpu.ollama_vram_bytes)}
					</div>
				{:else}
					<div class="text-xs text-gray-500 dark:text-gray-400">
						{$i18n.t('No GPU stats available from pods right now.')}
					</div>
				{/if}
				{#if status.gpu?.note}
					<div class="text-[11px] text-gray-500 dark:text-gray-400">{status.gpu.note}</div>
				{/if}
			</section>

			<section class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<div class="font-medium">{$i18n.t('Federation peers')}</div>
					<button
						type="button"
						class="px-2 py-1 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
						disabled={loading}
						on:click={refresh}
					>
						{$i18n.t('Ping peers')}
					</button>
				</div>
				{#if status.federation?.note}
					<div class="text-[11px] text-gray-500 dark:text-gray-400">{status.federation.note}</div>
				{/if}
				{#if (status.federation?.peers || []).length === 0}
					<div class="text-xs text-gray-500 dark:text-gray-400">
						{$i18n.t(
							'No peers configured (SPOCKIFY_FEDERATION_PEERS or FEDERATION_PEERS).'
						)}
					</div>
				{:else}
					<ul class="divide-y divide-gray-100 dark:divide-gray-850 rounded-lg border border-gray-100 dark:border-gray-850">
						{#each status.federation?.peers || [] as peer}
							<li class="flex items-center justify-between gap-3 px-3 py-2">
								<div class="min-w-0">
									<div class="truncate font-mono text-xs">{peer.url || '—'}</div>
									{#if peer.latency_ms != null || peer.probed_path}
										<div class="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
											{#if peer.latency_ms != null}{peer.latency_ms} ms{/if}
											{#if peer.probed_path}
												{' '}· {peer.probed_path}{/if}
											{#if peer.error}
												{' '}· {peer.error}{/if}
										</div>
									{:else if peer.error}
										<div class="mt-0.5 text-[10px] text-rose-600 dark:text-rose-400">
											{peer.error}
										</div>
									{/if}
								</div>
								<span
									class="text-[11px] px-1.5 py-0.5 rounded shrink-0 {peer.up
										? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
										: 'bg-rose-500/15 text-rose-700 dark:text-rose-300'}"
								>
									{peer.up ? $i18n.t('Up') : $i18n.t('Down')}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="space-y-2 pt-1">
				<div class="font-medium">{$i18n.t('Homelab ops')}</div>
				{#if status?.ops}
					<div class="text-xs space-y-1 text-gray-600 dark:text-gray-300">
						{#if status.ops.disk}
							<div>
								Disk ({status.ops.disk.path || status.ops.storage_root || 'STORAGE_ROOT'}):
								{formatBytes(status.ops.disk.used_bytes)} /
								{formatBytes(status.ops.disk.total_bytes)}
								{#if status.ops.disk.used_pct != null}
									({status.ops.disk.used_pct}%)
								{/if}
							</div>
						{/if}
						{#if status.ops.queue}
							<div>
								Agent queue depth: {status.ops.queue.depth ?? '—'}
								<span class="text-gray-500">
									(running {status.ops.queue.durable_running ?? 0} /
									{status.ops.queue.durable_total ?? 0} durable)
								</span>
							</div>
						{/if}
						{#if status.ops.load?.ok}
							<div>
								Load: {status.ops.load.load1?.toFixed?.(2)} /
								{status.ops.load.load5?.toFixed?.(2)} /
								{status.ops.load.load15?.toFixed?.(2)}
							</div>
						{/if}
						{#if status.ops.hpa?.note}
							<div class="text-[11px] text-gray-500">{status.ops.hpa.note}</div>
						{/if}
						{#if status.wave}
							<div class="text-[11px] text-gray-500">Wave {status.wave}</div>
						{/if}
					</div>
				{:else}
					<div class="text-xs text-gray-500">
						{$i18n.t('Ops metrics unavailable (router offline?).')}
					</div>
				{/if}
			</section>

			<section class="space-y-2 pt-1">
				<div class="font-medium">{$i18n.t('Free GPU for training')}</div>
				<div class="text-xs text-gray-500 dark:text-gray-400">
					{$i18n.t(
						'Unloads Ollama models (same as image-gen GPU prep). Does not scale ComfyUI down — use make free-gpu-for-training on the host for that.'
					)}
				</div>
				<button
					class="px-3 py-1.5 text-xs rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 hover:opacity-90 transition disabled:opacity-50"
					disabled={unloading || loading}
					on:click={unloadOllama}
				>
					{unloading ? $i18n.t('Unloading…') : $i18n.t('Unload Ollama models')}
				</button>
			</section>
		{:else}
			<div class="text-xs text-rose-600 dark:text-rose-400">
				{$i18n.t('Could not load Spockify status.')}
			</div>
		{/if}
	</div>
</div>
