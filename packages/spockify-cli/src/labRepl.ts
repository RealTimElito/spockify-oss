/**
 * Interactive lab mode using the same boxed chrome as the regular REPL.
 * Each prompt runs the closed-loop harness (orch → parallel exec → review).
 * Ctrl+C / Ctrl+D exits immediately (cancels an in-flight harness if any).
 */
import { runLabAgents } from './labAgents';
import { readBoxedLine } from './inputRaw';
import { pickFromList } from './picker';
import {
  nextThinkingMode,
  normalizeThinkingMode,
  resolveInitialThinkingMode,
  thinkingModeLabel,
  type ThinkingMode,
} from './thinking';
import {
  ansi,
  disableMouseTracking,
  parseLabRoundBanner,
  renderBanner,
  renderGoodbye,
  renderHelp,
  renderHint,
  renderLabFirstRunTip,
  renderLabRunFooter,
  renderLabRunHeader,
  renderStatusPanel,
  type SessionUiState,
} from './ui';

export interface LabReplOptions {
  apiKey?: string;
  baseUrl: string;
  cwd: string;
  orch: string;
  execModel: string;
  workers: number;
  maxRounds: number;
  dryRun?: boolean;
  email?: string;
}

const ROUND_PRESETS: Array<{ value: string; label: string; hint: string }> = [
  { value: '1', label: '1', hint: 'single pass' },
  { value: '3', label: '3', hint: 'short loop' },
  { value: '5', label: '5', hint: 'default' },
  { value: '8', label: '8', hint: 'deeper' },
  { value: '10', label: '10', hint: 'long' },
  { value: '15', label: '15', hint: 'thorough' },
  { value: '20', label: '20', hint: 'max' },
];

function clampRounds(n: number): number {
  return Math.max(1, Math.min(20, Math.floor(n)));
}

/** Lab harness is not Heavy ensemble — map Heavy → high think flag. */
function labThinkEnv(mode: ThinkingMode): Record<string, string> {
  const flag = mode === 'heavy' ? 'high' : mode;
  return {
    SPOCKIFY_LAB_ORCH_THINK: flag,
    SPOCKIFY_LAB_EXEC_THINK: flag,
  };
}

function isThinkingModeArg(value: string): value is ThinkingMode {
  return (
    value === 'off' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'heavy'
  );
}

function write(s: string): void {
  process.stdout.write(s);
}

