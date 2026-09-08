#!/usr/bin/env node
import path from 'node:path';
import { deviceLogin } from './auth';
import {
  clearCredentials,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  loadCredentials,
  resolveApiKey,
  saveCredentials,
} from './config';
import {
  discoverBaseUrl,
  fetchStackModels,
  pickDefaultModel,
  resolveBaseUrlWithCreds,
} from './discover';
import { runRepl } from './repl';
import { runTui } from './tui';
import { runLabAgents } from './labAgents';
import type { AgentMode } from './agent/types';
import { ansi } from './ui';

function printHelp(): void {
  console.log(`Spockify CLI — Claude Code–style coding agent

Usage:
  spockify                  Interactive agent REPL
  spockify --tui            Fullscreen TUI (mouse + settings)
  spockify tui              Same as --tui
  spockify "fix the bug"  One-shot prompt
  spockify lab "…"          Lab twin closed-loop (orch + parallel exec)
  spockify lab models       Show lab dual-role mapping / live aliases
  spockify login            Device link + code login
  spockify logout           Clear saved credentials
  spockify whoami           Show login status
  spockify models           List models from the configured stack
  spockify help

Options:
  --tui            Fullscreen TUI mode (btop-style)
  --model <id>     Model (default: live stack, else ${DEFAULT_MODEL})
  --orch <id>      Lab orchestrator (default: lab-orchestrator)
  --exec <id>      Lab executor (default: lab-executor)
  --workers <n>    Lab parallel executors per round (default: 4)
  --max-rounds <n> Lab plan→exec→review rounds (default: 5)
  --ask            Read-only tools
  --yolo           Auto-approve mutating tools (80-turn horizon)
  --max-turns <n>  Agent loop budget (default 48; yolo 80; max 80; or SPOCKIFY_MAX_TURNS)
  --cwd <path>     Workspace root (default: .)
  --base-url <url> Spockify host (auto: WEBUI_URL → local → ${DEFAULT_BASE_URL})
  --api-key <key>  LiteLLM key (else device login / SPOCKIFY_API_KEY / LITELLM_MASTER_KEY)
  --no-open        Don't open browser on login
  --dry-run        Lab: validate only (no model calls)

Lab twin:
  export SPOCKIFY_LAB_HOST=<twin-ip>   # probes :30080 / :30400
  # or: SPOCKIFY_BASE_URL=http://<twin>:30400
  spockify lab models
  spockify lab "add tests for foo" --orch lab-orchestrator --exec lab-executor

Auth:
  spockify login   Visit the link, enter the code, Approve (mints a virtual key)
`);
}

function parseArgs(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (
        key === 'ask' ||
        key === 'yolo' ||
        key === 'no-open' ||
        key === 'help' ||
        key === 'tui' ||
        key === 'dry-run'
      ) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
      continue;
    }
    if (a.startsWith('-') && a.length === 2) {
      flags[a.slice(1)] = true;
      continue;
    }
    positionals.push(a);
  }
  return { flags, positionals };
}

async function resolveSessionBaseUrl(
  flags: Record<string, string | boolean>,
): Promise<string> {
  const explicit =
    typeof flags['base-url'] === 'string' ? flags['base-url'] : undefined;
  const discovered = await discoverBaseUrl(explicit);
  return resolveBaseUrlWithCreds(discovered, loadCredentials());
}

async function ensureApiKey(
  flags: Record<string, string | boolean>,
  baseUrl: string,
): Promise<string> {
  let apiKey = resolveApiKey(
    typeof flags['api-key'] === 'string' ? flags['api-key'] : undefined,
    baseUrl,
  );

  if (!apiKey) {
    console.log('No API key — starting device login…');
    const creds = await deviceLogin({
      baseUrl,
      open: !flags['no-open'],
      onStatus: (m) => console.log(m),
    });
    apiKey = creds.accessToken;
  }

  if (
    typeof flags['api-key'] === 'string' &&
    flags['api-key'] &&
    !loadCredentials()
  ) {
    saveCredentials({
      accessToken: String(flags['api-key']),
      baseUrl,
      updatedAt: new Date().toISOString(),
    });
  }

  return apiKey;
}

