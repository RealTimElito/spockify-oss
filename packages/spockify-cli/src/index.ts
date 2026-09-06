#!/usr/bin/env node
import path from 'node:path';
import { deviceLogin } from './auth';
import {
  clearCredentials,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  loadCredentials,
  resolveApiKey,
  resolveBaseUrl,
  saveCredentials,
} from './config';
import { runRepl } from './repl';
import { runTui } from './tui';
import type { AgentMode } from './agent/types';

function printHelp(): void {
  console.log(`Spockify CLI — Claude Code–style coding agent

Usage:
  spockify                  Interactive agent REPL
  spockify --tui            Fullscreen TUI (mouse + settings)
  spockify tui              Same as --tui
  spockify "fix the bug"  One-shot prompt
  spockify login            Device link + code login
  spockify logout           Clear saved credentials
  spockify whoami           Show login status
  spockify help

Options:
  --tui            Fullscreen TUI mode (btop-style)
  --model <id>     Model (default: ${DEFAULT_MODEL})
  --ask            Read-only tools
  --yolo           Auto-approve mutating tools
  --cwd <path>     Workspace root (default: .)
  --base-url <url> Spockify host (default: ${DEFAULT_BASE_URL})
  --api-key <key>  LiteLLM key (else device login / SPOCKIFY_API_KEY)
  --no-open        Don't open browser on login

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
      if (key === 'ask' || key === 'yolo' || key === 'no-open' || key === 'help' || key === 'tui') {
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

async function main(): Promise<void> {
  const { flags, positionals } = parseArgs(process.argv.slice(2));
  if (flags.help || positionals[0] === 'help' || positionals[0] === '-h') {
    printHelp();
    return;
  }

  const cmd = positionals[0];
  const baseUrl = resolveBaseUrl(
    typeof flags['base-url'] === 'string' ? flags['base-url'] : undefined,
  );

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
    if (creds) {
      console.log(`Logged in via device credentials`);
      console.log(`  base:  ${creds.baseUrl}`);
      console.log(`  user:  ${creds.user?.email || creds.user?.name || '(unknown)'}`);
      console.log(`  key:   ${creds.accessToken.slice(0, 8)}…`);
      console.log(`  since: ${creds.updatedAt}`);
    } else if (envKey) {
      console.log(`Using SPOCKIFY_API_KEY (${envKey.slice(0, 8)}…)`);
    } else {
      console.log('Not logged in. Run: spockify login');
      process.exitCode = 1;
    }
    return;
  }

  const promptParts =
    cmd && !['login', 'logout', 'whoami', 'chat', 'tui'].includes(cmd)
      ? positionals
      : positionals[0] === 'chat'
        ? positionals.slice(1)
        : [];
  const prompt = promptParts.length ? promptParts.join(' ') : undefined;

  let apiKey = resolveApiKey(
    typeof flags['api-key'] === 'string' ? flags['api-key'] : undefined,
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

  // Persist explicit api-key if provided without credentials file
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

  const mode: AgentMode = flags.ask ? 'ask' : 'agent';
  const model =
    typeof flags.model === 'string' ? flags.model : DEFAULT_MODEL;
  const cwd =
    typeof flags.cwd === 'string'
      ? path.resolve(flags.cwd)
      : process.cwd();

  const creds = loadCredentials();
  const email = creds?.user?.email || creds?.user?.name;

  const session = {
    apiKey,
    baseUrl,
    model,
    mode,
    cwd,
    yolo: Boolean(flags.yolo),
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
