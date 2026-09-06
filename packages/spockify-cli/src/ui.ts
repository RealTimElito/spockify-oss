/** Claude Code–inspired terminal chrome for Spockify CLI. */

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

export interface SessionUiState {
  model: string;
  mode: 'ask' | 'agent';
  yolo: boolean;
  cwd: string;
  email?: string;
  baseUrl?: string;
  turns: number;
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

export function permissionLabel(yolo: boolean, mode: 'ask' | 'agent'): string {
  if (mode === 'ask') return 'ask';
  if (yolo) return 'bypass';
  return 'default';
}

export function modeBadge(mode: 'ask' | 'agent'): string {
  return mode === 'ask' ? 'ask' : 'agent';
}

function visibleWidth(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
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
  const hints = [
    ansi.dim('/help'),
    ansi.dim('/model'),
    ansi.dim('/mode'),
    ansi.dim('/clear'),
    ansi.dim('Ctrl+C twice to quit'),
  ].join(ansi.dim(' · '));

  return (
    renderAsciiLogo() +
    `  ${ansi.dim('coding agent')}  ${ansi.gray('·')}  ${ansi.dim(shortPath(state.cwd, termCols() - 24))}\n` +
    `  ${hints}\n\n`
  );
}

/** Compact mode tag for submitted prompts. */
export function sessionModeLabel(state: SessionUiState): string {
  if (state.mode === 'ask') return 'ask';
  if (state.yolo) return 'yolo';
  return 'agent';
}

/** Live chrome: model · agent mode · ask|run all · email */
export function renderStatusLine(state: SessionUiState): string {
  const modePart =
    state.mode === 'ask' ? ansi.blue('ask mode') : ansi.magenta('agent mode');
  const permPart =
    state.yolo && state.mode === 'agent'
      ? ansi.yellow('run all')
      : ansi.dim('ask');
  const parts: string[] = [
    ansi.cyan(modelLabel(state.model)),
    modePart,
    permPart,
    state.email ? ansi.green(state.email) : ansi.dim('api-key'),
  ];
  return truncateVisible(`  ${parts.join(ansi.dim(' · '))}`, paintCols());
}

/** After submit: model + ask/yolo/agent only. */
export function renderSubmittedStatus(state: SessionUiState): string {
  const mode = sessionModeLabel(state);
  const colored =
    mode === 'ask'
      ? ansi.blue(mode)
      : mode === 'yolo'
        ? ansi.yellow(mode)
        : ansi.magenta(mode);
  return truncateVisible(
    `  ${ansi.cyan(modelLabel(state.model))}${ansi.dim(' · ')}${colored}`,
    paintCols(),
  );
}

export function renderHelp(): string {
  const rows: Array<[string, string]> = [
    ['/ask', 'Ask mode — read-only, no writes'],
    ['/agent', 'Agent mode — can edit and run tools'],
    ['/mode', 'Interactive mode / permissions picker'],
    ['/yolo', 'Toggle run all (skip tool confirms)'],
    ['/model', 'Interactive model picker (or /model auto)'],
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
  return `\n${ansi.bold('  Commands')}\n${body}\n`;
}

export function renderStatusPanel(state: SessionUiState): string {
  const rows: Array<[string, string]> = [
    ['Model', modelLabel(state.model)],
    ['Mode', state.mode === 'ask' ? 'ask mode' : 'agent mode'],
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

export function commandHintsLine(): string {
  return truncateVisible(
    ansi.dim('  /help · /model · /mode'),
    paintCols(),
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

/** Lines below the input row for the last paint (for finishBoxedPrompt). */
let linesBelowInput = 3;

/**
 * Draw / redraw the input box with status underneath.
 * Leaves the cursor at the end of the typed text on the input line.
 * Does not use DECSC — VS Code's terminal is unreliable with save/restore.
 *
 * `submitted`: freeze the box with compact status only (no /help hint).
 */
export function paintBoxedPrompt(
  state: SessionUiState,
  buf: string,
  opts?: { repaint?: boolean; submitted?: boolean },
): void {
  const cols = paintCols();
  const inner = cols - 2;
  const top = ansi.border(`╭${'─'.repeat(inner)}╮`);
  const bottom = ansi.border(`╰${'─'.repeat(inner)}╯`);

  // Content between the two │ borders (visible width must be `inner`).
  const maxBuf = Math.max(8, inner - 3); // " ❯ "
  const display =
    buf.length > maxBuf ? `…${buf.slice(-(maxBuf - 1))}` : buf;
  const left = ` ${ansi.accent('❯')} ${display}`;
  const pad = Math.max(0, inner - visibleWidth(left));
  const mid = `${ansi.border('│')}${left}${' '.repeat(pad)}${ansi.border('│')}`;

  const submitted = !!opts?.submitted;
  const status = submitted
    ? renderSubmittedStatus(state)
    : renderStatusLine(state);
  // Live: status + /help only. Submitted: compact status alone.
  const footer = submitted ? status : `${status}\n${commandHintsLine()}`;
  linesBelowInput = submitted ? 2 : 3;

  if (opts?.repaint) {
    // Cursor is on the input line from the previous paint — go to top, clear down
    process.stdout.write('\x1b[1A\x1b[1G\x1b[0J');
  } else {
    process.stdout.write('\n');
  }

  // Write each chrome row with an explicit newline. Lines are cols-1 max so
  // the terminal never soft-wraps (which would desync relative cursor moves).
  process.stdout.write(`${top}\n${mid}\n${bottom}\n${footer}`);

  // Cursor is at end of footer — move just past the typed text on mid line
  process.stdout.write(`\x1b[${linesBelowInput}A`);
  // CHA is 1-based; +1 for leading │, +1 to sit after the last char (not on it)
  const col = 2 + visibleWidth(left);
  process.stdout.write(`\x1b[${col}G`);
}

/** Turn off mouse tracking (safe to call even if it was never enabled). */
export function disableMouseTracking(): void {
  process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?1003l');
}

/** After submit: move below chrome so agent output follows cleanly. */
export function finishBoxedPrompt(): void {
  process.stdout.write(`\x1b[${linesBelowInput}B\r\n`);
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
    tone: name === 'shell' ? 'code' : 'tool',
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
