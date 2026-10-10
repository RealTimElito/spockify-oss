/**
 * Profile v0 harness registry + stdio host runner.
 * Default id `spockify` = in-process runHarness (never a plugin subprocess).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import YAML from 'yaml';

export type HarnessToolsMode = 'host' | 'plugin';

export interface HarnessYaml {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  profile?: string;
  tools?: HarnessToolsMode;
  label?: string;
}

export interface TransportInfo {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface RunPolicy {
  mode?: string;
  maxTurns?: number;
  writeRequiresRead?: boolean;
}

export interface HostRunOpts {
  harness: HarnessYaml;
  cwd: string;
  transport: TransportInfo;
  policy?: RunPolicy;
  messages: Array<{ role: string; content: string }>;
  sessionId?: string;
  signal?: AbortSignal;
  /** Called for each event line (native HarnessEvent or profile {v,t}). */
  onEvent?: (ev: Record<string, unknown>) => void;
}

const DEFAULT_SPOCKIFY: HarnessYaml = {
  id: 'spockify',
  command: 'spockify',
  args: [],
  profile: 'v0',
  tools: 'host',
  label: 'Spockify runHarness (default)',
};

export function spockifyHome(): string {
  return process.env.SPOCKIFY_HOME || path.join(os.homedir(), '.spockify');
}

export function harnessesDir(): string {
  return path.join(spockifyHome(), 'harnesses');
}

export function configPath(): string {
  return path.join(spockifyHome(), 'config.json');
}

/** Load user + project harness yamls. Built-in `spockify` always present. */
export function listHarnesses(projectRoot?: string): HarnessYaml[] {
  const out: HarnessYaml[] = [{ ...DEFAULT_SPOCKIFY }];
  const seen = new Set(['spockify']);

  const dirs = [harnessesDir()];
  if (projectRoot) {
    dirs.push(path.join(projectRoot, '.spockify'));
  }
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      if (!ent.isFile()) continue;
      if (!/\.ya?ml$/i.test(ent.name)) continue;
      try {
        const raw = fs.readFileSync(path.join(dir, ent.name), 'utf8');
        const doc = YAML.parse(raw) as HarnessYaml;
        if (!doc?.id || !doc?.command) continue;
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        out.push({
          profile: 'v0',
          tools: 'host',
          args: [],
          env: {},
          ...doc,
        });
      } catch {
        /* skip bad yaml */
      }
    }
  }
  return out;
}

export function getHarness(id: string, projectRoot?: string): HarnessYaml | undefined {
  return listHarnesses(projectRoot).find((h) => h.id === id);
}

export function readActiveHarnessId(projectRoot?: string): string {
  const forced = (process.env.SPOCKIFY_HARNESS || '').trim();
  if (forced) return forced;
  if (projectRoot) {
    const proj = path.join(projectRoot, '.spockify', 'harness.yaml');
    if (fs.existsSync(proj)) {
      try {
        const doc = YAML.parse(fs.readFileSync(proj, 'utf8')) as { id?: string };
        if (doc?.id) return doc.id;
      } catch {
        /* fall through */
      }
    }
  }
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as {
      harness?: string;
    };
    if (cfg.harness) return cfg.harness;
  } catch {
    /* default */
  }
  return 'spockify';
}

export function setActiveHarnessId(id: string): void {
  const home = spockifyHome();
  fs.mkdirSync(home, { recursive: true });
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    cfg = {};
  }
  cfg.harness = id;
  fs.writeFileSync(configPath(), `${JSON.stringify(cfg, null, 2)}\n`);
}

function expand(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, key: string) => {
    return vars[key] ?? `{${key}}`;
  });
}

export function commandDigest(h: HarnessYaml): string {
  const blob = `${h.id}|${h.command}|${(h.args || []).join(' ')}`;
  return createHash('sha256').update(blob).digest('hex').slice(0, 12);
}

/**
 * Spawn a profile-v0 plugin over stdio JSONL.
 * Missing binary → throws with install hint (caller should fall back to spockify).
 */
