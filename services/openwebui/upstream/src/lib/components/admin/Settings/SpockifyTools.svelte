<script lang="ts">
	import { getContext } from 'svelte';

	const i18n = getContext('i18n');

	type ToolCard = {
		id: string;
		name: string;
		status: 'on' | 'stub' | 'docs';
		summary: string;
		href?: string;
	};

	const tools: ToolCard[] = [
		{
			id: 'web',
			name: 'Web search (SearXNG)',
			status: 'on',
			summary:
				'Router + OWUI web search via SearXNG. Per-turn Search auto/on/off in the composer.'
		},
		{
			id: 'knowledge',
			name: 'Knowledge / RAG',
			status: 'on',
			summary: 'Workspace → Knowledge: directories, files, collections. See docs/SPOCKIFY_KNOWLEDGE.md.',
			href: '/workspace/knowledge'
		},
		{
			id: 'notes',
			name: 'Notes',
			status: 'on',
			summary: 'Built-in notes + Projects (sidebar folders) for long-lived context.'
		},
		{
			id: 'projects',
			name: 'Projects',
			status: 'on',
			summary:
				'Sidebar → Projects (+). Add a project summary so chats remember goals/stack across sessions. Browse/edit in Settings → Memory.'
		},
		{
			id: 'memory',
			name: 'Memory browser',
			status: 'on',
			summary: 'Settings → Memory: edit your project summaries and clear your session digests.'
		},
		{
			id: 'scheduled',
			name: 'Scheduled agents',
			status: 'on',
			summary:
				'Daily morning / presets → prompt on spockify-auto. Settings → Scheduled agents (your jobs only).'
		},
		{
			id: 'parallel',
			name: 'Parallel agents',
			status: 'on',
			summary:
				'Chat chip “Parallel agents” or model spockify-agents: up to 4 workers in parallel (nested depth 2, shared search/browse, cancel), then synthesis.'
		},
		{
			id: 'browser',
			name: 'Browser agent',
			status: 'on',
			summary:
				'Allowlisted URL fetch → page text (Wave 8/9). Shared browse + POST /spockify/browser/fetch. Playwright click/type via PLAYWRIGHT_WS_URL sidecar (or PLAYWRIGHT_LOCAL=1). Guests: read-only fetch.'
		},
		{
			id: 'replay',
			name: 'Agent run replay',
			status: 'on',
			summary: 'Settings → Agent run replay: timeline of your workers/timings/outputs + time-travel fork.'
		},
		{
			id: 'datetime',
			name: 'Date / timezone',
			status: 'on',
			summary: 'Spockify Function: current time and timezone helpers (Workspace → Functions).'
		},
		{
			id: 'canvas',
			name: 'Canvas',
			status: 'on',
			summary:
				'Integrations → Canvas toggle. Auto-opens long docs/code when on (or Settings → Interface → Canvas auto-open). Manual: ```canvas fence / code-block → Canvas / navbar.'
		},
		{
			id: 'github',
			name: 'GitHub / coding workspace',
			status: 'on',
			summary:
				'Canvas: Copy patch / Download .diff. Optional WORKSPACE_GIT_ROOT apply + GITHUB_TOKEN.'
		},
		{
			id: 'mcp',
			name: 'MCP / OpenAPI tools',
			status: 'docs',
			summary:
				'IDE MCP is separate (docs/MCP_SETUP.md). Chat tools: Admin → Integrations → Tool Servers (OpenAPI).',
			href: '/admin/settings/integrations'
		},
		{
			id: 'arena',
			name: 'Eval / arena (A/B)',
			status: 'on',
			summary:
				'Select two models in the picker (or Admin → Evaluations arena). Same prompt → side-by-side; use thumbs to vote.',
			href: '/admin/settings/evaluations'
		}
	];

	const badge = (status: ToolCard['status']) => {
		if (status === 'on') return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
		if (status === 'stub') return 'bg-amber-500/15 text-amber-800 dark:text-amber-300';
		return 'bg-sky-500/15 text-sky-700 dark:text-sky-300';
	};

	const label = (status: ToolCard['status']) => {
		if (status === 'on') return 'Enabled';
		if (status === 'stub') return 'Stub';
		return 'Docs';
	};
</script>

<div class="flex flex-col h-full justify-between text-sm">
	<div class="space-y-4 overflow-y-scroll scrollbar-hidden h-full pb-4">
		<div>
			<div class="text-sm font-medium">{$i18n.t('Spockify tools')}</div>
			<div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
				{$i18n.t(
					'Marketplace-style list of Spockify tools. Enable full stacks under Integrations / Functions.'
				)}
			</div>
		</div>

		<ul class="space-y-3">
			{#each tools as tool}
				<li class="rounded-xl border border-gray-100 dark:border-gray-850 px-3 py-3">
					<div class="flex items-start justify-between gap-3">
						<div class="font-medium">{tool.name}</div>
						<span class="text-[11px] px-1.5 py-0.5 rounded shrink-0 {badge(tool.status)}">
							{label(tool.status)}
						</span>
					</div>
					<p class="text-xs text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
						{tool.summary}
					</p>
					{#if tool.href}
						<a
							href={tool.href}
							class="inline-block mt-2 text-xs text-sky-600 dark:text-sky-400 hover:underline"
						>
							{$i18n.t('Open')}
						</a>
					{/if}
				</li>
			{/each}
		</ul>
	</div>
</div>
