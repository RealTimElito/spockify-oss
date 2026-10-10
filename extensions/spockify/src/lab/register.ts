/**
 * Spockify: Lab Agents — spawn packages/spockify-lab-agents (orch → exec).
 * Progress goes to Output → Spockify Lab Agents (Composer/Agent-style).
 */

import { spawn } from 'node:child_process';
import * as vscode from 'vscode';

import { getAccount, getApiKey, signIn } from '../auth';
import { formatCaughtError } from '../util/errors';
import { isRemoteWorkspace, workspaceTerminalCwd } from '../terminal/runTerminalTool';
import { shSingleQuote } from '../terminal/termOutput';
import { buildLabHarnessArgv, resolveLabHarness } from './findHarness';
import { resolveLabLlmBaseUrl } from './resolveLabBaseUrl';

const CHANNEL = 'Spockify Lab Agents';
const TERM_NAME = 'Spockify Lab Agents';

export interface LabAgentsSettings {
  orch: string;
  exec: string;
  workers: number;
  maxRounds: number;
  harnessRoot?: string;
}

export function readLabAgentsSettings(): LabAgentsSettings {
  const c = vscode.workspace.getConfiguration('spockify');
  const workersRaw = c.get<number>('lab.workers', 4);
  const roundsRaw = c.get<number>('lab.maxRounds', 5);
  return {
    orch: (c.get<string>('lab.orchestratorModel') || 'lab-orchestrator').trim(),
    exec: (c.get<string>('lab.executorModel') || 'lab-executor').trim(),
    workers:
      typeof workersRaw === 'number' && Number.isFinite(workersRaw)
        ? Math.max(1, Math.min(16, Math.floor(workersRaw)))
        : 4,
    maxRounds:
      typeof roundsRaw === 'number' && Number.isFinite(roundsRaw)
        ? Math.max(1, Math.min(20, Math.floor(roundsRaw)))
        : 5,
    harnessRoot: (c.get<string>('lab.harnessRoot') || '').trim() || undefined,
  };
}

function editorSelectionOrEmpty(): string {
  const ed = vscode.window.activeTextEditor;
  if (!ed) return '';
  const sel = ed.document.getText(ed.selection);
  return sel.trim();
}

async function promptForTask(
  modelsOnly: boolean,
): Promise<string | undefined> {
  if (modelsOnly) {
    return 'models';
  }
  const fromSel = editorSelectionOrEmpty();
  const task = await vscode.window.showInputBox({
    title: 'Spockify Lab Agents (orch → exec)',
    prompt:
      'Benign coding goal for the twin closed-loop harness (plan → parallel exec → review)',
    value: fromSel || undefined,
    placeHolder: 'add tests for auth.ts',
    ignoreFocusOut: true,
  });
  const trimmed = task?.trim();
  return trimmed || undefined;
}

function buildHarnessArgs(
  task: string,
  settings: LabAgentsSettings,
  cwd: string,
  baseUrl: string,
): string[] {
  const args: string[] = [task];
  args.push('--orch', settings.orch);
  args.push('--exec', settings.exec);
  args.push('--workers', String(settings.workers));
  args.push('--max-rounds', String(settings.maxRounds));
  args.push('--cwd', cwd);
  args.push('--base-url', baseUrl);
  return args;
}

function shellCommandLine(command: string, args: string[]): string {
  return [command, ...args.map(shSingleQuote)].join(' ');
}

async function runViaTerminal(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  output: vscode.OutputChannel,
): Promise<void> {
  const line = shellCommandLine(command, args);
  output.appendLine(`lab-agents: remote/terminal → ${line.slice(0, 240)}`);
  // Fresh terminal each run so API key stays in TerminalOptions.env (not sendText).
  const term = vscode.window.createTerminal({
    name: TERM_NAME,
    cwd,
    env,
  });
  term.show(true);
  term.sendText(line, true);
  void vscode.window.showInformationMessage(
    'Lab Agents started in terminal “Spockify Lab Agents”.',
  );
}

