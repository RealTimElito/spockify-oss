/**
 * Builtin tools: apply_patch, terminal_run, agent run create/cancel.
 * MCP tools are bridged separately in register.ts.
 */

import * as vscode from 'vscode';
import type { ModelTransport } from '@spockify/ide-client';
import type { ApplyService } from '../../apply/types';
import { formatTerminalRunError } from '../../terminal/formatTerminalError';
import { checkShellCommand } from '../../terminal/isShellCommand';
import { runTerminalTool } from '../../terminal/runTerminalTool';
import type { UnifiedToolRegistry } from '../unifiedRegistry';
import type { ToolCallResult, ToolExecutionContext } from '../types';

import {
  extractShellCommand,
  preferTerminalForPrompt,
  shellWorkerCount,
} from './shellAgentIntent';
import {
  executeGlobFileSearch,
  executeGrep,
  executeListDir,
} from './workspaceExplore';

export {
  preferTerminalForPrompt,
  SHELL_AGENT_INTENT_RE,
} from './shellAgentIntent';

/** Default shell timeout for chat/composer terminal_run when args omit timeoutMs. */
const AGENT_TERMINAL_TIMEOUT_CAP_MS = 60_000;
export interface BuiltinToolDeps {
  getApplyService: () => ApplyService;
  getTransport?: () => Promise<ModelTransport | undefined>;
  output?: vscode.OutputChannel;
  /** Needed for web_search / fetch_url (SearXNG + browser fetch). */
  extensionContext?: vscode.ExtensionContext;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function registerBuiltinTools(
  registry: UnifiedToolRegistry,
  deps: BuiltinToolDeps,
): void {
  registry.register(
    {
      name: 'apply_patch',
      description:
        'Apply one or more file patches via ApplyService (checkpoints). Prefer COMPLETE updated file contents. A unique changed-line snippet is OK — it will be spliced into the existing file; truncated wipe-style payloads are refused.',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            description:
              'Array of { path, content } — full file text preferred; unique snippets are spliced when locate succeeds',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: {
                  type: 'string',
                  description:
                    'Complete new file text, or a unique snippet of the changed lines to splice',
                },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['files'],
      },
      mutates: true,
      source: 'apply',
    },
    async (args, ctx) => executeApplyPatch(args, ctx, deps),
  );

