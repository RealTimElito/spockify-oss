import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import ignore from 'ignore';
import type { ToolRegistry } from './registry';
import type { ToolCallResult, ToolExecutionContext } from './types';

const MAX_READ = 200_000;
const MAX_GREP_HITS = 80;
const MAX_SHELL_OUT = 200_000;

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

function ok(content: string): ToolCallResult {
  return { ok: true, content };
}

function fail(error: string): ToolCallResult {
  return { ok: false, content: '', error };
}

export function registerCliTools(registry: ToolRegistry): void {
  registry.register(
    {
      name: 'read_file',
      description: 'Read a UTF-8 text file under the workspace (optional offset/limit lines).',
      mutates: false,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path' },
          offset: { type: 'integer', description: '1-based start line' },
          limit: { type: 'integer', description: 'Max lines' },
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
        const offset =
          typeof args.offset === 'number' && args.offset > 0 ? args.offset : 1;
        const limit =
          typeof args.limit === 'number' && args.limit > 0
            ? args.limit
            : lines.length;
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = slice
          .map((l, i) => `${String(offset + i).padStart(6)}|${l}`)
          .join('\n');
        const body =
          numbered.length > MAX_READ
            ? numbered.slice(0, MAX_READ) + '\n… truncated'
            : numbered;
        return ok(body || '(empty)');
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  registry.register(
    {
      name: 'write_file',
      description: 'Write full file contents (creates parents). Prefer edit_file for small changes.',
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
        const abs = resolveSafe(ctx.cwd, String(args.path || ''));
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
      description: 'Replace exact old_string with new_string in a file (once, or all if replace_all).',
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
        if (!text.includes(oldS)) return fail('old_string not found');
        if (args.replace_all) {
          text = text.split(oldS).join(newS);
        } else {
          text = text.replace(oldS, newS);
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

  registry.register(
    {
      name: 'shell',
      description:
        'Execute a shell command in the workspace (bash -lc). Use this to run kubectl, git, npm, tests, etc. — do not only print the command for the user.',
      mutates: true,
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'Command to run, e.g. microk8s kubectl get pods -A',
          },
          timeout_ms: { type: 'integer' },
        },
        required: ['command'],
      },
    },
    async (args, ctx) => {
      const command = String(args.command || '');
      if (!command.trim()) return fail('command required');
      const timeout =
        typeof args.timeout_ms === 'number' && args.timeout_ms > 0
          ? args.timeout_ms
          : 120_000;
      return runShell(command, ctx.cwd, timeout, ctx.signal);
    },
  );
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
    // fall through to node if rg missing / error
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
    const child = spawn('bash', ['-lc', command], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const onAbort = () => {
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout.on('data', (b: Buffer) => {
      out += b.toString('utf8');
      if (out.length > MAX_SHELL_OUT) out = out.slice(0, MAX_SHELL_OUT);
    });
    child.stderr.on('data', (b: Buffer) => {
      err += b.toString('utf8');
      if (err.length > MAX_SHELL_OUT) err = err.slice(0, MAX_SHELL_OUT);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const body = [
        `exit ${code ?? '?'}`,
        out ? `stdout:\n${out}` : '',
        err ? `stderr:\n${err}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      resolve({ ok: (code ?? 1) === 0, content: body, error: code ? `exit ${code}` : undefined });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
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
