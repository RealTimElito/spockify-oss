/**
 * Optional out-of-process adapter for third-party harness binaries.
 * Spawns `command` with OpenAI-compatible env; emits profile-v0 / HarnessEvent JSONL.
 * Not imported by services/; not a default-image dependency.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export interface ExternalAdapterOpts {
  command: string;
  args?: string[];
  cwd: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  onEvent?: (ev: Record<string, unknown>) => void;
  signal?: AbortSignal;
}

/**
 * Spawn a foreign CLI and forward stdout lines as events.
 * Does not vendor any third-party AgentCore — argv/env wrapper only.
 */
export async function runExternalHarness(
  opts: ExternalAdapterOpts,
): Promise<{ ok: boolean; error?: string }> {
  const env = {
    ...process.env,
    OPENAI_BASE_URL: opts.baseUrl,
    OPENAI_API_KEY: opts.apiKey,
    OPENAI_MODEL: opts.model,
  };
  let child;
  try {
    child = spawn(opts.command, opts.args || [], {
      cwd: opts.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `external adapter: cannot spawn ${opts.command}: ${msg}`,
    };
  }
  if (!child.stdout) {
    child.kill();
    return { ok: false, error: 'no stdout' };
  }
  const onAbort = () => {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  };
  opts.signal?.addEventListener('abort', onAbort);
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      const ev = JSON.parse(t) as Record<string, unknown>;
      if (typeof ev.t === 'string' && !ev.type) ev.type = ev.t;
      opts.onEvent?.(ev);
    } catch {
      opts.onEvent?.({ type: 'text', content: t });
    }
  }
  opts.signal?.removeEventListener('abort', onAbort);
  const code: number = await new Promise((r) => child.on('close', (c) => r(c ?? 1)));
  if (code !== 0) {
    return { ok: false, error: `external harness exited ${code}` };
  }
  opts.onEvent?.({ type: 'done' });
  return { ok: true };
}