  registry.register(
    {
      name: 'terminal_run',
      description:
        'Run one shell command in the workspace folder cwd (local or Remote SSH). ' +
        'command MUST be a real shell argv/one-liner or short script (e.g. "npm test", "git status -sb"). ' +
        'NEVER paste markdown headings, plans, docs, multi-paragraph prose, or essays — those are refused. ' +
        'ONLY for commands that must execute (tests, builds, git, package managers, network probes). ' +
        'Do NOT use for reading/searching code — use read_file, grep, list_dir, glob_file_search, codebase_search. ' +
        'Do NOT use for arithmetic, explanations, or general Q&A — answer those directly. ' +
        'Call via native tool_calls or ```tool JSON; never write prose like terminal_run bash "…". ' +
        'Prefer python3 over python. Prefer write_file over shell redirects.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description:
              'Real shell command only (short argv/script). Not markdown, plans, or documentation.',
          },
          cwd: { type: 'string', description: 'Optional working directory' },
          timeoutMs: {
            type: 'number',
            description:
              'Optional timeout in ms (default 60000). Raise only for long builds/tests.',
          },
        },
        required: ['command'],
      },
      mutates: true,
      source: 'terminal',
    },
    async (args, ctx) => executeTerminalRun(args, ctx, deps),
  );

  registry.register(
    {
      name: 'spockify_create_agent_run',
      description:
        'Create a parallel multi-agent research/analysis run via /spockify/agents/runs. ' +
        'ONLY when the user explicitly asks for multiple/parallel agents ' +
        '("have N agents", "spawn agents", "in parallel", etc.). ' +
        'Do NOT use for ordinary questions, code explanation, or single-agent work — answer those yourself. ' +
        'NOT for shell/network commands (use terminal_run).',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Parent prompt for workers' },
          model: {
            type: 'string',
            description: 'OSS model id (default spockify-agents / spockify-room)',
          },
        },
        required: ['prompt'],
      },
      mutates: true,
      source: 'remote',
    },
    async (args, ctx) => executeCreateAgentRun(args, ctx, deps),
  );

  registry.register(
    {
      name: 'spockify_cancel_agent_run',
      description: 'Cancel an agent run by id via /spockify/agents/runs/:id/cancel.',
      parameters: {
        type: 'object',
        properties: {
          runId: { type: 'string' },
        },
        required: ['runId'],
      },
      mutates: true,
      source: 'remote',
    },
    async (args, ctx) => executeCancelAgentRun(args, ctx, deps),
  );

  registry.register(
    {
      name: 'codebase_search',
      description:
        'Search the workspace @codebase index (hybrid BM25 + vectors). ' +
        'Relevant chunks are often auto-attached already — call for a deeper query. ' +
        'If hits are empty, thin, or ambiguous, you MUST continue with multiple ' +
        'grep / glob_file_search / read_file passes (broaden patterns, synonyms, related symbols) — never claim ' +
        'you cannot browse the repo and never guess from memory. Empty/thin results auto-include grepFallback; ' +
        'still run more greps yourself when unsure.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          k: { type: 'number' },
          pathPrefix: { type: 'string' },
        },
        required: ['query'],
      },
      mutates: false,
      source: 'builtin',
    },
    async (args) => executeCodebaseSearch(args),
  );

  registry.register(
    {
      name: 'web_search',
      description:
        'Search the live web via Spockify SearXNG (same backend as spockify.eu chat). ' +
        'Use when the user asks for current info, docs, APIs, news, or when the ' +
        'Web Search / @web context chip is on and you need more results. ' +
        'Follow up with fetch_url to read a specific page.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: {
            type: 'number',
            description: 'Max results (default 5, max 10)',
          },
        },
        required: ['query'],
      },
      mutates: false,
      source: 'remote',
    },
    async (args) => executeWebSearch(args, deps),
  );

  registry.register(
    {
      name: 'fetch_url',
      description:
        'Fetch a web page as plain text via Spockify browser fetch ' +
        '(OWUI → router /spockify/browser/fetch, same as web chat). ' +
        'Use after web_search when you need the page body, or when the user pastes a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'http(s) URL to fetch' },
          maxChars: {
            type: 'number',
            description: 'Max characters of page text (default 24000)',
          },
        },
        required: ['url'],
      },
      mutates: false,
      source: 'remote',
    },
    async (args) => executeFetchUrl(args, deps),
  );

  registry.register(
    {
      name: 'grep',
      description:
        'Ripgrep-style text search across the workspace (vscode findTextInFiles; Remote SSH–safe). ' +
        'Use when @codebase / codebase_search hits are thin, for exact symbols, strings, or callers. ' +
        'Prefer this over terminal_run rg/grep.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Search pattern (regex by default)',
          },
          path: {
            type: 'string',
            description: 'Optional workspace-relative directory/file prefix',
          },
          caseInsensitive: { type: 'boolean' },
          maxResults: { type: 'number' },
        },
        required: ['pattern'],
      },
      mutates: false,
      source: 'builtin',
    },
    async (args) => executeGrep(args),
  );

  registry.register(
    {
      name: 'glob_file_search',
      description:
        'Find files by glob (e.g. **/*cloud*.py, **/routes/*.ts). Prefer over shell find. ' +
        'Use when you need paths before read_file.',
      parameters: {
        type: 'object',
        properties: {
          glob: {
            type: 'string',
            description: 'Glob pattern (e.g. **/*.ts)',
          },
          pathPrefix: { type: 'string' },
          maxResults: { type: 'number' },
        },
        required: ['glob'],
      },
      mutates: false,
      source: 'builtin',
    },
    async (args) => executeGlobFileSearch(args),
  );

  registry.register(
    {
      name: 'list_dir',
      description:
        'List files and directories at a workspace-relative path (default "."). Prefer over terminal_run ls.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Workspace-relative directory (default ".")',
          },
          maxEntries: { type: 'number' },
        },
      },
      mutates: false,
      source: 'builtin',
    },
    async (args) => executeListDir(args),
  );

  registry.register(
    {
      name: 'read_file',
      description:
        'Read a workspace-relative file (UTF-8). Use before answering "how does this work" ' +
        'or editing unfamiliar paths — prefer real file contents over guessing from @codebase snippets alone.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative path' },
          maxBytes: {
            type: 'number',
            description: 'Max bytes to return (default 120000)',
          },
        },
        required: ['path'],
      },
      mutates: false,
      source: 'builtin',
    },
    async (args) => executeReadFile(args),
  );

  registry.register(
    {
      name: 'write_file',
      description:
        'Create or overwrite one workspace file via vscode.workspace.fs (parents auto-created; works on Remote SSH). Prefer this over shell redirects. Prefer apply_patch when touching multiple files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative path' },
          content: { type: 'string', description: 'Full file contents' },
        },
        required: ['path', 'content'],
      },
      mutates: true,
      source: 'apply',
    },
    async (args, ctx) => executeWriteFile(args, ctx, deps),
  );
}

