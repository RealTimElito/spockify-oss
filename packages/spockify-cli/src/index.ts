#!/usr/bin/env node
import path from 'node:path';
import { deviceLogin } from './auth';
import {
  clearCredentials,
  DEFAULT_BASE_URL,
  loadCredentials,
  resolveApiKey,
  saveCredentials,
  webUiBaseForLogin,
  liteLlmBaseForApi,
} from './config';
import {
  discoverBaseUrl,
  fetchStackModels,
  resolveBaseUrlWithCreds,
} from './discover';
import { runRepl } from './repl';
import { runTui } from './tui';
import { runLabAgents } from './labAgents';
import { runLabRepl } from './labRepl';
import { runPentestEval } from './pentestEval/cmd';
import { printBenchHelp, runBench } from './bench';
import { runHarnessCli } from './harness/cmd';
import { runModelCmd } from './modelCmd';
import type { AgentMode } from './agent/types';
import { ansi } from './ui';
import { readActiveHarnessId } from '@spockify/harness-host';
import { isLabCatalogId } from '@spockify/harness';
import { resolveModelId } from './models';
import { resolveLabPinTarget } from './labPin';
import {
  isThinkingMode,
  normalizeThinkingMode,
  type ThinkingMode,
} from './thinking';

function printHelp(): void {
  console.log(`Spockify CLI — Claude Code–style coding agent

Usage:
  spockify                  Interactive agent REPL
  spockify agent            Same (OpenCode-shaped entry)
  spockify agent --mode plan|build
  spockify --tui            Fullscreen TUI (mouse + settings)
  spockify tui              Same as --tui
  spockify "fix the bug"  One-shot prompt
  spockify lab              Interactive lab mode (closed-loop REPL)
  spockify lab "…"          One-shot lab closed-loop (orch + parallel exec)
  spockify lab models       Show lab dual-role mapping / live aliases
  spockify bench dry-run    Probe LiteLLM (coding eval harness)
  spockify bench smoke      One coding completion
  spockify bench swe        SWE-bench Lite wrapper (see docs/BENCH.md)
  spockify bench route      Offline route-pack regret vs always-20b
  spockify harness list     List ~/.spockify/harnesses (default: spockify)
  spockify harness test [id] Run three fixtures; card includes harness id
  spockify harness use <id> Set active harness (missing → fall back to spockify)
  spockify pentest-eval     Evaluation REPL in the current dir (add tui/run for other surfaces)
  spockify pentest-eval roster
  spockify pentest-eval drill
  spockify login            Device link + code login
  spockify logout           Clear saved credentials
  spockify whoami           Show login status
  spockify models           List models from the configured stack
  spockify model lab        List unpublished lab catalog candidates
  spockify model promote    No-op until a fixture CARD exists
  spockify help

Options:
  --harness <id>   Plugin harness id (default: spockify / runHarness)
  --tui            Fullscreen TUI mode (btop-style)
  --model <id>     Model (default: Auto → 20b/120b; lab ids → local Ollama)
  --mode <m>       plan|ask|build|agent (plan/ask read-only; build/agent writes)
  --think <level>  off|low|medium|high|heavy
  --orch <id>      Lab orchestrator (default: lab-orchestrator)
  --exec <id>      Lab executor (default: lab-executor)
  --workers <n>    Lab parallel executors / bench instance workers
  --max-rounds <n> Lab plan→exec→review rounds (default: 5)
  --rounds <n>     Same as --max-rounds
  --subset <id>    Bench: lite|verified (default: lite)
  --slice <spec>   Bench: instance slice (default: 0:1)
  --filter <re>    Bench: instance-id regex
  --output <dir>   Bench: output directory
  --install        Bench: pip install mini-swe-agent
  --ask            Read-only tools (alias --mode plan)
  --yolo           Auto-approve mutating tools (80-turn horizon)
  --max-turns <n>  Agent loop budget (default 48; yolo 80; max 80; or SPOCKIFY_MAX_TURNS)
  --cwd <path>     Workspace root (default: .)
  --base-url <url> Spockify host (auto: WEBUI_URL → local → ${DEFAULT_BASE_URL})
  --api-key <key>  LiteLLM key (else device login / SPOCKIFY_API_KEY / LITELLM_MASTER_KEY)
  --no-open        Don't open browser on login
  --dry-run        Lab/bench: validate only (no heavy runs)

Lab twin:
  export SPOCKIFY_LAB_HOST=<twin-ip>   # probes :30080 / :30400
  # or: SPOCKIFY_BASE_URL=http://<twin>:30400
  spockify lab                          # lab mode REPL (live round progress)
  spockify lab models
  spockify lab "add tests for foo" --orch lab-orchestrator --exec lab-executor
  spockify bench dry-run
  spockify bench swe --subset lite --slice 0:1 --model gpt-oss-20b

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
        key === 'repl' ||
        key === 'cli' ||
        key === 'dry-run' ||
        key === 'install'
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
    const loginBase = webUiBaseForLogin(baseUrl);
    const creds = await deviceLogin({
      baseUrl: loginBase,
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

  if (cmd === 'pentest-eval') {
    const code = await runPentestEval(positionals.slice(1), { flags });
    process.exitCode = code;
    return;
  }

  const baseUrl = await resolveSessionBaseUrl(flags);

  if (cmd === 'harness') {
    const apiKey = resolveApiKey(
      typeof flags['api-key'] === 'string' ? flags['api-key'] : undefined,
      baseUrl,
    );
    const code = await runHarnessCli(positionals.slice(1), {
      cwd: typeof flags.cwd === 'string' ? flags.cwd : process.cwd(),
      baseUrl,
      apiKey: apiKey || undefined,
    });
    process.exitCode = code;
    return;
  }

  // Session badge: which harness id is active (default spockify).
  const harnessFlag =
    typeof flags.harness === 'string' ? flags.harness : undefined;
  const harnessId =
    harnessFlag ||
    readActiveHarnessId(
      typeof flags.cwd === 'string' ? flags.cwd : process.cwd(),
    );
  if (
    cmd !== 'login' &&
    cmd !== 'logout' &&
    cmd !== 'whoami' &&
    cmd !== 'help' &&
    cmd !== 'model'
  ) {
    console.log(ansi.dim(`harness: ${harnessId}`));
  }

  if (cmd === 'login') {
    await deviceLogin({
      baseUrl: webUiBaseForLogin(baseUrl),
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

  if (cmd === 'model') {
    process.exitCode = runModelCmd(positionals.slice(1));
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

  if (cmd === 'bench') {
    const rest = positionals.slice(1);
    const mode = (rest[0] || 'help').toLowerCase();
    if (mode === 'help' || flags.help) {
      printBenchHelp();
      return;
    }
    // Offline route regret / harness kernel tests need no LiteLLM key.
    let apiKey: string | undefined;
    if (mode !== 'route' && mode !== 'kernel' && mode !== 'harness') {
      try {
        apiKey = await ensureApiKey(flags, baseUrl);
      } catch {
        apiKey =
          typeof flags['api-key'] === 'string'
            ? flags['api-key']
            : process.env.LITELLM_MASTER_KEY || process.env.SPOCKIFY_API_KEY;
      }
    }
    const workersRaw =
      typeof flags.workers === 'string' ? Number(flags.workers) : undefined;
    const packFlag =
      typeof flags.pack === 'string'
        ? flags.pack
        : undefined;
    const code = await runBench({
      mode,
      baseUrl: liteLlmBaseForApi(baseUrl),
      apiKey,
      model: typeof flags.model === 'string' ? flags.model : undefined,
      subset: typeof flags.subset === 'string' ? flags.subset : undefined,
      slice: typeof flags.slice === 'string' ? flags.slice : undefined,
      filter: typeof flags.filter === 'string' ? flags.filter : undefined,
      workers:
        workersRaw != null && Number.isFinite(workersRaw)
          ? Math.max(1, Math.min(8, Math.floor(workersRaw)))
          : undefined,
      output: typeof flags.output === 'string' ? flags.output : undefined,
      dryRun: Boolean(flags['dry-run']),
      install: Boolean(flags.install),
      pack: packFlag,
      extraArgs: rest.slice(1),
    });
    process.exitCode = code;
    return;
  }

  if (cmd === 'lab' || cmd === 'lab-agents') {
    const rest = positionals.slice(1);
    const first = (rest[0] || '').toLowerCase();
    const modelsOnly = ['models', 'model', 'ls', 'list'].includes(first);
    // Bare `spockify lab` → interactive lab-mode REPL (Node chrome).
    const interactive = !modelsOnly && rest.length === 0;
    const task = modelsOnly || interactive ? undefined : rest.join(' ');
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
    const orch =
      typeof flags.orch === 'string'
        ? flags.orch
        : process.env.SPOCKIFY_LAB_ORCH || 'lab-orchestrator';
    const execModel =
      typeof flags.exec === 'string'
        ? flags.exec
        : process.env.SPOCKIFY_LAB_EXEC || 'lab-executor';
    const workersRaw =
      typeof flags.workers === 'string'
        ? Number(flags.workers)
        : Number(process.env.SPOCKIFY_LAB_WORKERS || '4');
    const roundsFlag =
      typeof flags['max-rounds'] === 'string'
        ? flags['max-rounds']
        : typeof flags.rounds === 'string'
          ? flags.rounds
          : undefined;
    const maxRoundsRaw =
      roundsFlag != null
        ? Number(roundsFlag)
        : Number(process.env.SPOCKIFY_LAB_MAX_ROUNDS || '5');
    const workers = Number.isFinite(workersRaw)
      ? Math.max(1, Math.min(16, Math.floor(workersRaw)))
      : 4;
    const maxRounds = Number.isFinite(maxRoundsRaw)
      ? Math.max(1, Math.min(20, Math.floor(maxRoundsRaw)))
      : 5;
    const litellm = liteLlmBaseForApi(baseUrl);
    const email = loadCredentials()?.user?.email;

    if (interactive) {
      const code = await runLabRepl({
        apiKey,
        baseUrl: litellm,
        cwd,
        orch,
        execModel,
        workers,
        maxRounds,
        dryRun: Boolean(flags['dry-run']),
        email,
      });
      process.exitCode = code;
      return;
    }

    const code = await runLabAgents({
      task,
      modelsOnly,
      orch,
      execModel,
      workers,
      maxRounds,
      cwd,
      // Harness needs LiteLLM /v1 — not OWUI SPA on :30080/:3080.
      baseUrl: litellm,
      apiKey,
      dryRun: Boolean(flags['dry-run']),
    });
    process.exitCode = code;
    return;
  }

  const promptParts =
    cmd &&
    !['login', 'logout', 'whoami', 'models', 'model', 'chat', 'tui', 'lab', 'lab-agents', 'bench', 'agent'].includes(
      cmd,
    )
      ? positionals
      : positionals[0] === 'chat' || positionals[0] === 'agent'
        ? positionals.slice(1)
        : [];
  const prompt = promptParts.length ? promptParts.join(' ') : undefined;

  const modeFlag =
    typeof flags.mode === 'string' ? flags.mode.toLowerCase() : undefined;
  let mode: AgentMode = flags.ask ? 'ask' : 'agent';
  if (modeFlag === 'plan' || modeFlag === 'ask') mode = modeFlag;
  else if (modeFlag === 'build' || modeFlag === 'agent') mode = modeFlag;
  else if (flags.ask) mode = 'plan';
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

  const userPinnedModel = typeof flags.model === 'string';
  const rawModel = userPinnedModel ? String(flags.model) : 'spockify-auto';
  const model = userPinnedModel
    ? resolveModelId(rawModel) || rawModel
    : 'spockify-auto';
  const userPinnedThink = typeof flags.think === 'string';
  const thinking: ThinkingMode | undefined = userPinnedThink
    ? isThinkingMode(flags.think)
      ? flags.think
      : normalizeThinkingMode(flags.think, 'off')
    : undefined;

  let sessionBaseUrl = baseUrl;
  let apiModel = model;
  let apiKey = resolveApiKey(
    typeof flags['api-key'] === 'string' ? flags['api-key'] : undefined,
    baseUrl,
  ) || '';

  if (isLabCatalogId(model)) {
    try {
      const pin = await resolveLabPinTarget({
        catalogId: model,
        configuredBaseUrl: baseUrl,
        explicitBaseUrl:
          typeof flags['base-url'] === 'string' ? flags['base-url'] : undefined,
        apiKey: apiKey || undefined,
      });
      sessionBaseUrl = pin.baseUrl;
      apiModel = pin.apiModel;
      if (pin.kind === 'ollama') {
        console.log(ansi.dim(`lab → ${pin.apiModel} @ ${pin.baseUrl}`));
      } else if (!apiKey) {
        apiKey = await ensureApiKey(flags, sessionBaseUrl);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
      return;
    }
  } else {
    apiKey = await ensureApiKey(flags, baseUrl);
  }

  const creds = loadCredentials();
  const email = creds?.user?.email || creds?.user?.name;

  const session = {
    apiKey,
    baseUrl: sessionBaseUrl,
    configuredBaseUrl: baseUrl,
    model,
    apiModel,
    mode,
    cwd,
    yolo: Boolean(flags.yolo),
    maxTurns,
    email,
    thinking,
    userPinnedThink,
    userPinnedModel,
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
    harnessId,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
