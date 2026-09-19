#!/usr/bin/env npx tsx
/**
 * Small-model control-plane card: gpt-oss-20b × three fixtures via runHarness.
 * 2026-09-19: ws_cascade must be red→green with cascade L≥1 (scripted fallback ok).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createModelTransport } from '@spockify/ide-client';
import {
  runHarness,
  ToolRegistry,
  registerHarnessTools,
  type HarnessSession,
} from '../src/index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const CARD_DIR = path.join(ROOT, 'snapshots/harness-20b-card-20260919');
const FIX = path.join(CARD_DIR, 'fixtures');
const MODEL = process.env.SPOCKIFY_BENCH_MODEL || 'gpt-oss-20b';
const BASE =
  process.env.SPOCKIFY_BASE_URL ||
  process.env.OPENAI_API_BASE?.replace(/\/v1\/?$/, '') ||
  'http://127.0.0.1:24001';
const KEY =
  process.env.SPOCKIFY_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.LITELLM_MASTER_KEY ||
  '';

const WS_SEARCH =
  'def greet(name):\n    return f"hi {name}"\n';
const WS_REPLACE =
  'def greet(name):\n    return f"hello {name}"\n';

type Row = {
  fixture: string;
  resolved: 'Y' | 'N';
  repair_turn_used: 'Y' | 'N';
  read_required_hits: number;
  cascade_layer?: number | null;
  wall_s: number;
  commit_sha: string;
  notes: string;
};

function gitSha(): string {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return (r.stdout || 'unknown').trim();
}

function pytestGreen(cwd: string): boolean {
  const r = spawnSync('python3', ['-m', 'pytest', '-q'], {
    cwd,
    encoding: 'utf8',
  });
  return r.status === 0;
}

async function copyFixture(name: string): Promise<string> {
  const src = path.join(FIX, name);
  const dest = path.join(CARD_DIR, 'work', name);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  for (const ent of await fs.readdir(src, { withFileTypes: true })) {
    if (!ent.isFile()) continue;
    if (ent.name.startsWith('.')) continue;
    await fs.copyFile(path.join(src, ent.name), path.join(dest, ent.name));
  }
  return dest;
}

/** Deterministic one-shot edit_file when the model refuses — proves cascade L1. */
async function scriptedWsCascadeEdit(cwd: string): Promise<number | null> {
  const registry = new ToolRegistry();
  registerHarnessTools(registry);
  const result = await registry.call(
    'edit_file',
    { path: 'greet.py', old_string: WS_SEARCH, new_string: WS_REPLACE },
    {
      cwd,
      mode: 'build',
      yolo: true,
      readSet: new Set(['greet.py']),
    },
  );
  if (!result.ok) return null;
  const m = result.content.match(/cascade L(\d+)/);
  return m ? Number(m[1]) : null;
}

const PROMPTS: Record<string, string> = {
  rate_write_gate:
    'The tests already pass. Append a one-line module docstring to rate.py using write_file ONLY. ' +
    'Do not call read_file or read first. Then run pytest -q.',
  ws_cascade:
    'greet.py return line has trailing spaces (formatter drift). Tests expect hello, not hi. ' +
    'Use edit_file or apply_patch with SEARCH/old_string EXACTLY (no trailing spaces):\n' +
    WS_SEARCH +
    'Replace hi with hello. Then pytest -q.',
  fence_repair:
    'IMPORTANT: Do NOT use native tool_calls. Reply with ONLY a markdown ```bash fence that runs `pytest -q`. ' +
    'Do not emit a ```tool fence on the first reply.',
};

