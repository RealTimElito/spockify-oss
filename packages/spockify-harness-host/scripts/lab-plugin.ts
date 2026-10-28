#!/usr/bin/env npx tsx
/**
 * One JSON request on stdin → profile events on stdout.
 * Missing/broken command exits 2 with `{op:error, fallback:true}` (no hang).
 */
import { getHarness, runPluginHarness } from '../src/index';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  let req: {
    id?: string;
    cwd?: string;
    model?: string;
    prompt?: string;
    maxTurns?: number;
    baseUrl?: string;
    apiKey?: string;
  };
  try {
    req = JSON.parse(await readStdin()) as typeof req;
  } catch {
    process.stdout.write(
      `${JSON.stringify({ op: 'error', message: 'bad plugin request', fallback: true })}\n`,
    );
    process.exitCode = 2;
    return;
  }
  const cwd = req.cwd || process.cwd();
  const h = getHarness(req.id || '', cwd);
  if (!h || h.id === 'spockify') {
    process.stdout.write(
      `${JSON.stringify({
        op: 'error',
        message: `unknown harness ${req.id || ''}; using spockify`,
        fallback: true,
      })}\n`,
    );
    process.exitCode = 2;
    return;
  }
  const result = await runPluginHarness({
    harness: h,
    cwd,
    transport: {
      baseUrl: req.baseUrl || '',
      apiKey: req.apiKey || '',
      model: req.model || '',
    },
    policy: { mode: 'build', maxTurns: req.maxTurns ?? 12 },
    messages: [{ role: 'user', content: req.prompt || '' }],
    onEvent: (ev) => {
      process.stdout.write(`${JSON.stringify(ev)}\n`);
    },
  });
  if (!result.ok) {
    process.stdout.write(
      `${JSON.stringify({
        op: 'error',
        message: result.error || 'plugin failed',
        fallback: true,
      })}\n`,
    );
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify({ op: 'done', type: 'done' })}\n`);
}

void main();
