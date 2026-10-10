import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import ignore from 'ignore';
import {
  applySearchReplace,
  applyEditCascade,
  gitReset,
  gitSnapshot,
  rejectUnifiedDiff,
  type GitSnapshot,
} from './gitTxn';
import { KillRegistry, spawnBashGroup } from './kill';
import { classifyBash, PermissionMemory } from './permissions';

import {
  childMayUseTool,
  killTaskAgent,
  runTaskBash,
  spawnTaskAgent,
  type TaskKind,
} from './taskAgent';
import { loadSkills, readNapkin, writeNapkin } from './skills';
import type { ToolRegistry } from './registry';
import type { TodoItem, ToolCallResult, ToolExecutionContext } from './types';

const MAX_READ = 200_000;
const MAX_GREP_HITS = 80;
const MAX_SHELL_OUT = 200_000;

/** Module-level snapshot for git_reset after git_snapshot. */
const snapshots = new Map<string, GitSnapshot>();
export const defaultKillRegistry = new KillRegistry();

function resolveSafe(cwd: string, rel: string): string {
  const root = path.resolve(cwd);
  const target = path.resolve(root, rel || '.');
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  return target;
}

async function loadIgnore(cwd: string) {
  const ig = ignore();
  ig.add(['.git/', 'node_modules/', 'dist/', 'build/', '.venv/', 'venv/']);
  for (const name of ['.gitignore', '.spockifyignore']) {
    try {
      const text = await fs.readFile(path.join(cwd, name), 'utf8');
      ig.add(text);
    } catch {
      /* missing */
    }
  }
  return ig;
}

function ok(content: string, extra?: Partial<ToolCallResult>): ToolCallResult {
  return { ok: true, content, ...extra };
}

function fail(error: string, extra?: Partial<ToolCallResult>): ToolCallResult {
  return { ok: false, content: '', error, ...extra };
}

/** Write guard: path must appear in the last K reads (default 3). */
export const READ_SET_K = 3;

/** Record a read; keep only the last READ_SET_K paths (insertion-ordered Set). */
export function noteReadPath(
  readSet: Set<string>,
  rel: string,
  k: number = READ_SET_K,
): void {
  const p = rel.replace(/\\/g, '/');
  readSet.delete(p);
  readSet.add(p);
  while (readSet.size > k) {
    const oldest = readSet.values().next().value as string | undefined;
    if (oldest == null) break;
    readSet.delete(oldest);
  }
}

function noteRead(ctx: ToolExecutionContext, rel: string): void {
  if (!ctx.readSet) return;
  noteReadPath(ctx.readSet, rel);
}