function runViaSpawn(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  output: vscode.OutputChannel,
): Promise<number> {
  return new Promise((resolve) => {
    output.appendLine(
      `lab-agents: spawn ${command} ${args.map((a) => JSON.stringify(a)).join(' ')}`,
    );
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (buf: Buffer) => {
      output.append(buf.toString('utf8'));
    });
    child.stderr?.on('data', (buf: Buffer) => {
      output.append(buf.toString('utf8'));
    });
    child.on('error', (err) => {
      output.appendLine(`lab-agents: spawn error: ${formatCaughtError(err)}`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function ensureLabCredentials(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): Promise<string | undefined> {
  let apiKey = await getApiKey(context);
  if (!apiKey) {
    const pick = await vscode.window.showWarningMessage(
      'Lab Agents needs a Spockify API key (LiteLLM virtual key or twin master key).',
      'Sign in',
    );
    if (pick === 'Sign in') {
      const ok = await signIn(context);
      if (ok) {
        apiKey = await getApiKey(context);
      }
    }
  }
  if (!apiKey) {
    return undefined;
  }
  const account = await getAccount(context);
  if (account?.kind === 'session') {
    output.appendLine(
      'lab-agents: note — session JWT may fail against LiteLLM :30400; prefer API-key sign-in or twin LITELLM_MASTER_KEY.',
    );
  }
  return apiKey;
}

/**
 * Run closed-loop harness or `models` listing.
 */
export async function runLabAgentsCommand(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  opts: { modelsOnly?: boolean; task?: string } = {},
): Promise<void> {
  const settings = readLabAgentsSettings();
  const productBase =
    vscode.workspace.getConfiguration('spockify').get<string>('baseUrl') || '';
  const labBase = resolveLabLlmBaseUrl(productBase);
  const cwd = workspaceTerminalCwd() || process.cwd();

  const task =
    opts.task?.trim() ||
    (await promptForTask(Boolean(opts.modelsOnly)));
  if (!task) {
    return;
  }

  const apiKey = await ensureLabCredentials(context, output);
  if (!apiKey && task.toLowerCase() !== 'models') {
    void vscode.window.showErrorMessage(
      'Lab Agents: sign in with an API key (or Self-hosted + LiteLLM key) first.',
    );
    return;
  }

  const launch = resolveLabHarness(context.extensionPath, cwd);
  if (!launch) {
    void vscode.window.showErrorMessage(
      'Lab Agents harness not found. Clone agentHub or set spockify.lab.harnessRoot.',
    );
    return;
  }

  const harnessArgs = buildHarnessArgs(task, settings, cwd, labBase);
  // Never put the key on argv (ps visibility); pass via env only.
  const { command, args, envExtra } = buildLabHarnessArgv(launch, harnessArgs);

  output.appendLine('');
  output.appendLine('—'.repeat(48));
  output.appendLine(`lab-agents · ${new Date().toISOString()}`);
  output.appendLine(`  task: ${task.slice(0, 200)}`);
  output.appendLine(`  orch=${settings.orch} exec=${settings.exec}`);
  output.appendLine(
    `  workers=${settings.workers} maxRounds=${settings.maxRounds}`,
  );
  output.appendLine(`  cwd=${cwd}`);
  output.appendLine(`  baseUrl=${labBase} (from ${productBase || 'default'})`);
  output.appendLine(
    `  harness=${launch.kind}${
      launch.kind === 'wrapper'
        ? ` ${launch.path}`
        : launch.kind === 'pythonModule'
          ? ` ${launch.pkgRoot}`
          : ` ${launch.bin}`
    }`,
  );
  output.show(true);

  const env: Record<string, string> = {
    ...envExtra,
    SPOCKIFY_BASE_URL: labBase,
    SPOCKIFY_LAB_BASE_URL: labBase,
  };
  if (apiKey) {
    env.SPOCKIFY_API_KEY = apiKey;
    // Twin / LAN LiteLLM often expects master key name.
    env.LITELLM_MASTER_KEY = apiKey;
  }

  if (isRemoteWorkspace()) {
    await runViaTerminal(command, args, cwd, env, output);
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Spockify Lab Agents',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: 'orch → exec…' });
      const code = await runViaSpawn(
        command,
        args,
        cwd,
        { ...process.env, ...env },
        output,
      );
      output.appendLine(`lab-agents: exit ${code}`);
      if (code === 0) {
        void vscode.window.showInformationMessage('Lab Agents finished.');
      } else if (code === 2) {
        void vscode.window.showWarningMessage(
          'Lab Agents refused the task (benign coding only). See Output.',
        );
      } else if (code === 127) {
        void vscode.window.showErrorMessage(
          'Lab Agents harness unavailable. Install packages/spockify-lab-agents or set spockify.lab.harnessRoot.',
        );
      } else {
        void vscode.window.showErrorMessage(
          `Lab Agents exited ${code}. See Output → ${CHANNEL}.`,
        );
      }
    },
  );
}

export function registerLabAgents(
  context: vscode.ExtensionContext,
  parentOutput?: vscode.OutputChannel,
): void {
  // Dedicated channel so lab noise does not drown Chat/Composer logs.
  const labOut = vscode.window.createOutputChannel(CHANNEL);
  context.subscriptions.push(labOut);

  context.subscriptions.push(
    vscode.commands.registerCommand('spockify.labAgents.run', async () => {
      try {
        await runLabAgentsCommand(context, labOut, {});
      } catch (err) {
        labOut.appendLine(`lab-agents: ${formatCaughtError(err)}`);
        void vscode.window.showErrorMessage(
          `Lab Agents failed: ${formatCaughtError(err)}`,
        );
      }
    }),
    vscode.commands.registerCommand('spockify.labAgents.models', async () => {
      try {
        await runLabAgentsCommand(context, labOut, { modelsOnly: true });
      } catch (err) {
        labOut.appendLine(`lab-agents: ${formatCaughtError(err)}`);
        void vscode.window.showErrorMessage(
          `Lab Agents models failed: ${formatCaughtError(err)}`,
        );
      }
    }),
  );

  parentOutput?.appendLine(
    'Lab Agents: Command Palette → Spockify: Lab Agents (orch → exec)',
  );
}
