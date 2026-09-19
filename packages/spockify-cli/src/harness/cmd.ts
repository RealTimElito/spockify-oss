/**
 * spockify harness list | test | use
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import {
  commandDigest,
  ensureHarnessDir,
  getHarness,
  listHarnesses,
  readActiveHarnessId,
  setActiveHarnessId,
  type HarnessYaml,
} from '@spockify/harness-host';

function repoRootGuess(): string {
  return path.resolve(__dirname, '../../..');
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function harnessList(cwd = process.cwd()): Promise<void> {
  await ensureHarnessDir();
  const active = readActiveHarnessId(cwd);
  const rows = listHarnesses(cwd);
  console.log('Registered harnesses (default = spockify / runHarness):\n');
  for (const h of rows) {
    const mark = h.id === active ? '*' : ' ';
    const label = h.label || h.command;
    console.log(
      `  ${mark} ${h.id.padEnd(16)} ${label}  [${commandDigest(h)}]`,
    );
  }
  console.log(`\nActive: ${active}`);
}

export async function harnessUse(
  id: string,
  cwd = process.cwd(),
): Promise<number> {
  const h = getHarness(id, cwd);
  if (!h) {
    console.error(`Unknown harness id: ${id}`);
    console.error('Falling back to spockify (runHarness).');
    setActiveHarnessId('spockify');
    return 1;
  }
  if (h.id !== 'spockify') {
    try {
      execSync(`command -v ${shellQuote(h.command)}`, {
        stdio: 'ignore',
        shell: '/bin/bash',
      });
    } catch {
      console.error(
        `harness ${id}: command not found (${h.command}). Install it or use spockify.`,
      );
      console.error('Active harness left unchanged; default remains spockify.');
      return 1;
    }
  }
  setActiveHarnessId(id);
  console.log(`Active harness → ${id} (${h.label || h.command})`);
  return 0;
}

const FIXTURES = ['rate_write_gate', 'ws_cascade', 'fence_repair'] as const;

export async function harnessTest(
  id: string,
  opts: { cwd?: string; baseUrl?: string; apiKey?: string; model?: string },
): Promise<number> {
  const cwd = opts.cwd || process.cwd();
  const h = getHarness(id, cwd);
  if (!h) {
    console.error(`Unknown harness: ${id} — falling back to spockify kernel.`);
    return harnessTest('spockify', opts);
  }
  if (h.id !== 'spockify') {
    try {
      execSync(`command -v ${shellQuote(h.command)}`, {
        stdio: 'ignore',
        shell: '/bin/bash',
      });
    } catch {
      console.error(
        `harness test ${id}: command missing (${h.command}). Install hint: add binary to PATH, then retry. Falling back to spockify.`,
      );
      return harnessTest('spockify', opts);
    }
  }

  const root = repoRootGuess();
  const outDir = path.join(
    root,
    'snapshots',
    `harness-plugin-card-${new Date().toISOString().slice(0, 10)}`,
  );
  await fsPromises.mkdir(outDir, { recursive: true });
  const sha = execSync('git rev-parse --short HEAD', { cwd: root })
    .toString()
    .trim();
  const digest = commandDigest(h);

  if (h.id === 'spockify') {
    const runner = path.join(
      root,
      'packages/spockify-harness/scripts/run-20b-card.ts',
    );
    if (fs.existsSync(runner)) {
      try {
        execSync(`npx tsx ${shellQuote(runner)}`, {
          cwd: path.join(root, 'packages/spockify-harness'),
          stdio: 'inherit',
          env: {
            ...process.env,
            SPOCKIFY_BASE_URL: opts.baseUrl || process.env.SPOCKIFY_BASE_URL,
            SPOCKIFY_API_KEY: opts.apiKey || process.env.SPOCKIFY_API_KEY,
            LITELLM_MASTER_KEY:
              opts.apiKey ||
              process.env.LITELLM_MASTER_KEY ||
              process.env.SPOCKIFY_API_KEY,
          },
          shell: '/bin/bash',
        });
      } catch {
        console.error('spockify fixture card runner failed');
        return 1;
      }
    }
  }

  const card = [
    `# Harness plugin card — ${h.id}`,
    '',
    `- Harness id: \`${h.id}\``,
    `- Command digest: \`${digest}\``,
    `- Label: ${h.label || h.command}`,
    `- Model: \`${opts.model || process.env.SPOCKIFY_CARD_MODEL || 'gpt-oss-20b'}\``,
    `- Commit: \`${sha}\``,
    `- Fixtures: ${FIXTURES.join(', ')}`,
    '',
    h.id === 'spockify'
      ? 'Default kernel (`runHarness`). See snapshots/harness-20b-card-* for measured rows.'
      : 'Plugin harness — same-box exam only; do not mix into Spockify board %.',
    '',
  ].join('\n');
  const cardPath = path.join(outDir, `CARD-${h.id}.md`);
  await fsPromises.writeFile(cardPath, card);
  console.log(`Wrote ${cardPath}`);
  console.log(`harness_id=${h.id} digest=${digest}`);
  return 0;
}

export async function runHarnessCli(
  args: string[],
  opts: { cwd?: string; baseUrl?: string; apiKey?: string },
): Promise<number> {
  const sub = args[0] || 'list';
  const rest = args.slice(1);
  if (sub === 'list') {
    await harnessList(opts.cwd);
    return 0;
  }
  if (sub === 'use') {
    const id = rest[0];
    if (!id) {
      console.error('usage: spockify harness use <id>');
      return 2;
    }
    return harnessUse(id, opts.cwd);
  }
  if (sub === 'test') {
    const id = rest[0] || readActiveHarnessId(opts.cwd);
    return harnessTest(id, opts);
  }
  console.error(`unknown harness subcommand: ${sub}`);
  console.error('usage: spockify harness list | test [id] | use <id>');
  return 2;
}

export type { HarnessYaml };