export async function runPluginHarness(
  opts: HostRunOpts,
): Promise<{ ok: boolean; error?: string }> {
  const h = opts.harness;
  if (h.id === 'spockify') {
    return { ok: false, error: 'use in-process runHarness for id=spockify' };
  }

  const vars: Record<string, string> = {
    cwd: opts.cwd,
    'transport.baseUrl': opts.transport.baseUrl,
    'transport.apiKey': opts.transport.apiKey,
    'transport.model': opts.transport.model,
  };

  const args = (h.args || []).map((a) => expand(a, vars));
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(h.env || {})) {
    env[k] = expand(v, vars);
  }
  // Common OpenAI-compat aliases
  env.OPENAI_BASE_URL = env.OPENAI_BASE_URL || opts.transport.baseUrl;
  env.OPENAI_API_KEY = env.OPENAI_API_KEY || opts.transport.apiKey;
  env.OPENAI_MODEL = env.OPENAI_MODEL || opts.transport.model;

  let child: ChildProcess;
  try {
    child = spawn(h.command, args, {
      cwd: opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `harness ${h.id}: cannot spawn ${h.command}: ${msg}. Install the binary or spockify harness use spockify.`,
    };
  }

  const earlyFail = new Promise<{ ok: false; error: string }>((resolve) => {
    child.once('error', (err: Error) => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      resolve({
        ok: false,
        error: `harness ${h.id}: cannot spawn ${h.command}: ${err.message}. Install the binary or spockify harness use spockify.`,
      });
    });
  });

  if (!child.stdin || !child.stdout) {
    child.kill();
    return { ok: false, error: `harness ${h.id}: no stdio` };
  }
  const stdin = child.stdin;
  const stdout = child.stdout;

  const hello = {
    v: 0,
    cmd: 'run',
    cwd: opts.cwd,
    transport: opts.transport,
    policy: {
      mode: opts.policy?.mode || 'build',
      maxTurns: opts.policy?.maxTurns ?? 48,
      writeRequiresRead: opts.policy?.writeRequiresRead !== false,
    },
    messages: opts.messages,
    sessionId: opts.sessionId || `sess-${Date.now()}`,
  };
  stdin.write(`${JSON.stringify(hello)}\n`);
  stdin.end();

  const onAbort = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  opts.signal?.addEventListener('abort', onAbort);

  const consume = (async () => {
    const rl = createInterface({ input: stdout, crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const ev = JSON.parse(trimmed) as Record<string, unknown>;
        if (typeof ev.t === 'string' && !ev.type) {
          ev.type = ev.t;
        }
        opts.onEvent?.(ev);
      } catch {
        opts.onEvent?.({ type: 'text', content: trimmed });
      }
    }
    const code: number = await new Promise((resolve) => {
      if (child.exitCode != null) {
        resolve(child.exitCode);
        return;
      }
      child.on('close', (c) => resolve(c ?? 1));
    });
    if (code !== 0) {
      return {
        ok: false as const,
        error: `harness ${h.id} exited ${code}. Falling back to Spockify kernel if caller chooses.`,
      };
    }
    return { ok: true as const };
  })();

  const result = await Promise.race([consume, earlyFail]);
  opts.signal?.removeEventListener('abort', onAbort);
  return result;
}

function commandOnPath(cmd: string): boolean {
  if (!cmd || cmd.includes('\0')) return false;
  if (cmd.startsWith('/') || /^[A-Za-z]:\\/.test(cmd)) {
    return fs.existsSync(cmd);
  }
  const quoted = `'${cmd.replace(/'/g, `'\\''`)}'`;
  const r = spawnSync('bash', ['-lc', `command -v ${quoted}`], {
    timeout: 2000,
    stdio: 'ignore',
  });
  return r.status === 0;
}

/** Resolve harness for a session; unknown/missing command → spockify (no hang). */
export function resolveHarnessOrFallback(
  id: string | undefined,
  projectRoot?: string,
): { harness: HarnessYaml; fallbackReason?: string; wanted: string } {
  const want = id || readActiveHarnessId(projectRoot);
  if (want === 'spockify') {
    return { harness: { ...DEFAULT_SPOCKIFY }, wanted: want };
  }
  const found = getHarness(want, projectRoot);
  if (!found) {
    return {
      harness: { ...DEFAULT_SPOCKIFY },
      wanted: want,
      fallbackReason: `unknown harness id ${want}; using spockify`,
    };
  }
  if (!commandOnPath(found.command)) {
    return {
      harness: { ...DEFAULT_SPOCKIFY },
      wanted: want,
      fallbackReason: `harness ${found.id}: command not found (${found.command}); using spockify`,
    };
  }
  return { harness: found, wanted: want };
}

export async function ensureHarnessDir(): Promise<void> {
  await fsPromises.mkdir(harnessesDir(), { recursive: true });
}

export { DEFAULT_SPOCKIFY };
