<script lang="ts">
	import { getContext, onMount, tick } from 'svelte';
	import { fly } from 'svelte/transition';

	import {
		config,
		user,
		tools as _tools,
		skills as _skills,
		mobile,
		settings,
		toolServers,
		terminalServers
	} from '$lib/stores';

	import { getOAuthClientAuthorizationUrl } from '$lib/apis/configs';
	import { deleteOAuthSession } from '$lib/apis/auths';
	import { getTools } from '$lib/apis/tools';
	import { getSkills } from '$lib/apis/skills';

	import { toast } from 'svelte-sonner';
	import { WEBUI_API_BASE_URL } from '$lib/constants';

	import Knobs from '$lib/components/icons/Knobs.svelte';
	import Dropdown from '$lib/components/common/Dropdown.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Switch from '$lib/components/common/Switch.svelte';
	import Spinner from '$lib/components/common/Spinner.svelte';
	import Wrench from '$lib/components/icons/Wrench.svelte';
	import Keyframes from '$lib/components/icons/Keyframes.svelte';
	import Sparkles from '$lib/components/icons/Sparkles.svelte';
	import GlobeAlt from '$lib/components/icons/GlobeAlt.svelte';
	import Photo from '$lib/components/icons/Photo.svelte';
	import Document from '$lib/components/icons/Document.svelte';
	import Terminal from '$lib/components/icons/Terminal.svelte';
	import ChevronRight from '$lib/components/icons/ChevronRight.svelte';
	import ChevronLeft from '$lib/components/icons/ChevronLeft.svelte';
	import LinkSlash from '$lib/components/icons/LinkSlash.svelte';

	const i18n = getContext('i18n');

	export let selectedToolIds: string[] = [];
	export let selectedSkillIds: string[] = [];

	export let selectedModels: string[] = [];
	export let fileUploadCapableModels: string[] = [];

	export let toggleFilters: { id: string; name: string; description?: string; icon?: string }[] =
		[];
	export let selectedFilterIds: string[] = [];

	export let showWebSearchButton = false;
	export let webSearchEnabled = false;
	export let showImageGenerationButton = false;
	export let imageGenerationEnabled = false;
	export let showVideoGenerationButton = false;
	export let videoGenerationEnabled = false;
	export let showCartoonGenerationButton = false;
	export let cartoonGenerationEnabled = false;
	export let cartoonSceneBrief = '';
	export let cartoonShotCount = 3;
	export let cartoonProfile: 'draft' | 'final' = 'draft';
	export let cartoonCharacterClass: 'cel_human' | 'nonhuman' = 'cel_human';

	let cartoonBusy = false;
	let cartoonScene: {
		scene_id: string;
		project_id: string;
		profile: string;
		run_state?: string;
		shots: {
			id: string;
			order: number;
			prompt: string;
			transition_after: string | null;
			approval: string;
			dialogue?: string;
			video_id?: string | null;
			stages: { state: string; kind: string }[];
		}[];
	} | null = null;

	async function cartoonDirector(path: string, payload?: Record<string, unknown>) {
		const token = localStorage.token;
		const res = await fetch(`${WEBUI_API_BASE_URL}/cartoon${path}`, {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
				...(token && { authorization: `Bearer ${token}` })
			},
			body: JSON.stringify(payload ?? {})
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) {
			const detail = typeof data?.detail === 'string' ? data.detail : 'Cartoon director request failed';
			throw new Error(detail);
		}
		cartoonScene = data;
		if (data?.project_id) {
			sessionStorage.setItem('spockifyCartoonProjectId', data.project_id);
		}
		return data;
	}

	async function saveCartoonPlan() {
		cartoonBusy = true;
		try {
			const key = `plan:${cartoonShotCount}:${cartoonProfile}:${cartoonCharacterClass}:${cartoonSceneBrief}`.slice(0, 180);
			await cartoonDirector('/plan', {
				brief: cartoonSceneBrief,
				shot_count: Number(cartoonShotCount),
				profile: cartoonProfile,
				character_class: cartoonCharacterClass,
				idempotency_key: key,
				project_id: sessionStorage.getItem('spockifyCartoonProjectId'),
				title: 'Scene'
			});
			toast.success('Shot plan saved');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Shot plan failed');
		} finally {
			cartoonBusy = false;
		}
	}

	async function saveCartoonShot(shot: { id: string; prompt: string; transition_after: string | null }) {
		cartoonBusy = true;
		try {
			await cartoonDirector(`/shots/${shot.id}`, {
				prompt: shot.prompt,
				transition_after: shot.transition_after,
				dialogue: shot.dialogue || ''
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Shot save failed');
		} finally {
			cartoonBusy = false;
		}
	}

	async function approveCartoonShot(shotId: string) {
		cartoonBusy = true;
		try {
			await cartoonDirector(`/shots/${shotId}/approve`, {});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Approve failed');
		} finally {
			cartoonBusy = false;
		}
	}

	async function regenCartoonShot(shotId: string) {
		cartoonBusy = true;
		try {
			await cartoonDirector(`/shots/${shotId}/regen`, { seconds: 2 });
			toast.success('Shot queued for rerender');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Regen failed');
		} finally {
			cartoonBusy = false;
		}
	}

	async function renderCartoonScene() {
		if (!cartoonScene) return;
		cartoonBusy = true;
		try {
			await cartoonDirector(`/scenes/${cartoonScene.scene_id}/render`, {
				seconds: 2,
				lip_sync: true
			});
			toast.success('Director queued a video job');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Render failed');
		} finally {
			cartoonBusy = false;
		}
	}

	async function applyCartoonProfile() {
		if (!cartoonScene) return;
		cartoonBusy = true;
		try {
			await cartoonDirector(`/scenes/${cartoonScene.scene_id}/profile`, { profile: cartoonProfile });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Profile update failed');
		} finally {
			cartoonBusy = false;
		}
	}
	export let showCanvasButton = true;
	export let canvasEnabled = false;
	export let showCodeInterpreterButton = false;
	export let codeInterpreterEnabled = false;

	export let onShowValves: Function;
	export let onClose: Function;
	export let closeOnOutsideClick = true;

	let show = false;
	let tab = '';

	let tools = null;
	let skills = null;

	$: if (show) {
		init();
	}

	let fileUploadEnabled = true;
	$: fileUploadEnabled =
		fileUploadCapableModels.length === selectedModels.length &&
		($user?.role === 'admin' || $user?.permissions?.chat?.file_upload);

	const init = async () => {
		if ($_tools === null) {
			await _tools.set(await getTools(localStorage.token));
		}

		if ($_tools) {
			tools = $_tools.reduce((a, tool, i, arr) => {
				a[tool.id] = {
					name: tool.name,
					description: tool.meta.description,
					enabled: selectedToolIds.includes(tool.id),
					...tool
				};
				return a;
			}, {});
		}

		if ($toolServers) {
			for (const serverIdx in $toolServers) {
				const server = $toolServers[serverIdx];
				if (server.info) {
					tools[`direct_server:${serverIdx}`] = {
						name: server?.info?.title ?? server.url,
						description: server.info.description ?? '',
						enabled: selectedToolIds.includes(`direct_server:${serverIdx}`)
					};
				}
			}
		}

		selectedToolIds = selectedToolIds.filter((id) => Object.keys(tools).includes(id));

		if ($_skills === null) {
			await _skills.set(await getSkills(localStorage.token));
		}

		if ($_skills) {
			skills = $_skills
				.filter((skill) => skill.is_active)
				.reduce((a, skill) => {
					a[skill.id] = {
						name: skill.name,
						description: skill.description,
						enabled: selectedSkillIds.includes(skill.id),
						...skill
					};
					return a;
				}, {});
		}

		selectedSkillIds = selectedSkillIds.filter((id) => Object.keys(skills ?? {}).includes(id));
	};
</script>

<Dropdown
	bind:show
	onOpenChange={(state) => {
		if (state === false) {
			onClose();
		}
	}}
>
	<Tooltip content={$i18n.t('Integrations')} placement="top">
		<slot />
	</Tooltip>
	<div slot="content">
		<div
			class="min-w-70 max-w-70 rounded-2xl px-1 py-1 border border-gray-100 dark:border-gray-800 z-50 bg-white dark:bg-gray-850 dark:text-white shadow-lg max-h-72 overflow-y-auto overflow-x-hidden scrollbar-thin"
		>
			{#if tab === ''}
				<div in:fly={{ x: -20, duration: 150 }}>
					{#if tools}
						{#if Object.keys(tools).length > 0}
							<button
								class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
								on:click={() => {
									tab = 'tools';
								}}
							>
								<Wrench />

								<div class="flex items-center w-full justify-between">
									<div class=" line-clamp-1">
										{$i18n.t('Tools')}
										<span class="ml-0.5 text-gray-500">{Object.keys(tools).length}</span>
									</div>

									<div class="text-gray-500">
										<ChevronRight />
									</div>
								</div>
							</button>
						{/if}

						{#if skills && Object.keys(skills).length > 0}
							<button
								class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
								on:click={() => {
									tab = 'skills';
								}}
							>
								<Keyframes className="size-4" strokeWidth="1.75" />

								<div class="flex items-center w-full justify-between">
									<div class=" line-clamp-1">
										{$i18n.t('Skills')}
										<span class="ml-0.5 text-gray-500">{Object.keys(skills).length}</span>
									</div>

									<div class="text-gray-500">
										<ChevronRight />
									</div>
								</div>
							</button>
						{/if}
					{:else}
						<div class="py-4">
							<Spinner />
						</div>
					{/if}

					{#if toggleFilters && toggleFilters.length > 0}
						{#each toggleFilters.sort( (a, b) => a.name.localeCompare( b.name, undefined, { sensitivity: 'base' } ) ) as filter, filterIdx (filter.id)}
							<Tooltip content={filter?.description} placement="top-start">
								<button
									class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
									on:click={() => {
										if (selectedFilterIds.includes(filter.id)) {
											selectedFilterIds = selectedFilterIds.filter((id) => id !== filter.id);
										} else {
											selectedFilterIds = [...selectedFilterIds, filter.id];
										}
									}}
								>
									<div class="flex-1 truncate">
										<div class="flex flex-1 gap-2 items-center">
											<div class="shrink-0">
												{#if filter?.icon}
													<div class="size-4 items-center flex justify-center">
														<img
															src={filter.icon}
															class="size-3.5 {filter.icon.includes('data:image/svg')
																? 'dark:invert-[80%]'
																: ''}"
															style="fill: currentColor;"
															alt={filter.name}
														/>
													</div>
												{:else}
													<Sparkles className="size-4" strokeWidth="1.75" />
												{/if}
											</div>

											<div class=" truncate">{filter?.name}</div>
										</div>
									</div>

									{#if filter?.has_user_valves && ($user?.role === 'admin' || ($user?.permissions?.chat?.valves ?? true))}
										<div class=" shrink-0">
											<Tooltip content={$i18n.t('Valves')}>
												<button
													class="self-center w-fit text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition rounded-full"
													type="button"
													on:click={(e) => {
														e.stopPropagation();
														e.preventDefault();
														onShowValves({
															type: 'function',
															id: filter.id
														});
													}}
												>
													<Knobs />
												</button>
											</Tooltip>
										</div>
									{/if}

									<div class=" shrink-0">
										<Switch
											state={selectedFilterIds.includes(filter.id)}
											on:change={async (e) => {
												const state = e.detail;
												await tick();
											}}
										/>
									</div>
								</button>
							</Tooltip>
						{/each}
					{/if}

					{#if showWebSearchButton}
						<Tooltip content={$i18n.t('Search the internet')} placement="top-start">
							<button
								class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
								on:click={() => {
									webSearchEnabled = !webSearchEnabled;
								}}
							>
								<div class="flex-1 truncate">
									<div class="flex flex-1 gap-2 items-center">
										<div class="shrink-0">
											<GlobeAlt />
										</div>

										<div class=" truncate">{$i18n.t('Web Search')}</div>
									</div>
								</div>

								<div class=" shrink-0">
									<Switch
										state={webSearchEnabled}
										on:change={async (e) => {
											const state = e.detail;
											await tick();
										}}
									/>
								</div>
							</button>
						</Tooltip>
					{/if}

					{#if showImageGenerationButton}
						<Tooltip content={$i18n.t('Generate an image')} placement="top-start">
							<button
								class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
								on:click={() => {
									imageGenerationEnabled = !imageGenerationEnabled;
									if (imageGenerationEnabled) {
										videoGenerationEnabled = false;
										cartoonGenerationEnabled = false;
									}
								}}
							>
								<div class="flex-1 truncate">
									<div class="flex flex-1 gap-2 items-center">
										<div class="shrink-0">
											<Photo className="size-4" strokeWidth="1.5" />
										</div>

										<div class=" truncate">{$i18n.t('Image')}</div>
									</div>
								</div>

								<div class=" shrink-0">
									<Switch
										state={imageGenerationEnabled}
										on:change={async (e) => {
											const state = e.detail;
											await tick();
										}}
									/>
								</div>
							</button>
						</Tooltip>
					{/if}

					{#if showVideoGenerationButton}
						<Tooltip content="Generate a video (LTX)" placement="top-start">
							<button
								class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
								on:click={() => {
									videoGenerationEnabled = !videoGenerationEnabled;
									if (videoGenerationEnabled) {
										imageGenerationEnabled = false;
										cartoonGenerationEnabled = false;
									}
								}}
							>
								<div class="flex-1 truncate">
									<div class="flex flex-1 gap-2 items-center">
										<div class="shrink-0">
											<Keyframes className="size-4" strokeWidth="1.5" />
										</div>

										<div class=" truncate">Video</div>
									</div>
								</div>

								<div class=" shrink-0">
									<Switch
										state={videoGenerationEnabled}
										on:change={async (e) => {
											const state = e.detail;
											await tick();
										}}
									/>
								</div>
							</button>
						</Tooltip>
					{/if}

					{#if showCartoonGenerationButton}
						<Tooltip
							content="Cartoon: Qwen sprite grid → slice → Wan FLF"
							placement="top-start"
						>
							<button
								class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
								on:click={() => {
									cartoonGenerationEnabled = !cartoonGenerationEnabled;
									if (cartoonGenerationEnabled) {
										imageGenerationEnabled = false;
										videoGenerationEnabled = false;
									}
								}}
							>
								<div class="flex-1 truncate">
									<div class="flex flex-1 gap-2 items-center">
										<div class="shrink-0">
											<Sparkles className="size-4" strokeWidth="1.5" />
										</div>

										<div class=" truncate">Cartoon</div>
									</div>
								</div>

								<div class=" shrink-0">
									<Switch
										state={cartoonGenerationEnabled}
										on:change={async (e) => {
											const state = e.detail;
											await tick();
										}}
									/>
								</div>
							</button>
						</Tooltip>
						{#if cartoonGenerationEnabled}
							<div
								class="mx-2 mb-2 space-y-2 rounded-xl border border-gray-200 px-2 py-2 text-xs dark:border-gray-700"
								on:click|stopPropagation
							>
								<label class="block">
									<div class="pb-1 text-gray-500">Scene brief</div>
									<textarea
										bind:value={cartoonSceneBrief}
										rows="3"
										class="w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-700"
									></textarea>
								</label>
								<div class="flex gap-2">
									<label class="flex-1">
										<div class="pb-1 text-gray-500">Shots</div>
										<select
											bind:value={cartoonShotCount}
											class="w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-700"
										>
											<option value={1}>1</option>
											<option value={2}>2</option>
											<option value={3}>3</option>
											<option value={4}>4</option>
										</select>
									</label>
									<label class="flex-1">
										<div class="pb-1 text-gray-500">Profile</div>
										<select
											bind:value={cartoonProfile}
											class="w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-700"
										>
											<option value="draft">Draft</option>
											<option value="final">Final</option>
										</select>
									</label>
								</div>
								<label class="block">
									<div class="pb-1 text-gray-500">Mouth</div>
									<select
										bind:value={cartoonCharacterClass}
										class="w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-700"
									>
										<option value="cel_human">Simple human-mouth (default)</option>
										<option value="nonhuman">Nonhuman, narration only</option>
									</select>
								</label>
								<p class="text-gray-500">
									Hobby / family cartoons only. No time estimate. Lip sync is
									wired, not a quality pass. Not commercial.
								</p>
								<button
									type="button"
									class="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-gray-600"
									disabled={cartoonBusy || !cartoonSceneBrief.trim()}
									on:click|stopPropagation={saveCartoonPlan}
								>
									Save shot plan
								</button>
								{#if cartoonScene}
									<div class="text-gray-500">
										{cartoonScene.run_state} · {cartoonScene.profile}
									</div>
									{#each cartoonScene.shots as shot}
										<div class="space-y-1 border-t border-gray-200 pt-2 dark:border-gray-700">
											<div>
												Shot {shot.order} · {shot.approval} · {shot.stages?.[shot.stages.length - 1]?.state}
												{#if shot.transition_after}
													· {shot.transition_after}
												{/if}
												{#if shot.video_id}
													· {shot.video_id}
												{/if}
											</div>
											<textarea
												bind:value={shot.prompt}
												rows="2"
												class="w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-700"
											></textarea>
											<textarea
												bind:value={shot.dialogue}
												rows="1"
												placeholder="Optional spoken line"
												class="w-full rounded-lg border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-700"
											></textarea>
											<div class="flex gap-1">
												<button
													type="button"
													class="rounded-lg border border-gray-300 px-2 py-1 disabled:opacity-50 dark:border-gray-600"
													disabled={cartoonBusy || shot.approval === 'approved'}
													on:click|stopPropagation={() => saveCartoonShot(shot)}
												>
													Save
												</button>
												<button
													type="button"
													class="rounded-lg border border-gray-300 px-2 py-1 disabled:opacity-50 dark:border-gray-600"
													disabled={cartoonBusy}
													on:click|stopPropagation={() => approveCartoonShot(shot.id)}
												>
													Approve
												</button>
												<button
													type="button"
													class="rounded-lg border border-gray-300 px-2 py-1 disabled:opacity-50 dark:border-gray-600"
													disabled={cartoonBusy}
													on:click|stopPropagation={() => regenCartoonShot(shot.id)}
												>
													Regen
												</button>
											</div>
										</div>
									{/each}
									<button
										type="button"
										class="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-gray-600"
										disabled={cartoonBusy}
										on:click|stopPropagation={renderCartoonScene}
									>
										Render pending shots
									</button>
									<button
										type="button"
										class="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-gray-600"
										disabled={cartoonBusy}
										on:click|stopPropagation={applyCartoonProfile}
									>
										Apply {cartoonProfile} profile
									</button>
								{/if}
							</div>
						{/if}
					{/if}

					{#if showCanvasButton}
						<Tooltip
							content="Open long docs/code in the Canvas side panel"
							placement="top-start"
						>
							<button
								class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
								on:click={() => {
									canvasEnabled = !canvasEnabled;
								}}
							>
								<div class="flex-1 truncate">
									<div class="flex flex-1 gap-2 items-center">
										<div class="shrink-0">
											<Document className="size-4" strokeWidth="1.5" />
										</div>

										<div class=" truncate">Canvas</div>
									</div>
								</div>

								<div class=" shrink-0">
									<Switch
										state={canvasEnabled}
										on:change={async (e) => {
											const state = e.detail;
											await tick();
										}}
									/>
								</div>
							</button>
						</Tooltip>
					{/if}

					{#if showCodeInterpreterButton}
						<Tooltip content={$i18n.t('Execute code for analysis')} placement="top-start">
							<button
								class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
								aria-pressed={codeInterpreterEnabled}
								aria-label={codeInterpreterEnabled
									? $i18n.t('Disable Code Interpreter')
									: $i18n.t('Enable Code Interpreter')}
								on:click={() => {
									codeInterpreterEnabled = !codeInterpreterEnabled;
								}}
							>
								<div class="flex-1 truncate">
									<div class="flex flex-1 gap-2 items-center">
										<div class="shrink-0">
											<Terminal className="size-3.5" strokeWidth="1.75" />
										</div>

										<div class=" truncate">{$i18n.t('Code Interpreter')}</div>
									</div>
								</div>

								<div class=" shrink-0">
									<Switch
										state={codeInterpreterEnabled}
										on:change={async (e) => {
											const state = e.detail;
											await tick();
										}}
									/>
								</div>
							</button>
						</Tooltip>
					{/if}
				</div>
			{:else if tab === 'tools' && tools}
				<div in:fly={{ x: 20, duration: 150 }}>
					<button
						class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
						on:click={() => {
							tab = '';
						}}
					>
						<ChevronLeft />

						<div class="flex items-center w-full justify-between">
							<div>
								{$i18n.t('Tools')}
								<span class="ml-0.5 text-gray-500">{Object.keys(tools).length}</span>
							</div>
						</div>
					</button>

					{#each Object.keys(tools) as toolId}
						<button
							class="relative flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
							on:click={async (e) => {
								if (!(tools[toolId]?.authenticated ?? true)) {
									e.preventDefault();

									let parts = toolId.split(':');
									let serverId = parts?.at(-1) ?? toolId;

									// Persist the tool ID so we can re-enable it after OAuth redirect
									sessionStorage.setItem('pendingOAuthToolId', toolId);

									const authUrl = getOAuthClientAuthorizationUrl(serverId, 'mcp');
									window.open(authUrl, '_self', 'noopener');
								} else {
									tools[toolId].enabled = !tools[toolId].enabled;

									const state = tools[toolId].enabled;
									await tick();

									if (state) {
										selectedToolIds = [...selectedToolIds, toolId];
									} else {
										selectedToolIds = selectedToolIds.filter((id) => id !== toolId);
									}
								}
							}}
						>
							{#if !(tools[toolId]?.authenticated ?? true)}
								<!-- make it slighly darker and not clickable -->
								<div class="absolute inset-0 opacity-50 rounded-xl cursor-pointer z-10" />
							{/if}
							<div class="flex-1 truncate">
								<div class="flex flex-1 gap-2 items-center">
									<Tooltip content={tools[toolId]?.name ?? ''} placement="top">
										<div class="shrink-0">
											<Wrench />
										</div>
									</Tooltip>
									<Tooltip content={tools[toolId]?.description ?? ''} placement="top-start">
										<div class=" truncate">{tools[toolId].name}</div>
									</Tooltip>
								</div>
							</div>

							{#if (tools[toolId]?.authenticated ?? true) && toolId.startsWith('server:mcp:')}
								<div class="shrink-0">
									<Tooltip content={$i18n.t('Disconnect OAuth')}>
										<button
											class="self-center w-fit text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition rounded-full"
											type="button"
											on:click={async (e) => {
												e.stopPropagation();
												e.preventDefault();

												const parts = toolId.split(':');
												const serverId = parts.at(-1) ?? toolId;
												const provider = `mcp:${serverId}`;

												try {
													await deleteOAuthSession(localStorage.token, provider);
													toast.success($i18n.t('OAuth session disconnected'));

													// Refresh tools to update authenticated state
													_tools.set(await getTools(localStorage.token));
													selectedToolIds = selectedToolIds.filter((id) => id !== toolId);
													await init();
												} catch (err) {
													toast.error(err ?? $i18n.t('Failed to disconnect'));
												}
											}}
										>
											<LinkSlash className="size-3.5" />
										</button>
									</Tooltip>
								</div>
							{/if}

							{#if tools[toolId]?.has_user_valves && ($user?.role === 'admin' || ($user?.permissions?.chat?.valves ?? true))}
								<div class=" shrink-0">
									<Tooltip content={$i18n.t('Valves')}>
										<button
											class="self-center w-fit text-sm text-gray-600 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition rounded-full"
											type="button"
											on:click={(e) => {
												e.stopPropagation();
												e.preventDefault();
												onShowValves({
													type: 'tool',
													id: toolId
												});
											}}
										>
											<Knobs />
										</button>
									</Tooltip>
								</div>
							{/if}

							<div class=" shrink-0">
								<Switch state={tools[toolId].enabled} />
							</div>
						</button>
					{/each}
				</div>
			{:else if tab === 'skills' && skills}
				<div in:fly={{ x: 20, duration: 150 }}>
					<button
						class="flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
						on:click={() => {
							tab = '';
						}}
					>
						<ChevronLeft />

						<div class="flex items-center w-full justify-between">
							<div>
								{$i18n.t('Skills')}
								<span class="ml-0.5 text-gray-500">{Object.keys(skills).length}</span>
							</div>
						</div>
					</button>

					{#each Object.keys(skills) as skillId}
						<button
							class="relative flex w-full justify-between gap-2 items-center px-3 py-1.5 text-sm cursor-pointer rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
							on:click={async () => {
								skills[skillId].enabled = !skills[skillId].enabled;

								const state = skills[skillId].enabled;
								await tick();

								if (state) {
									selectedSkillIds = [...selectedSkillIds, skillId];
								} else {
									selectedSkillIds = selectedSkillIds.filter((id) => id !== skillId);
								}
							}}
						>
							<div class="flex-1 truncate">
								<div class="flex flex-1 gap-2 items-center">
									<Tooltip content={skills[skillId]?.name ?? ''} placement="top">
										<div class="shrink-0">
											<Keyframes className="size-4" strokeWidth="1.75" />
										</div>
									</Tooltip>
									<Tooltip content={skills[skillId]?.description ?? ''} placement="top-start">
										<div class=" truncate">{skills[skillId].name}</div>
									</Tooltip>
								</div>
							</div>

							<div class=" shrink-0">
								<Switch state={skills[skillId].enabled} />
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</Dropdown>