/** Tokens from a free-text query suitable as grep patterns (broaden on thin index). */
function grepPatternsFromQuery(query: string): string[] {
  const raw = query.trim();
  if (!raw) return [];
  const tokens = raw
    .split(/[^a-zA-Z0-9_./:-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .filter(
      (t) =>
        !/^(the|and|for|with|from|this|that|what|how|where|when|into|file|code|search|about|please|find|show|does|work|using|used|like|just|some|any)$/i.test(
          t,
        ),
    );
  const uniq: string[] = [];
  for (const t of tokens) {
    if (!uniq.includes(t)) uniq.push(t);
    if (uniq.length >= 8) break;
  }
  // Prefer CamelCase / snake_case identifiers first
  uniq.sort((a, b) => {
    const score = (s: string) =>
      (/[A-Z]/.test(s) || /_/.test(s) || /\./.test(s) ? 2 : 0) +
      Math.min(s.length, 24) / 24;
    return score(b) - score(a);
  });
  const primary = uniq.slice(0, 5);
  // Synonym / broaden passes: camel↔snake, trailing plurals, short stems
  const expanded: string[] = [...primary];
  for (const t of primary) {
    for (const alt of synonymGrepTokens(t)) {
      if (!expanded.includes(alt)) expanded.push(alt);
      if (expanded.length >= 8) break;
    }
    if (expanded.length >= 8) break;
  }
  return expanded.slice(0, 8);
}

/** Lightweight alternate spellings to widen auto-grep when index is thin. */
function synonymGrepTokens(token: string): string[] {
  const out: string[] = [];
  if (/[A-Z]/.test(token) && !token.includes('_')) {
    const snake = token
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();
    if (snake !== token.toLowerCase()) out.push(snake);
  }
  if (token.includes('_')) {
    const camel = token
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel !== token) out.push(camel);
  }
  if (token.length >= 5 && /s$/i.test(token) && !/ss$/i.test(token)) {
    out.push(token.replace(/s$/i, ''));
  }
  if (token.length >= 6 && /ing$/i.test(token)) {
    out.push(token.replace(/ing$/i, ''));
  }
  // Dotted path last segment
  if (token.includes('.')) {
    const last = token.split('.').pop();
    if (last && last.length >= 3) out.push(last);
  }
  return out;
}

function isThinCodebaseHits(
  hits: Array<{ score?: number }>,
): boolean {
  if (hits.length === 0) return true;
  // Escalate sooner: ≤3 hits or weak/flat scores
  if (hits.length <= 3) return true;
  const scores = hits
    .map((h) => (typeof h.score === 'number' ? h.score : 0))
    .sort((a, b) => b - a);
  const top = scores[0] ?? 0;
  // Low absolute score or flat/ambiguous ranking
  if (top > 0 && top < 0.18) return true;
  if (hits.length >= 3 && scores[0]! - (scores[2] ?? 0) < 0.03) return true;
  return false;
}

async function executeCodebaseSearch(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const query = asString(args.query);
  try {
    const { tryGetCodebaseProvider } = await import('../../codebase');
    const provider = tryGetCodebaseProvider();
    if (!provider) {
      const grepFallback = await runGrepFallback(query);
      return {
        ok: true,
        content: JSON.stringify({
          hits: [],
          escalate: true,
          hint:
            'Codebase index unavailable — do NOT stop. Use grep / glob_file_search / read_file ' +
            '(multiple passes with broader patterns). Never claim you cannot browse the repo.',
          grepFallback,
        }),
      };
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder) {
      await provider.ensureIndex(folder.uri);
    }
    const hits = await provider.search({
      query,
      k: typeof args.k === 'number' ? args.k : 12,
      pathPrefix: asString(args.pathPrefix) || undefined,
    });
    const mapped = hits.map((h) => ({
      path: h.path,
      startLine: h.startLine,
      endLine: h.endLine,
      text: h.text.slice(0, 800),
      score: h.score,
    }));
    const thin = isThinCodebaseHits(mapped);
    if (!hits.length || thin) {
      const st = provider.getStatus();
      const grepFallback = await runGrepFallback(query);
      const baseHint = !hits.length
        ? st.status === 'indexing'
          ? 'Index still building — escalate to grep / glob / read_file now.'
          : st.chunks
            ? 'No index hits — escalate to grep / glob_file_search / read_file.'
            : 'Empty index — use grep / glob / read_file, or Spockify: Reindex Codebase.'
        : 'Index hits are thin/ambiguous — run more grep/glob passes and read_file definitions+callers before answering.';
      return {
        ok: true,
        content: JSON.stringify({
          hits: mapped,
          escalate: true,
          thin: thin && hits.length > 0,
          hint:
            `${baseHint} Do not invent paths. Do not claim you cannot browse the repo. ` +
            'Try alternate spellings/symbols, then read the best files.',
          grepFallback,
          status: st.status,
          chunks: st.chunks,
          files: st.files,
        }),
      };
    }
    return {
      ok: true,
      content: JSON.stringify({ hits: mapped }),
    };
  } catch (err) {
    const grepFallback = await runGrepFallback(query);
    return {
      ok: false,
      content: JSON.stringify({
        escalate: true,
        hint: 'codebase_search failed — continue with grep / glob_file_search / read_file',
        grepFallback,
      }),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runGrepFallback(
  query: string,
): Promise<
  | { patterns: string[]; results: unknown[] }
  | { skipped: string }
  | undefined
> {
  const patterns = grepPatternsFromQuery(query);
  if (!patterns.length) {
    return { skipped: 'no usable tokens for auto-grep' };
  }
  const results: unknown[] = [];
  for (const pattern of patterns) {
    try {
      const r = await executeGrep({
        pattern,
        maxResults: 16,
        caseInsensitive: true,
      });
      let parsed: unknown = r.content;
      try {
        parsed = JSON.parse(r.content);
      } catch {
        /* keep string */
      }
      results.push({ pattern, ok: r.ok, result: parsed, error: r.error });
    } catch (err) {
      results.push({
        pattern,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { patterns, results };
}

async function executeWebSearch(
  args: Record<string, unknown>,
  deps: BuiltinToolDeps,
): Promise<ToolCallResult> {
  const query = asString(args.query).trim();
  if (!query) {
    return { ok: false, content: '', error: 'web_search requires query' };
  }
  const ctx = deps.extensionContext;
  if (!ctx) {
    return {
      ok: false,
      content: '',
      error: 'web_search unavailable (extension context missing)',
    };
  }
  const maxResults =
    typeof args.maxResults === 'number' && args.maxResults > 0
      ? Math.min(Math.floor(args.maxResults), 10)
      : 5;
  try {
    const { searchWeb } = await import('../../rules/webContext');
    const hits = await searchWeb(ctx, query, maxResults);
    return {
      ok: true,
      content: JSON.stringify({
        query,
        results: hits,
        hint: hits.length
          ? 'Cite sources. Use fetch_url to read a specific page when snippets are insufficient.'
          : 'No results — try a narrower or alternate query.',
      }),
    };
  } catch (err) {
    return {
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function executeFetchUrl(
  args: Record<string, unknown>,
  deps: BuiltinToolDeps,
): Promise<ToolCallResult> {
  const url = asString(args.url).trim();
  if (!url) {
    return { ok: false, content: '', error: 'fetch_url requires url' };
  }
  const ctx = deps.extensionContext;
  if (!ctx) {
    return {
      ok: false,
      content: '',
      error: 'fetch_url unavailable (extension context missing)',
    };
  }
  const maxChars =
    typeof args.maxChars === 'number' && args.maxChars > 0
      ? Math.floor(args.maxChars)
      : undefined;
  try {
    const { fetchWebUrl } = await import('../../rules/webContext');
    const result = await fetchWebUrl(ctx, url, { maxChars });
    if (!result.ok) {
      return {
        ok: false,
        content: JSON.stringify(result),
        error: result.error || 'fetch failed',
      };
    }
    return { ok: true, content: JSON.stringify(result) };
  } catch (err) {
    return {
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function executeApplyPatch(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  deps: BuiltinToolDeps,
): Promise<ToolCallResult> {
  const rawFiles = args.files;
  if (!Array.isArray(rawFiles) || !rawFiles.length) {
    return { ok: false, content: '', error: 'apply_patch requires files[]' };
  }
  const files: Array<{ path: string; nextContent: string }> = [];
  for (const f of rawFiles) {
    if (!f || typeof f !== 'object') continue;
    const rec = f as Record<string, unknown>;
    const path = asString(rec.path);
    const content = asString(rec.content ?? rec.nextContent);
    if (!path) continue;
    files.push({ path, nextContent: content });
  }
  if (!files.length) {
    return { ok: false, content: '', error: 'No valid files in apply_patch' };
  }

  // Soften wipe gate: unique snippets splice in; true wipes still refused.
  const { resolveNonDestructiveNext } = await import(
    '../../composer/patchSanity'
  );
  const { resolveWorkspaceUri } = await import('../../chat/openWorkspaceFile');
  const safe: Array<{ path: string; nextContent: string }> = [];
  const rejectedDestructive: string[] = [];
  const splicedPaths: string[] = [];
  for (const f of files) {
    const uri = await resolveWorkspaceUri(f.path);
    if (!uri) {
      safe.push(f);
      continue;
    }
    let current = '';
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      current = Buffer.from(data).toString('utf8');
    } catch {
      safe.push(f);
      continue;
    }
    const resolved = resolveNonDestructiveNext(current, f.nextContent);
    if (!resolved) {
      rejectedDestructive.push(f.path);
      ctx.output?.appendLine(
        `runtime apply_patch: refused destructive replace for ${f.path} ` +
          `(could not splice snippet — pass full file contents or a unique locateable hunk)`,
      );
      continue;
    }
    if (resolved.via === 'snippet') {
      splicedPaths.push(f.path);
      ctx.output?.appendLine(
        `runtime apply_patch: spliced snippet into ${f.path}`,
      );
    }
    safe.push({ path: f.path, nextContent: resolved.next });
  }
  if (!safe.length) {
    return {
      ok: false,
      content: '',
      error:
        `apply_patch refused destructive replace for: ${rejectedDestructive.join(', ')}. ` +
        'Pass COMPLETE updated file contents, or a unique snippet of only the changed lines.',
    };
  }

  const { shouldAutoApplyFilePatches, shouldConfirmFileEdits } = await import(
    '../agentPermissionMode'
  );

  // Cursor ask_every_time: confirm file writes before staging/applying.
  if (shouldConfirmFileEdits()) {
    const { requestToolConsent } = await import('../toolConsent');
    const preview = safe
      .map((f) => f.path)
      .slice(0, 8)
      .join(', ');
    const decision = await requestToolConsent(
      ctx.sessionId,
      {
        title: 'Apply file edits?',
        hint: 'Permission mode: Ask every time',
        badge: `${safe.length} file${safe.length === 1 ? '' : 's'}`,
        commandPreview: preview + (safe.length > 8 ? '…' : ''),
        allowSessionEnabled: true,
        terminalRunEnabled: false,
      },
      ctx.signal,
    );
    if (decision === 'reject') {
      return {
        ok: false,
        content: '',
        error: 'User rejected file edits.',
      };
    }
  }

  if (!shouldAutoApplyFilePatches()) {
    const { buildUnifiedDiff } = await import('../../apply/diff');
    const diffs: Array<{ path: string; unifiedDiff: string }> = [];
    for (const f of safe) {
      try {
        const folders = vscode.workspace.workspaceFolders;
        let current = '';
        if (folders?.length) {
          const uri = vscode.Uri.joinPath(
            folders[0].uri,
            f.path.replace(/^\.\//, ''),
          );
          try {
            const buf = await vscode.workspace.fs.readFile(uri);
            current = Buffer.from(buf).toString('utf8');
          } catch {
            current = '';
          }
        }
        const unified = buildUnifiedDiff(f.path, current, f.nextContent);
        if (unified) {
          diffs.push({
            path: f.path,
            unifiedDiff:
              unified.length > 10_000
                ? `${unified.slice(0, 10_000)}\n…`
                : unified,
          });
        }
      } catch {
        /* skip preview for this file */
      }
    }

    const { stageInlineFileReview } = await import('../../apply/review/inlineReview');
    await stageInlineFileReview(
      safe.map((f) => ({ path: f.path, content: f.nextContent })),
      { source: 'agent', openFirst: true, sessionId: ctx.sessionId },
    );
    // Notify chat Files bar / status (composer tree pending changed).
    try {
      await vscode.commands.executeCommand('spockify.chat.refreshFilesChanged');
    } catch {
      /* chat may not be registered yet */
    }
    ctx.output?.appendLine(
      `runtime apply_patch: staged for review ${safe.map((f) => f.path).join(',')}`,
    );
    return {
      ok: true,
      content: JSON.stringify({
        staged: safe.map((f) => f.path),
        rejectedDestructive,
        spliced: splicedPaths,
        diffs,
        message:
          'File edits staged for inline review — user must Accept / Reject in the editor (not written yet).',
      }),
    };
  }

  const apply = deps.getApplyService();
  const result = await apply.apply(
    { files: safe, source: 'agent' },
    undefined,
  );
  ctx.output?.appendLine(
    `runtime apply_patch: applied=${result.applied.join(',')} rejected=${result.rejected.join(',')}`,
  );
  const ok =
    result.applied.length > 0 &&
    result.rejected.length === 0 &&
    rejectedDestructive.length === 0;
  return {
    ok,
    content: JSON.stringify({ ...result, rejectedDestructive }),
    error: ok
      ? undefined
      : rejectedDestructive.length
        ? `destructive replace refused: ${rejectedDestructive.join(', ')}`
        : `rejected: ${result.rejected.join(', ') || 'none applied'}`,
    checkpointId: result.checkpointId,
  };
}

async function executeTerminalRun(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  deps: BuiltinToolDeps,
): Promise<ToolCallResult> {
  const command = asString(args.command);
  if (!command) {
    return { ok: false, content: '', error: 'terminal_run requires command' };
  }
  const shellCheck = checkShellCommand(command);
  if (!shellCheck.ok) {
    return {
      ok: false,
      content: '',
      error: shellCheck.reason,
    };
  }
  const cwd = asString(args.cwd) || undefined;
  // Default agent shell timeout is short (see spockify.terminalAgent.timeoutMs)
  // so Remote SSH shellIntegration cannot hang for minutes on trivial/misrouted cmds.
  // Explicit timeoutMs in args still wins (Terminal Agent / long builds).
  const timeoutMs =
    typeof args.timeoutMs === 'number' && args.timeoutMs > 0
      ? Math.floor(args.timeoutMs)
      : AGENT_TERMINAL_TIMEOUT_CAP_MS;
  const result = await runTerminalTool(
    { command, cwd, sessionId: ctx.sessionId, timeoutMs },
    { output: deps.output, signal: ctx.signal },
  );
  if (result.denied) {
    return {
      ok: false,
      content: JSON.stringify(result),
      error: result.stderr || 'denied',
    };
  }
  return {
    ok: result.exitCode === 0,
    content: JSON.stringify({
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      sandboxNote: result.sandboxNote,
    }),
    error:
      result.exitCode === 0
        ? undefined
        : formatTerminalRunError(result, {
            osSandboxNote: result.sandboxNote,
          }),
  };
}

async function executeReadFile(
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const rel = asString(args.path);
  if (!rel) {
    return { ok: false, content: '', error: 'read_file requires path' };
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    return { ok: false, content: '', error: 'No workspace folder open' };
  }
  const maxBytes =
    typeof args.maxBytes === 'number' && args.maxBytes > 0
      ? Math.min(args.maxBytes, 500_000)
      : 120_000;
  try {
    const uri = vscode.Uri.joinPath(root, rel);
    const raw = await vscode.workspace.fs.readFile(uri);
    const slice = raw.slice(0, maxBytes);
    const truncated = raw.length > slice.length;
    return {
      ok: true,
      content: JSON.stringify({
        path: rel,
        bytes: slice.length,
        truncated,
        content: Buffer.from(slice).toString('utf8'),
      }),
    };
  } catch (err) {
    return {
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function executeWriteFile(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  deps: BuiltinToolDeps,
): Promise<ToolCallResult> {
  const path = asString(args.path);
  const content = asString(args.content);
  if (!path) {
    return { ok: false, content: '', error: 'write_file requires path' };
  }
  return executeApplyPatch({ files: [{ path, content }] }, ctx, deps);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Compact start payload for UI cards — never use alone as final tool history. */
function compactAgentRunToolContent(run: {
  id: string;
  status: string;
  model?: string;
  workers?: Array<{ id?: string; name?: string; state?: string }>;
  summary?: string;
}): string {
  const n = run.workers?.length ?? 0;
  const names = (run.workers || [])
    .map((w) => w.name || w.id)
    .filter(Boolean)
    .slice(0, 4)
    .join(', ');
  return JSON.stringify({
    id: run.id,
    status: run.status,
    model: run.model,
    workers: n,
    roles: names || undefined,
    summary:
      run.summary ||
      `Started agent run ${run.id.slice(0, 12)} (${n} worker${n === 1 ? '' : 's'}${names ? `: ${names}` : ''}). Live progress is in the Agents panel / chat card — do not dump this JSON to the user.`,
  });
}

async function waitForRemoteAgentRun(
  transport: ModelTransport,
  runId: string,
  signal?: AbortSignal,
): Promise<import('@spockify/ide-client').AgentRun> {
  if (!transport.getAgentRun) {
    throw new Error('getAgentRun unavailable');
  }
  const {
    agentRunToCardPayload,
    publishAgentRunToChat,
  } = await import('../../agents/agentRunChatBridge');
  const { sanitizeAgentRun } = await import('../../agents/agentRunUi');
  const terminal = new Set(['done', 'failed', 'cancelled']);
  let run = sanitizeAgentRun(await transport.getAgentRun(runId));
  const publish = () => {
    const card = agentRunToCardPayload(run);
    if (card) publishAgentRunToChat(card);
  };
  publish();
  while (!terminal.has(run.status)) {
    if (signal?.aborted) break;
    try {
      await sleep(1500, signal);
    } catch {
      break;
    }
    run = sanitizeAgentRun(await transport.getAgentRun(runId));
    publish();
  }
  return run;
}

/** Run parallel local shell workers (ping/curl/…) and publish an agent-run card. */
export async function runLocalShellAgentRun(
  prompt: string,
  ctx: ToolExecutionContext,
  deps: BuiltinToolDeps,
): Promise<ToolCallResult> {
  return executeLocalShellAgentRun(prompt, ctx, deps);
}

async function executeLocalShellAgentRun(
  prompt: string,
  ctx: ToolExecutionContext,
  deps: BuiltinToolDeps,
): Promise<ToolCallResult> {
  const command = extractShellCommand(prompt);
  if (!command) {
    return {
      ok: false,
      content: '',
      error:
        'Could not derive a shell command. Call terminal_run with an explicit command ' +
        '(e.g. ping -c 10 google.com).',
    };
  }
  const n = shellWorkerCount(prompt);
  const runId = `local-${Date.now().toString(36)}`;
  const createdAt = new Date().toISOString();
  const {
    agentRunToCardPayload,
    publishAgentRunToChat,
  } = await import('../../agents/agentRunChatBridge');
  const { upsertLocalAgentRun } = await import(
    '../../agents/localAgentRunStore'
  );

  type LocalWorker = {
    id: string;
    name: string;
    state: 'pending' | 'running' | 'done' | 'failed';
    prompt: string;
    result?: string;
    error?: string;
  };

  const workers: LocalWorker[] = Array.from({ length: n }, (_, i) => ({
    id: `w${i + 1}`,
    name: n === 1 ? 'Runner' : `Runner ${i + 1}`,
    state: 'pending',
    prompt: command,
  }));

  const publish = (
    status: string,
    nextWorkers: LocalWorker[],
    extra?: { synthesis?: string; error?: string },
  ) => {
    const snapshot = {
      id: runId,
      status,
      parent_prompt: prompt,
      model: 'terminal_run',
      workers: nextWorkers,
      synthesis: extra?.synthesis,
      error: extra?.error,
      created_at: createdAt,
      updated_at: new Date().toISOString(),
    };
    upsertLocalAgentRun(snapshot as import('@spockify/ide-client').AgentRun);
    const card = agentRunToCardPayload(snapshot);
    if (card) publishAgentRunToChat(card);
  };

  publish('running', workers);
  for (const w of workers) w.state = 'running';
  publish('running', workers);

  const results = await Promise.all(
    workers.map(async (w) => {
      const result = await runTerminalTool(
        { command, sessionId: ctx.sessionId },
        { output: deps.output, signal: ctx.signal },
      );
      const body = [
        result.stdout?.trim(),
        result.stderr?.trim(),
        result.denied ? '(denied)' : `exit ${result.exitCode}`,
      ]
        .filter(Boolean)
        .join('\n');
      return {
        worker: w,
        ok: !result.denied && result.exitCode === 0,
        body,
        error: result.denied
          ? result.stderr || 'denied'
          : result.exitCode === 0
            ? undefined
            : formatTerminalRunError(result, {
                osSandboxNote: result.sandboxNote,
              }),
      };
    }),
  );

  const doneWorkers: LocalWorker[] = results.map((r) => ({
    ...r.worker,
    state: r.ok ? 'done' : 'failed',
    result: r.body,
    error: r.error,
  }));
  const anyOk = results.some((r) => r.ok);
  const synthesis = results
    .map(
      (r) =>
        `### ${r.worker.name} (${r.ok ? 'ok' : 'failed'})\n\`\`\`\n${r.body.slice(0, 4000)}\n\`\`\``,
    )
    .join('\n\n');
  const status = anyOk ? 'done' : 'failed';
  publish(status, doneWorkers, {
    synthesis,
    error: anyOk ? undefined : 'all shell workers failed',
  });
  void vscode.window.showInformationMessage(
    anyOk
      ? `Shell agents done — ${command}`
      : `Shell agents failed — ${command}`,
  );
  ctx.output?.appendLine(
    `runtime local_shell_agent_run: ${runId} cmd=${command} workers=${n} status=${status}`,
  );
  // Cards are UI-only; put stdout into tool/assistant history so follow-ups
  // (e.g. "what's the average time?") can see ping latencies.
  const { formatAgentRunTranscript } = await import(
    '../../agents/agentRunTranscript'
  );
  return {
    ok: anyOk,
    content: formatAgentRunTranscript({
      heading: anyOk
        ? `Local shell agents finished (${n}× \`${command}\`):`
        : `Local shell agents failed (${n}× \`${command}\`):`,
      synthesis,
      workers: doneWorkers.map((w, i) => ({
        name: w.name,
        id: w.id,
        ok: results[i]?.ok,
        state: w.state,
        result: w.result,
        error: w.error,
      })),
      error: anyOk ? undefined : 'all shell workers failed',
    }),
    error: anyOk ? undefined : 'all shell workers failed',
  };
}

async function executeCreateAgentRun(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
  deps: BuiltinToolDeps,
): Promise<ToolCallResult> {
  const prompt = asString(args.prompt);
  if (!prompt) {
    return { ok: false, content: '', error: 'prompt required' };
  }
  // Refuse silent fan-out on ordinary Q&A (Multitask hint used to over-trigger).
  const { hasMultiAgentSpawnIntent } = await import('./shellAgentIntent');
  const intentHead = prompt.split(/\n---\n/)[0]?.trim() || prompt;
  if (!hasMultiAgentSpawnIntent(intentHead)) {
    return {
      ok: false,
      content: '',
      error:
        'Multi-agent spawn refused: user did not ask for parallel/multiple agents. ' +
        'Answer the question yourself with read_file / grep / codebase_search / tools as needed.',
    };
  }
  if (preferTerminalForPrompt(prompt)) {
    return executeLocalShellAgentRun(prompt, ctx, deps);
  }
  const transport = await deps.getTransport?.();
  if (!transport?.createAgentRun) {
    return {
      ok: false,
      content: '',
      error: 'Remote agent API unavailable (sign in / remote provider).',
    };
  }
  const model =
    asString(args.model) ||
    'spockify-agents';
  try {
    const raw = await transport.createAgentRun({
      parent_prompt: prompt,
      model,
      synthesize: true,
    });
    const { sanitizeAgentRun } = await import('../../agents/agentRunUi');
    const {
      agentRunToCardPayload,
      publishAgentRunToChat,
    } = await import('../../agents/agentRunChatBridge');
    let run = sanitizeAgentRun(raw);
    const card = agentRunToCardPayload(run);
    if (card) publishAgentRunToChat(card);
    // Kick Agents tree poll so chat cards leave pending without opening the view.
    void vscode.commands.executeCommand('spockify.agents.refresh');
    ctx.output?.appendLine(
      `runtime create_agent_run: ${run.id} status=${run.status} workers=${run.workers?.length ?? 0}`,
    );

    // Wait for workers so tool results (and the next user turn) include
    // synthesis / stdout — not just a "started" stub.
    if (transport.getAgentRun) {
      run = sanitizeAgentRun(
        await waitForRemoteAgentRun(transport, run.id, ctx.signal),
      );
    }

    const { formatAgentRunTranscript } = await import(
      '../../agents/agentRunTranscript'
    );
    const terminal = new Set(['done', 'failed', 'cancelled']);
    const finished = terminal.has(run.status);
    if (!finished) {
      return {
        ok: true,
        content: compactAgentRunToolContent({
          ...run,
          summary: `Agent run ${run.id.slice(0, 12)} still ${run.status}; live progress is in the Agents panel.`,
        }),
      };
    }
    const ok = run.status === 'done';
    return {
      ok,
      content: formatAgentRunTranscript({
        heading: `Parallel agents finished (${run.status}):`,
        synthesis: run.synthesis,
        workers: (run.workers || []).map((w) => ({
          name: w.name,
          id: w.id,
          state: w.state,
          result: w.result,
          error: w.error,
        })),
        error: run.error,
      }),
      error: ok ? undefined : run.error || run.status,
    };
  } catch (err) {
    return {
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function executeCancelAgentRun(
  args: Record<string, unknown>,
  _ctx: ToolExecutionContext,
  deps: BuiltinToolDeps,
): Promise<ToolCallResult> {
  const runId = asString(args.runId);
  if (!runId) {
    return { ok: false, content: '', error: 'runId required' };
  }
  const { isLocalAgentRunId } = await import('../../agents/localAgentRunStore');
  if (isLocalAgentRunId(runId)) {
    return {
      ok: false,
      content: '',
      error:
        'Local shell agent runs cannot be cancelled via API; they finish when terminal commands complete.',
    };
  }
  const transport = await deps.getTransport?.();
  if (!transport?.cancelAgentRun) {
    return {
      ok: false,
      content: '',
      error: 'Remote agent API unavailable.',
    };
  }
  try {
    const run = await transport.cancelAgentRun(runId);
    return { ok: true, content: JSON.stringify(run ?? { cancelled: true, runId }) };
  } catch (err) {
    return {
      ok: false,
      content: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Bridge MCP tools from @spockify/mcp ToolRegistry into unified names. */
export function syncMcpToolsIntoUnified(
  unified: UnifiedToolRegistry,
  mcp: {
    listTools: () => Array<{
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      server: string;
    }>;
    callTool: (
      server: string,
      name: string,
      args?: Record<string, unknown>,
    ) => Promise<{ ok: boolean; content: string; error?: string }>;
  },
): void {
  // Drop previous mcp__* entries
  for (const t of unified.listAll()) {
    if (t.source === 'mcp') {
      unified.unregister(t.name);
    }
  }

  for (const tool of mcp.listTools()) {
    const name = `mcp__${tool.server}__${tool.name}`;
    unified.register(
      {
        name,
        description: tool.description || `MCP ${tool.server}/${tool.name}`,
        parameters: (tool.inputSchema as Record<string, unknown>) || {
          type: 'object',
          properties: {},
        },
        // Conservative: treat MCP as potentially mutating unless name looks read-only
        mutates: !/^(list|get|read|search|find|describe|cat)/i.test(tool.name),
        source: 'mcp',
      },
      async (args, _ctx) => {
        const result = await mcp.callTool(tool.server, tool.name, args);
        return {
          ok: result.ok,
          content: result.content,
          error: result.error,
        };
      },
    );
  }
}