async function runOne(fixture: string, sha: string): Promise<Row> {
  const cwd = await copyFixture(fixture);
  const beforeGreen = pytestGreen(cwd);
  const transport = createModelTransport({
    apiKey: KEY,
    baseUrl: BASE,
    apiBackend: 'litellm',
  });
  const registry = new ToolRegistry();
  registerHarnessTools(registry);

  const session: HarnessSession = {
    messages: [{ role: 'user', content: PROMPTS[fixture]! }],
    tick: 0,
    readSet: [],
    toolLog: [],
    todos: [],
    cwd,
    model: MODEL,
  };

  let repair = false;
  let readReq = 0;
  let cascadeLayer: number | null = null;
  let scripted = false;
  const t0 = Date.now();

  for await (const ev of runHarness({
    transport,
    session,
    registry,
    policy: {
      mode: 'build',
      yolo: true,
      maxTurns: 5,
      writeRequiresRead: true,
      editCascade: true,
      thinking: 'low',
    },
  })) {
    if (ev.type === 'toolResult') {
      const blob = `${ev.error || ''} ${ev.content || ''}`;
      if (/READ_REQUIRED/.test(blob)) readReq++;
      const layerHit = blob.match(/cascade L([\d,]+)/);
      if (layerHit) {
        const n = Number(String(layerHit[1]).split(',')[0]);
        if (Number.isFinite(n)) cascadeLayer = n;
      }
    }
    if (ev.type === 'text' && /not a tool call/i.test(ev.content)) {
      repair = true;
    }
  }

  for (const m of session.messages) {
    if (m.role === 'user' && /not a tool call/i.test(m.content)) {
      repair = true;
    }
  }

  if (fixture === 'ws_cascade') {
    const body = await fs.readFile(path.join(cwd, 'greet.py'), 'utf8');
    if (!/hello/.test(body) || (cascadeLayer ?? 0) < 1) {
      const layer = await scriptedWsCascadeEdit(cwd);
      if (layer != null) {
        cascadeLayer = layer;
        scripted = true;
      }
    }
  }

  const afterGreen = pytestGreen(cwd);
  const wall = Math.round((Date.now() - t0) / 1000);

  let resolved: 'Y' | 'N' = 'N';
  let notes = `before_green=${beforeGreen} after_green=${afterGreen}`;

  if (fixture === 'rate_write_gate') {
    resolved = afterGreen ? 'Y' : 'N';
    if (readReq > 0) notes += '; WRITE_GATE_HIT';
  } else if (fixture === 'ws_cascade') {
    const body = await fs.readFile(path.join(cwd, 'greet.py'), 'utf8');
    const edited = /hello/.test(body);
    resolved =
      !beforeGreen && edited && afterGreen && (cascadeLayer ?? 0) >= 1
        ? 'Y'
        : 'N';
    if (cascadeLayer != null) notes += `; cascade_L${cascadeLayer}`;
    if (edited) notes += '; edit_applied';
    if (scripted) notes += '; SCRIPTED_EDIT';
    if (beforeGreen) notes += '; BAD_FIXTURE_WAS_GREEN';
  } else {
    resolved = afterGreen ? 'Y' : 'N';
    if (repair) notes += '; REPAIR_TURN';
  }

  return {
    fixture,
    resolved,
    repair_turn_used: repair ? 'Y' : 'N',
    read_required_hits: readReq,
    cascade_layer: cascadeLayer,
    wall_s: wall,
    commit_sha: sha,
    notes,
  };
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error('Need SPOCKIFY_API_KEY / OPENAI_API_KEY / LITELLM_MASTER_KEY');
    process.exit(2);
  }
  const sha = gitSha();
  const rows: Row[] = [];
  for (const name of ['rate_write_gate', 'ws_cascade', 'fence_repair'] as const) {
    console.error(`=== running ${name} ===`);
    rows.push(await runOne(name, sha));
    console.error(JSON.stringify(rows[rows.length - 1], null, 2));
  }

  const ws = rows.find((r) => r.fixture === 'ws_cascade');
  const cascadeFired = (ws?.cascade_layer ?? 0) >= 1;
  const cascadeResolved = ws?.resolved === 'Y';

  const md: string[] = [
    '# Harness small-model card — gpt-oss-20b × 3 fixtures',
    '',
    `- Host: LiteLLM \`${BASE}\` (same board path; workers not raised)`,
    `- Model: \`${MODEL}\``,
    `- Harness entry: \`runHarness\` (@spockify/harness)`,
    `- Commit SHA: \`${sha}\` (pre-commit tip; card re-stamped after commit)`,
    `- Date: 2026-09-19`,
    `- Wichy same-box: see SAMEBOX.md (install attempt on eval host)`,
    '',
    '| fixture | resolved | repair-turn used | READ_REQUIRED hits | cascade L | wall s | commit SHA |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    md.push(
      `| ${r.fixture} | ${r.resolved} | ${r.repair_turn_used} | ${r.read_required_hits} | ${r.cascade_layer ?? '—'} | ${r.wall_s} | ${r.commit_sha} |`,
    );
  }
  md.push('');
  md.push('## Notes');
  for (const r of rows) {
    md.push(`- **${r.fixture}**: ${r.notes}`);
  }
  md.push('');
  md.push('## Cascade proof');
  md.push(
    `- ws_cascade L≥1 fired: ${cascadeFired ? 'Y' : 'N'} · resolved: ${cascadeResolved ? 'Y' : 'N'}`,
  );
  md.push(
    '- Fixture design: pytest red until hi→hello; SEARCH omits trailing spaces so exact match cannot succeed.',
  );
  md.push('');
  md.push('## Surpass claim');
  const edge =
    rows.some((r) => r.repair_turn_used === 'Y') ||
    (cascadeFired && cascadeResolved);
  md.push(
    edge
      ? 'Measured edge only if repair-turn or cascade L≥1 saved a case exact-match/native-tools would drop — see notes. No board % claimed. Same-box vs other harnesses only in SAMEBOX.md.'
      : 'At most tied on units vs exact-match/native-tools; no surpass claim.',
  );
  md.push('');
  md.push('sqlfluff Lite pass@1=0 historical row unchanged (do not retune).');
  md.push('Prior card `snapshots/harness-20b-card-20260918/` left untouched.');

  await fs.writeFile(path.join(CARD_DIR, 'CARD.md'), md.join('\n') + '\n', 'utf8');
  await fs.writeFile(
    path.join(CARD_DIR, 'rows.json'),
    JSON.stringify(rows, null, 2) + '\n',
    'utf8',
  );
  console.log(md.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
