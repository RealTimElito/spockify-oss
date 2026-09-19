#!/usr/bin/env npx tsx
/**
 * One-shot live ws_cascade via runHarness — NO scripted edit_file injection.
 * Writes note under snapshots/harness-20b-card-20260919/ (does not replace CARD.md).
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelTransport } from '@spockify/ide-client';
import {
  runHarness,
  ToolRegistry,
  registerHarnessTools,
  type HarnessSession,
} from '../src/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const FIX = path.join(
  ROOT,
  'snapshots/harness-20b-card-20260919/fixtures/ws_cascade',
);
const NOTE = path.join(
  ROOT,
  'snapshots/harness-20b-card-20260919/LIVE_WS_CASCADE_NOSCRIPT.md',
);

const KEY =
  process.env.SPOCKIFY_API_KEY ||
  process.env.OPENAI_API_KEY ||
  process.env.LITELLM_MASTER_KEY ||
  '';
const BASE =
  process.env.SPOCKIFY_BASE_URL ||
  process.env.OPENAI_API_BASE?.replace(/\/v1\/?$/, '') ||
  'http://127.0.0.1:24001';
const MODEL = process.env.SPOCKIFY_CARD_MODEL || 'gpt-oss-20b';

const WS_SEARCH =
  'def greet(name):\n    return f"hi {name}"\n';
const WS_REPLACE =
  'def greet(name):\n    return f"hello {name}"\n';

async function copyWork(): Promise<string> {
  const dest = path.join(
    ROOT,
    'snapshots/harness-20b-card-20260919/work/ws_cascade_noscript',
  );
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(dest, { recursive: true });
  for (const name of ['greet.py', 'test_greet.py']) {
    await fs.copyFile(path.join(FIX, name), path.join(dest, name));
  }
  return dest;
}

function pytestGreen(cwd: string): boolean {
  try {
    execSync('python3 -m pytest -q', { cwd, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error('missing API key');
    process.exit(2);
  }
  const sha = execSync('git rev-parse --short HEAD', { cwd: ROOT })
    .toString()
    .trim();
  const cwd = await copyWork();
  const before = pytestGreen(cwd);
  const transport = createModelTransport({
    apiKey: KEY,
    baseUrl: BASE,
    apiBackend: 'litellm',
  });
  const registry = new ToolRegistry();
  registerHarnessTools(registry);
  const session: HarnessSession = {
    messages: [
      {
        role: 'user',
        content:
          'greet.py return line has trailing spaces (formatter drift). Tests expect hello, not hi. ' +
          'Use edit_file or apply_patch with SEARCH/old_string EXACTLY (no trailing spaces):\n' +
          WS_SEARCH +
          'Replace hi with hello. Then pytest -q.',
      },
    ],
    tick: 0,
    readSet: [],
    toolLog: [],
    todos: [],
    cwd,
    model: MODEL,
  };

  let cascadeLayer: number | null = null;
  let editApplied = false;
  const t0 = Date.now();
  for await (const ev of runHarness({
    transport,
    session,
    registry,
    policy: {
      mode: 'build',
      yolo: true,
      maxTurns: 6,
      writeRequiresRead: true,
      editCascade: true,
      thinking: 'low',
    },
  })) {
    if (ev.type === 'toolResult') {
      const blob = `${ev.error || ''} ${ev.content || ''}`;
      const m = blob.match(/cascade L([\d,]+)/);
      if (m) {
        const n = Number(String(m[1]).split(',')[0]);
        if (Number.isFinite(n)) cascadeLayer = n;
      }
      if (/Edited |apply_patch ok|Wrote /.test(blob) && !/READ_REQUIRED/.test(blob)) {
        editApplied = true;
      }
    }
  }
  const body = await fs.readFile(path.join(cwd, 'greet.py'), 'utf8');
  const hello = /hello/.test(body);
  const after = pytestGreen(cwd);
  const wall = Math.round((Date.now() - t0) / 1000);
  const yn =
    !before && hello && after && (cascadeLayer ?? 0) >= 1 && editApplied
      ? 'Y'
      : 'N';

  const md = [
    '# Live ws_cascade without scripted edit',
    '',
    `- Date: ${new Date().toISOString()}`,
    `- Commit: \`${sha}\``,
    `- Model: \`${MODEL}\``,
    `- Entry: \`runHarness\` only (no card-runner scripted edit_file)`,
    `- Result: **${yn}**`,
    `- before_green=${before} after_green=${after} hello_in_file=${hello}`,
    `- cascade_L=${cascadeLayer ?? '—'} edit_applied=${editApplied} wall_s=${wall}`,
    '',
    yn === 'Y'
      ? 'Model used edit_file/apply_patch; cascade L≥1 without SCRIPTED_EDIT.'
      : 'N — treat as tool-description / model refusal issue; do not add a new cascade layer.',
    '',
  ].join('\n');
  await fs.writeFile(NOTE, md);
  console.log(md);
  console.log(`note=${NOTE}`);
  process.exit(yn === 'Y' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