export function registerHarnessTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'read_file',
      description:
        'Read a UTF-8 text file under the workspace (optional offset/limit lines). Prefer over unbounded cat.',
      mutates: false,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path' },
          offset: { type: 'integer', description: '1-based start line' },
          limit: { type: 'integer', description: 'Max lines' },
          start: { type: 'integer', description: 'Alias for offset' },
          end: { type: 'integer', description: 'Inclusive end line' },
        },
        required: ['path'],
      },
    },
    async (args, ctx) => {
      try {
        const rel = String(args.path || '');
        const abs = resolveSafe(ctx.cwd, rel);
        const raw = await fs.readFile(abs, 'utf8');
        const lines = raw.split(/\r?\n/);
        let offset =
          typeof args.offset === 'number' && args.offset > 0
            ? args.offset
            : typeof args.start === 'number' && args.start > 0
              ? args.start
              : 1;
        let limit =
          typeof args.limit === 'number' && args.limit > 0
            ? args.limit
            : lines.length;
        if (typeof args.end === 'number' && args.end >= offset) {
          limit = args.end - offset + 1;
        }
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = slice
          .map((l, i) => `${String(offset + i).padStart(6)}|${l}`)
          .join('\n');
        const body =
          numbered.length > MAX_READ
            ? numbered.slice(0, MAX_READ) + '\n… truncated'
            : numbered;
        noteRead(ctx, path.relative(ctx.cwd, abs));
        return ok(body || '(empty)');
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // OpenCode-shaped alias
  registry.register(
    {
      name: 'read',
      description: 'Alias for read_file (path + optional start/end lines).',
      mutates: false,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'integer' },
          limit: { type: 'integer' },
          start: { type: 'integer' },
          end: { type: 'integer' },
        },
        required: ['path'],
      },
    },
    async (args, ctx) => registry.call('read_file', args, ctx),
  );

  registry.register(
    {
      name: 'write_file',
      description:
        'Write full file contents (creates parents). Prefer apply_patch/edit_file for edits. Requires prior read of existing paths.',
      mutates: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
    async (args, ctx) => {
      try {
        const rel = String(args.path || '');
        const abs = resolveSafe(ctx.cwd, rel);
        let exists = false;
        try {
          await fs.access(abs);
          exists = true;
        } catch {
          exists = false;
        }
        if (exists && ctx.writeRequiresRead !== false && ctx.readSet) {
          const norm = path.relative(ctx.cwd, abs).replace(/\\/g, '/');
          const relN = rel.replace(/\\/g, '/');
          if (!ctx.readSet.has(norm) && !ctx.readSet.has(relN)) {
            return fail('READ_REQUIRED: read path in last turns before write_file', {
              failObject: { code: 'READ_REQUIRED', path: norm },
            });
          }
        }
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, String(args.content ?? ''), 'utf8');
        return ok(`Wrote ${path.relative(ctx.cwd, abs)}`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  registry.register(
    {
      name: 'edit_file',
      description:
        'Replace old_string with new_string (exact, then whitespace-normalized).',
      mutates: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
          replace_all: { type: 'boolean' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
    async (args, ctx) => {
      try {
        const abs = resolveSafe(ctx.cwd, String(args.path || ''));
        const oldS = String(args.old_string ?? '');
        const newS = String(args.new_string ?? '');
        if (!oldS) return fail('old_string required');
        let text = await fs.readFile(abs, 'utf8');
        const rel = path.relative(ctx.cwd, abs).replace(/\\/g, '/');
        const justRead = Boolean(ctx.readSet?.has(rel));
        if (args.replace_all) {
          if (text.includes(oldS)) {
            text = text.split(oldS).join(newS);
          } else {
            const one = applyEditCascade(text, oldS, newS, { justRead });
            if (!one.ok) return fail(one.error);
            text = one.text;
          }
        } else {
          const one = applyEditCascade(text, oldS, newS, { justRead });
          if (!one.ok) return fail(one.error);
          text = one.text;
          await fs.writeFile(abs, text, 'utf8');
          return ok(
            `Edited ${path.relative(ctx.cwd, abs)} (cascade L${one.layer})`,
          );
        }
        await fs.writeFile(abs, text, 'utf8');
        return ok(`Edited ${path.relative(ctx.cwd, abs)}`);
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  registry.register(
    {
      name: 'apply_patch',
      description:
        'Apply SEARCH/REPLACE hunks to a file (only legal write format). Rejects unified diffs.',
      mutates: true,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          patch: { type: 'string', description: 'SEARCH\\n...\\nREPLACE\\n...' },
          search: { type: 'string' },
          replace: { type: 'string' },
        },
        required: ['path'],
      },
    },
    async (args, ctx) => {
      try {
        const rel = typeof args.path === 'string' ? args.path.trim() : '';
        if (!rel) return fail('path required');
        const abs = resolveSafe(ctx.cwd, rel);
        const patchBody =
          typeof args.patch === 'string'
            ? args.patch
            : typeof args.search === 'string'
              ? `SEARCH\n${args.search}\nREPLACE\n${args.replace ?? ''}`
              : '';
        if (!patchBody.trim()) return fail('patch or search/replace required');
        const rej = rejectUnifiedDiff(patchBody);
        if (rej) return fail(rej);
        let text = await fs.readFile(abs, 'utf8');
        const hunks = parseSrHunks(patchBody);
        if (!hunks.length && typeof args.search === 'string') {
          hunks.push({
            search: String(args.search),
            replace: String(args.replace ?? ''),
          });
        }
        if (!hunks.length) return fail('no SEARCH/REPLACE hunks found');
        const layers: number[] = [];
        for (const h of hunks) {
          const r = applySearchReplace(text, h.search, h.replace);
          if (!r.ok) return fail(r.error);
          text = r.text;
          layers.push(r.layer);
        }
        await fs.writeFile(abs, text, 'utf8');
        return ok(
          `apply_patch ok ${path.relative(ctx.cwd, abs)} (${hunks.length} hunks; cascade L${layers.join(',')})`,
        );
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  registry.register(
    {
      name: 'glob_file_search',
      description: 'Find files by glob pattern under the workspace.',
      mutates: false,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'e.g. **/*.ts' },
          path: { type: 'string', description: 'Subdirectory' },
        },
        required: ['pattern'],
      },
    },
    async (args, ctx) => {
      try {
        const base = resolveSafe(ctx.cwd, String(args.path || '.'));
        const ig = await loadIgnore(ctx.cwd);
        const hits = await fg(String(args.pattern || '**/*'), {
          cwd: base,
          onlyFiles: true,
          dot: false,
          absolute: false,
          suppressErrors: true,
        });
        const filtered = hits
          .filter((h) => !ig.ignores(h))
          .slice(0, 200)
          .map((h) => path.relative(ctx.cwd, path.join(base, h)));
        return ok(filtered.join('\n') || '(no matches)');
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  registry.register(
    {
      name: 'glob',
      description: 'Alias for glob_file_search.',
      mutates: false,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['pattern'],
      },
    },
    async (args, ctx) => registry.call('glob_file_search', args, ctx),
  );

  registry.register(
    {
      name: 'grep',
      description: 'Search file contents with a regex (ripgrep if available, else Node).',
      mutates: false,
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
          glob: { type: 'string' },
          case_insensitive: { type: 'boolean' },
        },
        required: ['pattern'],
      },
    },
    async (args, ctx) => runGrep(args, ctx),
  );

  const shellParams = {
    type: 'object' as const,
    properties: {
      command: { type: 'string' },
      timeout_ms: { type: 'integer' },
    },
    required: ['command'],
  };

  const executeShell: import('./types').ToolExecutor = async (args, ctx) => {
    const command = String(args.command || '');
    if (!command.trim()) return fail('command required');
    const action = classifyBash(command);
    if (action === 'deny') {
      return fail('shell denied by classifier (destructive pattern)');
    }
    if (action === 'ask' && !ctx.yolo) {
      const granted = ctx.permissions?.allows('shell', { command });
      if (!granted && ctx.confirm) {
        const okUser = await ctx.confirm('shell', { command });
        if (!okUser) return fail('User denied tool');
        ctx.permissions?.remember('shell', { command });
      } else if (!granted && !ctx.confirm) {
        return fail('shell requires confirm or session grant');
      }
    } else if (action === 'ask' && ctx.yolo && ctx.yoloGrants === 'none') {
      return fail('yoloGrants=none blocks ask-class shell');
    }
    const timeout =
      typeof args.timeout_ms === 'number' && args.timeout_ms > 0
        ? args.timeout_ms
        : 300_000;
    return runShell(command, ctx.cwd, timeout, ctx.signal);
  };

  registry.register(
    {
      name: 'shell',
      description:
        'Execute a shell command in the workspace (bash -lc). Sandboxed by cwd; plan mode blocks this.',
      mutates: true,
      parameters: shellParams,
    },
    executeShell,
  );

  registry.register(
    {
      name: 'bash',
      description: 'Alias for shell.',
      mutates: true,
      parameters: shellParams,
    },
    executeShell,
  );

  registry.register(
    {
      name: 'run_tests',
      description:
        'Run pytest or a custom command; returns fail-object JSON on red.',
      mutates: true,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Default: pytest -q',
          },
          timeout_ms: { type: 'integer' },
        },
      },
    },
    async (args, ctx) => {
      const command = String(args.command || 'pytest -q');
      const timeout =
        typeof args.timeout_ms === 'number' && args.timeout_ms > 0
          ? args.timeout_ms
          : 300_000;
      const result = await runShell(command, ctx.cwd, timeout, ctx.signal);
      if (result.ok) return result;
      const failObject = {
        schema: 'fail-object.v1',
        command,
        exit: result.error || 'nonzero',
        stdout_tail: (result.content || '').slice(-4000),
        cwd: ctx.cwd,
      };
      return {
        ok: false,
        content: JSON.stringify(failObject, null, 2),
        error: 'tests_failed',
        failObject,
      };
    },
  );

  registry.register(
    {
      name: 'git_snapshot',
      description: 'Record HEAD before first WRITE; used by git_reset on red.',
      mutates: false,
      parameters: { type: 'object', properties: {} },
    },
    async (_args, ctx) => {
      const snap = await gitSnapshot(ctx.cwd);
      if (!snap) return fail('not a git repo');
      snapshots.set(ctx.cwd, snap);
      return ok(
        JSON.stringify({
          head: snap.head,
          dirty_before: snap.dirtyBefore,
        }),
      );
    },
  );

  registry.register(
    {
      name: 'git_reset',
      description: 'reset --hard to last git_snapshot (refuses if dirty at snapshot).',
      mutates: true,
      parameters: { type: 'object', properties: {} },
    },
    async (_args, ctx) => {
      const snap = snapshots.get(ctx.cwd);
      if (!snap) return fail('no snapshot; call git_snapshot first');
      const r = await gitReset(snap);
      return r.ok ? ok(r.message) : fail(r.message);
    },
  );

  registry.register(
    {
      name: 'todowrite',
      description: 'Durable task list that survives compact.',
      mutates: false,
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                status: { type: 'string' },
              },
            },
          },
          merge: { type: 'boolean' },
        },
        required: ['todos'],
      },
    },
    async (args, ctx) => {
      const incoming = Array.isArray(args.todos) ? (args.todos as TodoItem[]) : [];
      if (!ctx.todos) return fail('session todos not bound');
      if (args.merge) {
        for (const t of incoming) {
          const i = ctx.todos.findIndex((x) => x.id === t.id);
          if (i >= 0) ctx.todos[i] = { ...ctx.todos[i]!, ...t };
          else ctx.todos.push(t);
        }
      } else {
        ctx.todos.splice(0, ctx.todos.length, ...incoming);
      }
      return ok(JSON.stringify(ctx.todos, null, 2));
    },
  );

  registry.register(
    {
      name: 'todo',
      description: 'Alias for todowrite.',
      mutates: false,
      parameters: {
        type: 'object',
        properties: {
          todos: { type: 'array' },
          merge: { type: 'boolean' },
        },
        required: ['todos'],
      },
    },
    async (args, ctx) => registry.call('todowrite', args, ctx),
  );

  registry.register(
    {
      name: 'ask_user',
      description: 'Ask the user a clarifying question (surfaces as askUser event).',
      mutates: false,
      parameters: {
        type: 'object',
        properties: { prompt: { type: 'string' } },
        required: ['prompt'],
      },
    },
    async (args, ctx) => {
      const prompt = String(args.prompt || '');
      ctx.onEvent?.({ type: 'askUser', prompt });
      if (ctx.askUser) {
        const answer = await ctx.askUser(prompt);
        return ok(answer);
      }
      return ok('(ask_user queued; no interactive bridge)');
    },
  );

  registry.register(
    {
      name: 'task',
      description:
        'Spawn a typed TaskAgent (explore|bash|general). Children cannot nest task.',
      mutates: true,
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'explore|bash|general' },
          prompt: { type: 'string' },
          command: { type: 'string', description: 'For kind=bash' },
        },
        required: ['kind'],
      },
    },
    async (args, ctx) => {
      const kind = String(args.kind || 'general') as TaskKind;
      if (!['explore', 'bash', 'general'].includes(kind)) {
        return fail('kind must be explore|bash|general');
      }
      const handle = spawnTaskAgent(kind);
      ctx.onEvent?.({ type: 'taskSpawn', id: handle.id, kind });
      try {
        if (kind === 'bash') {
          const command = String(args.command || args.prompt || 'true');
          if (!childMayUseTool(kind, 'shell')) return fail('shell not in subset');
          const r = await runTaskBash(handle, command, ctx.cwd);
          ctx.onEvent?.({ type: 'taskDone', id: handle.id });
          return r;
        }
        // explore/general: return subset contract (full nested loop is Phase 4+)
        ctx.onEvent?.({ type: 'taskDone', id: handle.id });
        return ok(
          JSON.stringify({
            id: handle.id,
            kind,
            prompt: String(args.prompt || ''),
            tools: [...(kind === 'explore'
              ? ['read', 'grep', 'glob']
              : ['read', 'grep', 'glob', 'shell', 'apply_patch'])],
            note: 'task agent spawned; nested runHarness deferred to client',
          }),
        );
      } finally {
        killTaskAgent(handle);
      }
    },
  );

  registry.register(
    {
      name: 'checkpoint',
      description: 'Git snapshot alias (shadow/keep checkpoint).',
      mutates: false,
      parameters: { type: 'object', properties: {} },
    },
    async (args, ctx) => registry.call('git_snapshot', args, ctx),
  );

  registry.register(
    {
      name: 'list_skills',
      description: 'List markdown skills under skills dir or .spockify/skills.',
      mutates: false,
      parameters: {
        type: 'object',
        properties: { dir: { type: 'string' } },
      },
    },
    async (args, ctx) => {
      const dir = String(
        args.dir || path.join(ctx.cwd, '.spockify', 'skills'),
      );
      const skills = await loadSkills(dir);
      return ok(
        skills.map((s) => `${s.id}: ${s.title}`).join('\n') || '(no skills)',
      );
    },
  );

  registry.register(
    {
      name: 'activate_skill',
      description: 'Load a skill body into the session active set.',
      mutates: false,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          dir: { type: 'string' },
        },
        required: ['id'],
      },
    },
    async (args, ctx) => {
      const dir = String(
        args.dir || path.join(ctx.cwd, '.spockify', 'skills'),
      );
      const skills = await loadSkills(dir);
      const hit = skills.find((s) => s.id === String(args.id));
      if (!hit) return fail(`skill not found: ${args.id}`);
      if (!ctx.activeSkills) return fail('activeSkills not bound');
      ctx.activeSkills.push(hit.body);
      return ok(`activated ${hit.id} (${hit.title})`);
    },
  );

  registry.register(
    {
      name: 'napkin',
      description: 'Read/write .spockify/napkin.md (no Wichy notebook.db).',
      mutates: true,
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'If set, overwrite napkin' },
        },
      },
    },
    async (args, ctx) => {
      if (typeof args.text === 'string') {
        const p = await writeNapkin(ctx.cwd, args.text);
        return ok(`wrote ${p}`);
      }
      return ok((await readNapkin(ctx.cwd)) || '(empty napkin)');
    },
  );

  registry.register(
    {
      name: 'grant',
      description: 'Add a session grant pattern (e.g. "bash npm *").',
      mutates: false,
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string' } },
        required: ['pattern'],
      },
    },
    async (args, ctx) => {
      if (!ctx.permissions) ctx.permissions = new PermissionMemory();
      ctx.permissions.grant(String(args.pattern || ''));
      return ok(JSON.stringify(ctx.permissions.list(), null, 2));
    },
  );

  registry.register(
    {
      name: 'revoke',
      description: 'Revoke all session grants.',
      mutates: false,
      parameters: { type: 'object', properties: {} },
    },
    async (_args, ctx) => {
      ctx.permissions?.revokeAll();
      return ok('grants revoked');
    },
  );
}