async function main(): Promise<void> {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  if (flags.help || positionals[0] === 'help' || positionals[0] === '-h') {
    printHelp();
    return;
  }

  const cmd = positionals[0];
  const baseUrl = await resolveSessionBaseUrl(flags);

  if (cmd === 'login') {
    await deviceLogin({
      baseUrl,
      open: !flags['no-open'],
      onStatus: (m) => console.log(m),
    });
    const creds = loadCredentials();
    if (creds?.user?.email) console.log(`User: ${creds.user.email}`);
    return;
  }

  if (cmd === 'logout') {
    clearCredentials();
    console.log('Logged out.');
    return;
  }

  if (cmd === 'whoami') {
    const creds = loadCredentials();
    const envKey = process.env.SPOCKIFY_API_KEY?.trim();
    const master = process.env.LITELLM_MASTER_KEY?.trim();
    console.log(`Resolved base: ${baseUrl}`);
    if (creds) {
      console.log(`Logged in via device credentials`);
      console.log(`  base:  ${creds.baseUrl}`);
      console.log(`  user:  ${creds.user?.email || creds.user?.name || '(unknown)'}`);
      console.log(`  key:   ${creds.accessToken.slice(0, 8)}…`);
      console.log(`  since: ${creds.updatedAt}`);
    } else if (envKey) {
      console.log(`Using SPOCKIFY_API_KEY (${envKey.slice(0, 8)}…)`);
    } else if (master) {
      console.log(`Using LITELLM_MASTER_KEY (${master.slice(0, 8)}…)`);
    } else {
      console.log('Not logged in. Run: spockify login');
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'models') {
    const apiKey = await ensureApiKey(flags, baseUrl);
    const models = await fetchStackModels({ apiKey, baseUrl });
    console.log(`${ansi.bold('Models')}  ${ansi.dim(baseUrl)}  (${models.length})`);
    for (const m of models) {
      const alias =
        m.aliases.length > 0 ? ansi.dim(`  (${m.aliases.join(', ')})`) : '';
      console.log(`  ${ansi.cyan(m.id)}${alias}`);
      if (m.blurb) console.log(`      ${ansi.dim(m.blurb)}`);
    }
    return;
  }

  if (cmd === 'lab' || cmd === 'lab-agents') {
    const rest = positionals.slice(1);
    const modelsOnly =
      rest.length === 0 ||
      ['models', 'model', 'ls', 'list'].includes((rest[0] || '').toLowerCase());
    const task = modelsOnly ? undefined : rest.join(' ');
    const cwd =
      typeof flags.cwd === 'string' ? path.resolve(flags.cwd) : process.cwd();
    let apiKey: string | undefined;
    try {
      apiKey = await ensureApiKey(flags, baseUrl);
    } catch {
      apiKey =
        typeof flags['api-key'] === 'string'
          ? flags['api-key']
          : process.env.LITELLM_MASTER_KEY || process.env.SPOCKIFY_API_KEY;
    }
    const code = await runLabAgents({
      task,
      modelsOnly,
      orch: typeof flags.orch === 'string' ? flags.orch : undefined,
      execModel: typeof flags.exec === 'string' ? flags.exec : undefined,
      workers:
        typeof flags.workers === 'string' ? Number(flags.workers) : undefined,
      maxRounds:
        typeof flags['max-rounds'] === 'string'
          ? Number(flags['max-rounds'])
          : undefined,
      cwd,
      baseUrl,
      apiKey,
      dryRun: Boolean(flags['dry-run']),
    });
    process.exitCode = code;
    return;
  }

  const promptParts =
    cmd && !['login', 'logout', 'whoami', 'models', 'chat', 'tui', 'lab', 'lab-agents'].includes(cmd)
      ? positionals
      : positionals[0] === 'chat'
        ? positionals.slice(1)
        : [];
  const prompt = promptParts.length ? promptParts.join(' ') : undefined;

  const apiKey = await ensureApiKey(flags, baseUrl);

  const mode: AgentMode = flags.ask ? 'ask' : 'agent';
  const cwd =
    typeof flags.cwd === 'string'
      ? path.resolve(flags.cwd)
      : process.cwd();
  const maxTurnsRaw =
    typeof flags['max-turns'] === 'string'
      ? Number(flags['max-turns'])
      : undefined;
  const maxTurns =
    typeof maxTurnsRaw === 'number' && Number.isFinite(maxTurnsRaw) && maxTurnsRaw > 0
      ? Math.floor(maxTurnsRaw)
      : undefined;

  let model =
    typeof flags.model === 'string' ? flags.model : DEFAULT_MODEL;
  if (typeof flags.model !== 'string') {
    try {
      const available = await fetchStackModels({ apiKey, baseUrl });
      model = pickDefaultModel(available, DEFAULT_MODEL);
    } catch (err) {
      // Keep DEFAULT_MODEL; picker will surface a clearer error later.
      console.error(err instanceof Error ? err.message : err);
    }
  }

  const creds = loadCredentials();
  const email = creds?.user?.email || creds?.user?.name;

  const session = {
    apiKey,
    baseUrl,
    model,
    mode,
    cwd,
    yolo: Boolean(flags.yolo),
    maxTurns,
    email,
  };

  if (flags.tui || cmd === 'tui') {
    if (prompt && cmd !== 'tui') {
      console.error('One-shot prompts use the REPL; omit --tui or drop the prompt.');
      process.exitCode = 1;
      return;
    }
    await runTui(session);
    return;
  }

  await runRepl({
    ...session,
    prompt,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
