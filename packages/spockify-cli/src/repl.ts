import { createModelTransport } from '@spockify/ide-client';
import { runAgentTurn } from './agent/loop';
import { ToolRegistry } from './agent/registry';
import { registerCliTools } from './agent/tools';
import type { AgentMessage, AgentMode } from './agent/types';
import { DEFAULT_MODEL } from './config';
import { DoublePressExit, type ExitKey } from './exitGuard';
import { readBoxedLine, readLineRaw } from './inputRaw';
import {
  isModelMetaCommand,
  MODEL_PRESETS,
  resolveModelId,
} from './models';
import { pickFromList } from './picker';
import {
  MarkdownStreamRenderer,
  Spinner,
  disableMouseTracking,
  modelLabel,
  renderAssistantStart,
  renderBanner,
  renderError,
  renderGoodbye,
  renderHelp,
  renderHint,
  renderStatusLine,
  renderStatusPanel,
  renderToolResultCard,
  renderToolStart,
  renderPermissionRequest,
  type SessionUiState,
  ansi,
} from './ui';

export interface ReplOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  mode: AgentMode;
  cwd: string;
  yolo: boolean;
  email?: string;
  prompt?: string;
}

function write(s: string): void {
  process.stdout.write(s);
}

export async function runRepl(opts: ReplOptions): Promise<void> {
  disableMouseTracking();

  const transport = createModelTransport({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });
  const registry = new ToolRegistry();
  registerCliTools(registry);

  const history: AgentMessage[] = [];

  let mode = opts.mode;
  let yolo = opts.yolo;
  let model = opts.model || DEFAULT_MODEL;
  let turns = 0;
  let shouldExit = false;
  let turnAbort: AbortController | undefined;

  const exitGuard = new DoublePressExit(write);

  const state = (): SessionUiState => ({
    model,
    mode,
    yolo,
    cwd: opts.cwd,
    email: opts.email,
    baseUrl: opts.baseUrl,
    turns,
  });

  /** @returns true if caller should exit */
  async function handleInterrupt(key: ExitKey): Promise<boolean> {
    turnAbort?.abort();
    if (exitGuard.press(key)) {
      shouldExit = true;
      exitGuard.dispose();
      return true;
    }
    return false;
  }

  const readLine = () =>
    readLineRaw({
      onInterrupt: handleInterrupt,
      shouldExit: () => shouldExit,
    });

  const confirm = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<boolean> => {
    if (shouldExit) return false;
    write(renderPermissionRequest(name, args));
    write(
      `  ${ansi.dim('Allow?')} ${ansi.green('[y]')} ${ansi.dim('/')} ${ansi.red('[N]')} ${ansi.accent('❯')} `,
    );
    const ans = await readLine();
    if (ans === 'exit' || ans === 'retry' || shouldExit) return false;
    return /^y(es)?$/i.test(ans.trim());
  };

  const pickMode = async (): Promise<void> => {
    const next = await pickFromList({
      title: 'Mode',
      current: mode,
      items: [
        {
          value: 'agent',
          label: 'agent mode',
          hint: 'edit files · run tools',
        },
        {
          value: 'ask',
          label: 'ask mode',
          hint: 'read-only',
        },
      ],
    });
    if (!next) return;
    mode = next as AgentMode;
    if (mode === 'ask') yolo = false;
    write(renderHint(`Mode → ${mode === 'ask' ? 'ask mode' : 'agent mode'}`));
  };

  const pickPerm = async (): Promise<void> => {
    const current = yolo && mode === 'agent' ? 'run-all' : 'ask';
    const next = await pickFromList({
      title: 'Permissions',
      current,
      items: [
        {
          value: 'ask',
          label: 'ask',
          hint: 'confirm before tools',
        },
        {
          value: 'run-all',
          label: 'run all',
          hint: 'skip confirms (yolo)',
        },
      ],
    });
    if (!next) return;
    if (next === 'run-all') {
      if (mode === 'ask') mode = 'agent';
      yolo = true;
      write(renderHint('Permissions → run all'));
    } else {
      yolo = false;
      write(renderHint('Permissions → ask'));
    }
  };

  const pickModel = async (): Promise<void> => {
    const next = await pickFromList({
      title: 'Model',
      current: model,
      items: MODEL_PRESETS.map((p) => ({
        value: p.id,
        label:
          modelLabel(p.id) === p.id
            ? p.id
            : `${modelLabel(p.id)} (${p.id})`,
        hint: p.blurb,
      })),
    });
    if (!next) return;
    model = next;
    write(renderHint(`Model → ${modelLabel(model)}`));
  };

  const askBoxed = async (): Promise<string | null> => {
    while (!shouldExit) {
      if (exitGuard.isArmed()) {
        await exitGuard.waitUntilClear();
        if (shouldExit) return null;
      }

      const line = await readBoxedLine({
        state,
        onInterrupt: handleInterrupt,
        shouldExit: () => shouldExit,
      });
      if (line === 'exit' || shouldExit) return null;
      if (line === 'retry') {
        await exitGuard.waitUntilClear();
        if (shouldExit) return null;
        write('\n');
        continue;
      }
      return line;
    }
    return null;
  };

  const runOnce = async (userText: string) => {
    const prior = history.filter((m) => m.role !== 'system');
    prior.push({ role: 'user', content: userText });
    const md = new MarkdownStreamRenderer(write);
    turnAbort = new AbortController();
    const signal = turnAbort.signal;
    let headerWritten = false;
    let lastHeader = '';
    const spinner = new Spinner('thinking');
    spinner.start();
    try {
      const updated = await runAgentTurn({
        transport,
        registry,
        model,
        mode,
        messages: prior,
        cwd: opts.cwd,
        yolo,
        signal,
        confirm: yolo ? undefined : confirm,
        onEvent: (ev) => {
          if (ev.type === 'model') {
            spinner.stop();
            const line = renderAssistantStart(ev.requested, ev.resolved);
            if (!headerWritten) {
              write(line);
              headerWritten = true;
              lastHeader = line;
            } else if (ev.resolved && line !== lastHeader) {
              // Rewrite the header line once the worker is known
              write(`\x1b[1A\r\x1b[2K${line.replace(/^\n/, '')}`);
              lastHeader = line;
            }
          } else if (ev.type === 'text') {
            spinner.stop();
            if (!headerWritten) {
              write(renderAssistantStart(model));
              headerWritten = true;
            }
            md.push(ev.content);
          } else if (ev.type === 'toolStart') {
            spinner.stop();
            if (!headerWritten) {
              write(renderAssistantStart(model));
              headerWritten = true;
            }
            md.flush();
            const preview = JSON.stringify(ev.arguments).slice(0, 100);
            write(renderToolStart(ev.name, preview));
          } else if (ev.type === 'toolResult') {
            md.flush();
            write(
              renderToolResultCard(
                ev.name,
                ev.ok,
                ev.content || ev.error || '',
              ),
            );
          } else if (ev.type === 'error') {
            spinner.stop();
            if (!headerWritten) {
              write(renderAssistantStart(model));
              headerWritten = true;
            }
            md.flush();
            write(renderError(ev.message));
          } else if (ev.type === 'done' && ev.cancelled) {
            spinner.stop();
            md.flush();
            write(renderHint('Cancelled.'));
          }
        },
      });
      md.flush();
      if (!signal.aborted) {
        history.length = 0;
        history.push(...updated.filter((m) => m.role !== 'system'));
        turns += 1;
      }
    } catch (err) {
      spinner.stop();
      md.flush();
      if (signal.aborted || shouldExit) {
        write(renderHint('Cancelled.'));
        return;
      }
      write(renderError(err instanceof Error ? err.message : String(err)));
      throw err;
    } finally {
      spinner.stop();
      turnAbort = undefined;
    }
    write('\n');
  };

  if (opts.prompt) {
    write(renderBanner(state()));
    write(`${ansi.accent('❯')} ${opts.prompt}\n`);
    write(`${renderStatusLine(state())}\n`);
    await runOnce(opts.prompt);
    exitGuard.dispose();
    return;
  }

  write(renderBanner(state()));

  while (!shouldExit) {
    let line: string | null;
    try {
      line = await askBoxed();
    } catch {
      break;
    }
    if (line === null || shouldExit) break;
    const text = line.trim();
    if (!text) continue;
    if (text === '/exit' || text === '/quit') break;

    if (text === '/ask') {
      mode = 'ask';
      yolo = false;
      write(renderHint('Mode → ask'));
      continue;
    }
    if (text === '/agent') {
      mode = 'agent';
      write(renderHint(`Mode → ${yolo ? 'yolo' : 'agent'}`));
      continue;
    }
    if (text === '/mode') {
      await pickMode();
      await pickPerm();
      continue;
    }
    if (text === '/yolo') {
      if (mode === 'ask') {
        write(renderHint('Switch to /agent first — ask mode is read-only.'));
        continue;
      }
      yolo = !yolo;
      write(renderHint(yolo ? 'Permissions → run all' : 'Permissions → ask'));
      continue;
    }
    if (text === '/status') {
      write(renderStatusPanel(state()));
      continue;
    }
    if (text === '/clear') {
      history.length = 0;
      turns = 0;
      write(renderHint('Conversation cleared.'));
      continue;
    }
    if (text === '/model' || text.startsWith('/model ')) {
      const arg = text.slice('/model'.length).trim();
      if (!arg || isModelMetaCommand(arg)) {
        await pickModel();
        continue;
      }
      const resolved = resolveModelId(arg);
      if (!resolved) {
        write(renderHint(`Unknown model “${arg}”. Try /model`));
        continue;
      }
      model = resolved;
      write(renderHint(`Model → ${modelLabel(model)}`));
      continue;
    }
    if (text === '/help') {
      write(renderHelp());
      continue;
    }

    try {
      await runOnce(text);
    } catch {
      /* already printed */
    }
  }

  exitGuard.dispose();
  write(renderGoodbye());
}