/** Back-compat name used by CLI. */
export const registerCliTools = registerHarnessTools;

function parseSrHunks(body: string): Array<{ search: string; replace: string }> {
  const hunks: Array<{ search: string; replace: string }> = [];
  const re =
    /^\s*SEARCH\s*\n([\s\S]*?)^\s*REPLACE\s*\n([\s\S]*?)(?=^\s*SEARCH\s*$|\Z)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    let s = m[1] || '';
    let r = m[2] || '';
    if (s.endsWith('\n')) s = s.slice(0, -1);
    if (r.endsWith('\n')) r = r.slice(0, -1);
    hunks.push({ search: s, replace: r });
  }
  return hunks;
}

async function runGrep(
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolCallResult> {
  const pattern = String(args.pattern || '');
  if (!pattern) return fail('pattern required');
  const searchRoot = resolveSafe(ctx.cwd, String(args.path || '.'));
  const glob = typeof args.glob === 'string' ? args.glob : undefined;
  const ci = Boolean(args.case_insensitive);

  const rgArgs = ['-n', '--no-heading', '--color', 'never', '-m', '20'];
  if (ci) rgArgs.push('-i');
  if (glob) rgArgs.push('--glob', glob);
  rgArgs.push('--', pattern, searchRoot);

  const rg = await runShellCapture('rg', rgArgs, ctx.cwd, 60_000, ctx.signal);
  if (rg.started) {
    if (rg.code === 0 || rg.code === 1) {
      const text = (rg.stdout || '(no matches)').slice(0, MAX_GREP_HITS * 200);
      return ok(text);
    }
    if (!/ENOENT|not found/i.test(rg.stderr)) {
      return fail(rg.stderr || `rg exit ${rg.code}`);
    }
  }

  try {
    const ig = await loadIgnore(ctx.cwd);
    const files = await fg(glob || '**/*', {
      cwd: searchRoot,
      onlyFiles: true,
      absolute: true,
      suppressErrors: true,
    });
    const re = new RegExp(pattern, ci ? 'i' : undefined);
    const lines: string[] = [];
    for (const abs of files) {
      const rel = path.relative(ctx.cwd, abs);
      if (ig.ignores(rel)) continue;
      let text: string;
      try {
        text = await fs.readFile(abs, 'utf8');
      } catch {
        continue;
      }
      const fileLines = text.split(/\r?\n/);
      for (let i = 0; i < fileLines.length; i++) {
        if (re.test(fileLines[i]!)) {
          lines.push(`${rel}:${i + 1}:${fileLines[i]}`);
          if (lines.length >= MAX_GREP_HITS) {
            return ok(lines.join('\n') + '\n… truncated');
          }
        }
      }
    }
    return ok(lines.join('\n') || '(no matches)');
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function runShell(
  command: string,
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ToolCallResult> {
  return new Promise((resolve) => {
    const child = spawnBashGroup(command, cwd);
    const id = `shell_${Date.now().toString(36)}`;
    defaultKillRegistry.track(id, child);
    let out = '';
    let err = '';
    const onAbort = () => {
      defaultKillRegistry.kill(id, 'SIGTERM');
      setTimeout(() => defaultKillRegistry.kill(id, 'SIGKILL'), 2000);
    };
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      defaultKillRegistry.kill(id, 'SIGKILL');
    }, timeoutMs);
    child.stdout?.on('data', (b: Buffer) => {
      out += b.toString('utf8');
      if (out.length > MAX_SHELL_OUT) out = out.slice(0, MAX_SHELL_OUT);
    });
    child.stderr?.on('data', (b: Buffer) => {
      err += b.toString('utf8');
      if (err.length > MAX_SHELL_OUT) err = err.slice(0, MAX_SHELL_OUT);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      defaultKillRegistry.untrack(id);
      const body = [
        `exit ${code ?? '?'}`,
        out ? `stdout:\n${out}` : '',
        err ? `stderr:\n${err}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      resolve({
        ok: (code ?? 1) === 0,
        content: body,
        error: code ? `exit ${code}` : undefined,
      });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      defaultKillRegistry.untrack(id);
      resolve(fail(e.message));
    });
  });
}

function runShellCapture(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ started: boolean; code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let started = true;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const onAbort = () => child.kill('SIGTERM');
    signal?.addEventListener('abort', onAbort);
    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({
        started: false,
        code: null,
        stdout: '',
        stderr: e.message,
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ started, code, stdout, stderr });
    });
  });
}