export async function runLabRepl(opts: LabReplOptions): Promise<number> {
  disableMouseTracking();

  let orch = opts.orch;
  let execModel = opts.execModel;
  let workers = opts.workers;
  let maxRounds = opts.maxRounds;
  let turns = 0;
  let shouldExit = false;
  let activeChild: { kill: (sig?: NodeJS.Signals) => void } | null = null;
  let liveRound: number | undefined;
  let livePhase: string | undefined;
  // Lab defaults to Low (harness brief); SPOCKIFY_THINKING still wins when set.
  let thinking: ThinkingMode = process.env.SPOCKIFY_THINKING
    ? resolveInitialThinkingMode()
    : 'low';

  const state = (): SessionUiState => ({
    model: orch,
    mode: 'agent',
    yolo: false,
    cwd: opts.cwd,
    email: opts.email,
    baseUrl: opts.baseUrl,
    turns,
    thinking,
    lab: {
      orch,
      exec: execModel,
      workers,
      maxRounds,
      round: liveRound,
      phase: livePhase,
    },
  });

  const requestExit = (): void => {
    shouldExit = true;
    try {
      activeChild?.kill('SIGINT');
    } catch {
      /* ignore */
    }
    activeChild = null;
  };

  // Process-level SIGINT while a harness is running (raw mode not active).
  const onSigInt = () => {
    write('\n');
    requestExit();
  };
  process.on('SIGINT', onSigInt);

  const pickRounds = async (): Promise<void> => {
    const current = String(maxRounds);
    const items = ROUND_PRESETS.map((p) => ({ ...p }));
    if (!items.some((it) => it.value === current)) {
      items.unshift({
        value: current,
        label: current,
        hint: 'current',
      });
    }
    const next = await pickFromList({
      title: 'Max rounds (plan → exec → review)',
      current,
      items,
    });
    if (!next) {
      write(renderHint(`max rounds = ${maxRounds} (unchanged)`));
      return;
    }
    maxRounds = clampRounds(Number(next));
    write(renderHint(`max rounds → ${maxRounds}`));
  };

  write(renderBanner(state()));
  write(renderLabFirstRunTip());

  try {
    while (!shouldExit) {
      const line = await readBoxedLine({
        state,
        onInterrupt: () => {
          requestExit();
          return true;
        },
        shouldExit: () => shouldExit,
      });

      if (line === 'exit' || shouldExit) break;
      if (line === 'retry') continue;

      const text = line.trim();
      if (!text) continue;

      if (text === '/exit' || text === '/quit' || text === 'exit' || text === 'quit') {
        break;
      }
      if (text === '/help' || text === 'help' || text === '?') {
        write(renderHelp(true));
        continue;
      }
      if (text === '/status' || text === '/model') {
        write(renderStatusPanel(state()));
        continue;
      }
      if (text === '/clear') {
        turns = 0;
        write(renderHint('Turn counter cleared (each task is still an independent run).'));
        continue;
      }
      if (text === '/think' || text.startsWith('/think ')) {
        const arg = text.slice('/think'.length).trim().toLowerCase();
        if (!arg) {
          thinking = nextThinkingMode(thinking);
        } else if (isThinkingModeArg(arg)) {
          thinking = arg;
        } else {
          const normalized = normalizeThinkingMode(arg, thinking);
          if (normalized === thinking && arg !== normalized) {
            write(
              renderHint(
                `Unknown thinking “${arg}”. Use off, low, medium, high, or heavy.`,
              ),
            );
            continue;
          }
          thinking = normalized;
        }
        write(
          renderHint(
            `Thinking → ${thinkingModeLabel(thinking)}` +
              (thinking === 'heavy'
                ? ' (lab uses high think; not Heavy ensemble)'
                : ''),
          ),
        );
        continue;
      }

      if (text.startsWith('/orch')) {
        const arg = text.slice('/orch'.length).trim();
        if (arg) {
          orch = arg;
          write(renderHint(`orch → ${orch}`));
        } else {
          write(renderHint(`orch = ${orch}`));
        }
        continue;
      }
      if (text.startsWith('/exec')) {
        const arg = text.slice('/exec'.length).trim();
        if (arg) {
          execModel = arg;
          write(renderHint(`exec → ${execModel}`));
        } else {
          write(renderHint(`exec = ${execModel}`));
        }
        continue;
      }
      if (text.startsWith('/workers')) {
        const arg = text.slice('/workers'.length).trim();
        if (arg) {
          const n = Number(arg);
          if (!Number.isFinite(n)) {
            write(renderHint('usage: /workers <1-16>'));
            continue;
          }
          workers = Math.max(1, Math.min(16, Math.floor(n)));
          write(renderHint(`workers → ${workers}`));
        } else {
          write(renderHint(`workers = ${workers}`));
        }
        continue;
      }
      if (text.startsWith('/rounds')) {
        const arg = text.slice('/rounds'.length).trim();
        if (arg) {
          const n = Number(arg);
          if (!Number.isFinite(n)) {
            write(renderHint('usage: /rounds <1-20>  (or bare /rounds for selector)'));
            continue;
          }
          maxRounds = clampRounds(n);
          write(renderHint(`max rounds → ${maxRounds}`));
        } else {
          await pickRounds();
        }
        continue;
      }
      if (text === '/models' || text === '/model ls' || text === '/model list') {
        const code = await runLabAgents({
          modelsOnly: true,
          orch,
          execModel,
          cwd: opts.cwd,
          baseUrl: opts.baseUrl,
          apiKey: opts.apiKey,
          dryRun: opts.dryRun,
          env: labThinkEnv(thinking),
          onChild: (child) => {
            activeChild = child;
          },
        });
        activeChild = null;
        if (shouldExit) break;
        if (code !== 0) {
          write(`${ansi.dim(`(exit ${code})`)}\n`);
        }
        continue;
      }
      if (text.startsWith('/')) {
        write(renderHint(`unknown command ${text.split(/\s+/)[0]} — try /help`));
        continue;
      }

      write(renderLabRunHeader(state(), turns + 1));

      liveRound = undefined;
      livePhase = undefined;
      const t0 = Date.now();
      const code = await runLabAgents({
        task: text,
        orch,
        execModel,
        workers,
        maxRounds,
        cwd: opts.cwd,
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        dryRun: opts.dryRun,
        env: labThinkEnv(thinking),
        onChild: (child) => {
          activeChild = child;
        },
        onLine: (line) => {
          const parsed = parseLabRoundBanner(line);
          if (parsed) {
            liveRound = parsed.round;
            livePhase = parsed.phase;
            if (parsed.maxRounds > 0) {
              maxRounds = Math.max(maxRounds, parsed.maxRounds);
            }
          }
        },
      });
      activeChild = null;
      turns += 1;
      const wallS = (Date.now() - t0) / 1000;
      write(
        renderLabRunFooter({
          wallS,
          code,
          round: liveRound,
          maxRounds,
        }),
      );
      liveRound = undefined;
      livePhase = undefined;

      if (shouldExit) break;
      if (code === 130) {
        // Child already aborted via SIGINT — exit the REPL.
        shouldExit = true;
        break;
      }
      if (code !== 0) {
        write(`${ansi.dim(`(exit ${code})`)}\n`);
      }
    }
  } finally {
    process.off('SIGINT', onSigInt);
  }

  write(renderGoodbye());
  return shouldExit ? 130 : 0;
}
