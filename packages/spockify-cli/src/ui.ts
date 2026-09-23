/** Claude Code–inspired terminal chrome for Spockify CLI. */

import { formatSessionPin } from '@spockify/harness';
import type { SlashCommand } from './slash';
import {
  MAX_INPUT_ROWS,
  graphemeWidth,
  layoutWrap,
  segmentGraphemes,
} from './composerBuffer';

export const ansi = {
  reset: '\x1b[0m',
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  italic: (s: string) => `\x1b[3m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  /** Soft peach accent (Claude Code vibe) */
  accent: (s: string) => `\x1b[38;5;216m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[38;5;245m${s}\x1b[0m`,
  /** Slightly brighter panel border */
  border: (s: string) => `\x1b[38;5;240m${s}\x1b[0m`,
  /** Code body */
  code: (s: string) => `\x1b[38;5;252m${s}\x1b[0m`,
};

export interface LabUiState {
  orch: string;
  exec: string;
  workers: number;
  maxRounds: number;
  /** Live harness phase from Round banners (plan|exec|handoff|review). */
  phase?: string;
  /** Current round index from harness (1-based). */
  round?: number;
}

export interface SessionUiState {
  model: string;
  mode: import('./agent/types').AgentMode;
  yolo: boolean;
  /** Router thinking chip (Off/Low/Medium/High/Heavy). */
  thinking?: import('./thinking').ThinkingMode;
  cwd: string;
  email?: string;
  baseUrl?: string;
  turns: number;
  /** Active harness id (default spockify / runHarness). */
  harnessId?: string;
  /** When set, chrome shows lab closed-loop status instead of agent/ask. */
  lab?: LabUiState;
  /** Up to 2 attached skill ids. */
  skillIds?: string[];
  /** Session picker resolved Auto — header shows auto → tag. */
  autoPicked?: boolean;
  /** Evaluation harness chrome. */
  evalMode?: boolean;
}

export function shortPath(p: string, max = 36): string {
  const home = process.env.HOME || '';
  let s = home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  if (s === '~' || s === '~/') return '~';
  if (s.length <= max) return s;
  const parts = s.split(/[/\\]/).filter(Boolean);
  if (parts.length >= 2) {
    const tail = parts.slice(-2).join('/');
    const prefix = s.startsWith('~/') ? '~/' : s.startsWith('/') ? '/' : '';
    const candidate = `${prefix}…/${tail}`;
    if (candidate.length <= max) return candidate;
    return `…/${parts[parts.length - 1]}`;
  }
  return `…${s.slice(-(max - 1))}`;
}

export function modelLabel(model: string): string {
  if (model === 'spockify-auto' || model.endsWith('-auto')) {
    return 'auto';
  }
  if (model === 'gpt-oss-20b' || model.startsWith('gpt-oss')) {
    return 'gpt-oss';
  }
  return model;
}

/** Header label: `auto → gemma` when orchestrator picked a worker. */
export function formatAssistantModel(
  requested: string,
  resolved?: string,
): string {
  const req = modelLabel(requested);
  const res = resolved ? modelLabel(resolved) : '';
  const isAuto =
    requested === 'spockify-auto' || requested.endsWith('-auto');
  if (res && isAuto && res !== req && res !== 'auto') {
    return `auto → ${res}`;
  }
  if (res && res !== req && !isAuto) {
    return res;
  }
  return req;
}

export function renderAssistantStart(
  requested?: string,
  resolved?: string,
): string {
  const name = ansi.accent(ansi.bold('spockify'));
  if (!requested) return `\n${name}\n`;
  const label = formatAssistantModel(requested, resolved);
  return `\n${name}${ansi.dim(' · ')}${ansi.cyan(label)}\n`;
}

export function permissionLabel(
  yolo: boolean,
  mode: import('./agent/types').AgentMode,
): string {
  if (mode === 'ask' || mode === 'plan') return 'ask';
  if (yolo) return 'bypass';
  return 'default';
}

export function modeBadge(mode: import('./agent/types').AgentMode): string {
  if (mode === 'plan') return 'plan';
  if (mode === 'build') return 'build';
  return mode === 'ask' ? 'ask' : 'agent';
}

function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/** Loaded-tool roster for /tools. */
export function renderToolsList(
  tools: Array<{ name: string; description: string }>,
): string {
  if (!tools.length) {
    return `\n${ansi.bold('  Tools')}\n  ${ansi.dim('None registered in this session.')}\n`;
  }
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const labelW = Math.max(12, ...sorted.map((t) => t.name.length));
  const rows = sorted.map((t) => {
    const one = t.description.replace(/\s+/g, ' ').trim();
    const clip = one.length > 88 ? `${one.slice(0, 85)}…` : one;
    return `  ${ansi.accent(padVisible(t.name, labelW))}  ${ansi.dim(clip)}`;
  });
  return `\n${ansi.bold('  Tools')}  ${ansi.dim(`${sorted.length} loaded`)}\n${rows.join('\n')}\n`;
}

function padVisible(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w >= width) return s;
  return s + ' '.repeat(width - w);
}

export function termCols(): number {
  return Math.max(52, Math.min(process.stdout.columns || 80, 96));
}

/**
 * Usable paint width. Leave the last terminal column empty so xterm/VS Code
 * does not auto-wrap a full-width line into an extra blank row (breaks CUU).
 */
export function paintCols(): number {
  const cols = process.stdout.columns || 80;
  return Math.max(40, Math.min(cols - 1, 95));
}

/** Truncate a (possibly ANSI-colored) string to a max visible width. */
export function truncateVisible(s: string, max: number): string {
  if (max <= 0) return '';
  if (visibleWidth(s) <= max) return s;
  let out = '';
  let w = 0;
  for (let i = 0; i < s.length; ) {
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    if (w >= max - 1) {
      out += '…';
      break;
    }
    out += s[i];
    w += 1;
    i += 1;
  }
  return out + ansi.reset;
}

/** ASCII art logo — rendered in the accent color (256-color peach). */
export function renderAsciiLogo(): string {
  const rawCols = process.stdout.columns || 80;
  const word = 'SPOCKIFY';

  const artworkLines = [
    '███████╗██████╗  ██████╗  ██████╗██╗  ██╗██╗███████╗██╗   ██╗',
    '██╔════╝██╔══██╗██╔═══██╗██╔════╝██║ ██╔╝██║██╔════╝╚██╗ ██╔╝',
    '███████╗██████╔╝██║   ██║██║     █████╔╝ ██║█████╗   ╚████╔╝',
    '╚════██║██╔═══╝ ██║   ██║██║     ██╔═██╗ ██║██╔══╝    ╚██╔╝',
    '███████║██║     ╚██████╔╝╚██████╗██║  ██╗██║██║        ██║',
    '╚══════╝╚═╝      ╚═════╝  ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝',
  ];

  const maxLineLen = Math.max(...artworkLines.map((l) => l.length));
  // Keep a narrow-terminal fallback (single centered line) so we don't overflow.
  if (rawCols < maxLineLen) {
    const padLeft = Math.max(0, Math.floor((rawCols - word.length) / 2));
    return `\n${' '.repeat(padLeft)}${ansi.accent(ansi.bold(word))}\n`;
  }

  // Center the whole block (no ANSI inside the measured width).
  const padLeft = Math.max(0, Math.floor((rawCols - maxLineLen) / 2));
  const centered = artworkLines.map((line) => {
    const rightPad = maxLineLen - line.length;
    return `${' '.repeat(padLeft)}${ansi.accent(line + ' '.repeat(rightPad))}`;
  });

  return `\n${centered.join('\n')}\n`;
}

/** Minimal welcome — status lives under the input box (Claude Code). */
export function renderBanner(state: SessionUiState): string {
  const lab = !!state.lab;
  const role = state.evalMode
    ? `${ansi.dim('evaluation agent')}  ${ansi.gray('·')}  ${ansi.magenta('pentest-eval')}`
    : lab
      ? `${ansi.dim('coding agent')}  ${ansi.gray('·')}  ${ansi.magenta('lab')}`
      : ansi.dim('coding agent');
  const hints = state.evalMode
    ? [
        ansi.dim('/help'),
        ansi.dim('/tools'),
        ansi.dim('/model'),
        ansi.dim('/think'),
        ansi.dim('/score'),
        ansi.dim('/findings'),
        ansi.dim('/done'),
        ansi.dim('/report'),
        ansi.dim('/expand'),
        ansi.dim('/approve'),
        ansi.dim('Ctrl+C twice to quit'),
      ]
    : lab
    ? [
        ansi.dim('/help'),
        ansi.dim('/rounds'),
        ansi.dim('/orch'),
        ansi.dim('/exec'),
        ansi.dim('/models'),
        ansi.dim('Ctrl+C to quit'),
      ]
    : [
        ansi.dim('/help'),
        ansi.dim('/model'),
        ansi.dim('/think'),
        ansi.dim('/mode'),
        ansi.dim('/clear'),
        ansi.dim('Ctrl+C twice to quit'),
      ];

  return (
    renderAsciiLogo() +
    `  ${role}  ${ansi.gray('·')}  ${ansi.dim(shortPath(state.cwd, termCols() - 24))}\n` +
    `  ${hints.join(ansi.dim(' · '))}\n\n`
  );
}

/** Compact mode tag for submitted prompts. */
export function sessionModeLabel(state: SessionUiState): string {
  if (state.lab) return 'lab';
  if (state.mode === 'ask') return 'ask';
  if (state.yolo) return 'yolo';
  return 'agent';
}

/** Live chrome: model · agent mode · ask|run all · email (or lab orch/exec). */
export function renderStatusLine(state: SessionUiState): string {
  if (state.lab) {
    const live =
      state.lab.round != null && state.lab.phase
        ? ansi.yellow(
            `R${state.lab.round}/${state.lab.maxRounds} · ${state.lab.phase}`,
          )
        : ansi.dim(`rounds ${state.lab.maxRounds}`);
    const parts: string[] = [
      `${ansi.cyan(modelLabel(state.lab.orch))}${ansi.dim(' → ')}${ansi.cyan(modelLabel(state.lab.exec))}`,
      ansi.magenta('lab'),
      live,
      ansi.dim(`×${state.lab.workers}`),
      ansi.dim(`harness ${state.harnessId || 'spockify'}`),
      state.email ? ansi.green(state.email) : ansi.dim('api-key'),
    ];
    return truncateVisible(`  ${parts.join(ansi.dim(' · '))}`, paintCols());
  }
  const pin = formatSessionPin({
    harnessId: state.harnessId,
    model: state.model,
    thinking: state.thinking || 'off',
    auto: state.autoPicked,
  });
  const modePart =
    state.mode === 'ask' ? ansi.blue('ask mode') : ansi.magenta('agent mode');
  const permPart =
    state.yolo && state.mode === 'agent'
      ? ansi.yellow('run all')
      : ansi.dim('ask');
  const parts: string[] = [ansi.cyan(pin), modePart, permPart];
  parts.push(state.email ? ansi.green(state.email) : ansi.dim('api-key'));
  return truncateVisible(`  ${parts.join(ansi.dim(' · '))}`, paintCols());
}

/** After submit: model + ask/yolo/agent only (or lab orch→exec). */
export function renderSubmittedStatus(state: SessionUiState): string {
  if (state.lab) {
    return truncateVisible(
      `  ${ansi.cyan(modelLabel(state.lab.orch))}${ansi.dim(' → ')}${ansi.cyan(modelLabel(state.lab.exec))}${ansi.dim(' · ')}${ansi.magenta('lab')}${ansi.dim(` · rounds ${state.lab.maxRounds}`)}`,
      paintCols(),
    );
  }
  const mode = sessionModeLabel(state);
  const colored =
    mode === 'ask'
      ? ansi.blue(mode)
      : mode === 'yolo'
        ? ansi.yellow(mode)
        : ansi.magenta(mode);
  return truncateVisible(
    `  ${ansi.cyan(
      formatSessionPin({
        harnessId: state.harnessId,
        model: state.model,
        thinking: state.thinking || 'off',
        auto: state.autoPicked,
      }),
    )}${ansi.dim(' · ')}${colored}`,
    paintCols(),
  );
}

export function renderHelp(lab = false, evalMode = false): string {
  if (evalMode) {
    const rows: Array<[string, string]> = [
      ['/resume', 'Continue a saved chat'],
      ['/model', 'Pick a planner'],
      ['/think [mode]', 'Cycle thinking Off→Low→Med→High→Heavy'],
      ['/autonomy <L0-L3>', 'Retune the approval gate (L0 = full throughput)'],
      ['/scope [file]', 'Show or load a customer / test scope brief'],
      ['/score', 'Score this run against the catalogue (lists findings)'],
      ['/findings', 'Finding cards; /findings edit <id> field=value before /approve'],
      ['/done', 'Force a close-out turn: submit findings or declare none'],
      ['/report', 'Write a pentest report (score appended when a catalogue is loaded)'],
      ['/expand', 'Same report plus transcript and previous draft as appendices'],
      ['/approve', 'Accept queued findings/report after reviewing cards'],
      ['/kill', 'Stop the evaluation session'],
      ['/tools', 'List tools loaded in this session'],
      ['/status', 'Session details'],
      ['/clear', 'Clear conversation'],
      ['/help', 'Show this help'],
      ['/exit', 'Quit'],
    ];
    const labelW = Math.max(...rows.map(([k]) => k.length));
    const body = rows
      .map(([k, v]) => `  ${ansi.accent(padVisible(k, labelW))}  ${ansi.dim(v)}`)
      .join('\n');
    return (
      `\n${ansi.bold('  Evaluation')}\n` +
      `  ${ansi.dim('Same loop as a coding agent: you type a task, the planner uses tools, then you get findings.')}\n` +
      `  ${ansi.dim('Tools: eval_list, eval_glob, eval_read_file, eval_search, eval_write_file, eval_notes, eval_exec,')}\n` +
      `  ${ansi.dim('eval_status, eval_health, eval_digest, eval_pending, eval_validate_finding,')}\n` +
      `  ${ansi.dim('eval_submit_finding, eval_submit_report, eval_propose, eval_pin_endpoint, eval_connect.')}\n` +
      `\n${ansi.bold('  Commands')}\n${body}\n` +
      `\n  ${ansi.dim('Any other line is a task for the planner.')}\n`
    );
  }
  if (lab) {
    const overview = [
      '',
      ansi.bold('  Lab mode'),
      `  ${ansi.dim('Each prompt runs a closed loop: orch plans → parallel exec workers')}`,
      `  ${ansi.dim('implement → orch reviews → continue or stop. Repeats up to max rounds.')}`,
      '',
      ansi.bold('  Rounds'),
      `  ${ansi.dim('One round = plan + exec batch + DONE digests + review. Max rounds caps')}`,
      `  ${ansi.dim('how many loops run before stop (orch can stop earlier if done).')}`,
      `  ${ansi.dim('Set with /rounds, --max-rounds / --rounds, or SPOCKIFY_LAB_MAX_ROUNDS.')}`,
      '',
      ansi.bold('  Roles'),
      `  ${ansi.dim('orch  — planner + reviewer (lab-orchestrator)')}`,
      `  ${ansi.dim('exec  — implementer model used by each worker (lab-executor)')}`,
      `  ${ansi.dim('workers — max parallel exec tasks per round (×N in status)')}`,
      '',
      ansi.bold('  Progress'),
      `  ${ansi.dim('Live round banners (Round k/N · plan|exec|handoff|review), streamed')}`,
      `  ${ansi.dim('orch/exec, DONE/OUTPUT digests after exec, plus continue/stop.')}`,
      `  ${ansi.dim('Status line shows live Rk/N · phase while the harness runs.')}`,
      '',
      ansi.bold('  Keys'),
      `  ${ansi.dim('Ctrl+C exits immediately (cancels an in-flight harness). Ctrl+D /exit too.')}`,
      `  ${ansi.dim('Input: arrows move · esc+enter newline · Ctrl+W delete word.')}`,
      `  ${ansi.dim('tmux note: Ctrl+Left may be bound by tmux — use Esc+b or unbind C-Left.')}`,
      '',
    ].join('\n');
    const rows: Array<[string, string]> = [
      ['/rounds [n]', 'Pick or set max rounds (1–20)'],
      ['/workers [n]', 'Show or set parallel workers'],
      ['/orch [id]', 'Show or set orchestrator model'],
      ['/exec [id]', 'Show or set executor model'],
      ['/models', 'Dual-role mapping + live lab aliases'],
      ['/tools', 'List tools loaded in this session'],
      ['/status', 'Full session details'],
      ['/clear', 'Reset turn counter'],
      ['/help', 'Show this help'],
      ['/exit', 'Quit (or Ctrl+C)'],
    ];
    const labelW = Math.max(...rows.map(([k]) => k.length));
    const body = rows
      .map(
        ([k, v]) =>
          `  ${ansi.accent(padVisible(k, labelW))}  ${ansi.dim(v)}`,
      )
      .join('\n');
    return (
      `${overview}${ansi.bold('  Commands')}\n${body}\n` +
      `\n  ${ansi.dim('Any other line is a coding goal for the harness.')}\n`
    );
  }
  const rows: Array<[string, string]> = [
    ['/ask', 'Ask mode — read-only, no writes'],
    ['/plan', 'Plan mode — OpenCode-shaped read-only'],
    ['/agent', 'Agent mode — can edit and run tools'],
    ['/build', 'Build mode — OpenCode-shaped writes'],
    ['/init', 'Write AGENTS.md project memory'],
    ['/mode', 'Interactive mode / permissions picker'],
    ['/yolo', 'Toggle run all (skip tool confirms)'],
    ['/revoke', 'Clear session tool grants (re-ask next command)'],
    ['/model', 'Pin gpt-oss-20b or gpt-oss-120b (locked after first write)'],
    ['/skill', 'Attach ≤2 skills by name from .spockify/skills'],
    ['/think [mode]', 'Cycle thinking Off→Low→Med→High→Heavy (or set mode)'],
    ['/tools', 'List tools loaded in this session'],
    ['/status', 'Full session details'],
    ['/clear', 'Clear conversation'],
    ['/help', 'Show this help'],
    ['/exit', 'Quit (or Ctrl+C / Ctrl+D twice)'],
  ];
  const labelW = Math.max(...rows.map(([k]) => k.length));
  const body = rows
    .map(
      ([k, v]) =>
        `  ${ansi.accent(padVisible(k, labelW))}  ${ansi.dim(v)}`,
    )
    .join('\n');
  return (
    `\n${ansi.bold('  Commands')}\n${body}\n` +
    `\n${ansi.bold('  Input')}\n` +
    `  ${ansi.dim('Left/Right · Home/End · Ctrl+Left/Right words · Ctrl+W / Ctrl+Backspace delete word')}\n` +
    `  ${ansi.dim('Up/Down wrap then history · Enter send · Esc+Enter or Shift+Enter newline')}\n` +
    `  ${ansi.dim('tmux: Ctrl+Left is often tmux-bound — unbind or use Alt+Left if your term sends it.')}\n` +
    `\n  ${ansi.dim('Chat High/Medium may SPAWN workers via the router (chips on web/IDE);')}` +
    `\n  ${ansi.dim('same DONE-digest merge as lab. Heavy stays the 4-role ensemble.')}\n`
  );
}

export function renderStatusPanel(state: SessionUiState): string {
  const rows: Array<[string, string]> = state.lab
    ? [
        ['Orchestrator', modelLabel(state.lab.orch)],
        ['Executor', modelLabel(state.lab.exec)],
        ['Workers', String(state.lab.workers)],
        ['Max rounds', String(state.lab.maxRounds)],
        ['Mode', 'lab closed-loop'],
        ['Workspace', state.cwd],
        ['Account', state.email || '(API key / no email)'],
        ['Endpoint', state.baseUrl || 'https://spockify.eu'],
        ['Turns', String(state.turns)],
      ]
    : [
        ['Model', modelLabel(state.model)],
        ['Mode', state.mode === 'ask' ? 'ask mode' : 'agent mode'],
        [
          'Thinking',
          state.thinking
            ? state.thinking === 'off'
              ? 'Off'
              : state.thinking
            : '(default)',
        ],
        [
          'Permissions',
          state.yolo && state.mode === 'agent' ? 'run all' : 'ask',
        ],
        ['Workspace', state.cwd],
        ['Account', state.email || '(API key / no email)'],
        ['Endpoint', state.baseUrl || 'https://spockify.eu'],
        ['Turns', String(state.turns)],
      ];
  const labelW = Math.max(...rows.map(([k]) => k.length));
  const body = rows
    .map(([k, v]) => `  ${ansi.dim(padVisible(k, labelW))}  ${v}`)
    .join('\n');
  return `\n${ansi.bold('  Session')}\n${body}\n`;
}

export function renderPromptHeader(): string {
  const inner = termCols() - 2;
  return `\n${ansi.border(`╭${'─'.repeat(inner)}╮`)}\n`;
}

export function commandHintsLine(lab = false): string {
  return truncateVisible(
    lab
      ? ansi.dim('  /help · enter send · esc+enter newline')
      : ansi.dim('  / commands · enter send · esc+enter newline · ↑ history'),
    paintCols(),
  );
}

/** One-shot tip under the lab banner (first REPL paint). */
export function renderLabFirstRunTip(): string {
  return (
    renderHint(
      'Tip: /help explains the loop · /rounds picks max plan→exec→review rounds',
    ) + '\n'
  );
}

/** Parse `══ Round k/N · phase ══` harness banners. */
export function parseLabRoundBanner(
  line: string,
): { round: number; maxRounds: number; phase: string } | null {
  const m = /══\s*Round\s+(\d+)\s*\/\s*(\d+)\s*·\s*([a-z]+)(?:\b|\s)/i.exec(
    line || '',
  );
  if (!m) return null;
  return {
    round: Number(m[1]),
    maxRounds: Number(m[2]),
    phase: m[3].toLowerCase(),
  };
}

/** Pre-run chrome before spawning the harness. */
export function renderLabRunHeader(state: SessionUiState, turn: number): string {
  const lab = state.lab;
  if (!lab) return '';
  return (
    `\n${ansi.accent(ansi.bold('spockify'))}${ansi.dim(' · ')}${ansi.magenta('lab')}` +
      `${ansi.dim(' · turn ')}${ansi.bold(String(turn))}` +
      `${ansi.dim(' · ')}${ansi.cyan(modelLabel(lab.orch))}${ansi.dim(' → ')}${ansi.cyan(modelLabel(lab.exec))}` +
      `${ansi.dim(` · max ${lab.maxRounds} rounds · ×${lab.workers}`)}\n`
  );
}

/** Post-run chrome: wall time + exit. */
export function renderLabRunFooter(opts: {
  wallS: number;
  code: number;
  round?: number;
  maxRounds?: number;
}): string {
  const wall =
    opts.wallS < 10
      ? `${opts.wallS.toFixed(1)}s`
      : `${Math.round(opts.wallS)}s`;
  const roundBit =
    opts.round != null && opts.maxRounds != null
      ? `${ansi.dim(' · last ')}R${opts.round}/${opts.maxRounds}`
      : '';
  const status =
    opts.code === 0
      ? ansi.green('done')
      : opts.code === 130
        ? ansi.yellow('cancelled')
        : ansi.red(`exit ${opts.code}`);
  return (
    `${ansi.dim('── ')}${status}${ansi.dim(` · ${wall}`)}${roundBit}${ansi.dim(' ──')}\n`
  );
}

/** Closing of the input box + status (history / non-live). */
export function renderPromptFooter(state: SessionUiState): string {
  const inner = paintCols() - 2;
  return (
    `${ansi.border(`╰${'─'.repeat(inner)}╯`)}\n` +
    `${renderStatusLine(state)}\n` +
    `${commandHintsLine()}\n`
  );
}

export function readlinePrompt(): string {
  return `${ansi.border('│')} ${ansi.accent('❯')} `;
}

/**
 * Last boxed-prompt paint geometry (cursor sits on a mid row).
 * Used so repaint/finish can move relative to a multi-line wrap region.
 */
let lastBoxedPaint: {
  /** 0-based caret row within the mid (input) block. */
  caretRow: number;
  /** Number of mid rows painted. */
  midRows: number;
  /** Rows from last mid line through end of footer. */
  linesBelowLastMid: number;
} = { caretRow: 0, midRows: 1, linesBelowLastMid: 3 };

/** Content width after the ` ❯ ` / indent prefix inside the box. */
export function boxedInputContentWidth(cols = paintCols()): number {
  const inner = cols - 2;
  return Math.max(8, inner - 3);
}

/**
 * Draw / redraw the input box with status underneath.
 * Buffer wraps downward (capped) instead of a one-line horizontal slide.
 * Does not use DECSC — VS Code's terminal is unreliable with save/restore.
 *
 * `submitted`: freeze the box with compact status only (no /help hint).
 * `caret` / `scrollTop`: grapheme index + wrap scroll (live editing).
 */
export function renderSlashMenu(
  items: SlashCommand[],
  selected: number,
  cols = paintCols(),
): string {
  if (!items.length) return '';
  const lines = items.map((it, i) => {
    const mark = i === selected ? ansi.accent('❯') : ansi.dim(' ');
    const name = i === selected ? ansi.bold(it.name) : ansi.dim(it.name);
    const hint = ansi.dim(`  ${it.hint}`);
    return truncateVisible(`  ${mark} ${name}${hint}`, cols);
  });
  return lines.join('\n');
}

export function paintBoxedPrompt(
  state: SessionUiState,
  buf: string,
  opts?: {
    repaint?: boolean;
    submitted?: boolean;
    caret?: number;
    scrollTop?: number;
    slashItems?: SlashCommand[];
    slashSelected?: number;
  },
): void {
  const cols = paintCols();
  const inner = cols - 2;
  const contentW = boxedInputContentWidth(cols);
  const top = ansi.border(`╭${'─'.repeat(inner)}╮`);
  const bottom = ansi.border(`╰${'─'.repeat(inner)}╯`);

  const graphemes = segmentGraphemes(buf);
  const caret =
    opts?.caret != null
      ? Math.max(0, Math.min(opts.caret, graphemes.length))
      : graphemes.length;
  const lay = layoutWrap(
    graphemes,
    caret,
    contentW,
    MAX_INPUT_ROWS,
    opts?.scrollTop ?? 0,
  );

  const midLines: string[] = [];
  for (let vi = 0; vi < lay.visibleRows.length; vi++) {
    const row = lay.visibleRows[vi]!;
    const absRow = lay.scrollTop + vi;
    let slice = graphemes.slice(row.start, row.end);
    if (slice.length && slice[slice.length - 1] === '\n') {
      slice = slice.slice(0, -1);
    }
    const text = slice.join('');
    const prefix =
      absRow === 0 ? ` ${ansi.accent('❯')} ` : '   ';
    const left = `${prefix}${text}`;
    const pad = Math.max(0, inner - visibleWidth(left));
    midLines.push(
      `${ansi.border('│')}${left}${' '.repeat(pad)}${ansi.border('│')}`,
    );
  }
  if (midLines.length === 0) {
    const left = ` ${ansi.accent('❯')} `;
    const pad = Math.max(0, inner - visibleWidth(left));
    midLines.push(
      `${ansi.border('│')}${left}${' '.repeat(pad)}${ansi.border('│')}`,
    );
  }
  const mid = midLines.join('\n');
  const midRows = midLines.length;

  const submitted = !!opts?.submitted;
  const status = submitted
    ? renderSubmittedStatus(state)
    : renderStatusLine(state);
  const slashItems = !submitted && opts?.slashItems?.length ? opts.slashItems : [];
  const slashBlock =
    slashItems.length > 0
      ? renderSlashMenu(slashItems, opts?.slashSelected ?? 0, cols)
      : '';
  const hint = submitted ? '' : commandHintsLine(!!state.lab);
  const footerParts = [status, slashBlock, hint].filter(Boolean);
  const footer = footerParts.join('\n');
  const footerRows = footer.split('\n').length;
  const linesBelowLastMid = 1 + footerRows;

  if (opts?.repaint) {
    // Cursor is on a mid row — climb to the top border, then clear down.
    const up = lastBoxedPaint.caretRow + 1;
    process.stdout.write(`\x1b[${up}A\x1b[1G\x1b[0J`);
  } else {
    process.stdout.write('\n');
  }

  process.stdout.write(`${top}\n${mid}\n${bottom}\n${footer}`);

  const caretVis = lay.caretRow - lay.scrollTop;
  const caretRowClamped = Math.max(0, Math.min(midRows - 1, caretVis));
  // From end of footer → target mid row
  const upFromFooter =
    linesBelowLastMid + (midRows - 1 - caretRowClamped);
  process.stdout.write(`\x1b[${upFromFooter}A`);

  // Column: │ + prefix + caretCol (1-based CHA)
  const absCaretRow = lay.scrollTop + caretRowClamped;
  const prefixW = absCaretRow === 0 ? 3 : 3; // " ❯ " or "   "
  let caretCol = lay.caretCol;
  if (caretVis !== caretRowClamped) {
    // Caret scrolled out of the painted window — park at end of last visible.
    const row = lay.visibleRows[caretRowClamped]!;
    let slice = graphemes.slice(row.start, row.end);
    if (slice.length && slice[slice.length - 1] === '\n') {
      slice = slice.slice(0, -1);
    }
    caretCol = 0;
    for (const g of slice) caretCol += graphemeWidth(g);
  }
  const col = 2 + prefixW + caretCol;
  process.stdout.write(`\x1b[${col}G`);

  lastBoxedPaint = {
    caretRow: caretRowClamped,
    midRows,
    linesBelowLastMid,
  };
}

/** Turn off mouse tracking (safe to call even if it was never enabled). */
export function disableMouseTracking(): void {
  process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?1003l');
}

/** After submit: move below chrome so agent output follows cleanly. */
export function finishBoxedPrompt(): void {
  const down =
    lastBoxedPaint.midRows -
    1 -
    lastBoxedPaint.caretRow +
    lastBoxedPaint.linesBelowLastMid;
  process.stdout.write(`\x1b[${Math.max(0, down)}B\r\n`);
}

/** @deprecated use paintBoxedPrompt */
export function openLivePrompt(state: SessionUiState): number {
  paintBoxedPrompt(state, '');
  return 3;
}

/** @deprecated use finishBoxedPrompt */
export function finishLivePrompt(_linesBelow: number): void {
  finishBoxedPrompt();
}

export function renderHint(msg: string): string {
  return `${ansi.dim(`  ${msg}`)}\n`;
}

function wrapPlain(s: string, width: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else {
      lines.push(cur);
      cur = w;
    }
    while (cur.length > width) {
      lines.push(cur.slice(0, width));
      cur = cur.slice(width);
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * A dim, boxed "reasoning" panel that keeps the model's chain-of-thought
 * visually separate from its reply. Returns '' when there is nothing to show.
 */
export function renderReasoning(text: string, label = 'reasoning'): string {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return '';
  const width = Math.max(24, Math.min(96, termCols() - 6));
  const out: string[] = [`\n  ${ansi.dim(`╭─ ${label}`)}`];
  for (const raw of clean.split('\n')) {
    const line = raw.trimEnd();
    if (!line) {
      out.push(`  ${ansi.dim('│')}`);
      continue;
    }
    for (const chunk of wrapPlain(line, width)) {
      out.push(`  ${ansi.dim('│')} ${ansi.gray(chunk)}`);
    }
  }
  out.push(`  ${ansi.dim('╰─')}\n`);
  return `${out.join('\n')}\n`;
}

export function renderError(msg: string): string {
  return `\n${ansi.red('✘')} ${msg}\n`;
}

/** Human-readable preview of tool args for permission UI (no raw JSON dump). */
export function formatToolArgsPreview(
  name: string,
  args: Record<string, unknown>,
): { title: string; body: string } {
  if (name === 'shell') {
    const cmd = String(args.command ?? '').trim() || '(empty command)';
    return { title: 'bash', body: cmd };
  }
  if (name === 'write_file' || name === 'edit_file' || name === 'read_file') {
    const path = String(args.path ?? args.file ?? '').trim() || '(path)';
    if (name === 'edit_file') {
      const oldS = String(args.old_string ?? '').slice(0, 120);
      const newS = String(args.new_string ?? '').slice(0, 120);
      return {
        title: 'edit',
        body: `${path}\n\n− ${oldS}${oldS.length >= 120 ? '…' : ''}\n+ ${newS}${newS.length >= 120 ? '…' : ''}`,
      };
    }
    if (name === 'write_file') {
      const content = String(args.content ?? '');
      const lines = content.split('\n').length;
      return {
        title: 'write',
        body: `${path}\n${lines} line${lines === 1 ? '' : 's'}`,
      };
    }
    return { title: 'read', body: path };
  }
  // Generic: key: value lines, not JSON braces
  const lines = Object.entries(args).map(([k, v]) => {
    const val =
      typeof v === 'string'
        ? v.length > 160
          ? `${v.slice(0, 160)}…`
          : v
        : JSON.stringify(v);
    return `${k}: ${val}`;
  });
  return { title: name, body: lines.join('\n') || '(no args)' };
}

export function renderPermissionRequest(
  name: string,
  args: Record<string, unknown>,
): string {
  const { title, body } = formatToolArgsPreview(name, args);
  const header =
    `\n${ansi.yellow('⏸')}  ${ansi.bold('Allow')} ${ansi.cyan(name)}?\n`;
  const card = renderCard({
    title,
    body,
    tone: name === 'shell' || name === 'bash' ? 'code' : 'tool',
  });
  return header + card;
}

/** Bordered content card (code / shell / tool output). */
export function renderCard(opts: {
  title: string;
  body: string;
  tone?: 'code' | 'ok' | 'err' | 'tool';
}): string {
  const cols = termCols();
  const inner = cols - 2;
  const tone = opts.tone || 'code';
  const titleColor =
    tone === 'err'
      ? ansi.red
      : tone === 'ok'
        ? ansi.green
        : tone === 'tool'
          ? ansi.cyan
          : ansi.accent;

  const label = ` ${opts.title} `;
  const labelW = visibleWidth(label);
  const left = 1;
  const right = Math.max(1, inner - left - labelW);
  const top =
    ansi.border('╭') +
    ansi.border('─'.repeat(left)) +
    titleColor(label) +
    ansi.border('─'.repeat(right)) +
    ansi.border('╮');

  const lines = (opts.body.replace(/\r\n/g, '\n').replace(/\r/g, '\n') || ' ')
    .split('\n')
    .map((line) => {
      // soft-wrap long lines
      const chunks: string[] = [];
      const max = inner - 2;
      let rest = line;
      if (rest.length === 0) {
        chunks.push('');
      } else {
        while (rest.length > max) {
          chunks.push(rest.slice(0, max));
          rest = rest.slice(max);
        }
        chunks.push(rest);
      }
      return chunks
        .map((chunk) => {
          const content =
            tone === 'code' ? ansi.code(chunk) : chunk;
          return (
            ansi.border('│') +
            ' ' +
            padVisible(content, inner - 1) +
            ansi.border('│')
          );
        })
        .join('\n');
    });

  const bottom = ansi.border(`╰${'─'.repeat(inner)}╯`);
  return `\n${top}\n${lines.join('\n')}\n${bottom}\n`;
}

export function toolStatusLine(
  name: string,
  args: Record<string, unknown> | undefined,
): string {
  const a = args || {};
  const pathish = String(
    a.path || a.file || a.filepath || a.command || a.query || a.pattern || '',
  ).trim();
  const short =
    pathish.length > 64 ? `${pathish.slice(0, 61)}…` : pathish;
  switch (name) {
    case 'read_file':
    case 'read':
      return short ? `Reading ${short}` : 'Reading…';
    case 'write_file':
    case 'write':
    case 'apply_patch':
    case 'edit':
      return short ? `Editing ${short}` : 'Editing…';
    case 'grep':
    case 'glob':
    case 'codebase_search':
      return short ? `Searching ${short}` : 'Searching…';
    case 'terminal_run':
    case 'shell':
    case 'run_terminal':
      return short ? `Running: ${short}` : 'Running shell…';
    case 'list_dir':
      return short ? `Listing ${short}` : 'Listing…';
    default:
      return short ? `${name} ${short}` : name;
  }
}

/** Mid-thought SPAWN HUD line from router `spockify_agents` payload. */
export function agentsStatusLine(run: Record<string, unknown>): string {
  const status = String(run.status || '').toLowerCase();
  const workers = Array.isArray(run.workers) ? run.workers : [];
  const total =
    typeof run.workerCount === 'number'
      ? run.workerCount
      : typeof run.n === 'number'
        ? run.n
        : workers.length;
  const done = workers.filter((w) => {
    if (!w || typeof w !== 'object') return false;
    const s = String(
      (w as { status?: string; state?: string }).status ||
        (w as { status?: string; state?: string }).state ||
        '',
    ).toLowerCase();
    return /^(done|failed|cancelled|completed|ok)$/.test(s);
  }).length;
  if (status === 'merging' || status === 'merge' || status === 'synthesizing') {
    return 'Merging workers…';
  }
  if (total > 0) {
    return `Spawn · ${done}/${total}`;
  }
  if (status === 'running' || status === 'spawn' || status === 'spawning') {
    return 'Spawn workers…';
  }
  return 'Spawn…';
}

export function renderToolStart(name: string, argsPreview: string): string {
  const preview = argsPreview ? ansi.dim(` ${argsPreview}`) : '';
  return `\n${ansi.cyan('⏺')} ${ansi.bold(name)}${preview}\n`;
}

/**
 * Spinner that animates in-place on stdout while awaiting a response.
 * Call start() before the async work, stop() after.
 */
export class Spinner {
  private static readonly FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIdx = 0;
  private label: string;
  private active = false;

  constructor(label = 'thinking') {
    this.label = label;
  }

  setLabel(label: string): void {
    this.label = label || 'thinking';
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.frameIdx = 0;
    process.stdout.write('\n');
    this.timer = setInterval(() => {
      const frame = Spinner.FRAMES[this.frameIdx % Spinner.FRAMES.length]!;
      process.stdout.write(
        `\r  ${ansi.accent(frame)} ${ansi.dim(this.label)}…   `,
      );
      this.frameIdx++;
    }, 80);
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Clear the spinner line
    process.stdout.write('\r\x1b[2K');
  }
}

export function renderGoodbye(): string {
  return (
    `\n  ${ansi.dim('╭─────────────────────────────╮')}\n` +
    `  ${ansi.dim('│')}  ${ansi.accent('✦')} ${ansi.bold('Thanks for using Spockify')}  ${ansi.dim('│')}\n` +
    `  ${ansi.dim('╰─────────────────────────────╯')}\n\n`
  );
}

export function renderToolResultCard(
  name: string,
  ok: boolean,
  content: string,
): string {
  const body = (content || '').trimEnd() || (ok ? '(empty)' : '(failed)');
  // Keep cards readable — cap very long shell dumps
  const maxLines = 40;
  const lines = body.split('\n');
  const clipped =
    lines.length > maxLines
      ? lines.slice(0, maxLines).join('\n') +
        `\n… ${lines.length - maxLines} more lines`
      : body;
  return renderCard({
    title: ok ? name : `${name} · failed`,
    body: clipped,
    tone: ok ? 'ok' : 'err',
  });
}

/**
 * Stream markdown → terminal: prose streams live; fenced code becomes cards.
 */
export class MarkdownStreamRenderer {
  private buf = '';
  private mode: 'text' | 'fence' = 'text';
  private fenceLang = '';
  private fenceBody = '';
  private out: (s: string) => void;

  constructor(out: (s: string) => void = (s) => process.stdout.write(s)) {
    this.out = out;
  }

  push(chunk: string): void {
    this.buf += chunk;
    this.drain(false);
  }

  flush(): void {
    this.drain(true);
  }

  private drain(eof: boolean): void {
    while (this.buf.length) {
      if (this.mode === 'text') {
        const idx = this.buf.indexOf('```');
        if (idx === -1) {
          if (eof) {
            this.out(formatProse(this.buf));
            this.buf = '';
          } else {
            // hold back a partial ``` at the end
            const hold = holdFencePrefix(this.buf);
            const emit = this.buf.slice(0, this.buf.length - hold);
            if (emit) this.out(formatProse(emit));
            this.buf = this.buf.slice(this.buf.length - hold);
          }
          return;
        }
        if (idx > 0) {
          this.out(formatProse(this.buf.slice(0, idx)));
        }
        this.buf = this.buf.slice(idx + 3);
        const nl = this.buf.indexOf('\n');
        if (nl === -1) {
          if (!eof) {
            // incomplete fence header — put back
            this.buf = '```' + this.buf;
            return;
          }
          this.fenceLang = this.buf.trim() || 'code';
          this.buf = '';
        } else {
          this.fenceLang = this.buf.slice(0, nl).trim() || 'code';
          this.buf = this.buf.slice(nl + 1);
        }
        this.mode = 'fence';
        this.fenceBody = '';
        continue;
      }

      // fence mode
      const close = this.buf.indexOf('```');
      if (close === -1) {
        if (eof) {
          this.fenceBody += this.buf;
          this.buf = '';
          this.emitFence();
          this.mode = 'text';
        } else {
          const hold = holdFencePrefix(this.buf);
          this.fenceBody += this.buf.slice(0, this.buf.length - hold);
          this.buf = this.buf.slice(this.buf.length - hold);
        }
        return;
      }
      this.fenceBody += this.buf.slice(0, close);
      this.buf = this.buf.slice(close + 3);
      // drop optional trailing newline after closing fence
      if (this.buf.startsWith('\n')) this.buf = this.buf.slice(1);
      this.emitFence();
      this.mode = 'text';
    }
  }

  private emitFence(): void {
    const lang = this.fenceLang || 'code';
    const title = lang.toLowerCase() === 'bash' || lang.toLowerCase() === 'sh'
      ? 'bash'
      : lang.toLowerCase() === 'shell'
        ? 'shell'
        : lang;
    this.out(
      renderCard({
        title,
        body: this.fenceBody.replace(/\n$/, ''),
        tone: 'code',
      }),
    );
    this.fenceBody = '';
    this.fenceLang = '';
  }
}

function holdFencePrefix(s: string): number {
  if (s.endsWith('``')) return 2;
  if (s.endsWith('`')) return 1;
  return 0;
}

/** Light prose polish: bold **x**, inline `code`. */
function formatProse(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, (_m, inner: string) => ansi.bold(inner))
    .replace(/`([^`\n]+)`/g, (_m, inner: string) => ansi.cyan(inner));
}
