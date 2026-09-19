#!/usr/bin/env npx tsx
/**
 * Lab → kernel stdio adapter.
 * Orch/exec policy stays elsewhere; tools run only via runHarness (+ TaskAgent subsets).
 *
 * Line protocol (stdin JSON → stdout JSON):
 *   {"op":"tools","kind":"...","cwd":"...","model":"...","prompt":"...","maxTurns"?:n}
 *   {"op":"call","cwd":"...","tool":"write_file","args":{...}}  — single HostTools call
 * Events: HarnessEvent objects / toolResult, then {"op":"done","ok":true}.
 */
import { createInterface } from 'node:readline';
import { createModelTransport } from '@spockify/ide-client';
import {
  runHarness,
  ToolRegistry,
  registerHarnessTools,
  childMayUseTool,
  type HarnessSession,
  type TaskKind,
} from '../src/index';

const KEY =
  process.env.SPOCKIFY_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.LITELLM_MASTER_KEY ||
  '';
const BASE =
  process.env.SPOCKIFY_BASE_URL ||
  process.env.OPENAI_API_BASE?.replace(/\/v1\/?$/, '') ||
  'http://127.0.0.1:24001';

type ToolsReq = {
  op: 'tools';
  kind?: TaskKind | 'plan' | 'coding';
  cwd: string;
  model: string;
  prompt: string;
  maxTurns?: number;
};

type CallReq = {
  op: 'call';
  cwd: string;
  tool: string;
  args?: Record<string, unknown>;
};

type Req = ToolsReq | CallReq;

function write(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function resolveKind(raw?: string): TaskKind {
  if (raw === 'explore' || raw === 'plan') return 'explore';
  if (raw === 'bash') return 'bash';
  return 'general';
}

async function seedReadSet(cwd: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const seeded: string[] = [];
  try {
    for (const ent of await fs.readdir(cwd, { withFileTypes: true })) {
      if (!ent.isFile()) continue;
      if (ent.name.startsWith('.')) continue;
      seeded.push(ent.name);
      seeded.push(path.join(cwd, ent.name));
    }
  } catch {
    /* empty cwd ok */
  }
  return seeded;
}

async function runTools(req: ToolsReq): Promise<void> {
  if (!KEY) {
    write({ op: 'error', message: 'missing API key' });
    return;
  }
  const kind = resolveKind(req.kind);
  const registry = new ToolRegistry();
  registerHarnessTools(registry);
  const filtered = new ToolRegistry();
  const mode = kind === 'explore' ? 'plan' : 'build';
  for (const t of registry.listForMode(mode)) {
    if (!childMayUseTool(kind, t.name)) continue;
    filtered.register(t, (args, ctx) => t.execute(args, ctx));
  }

  const transport = createModelTransport({
    apiKey: KEY,
    baseUrl: BASE,
    apiBackend: 'litellm',
  });

  const seeded = await seedReadSet(req.cwd);
  const session: HarnessSession = {
    messages: [{ role: 'user', content: req.prompt }],
    tick: 0,
    readSet: seeded,
    toolLog: [],
    todos: [],
    cwd: req.cwd,
    model: req.model,
  };

  for await (const ev of runHarness({
    transport,
    session,
    registry: filtered,
    policy: {
      mode,
      yolo: true,
      maxTurns: req.maxTurns ?? 12,
      writeRequiresRead: true,
      editCascade: true,
      thinking: 'low',
    },
  })) {
    write(ev);
  }
  write({ op: 'done', ok: true });
}

/** Deterministic single-tool call through the harness registry (no LLM). */
async function runCall(req: CallReq): Promise<void> {
  const registry = new ToolRegistry();
  registerHarnessTools(registry);
  const seeded = await seedReadSet(req.cwd);
  const readSet = new Set(seeded);
  const result = await registry.call(req.tool, req.args || {}, {
    cwd: req.cwd,
    mode: 'build',
    yolo: true,
    readSet,
    writeRequiresRead: true,
  });
  write({
    type: 'toolResult',
    id: 'call-1',
    name: req.tool,
    ok: result.ok,
    content: result.content || '',
    error: result.error,
  });
  write({ op: 'done', ok: result.ok });
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: Req;
    try {
      req = JSON.parse(trimmed) as Req;
    } catch {
      write({ op: 'error', message: 'invalid json' });
      continue;
    }
    if (req.op === 'tools') {
      await runTools(req);
    } else if (req.op === 'call') {
      await runCall(req);
    } else {
      write({ op: 'error', message: `unknown op` });
    }
  }
}

main().catch((err) => {
  write({
    op: 'error',
    message: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
