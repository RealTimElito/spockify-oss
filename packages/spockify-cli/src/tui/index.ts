import { createModelTransport } from '@spockify/ide-client';
import { runAgentTurn } from '../agent/loop';
import { ToolRegistry } from '../agent/registry';
import { registerCliTools } from '../agent/tools';
import type { AgentMessage, AgentMode } from '../agent/types';
import { MODEL_PRESETS } from '../models';
import { modelLabel, shortPath, ansi } from '../ui';
import { Frame, truncate, visLen } from './draw';
import {
  createInputParser,
  enterAltScreen,
  hideCursor,
  leaveAltScreen,
  termSize,
  type KeyEvent,
} from './terminal';

export interface TuiOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  mode: AgentMode;
  cwd: string;
  yolo: boolean;
  email?: string;
}

type LogLine = {
  kind: 'user' | 'assistant' | 'system' | 'tool' | 'error';
  text: string;
  meta?: string;
};

type Modal =
  | null
  | { kind: 'settings' }
  | { kind: 'model'; idx: number }
  | { kind: 'mode'; idx: number }
  | { kind: 'perm'; idx: number }
  | { kind: 'confirm'; title: string; body: string };

export async function runTui(opts: TuiOptions): Promise<void> {
  const transport = createModelTransport({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });
  const registry = new ToolRegistry();
  registerCliTools(registry);

  let model = opts.model;
  let mode: AgentMode = opts.mode;
  let yolo = opts.yolo;
  let turns = 0;
  let input = '';
  let log: LogLine[] = [];
  let scroll = 0; // lines from bottom (0 = pinned to end)
  let modal: Modal = null;
  let running = false;
  let shouldExit = false;
  let frame: Frame | null = null;
  let dirty = true;
  let turnAbort: AbortController | undefined;
  let confirmResolve: ((ok: boolean) => void) | null = null;
  const history: AgentMessage[] = [];

  const size = () => termSize();

  const markDirty = () => {
    dirty = true;
  };

  const pushLog = (line: LogLine) => {
    log.push(line);
    markDirty();
  };

  const wrap = (text: string, width: number): string[] => {
    if (width < 8) return [truncate(text, width)];
    const words = text.split(/(\s+)/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if (visLen(cur) + visLen(w) <= width) {
        cur += w;
      } else {
        if (cur) lines.push(cur);
        cur = w.trimStart();
        while (visLen(cur) > width) {
          lines.push(cur.slice(0, width));
          cur = cur.slice(width);
        }
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };

  const render = () => {
    const { cols, rows } = size();
    if (!frame || frame.cols !== cols || frame.rows !== rows) {
      frame = new Frame(cols, rows);
    }
    frame.clear();

    // Keep sidebar wide enough that labels/values aren't clipped
    const sideW = Math.min(32, Math.max(26, Math.floor(cols * 0.3)));
    const chatW = Math.max(24, cols - sideW);
    const headerH = 1;
    const inputH = 3;
    const chatH = Math.max(6, rows - headerH - inputH);
    const sx = chatW;
    const iy = headerH + chatH;

    const modeVal = mode === 'ask' ? 'ask' : 'agent';
    const permVal = yolo && mode === 'agent' ? 'run all' : 'ask';

    // Header bar
    frame.fill(0, 0, cols, 1);
    frame.text(
      0,
      0,
      `${ansi.accent(ansi.bold(' Spockify'))}${ansi.dim(' TUI')}`,
    );
    const statusBits = [
      ansi.cyan(modelLabel(model)),
      mode === 'ask' ? ansi.blue(modeVal) : ansi.magenta(modeVal),
      yolo && mode === 'agent' ? ansi.yellow(permVal) : ansi.dim(permVal),
    ].join(ansi.dim(' · '));
    frame.text(16, 0, statusBits);
    const right = running ? ansi.yellow(' thinking… ') : ansi.dim(' idle ');
    frame.text(Math.max(0, cols - visLen(right) - 1), 0, right);

    // Chat panel
    frame.box(0, headerH, chatW, chatH, { title: 'chat', focus: !modal });
    const innerW = chatW - 4;
    const innerH = chatH - 2;
    const wrapped: string[] = [];
    if (log.length === 0) {
      wrapped.push(
        ansi.dim('Type a message · /help · click sidebar to change settings'),
      );
    }
    for (const line of log) {
      if (line.kind === 'user') {
        for (const b of wrap(`❯ ${line.text}`, innerW)) {
          wrapped.push(ansi.accent(b));
        }
      } else if (line.kind === 'assistant') {
        if (line.meta) {
          wrapped.push(ansi.dim(truncate(line.meta, innerW)));
        }
        for (const b of wrap(line.text, innerW)) {
          wrapped.push(b);
        }
        wrapped.push(''); // breathing room after replies
      } else if (line.kind === 'tool') {
        for (const b of wrap(`⚙ ${line.text}`, innerW)) {
          wrapped.push(ansi.dim(b));
        }
      } else if (line.kind === 'error') {
        for (const b of wrap(`✘ ${line.text}`, innerW)) {
          wrapped.push(ansi.red(b));
        }
      } else {
        for (const b of wrap(line.text, innerW)) {
          wrapped.push(ansi.dim(b));
        }
      }
    }
    const maxScroll = Math.max(0, wrapped.length - innerH);
    scroll = Math.min(scroll, maxScroll);
    const start = Math.max(0, wrapped.length - innerH - scroll);
    const slice = wrapped.slice(start, start + innerH);
    for (let i = 0; i < slice.length; i++) {
      frame.text(2, headerH + 1 + i, truncate(slice[i]!, innerW), innerW);
    }
    if (maxScroll > 0) {
      const hint = scroll > 0 ? `↑${scroll}` : '↓';
      frame.text(chatW - 4, headerH + chatH - 2, ansi.dim(hint), 3);
    }

    // Sidebar — one row per setting, clickable
    frame.box(sx, headerH, sideW, chatH, { title: 'session' });
    const contentW = sideW - 4;
    const rowsSide: Array<{
      id: string;
      label: string;
      value: string;
      color: (s: string) => string;
      clickable: boolean;
    }> = [
      {
        id: 'hit:model',
        label: 'model',
        value: modelLabel(model),
        color: ansi.cyan,
        clickable: true,
      },
      {
        id: 'hit:mode',
        label: 'mode',
        value: modeVal,
        color: mode === 'ask' ? ansi.blue : ansi.magenta,
        clickable: true,
      },
      {
        id: 'hit:perm',
        label: 'perm',
        value: permVal,
        color: yolo && mode === 'agent' ? ansi.yellow : ansi.dim,
        clickable: true,
      },
      {
        id: 'hit:email',
        label: 'user',
        value: opts.email || 'api-key',
        color: ansi.green,
        clickable: false,
      },
    ];

    let sy = headerH + 2;
    for (const r of rowsSide) {
      if (sy >= headerH + chatH - 6) break;
      frame.text(sx + 2, sy, ansi.dim(r.label), contentW);
      const val = truncate(r.value, contentW - (r.clickable ? 2 : 0));
      const line = r.clickable
        ? ansi.accent('▸ ') + r.color(val)
        : r.color(val);
      frame.text(sx + 2, sy + 1, line, contentW);
      if (r.clickable) {
        frame.hit(r.id, sx + 1, sy, sideW - 2, 2);
      }
      sy += 3;
    }

    // cwd
    if (sy < headerH + chatH - 5) {
      frame.text(sx + 2, sy, ansi.dim('cwd'), contentW);
      frame.text(
        sx + 2,
        sy + 1,
        ansi.dim(truncate(shortPath(opts.cwd, contentW), contentW)),
        contentW,
      );
      sy += 3;
    }

    // Sidebar actions
    const f = frame;
    const btnY = Math.max(sy + 1, headerH + chatH - 5);
    const btn = (id: string, y: number, label: string) => {
      if (y >= headerH + chatH - 1) return;
      const t = truncate(label, contentW - 2);
      f.text(sx + 2, y, ansi.accent(`[ ${t} ]`), contentW);
      f.hit(id, sx + 2, y, contentW, 1);
    };
    btn('hit:settings', btnY, 'settings  s');
    btn('hit:clear', btnY + 1, 'clear');
    btn('hit:quit', btnY + 2, 'quit  q');

    // Input bar — full width, accent when focused
    frame.box(0, iy, cols, inputH, {
      title: running ? 'working' : 'message',
      focus: !modal && !running,
    });
    const prompt = running ? ansi.dim('  … ') : ansi.accent('  ❯ ');
    const maxIn = cols - 8;
    const shown =
      input.length > maxIn ? `…${input.slice(-(maxIn - 1))}` : input;
    frame.text(1, iy + 1, prompt + shown, cols - 2);
    frame.text(
      Math.max(2, cols - 22),
      iy + 2,
      ansi.dim('enter send · /help'),
      20,
    );

    if (modal) {
      drawModal(frame, cols, rows, modal, model, mode, yolo);
      hideCursor();
    } else {
      hideCursor();
    }

    frame.flush();
  };

  const openSettings = () => {
    modal = { kind: 'settings' };
    markDirty();
  };

  const openModel = () => {
    const idx = Math.max(
      0,
      MODEL_PRESETS.findIndex((p) => p.id === model),
    );
    modal = { kind: 'model', idx };
    markDirty();
  };

  const openMode = () => {
    modal = { kind: 'mode', idx: mode === 'ask' ? 1 : 0 };
    markDirty();
  };

  const openPerm = () => {
    modal = {
      kind: 'perm',
      idx: yolo && mode === 'agent' ? 1 : 0,
    };
    markDirty();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    if (text === '/q' || text === '/quit' || text === '/exit') {
      shouldExit = true;
      return;
    }
    if (text === '/settings' || text === '/s') {
      input = '';
      openSettings();
      return;
    }
    if (text === '/help' || text === '/?') {
      input = '';
      pushLog({
        kind: 'system',
        text: 'Keys: enter send · s settings · ↑↓/PgUp/PgDn scroll · q quit · esc close · click ▸ sidebar',
      });
      pushLog({
        kind: 'system',
        text: 'Commands: /help · /settings · /clear · /exit · or click model/mode/perm',
      });
      return;
    }
    if (text === '/clear') {
      input = '';
      log = [];
      history.length = 0;
      turns = 0;
      markDirty();
      return;
    }
    input = '';
    pushLog({ kind: 'user', text });
    running = true;
    markDirty();
    turnAbort = new AbortController();
    const prior = history.filter((m) => m.role !== 'system');
    prior.push({ role: 'user', content: text });
    let assistantBuf = '';
    let headerMeta = '';
    // Start a fresh assistant bubble
    pushLog({ kind: 'assistant', text: '', meta: '' });
    try {
      const updated = await runAgentTurn({
        transport,
        registry,
        model,
        mode,
        messages: prior,
        cwd: opts.cwd,
        yolo,
        signal: turnAbort.signal,
        confirm: async (name, args) => {
          if (mode === 'ask') return false;
          if (yolo) return true;
          const preview = formatToolPreview(name, args);
          return await new Promise<boolean>((resolve) => {
            confirmResolve = resolve;
            modal = {
              kind: 'confirm',
              title: `Allow ${name}?`,
              body: preview,
            };
            markDirty();
          });
        },
        onEvent: (ev) => {
          if (ev.type === 'model') {
            headerMeta =
              ev.resolved && ev.resolved !== ev.requested
                ? `spockify · ${modelLabel(ev.requested)} → ${modelLabel(ev.resolved)}`
                : `spockify · ${modelLabel(ev.requested)}`;
          } else if (ev.type === 'text') {
            assistantBuf += ev.content;
            const last = log[log.length - 1];
            if (last?.kind === 'assistant') {
              last.text = assistantBuf;
              last.meta = headerMeta || last.meta;
              markDirty();
            } else {
              pushLog({
                kind: 'assistant',
                text: assistantBuf,
                meta: headerMeta,
              });
            }
          } else if (ev.type === 'toolStart') {
            pushLog({
              kind: 'tool',
              text: formatToolPreview(ev.name, ev.arguments),
            });
          } else if (ev.type === 'toolResult') {
            const snippet = (ev.content || ev.error || '')
              .replace(/\s+/g, ' ')
              .slice(0, 120);
            pushLog({
              kind: 'tool',
              text: `${ev.name} → ${ev.ok ? 'ok' : 'err'}${snippet ? `: ${snippet}` : ''}`,
            });
          } else if (ev.type === 'error') {
            pushLog({ kind: 'error', text: ev.message });
          }
        },
      });
      history.length = 0;
      history.push(...updated.filter((m) => m.role !== 'system'));
      turns += 1;
    } catch (err) {
      if (!turnAbort.signal.aborted) {
        pushLog({
          kind: 'error',
          text: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      running = false;
      turnAbort = undefined;
      markDirty();
    }
  };

  const onKey = async (ev: KeyEvent) => {
    if (ev.type === 'resize') {
      markDirty();
      return;
    }

    if (ev.type === 'mouse') {
      const { mouse } = ev;
      if (mouse.release) return;
      if (!frame) return;
      // scroll wheel (SGR button 64/65)
      if (mouse.button === 64) {
        scroll += 3;
        markDirty();
        return;
      }
      if (mouse.button === 65) {
        scroll = Math.max(0, scroll - 3);
        markDirty();
        return;
      }
      if (mouse.button !== 0 && mouse.button !== 32) return;
      const hit = frame.hitTest(mouse.col, mouse.row);
      if (!hit) return;
      if (modal) {
        handleModalHit(hit);
        return;
      }
      if (hit === 'hit:settings') openSettings();
      else if (hit === 'hit:model') openModel();
      else if (hit === 'hit:mode') openMode();
      else if (hit === 'hit:perm') openPerm();
      else if (hit === 'hit:clear') {
        log = [{ kind: 'system', text: 'Chat cleared.' }];
        history.length = 0;
        turns = 0;
        markDirty();
      } else if (hit === 'hit:quit') {
        shouldExit = true;
      } else if (hit.startsWith('modal:')) {
        handleModalHit(hit);
      }
      return;
    }

    const { key, ctrl } = ev;
    if (ctrl && key === 'c') {
      if (running) {
        turnAbort?.abort();
        pushLog({ kind: 'system', text: 'Cancelled.' });
        running = false;
        markDirty();
        return;
      }
      shouldExit = true;
      return;
    }

    if (modal) {
      handleModalKey(key);
      return;
    }

    if (key === 'escape') return;
    if (key === 'q' && input.length === 0) {
      shouldExit = true;
      return;
    }
    if (key === 's' && input.length === 0) {
      openSettings();
      return;
    }
    if (key === 'up' || key === 'pageup') {
      scroll += key === 'pageup' ? 10 : 1;
      markDirty();
      return;
    }
    if (key === 'down' || key === 'pagedown') {
      scroll = Math.max(0, scroll - (key === 'pagedown' ? 10 : 1));
      markDirty();
      return;
    }
    if (key === 'enter') {
      void send();
      return;
    }
    if (key === 'backspace') {
      input = input.slice(0, -1);
      markDirty();
      return;
    }
    if (key.length === 1 && !ctrl) {
      input += key;
      markDirty();
    }
  };

  const settleConfirm = (ok: boolean) => {
    if (confirmResolve) {
      confirmResolve(ok);
      confirmResolve = null;
    }
    modal = null;
    markDirty();
  };

  const handleModalHit = (hit: string) => {
    if (modal?.kind === 'confirm') {
      if (hit === 'modal:yes') settleConfirm(true);
      else if (hit === 'modal:no' || hit === 'modal:close') settleConfirm(false);
      return;
    }
    if (hit === 'modal:close') {
      modal = null;
      markDirty();
      return;
    }
    if (hit.startsWith('modal:pick:')) {
      const value = hit.slice('modal:pick:'.length);
      applyModalPick(value);
    }
    if (hit === 'modal:goto:model') openModel();
    if (hit === 'modal:goto:mode') openMode();
    if (hit === 'modal:goto:perm') openPerm();
  };

  const applyModalPick = (value: string) => {
    if (!modal) return;
    if (modal.kind === 'model') {
      model = value;
      pushLog({ kind: 'system', text: `Model → ${modelLabel(model)}` });
    } else if (modal.kind === 'mode') {
      mode = value as AgentMode;
      if (mode === 'ask') yolo = false;
      pushLog({
        kind: 'system',
        text: `Mode → ${mode === 'ask' ? 'ask mode' : 'agent mode'}`,
      });
    } else if (modal.kind === 'perm') {
      if (value === 'run-all') {
        mode = 'agent';
        yolo = true;
      } else {
        yolo = false;
      }
      pushLog({
        kind: 'system',
        text: `Permissions → ${yolo ? 'run all' : 'ask'}`,
      });
    }
    modal = null;
    markDirty();
  };

  const handleModalKey = (key: string) => {
    if (!modal) return;
    if (modal.kind === 'confirm') {
      if (key === 'y' || key === 'enter') settleConfirm(true);
      else if (key === 'n' || key === 'escape') settleConfirm(false);
      return;
    }
    if (key === 'escape') {
      modal = null;
      markDirty();
      return;
    }
    if (modal.kind === 'settings') {
      if (key === '1' || key === 'm') openModel();
      else if (key === '2') openMode();
      else if (key === '3') openPerm();
      else if (key === 'enter') openModel();
      return;
    }
    if (
      modal.kind === 'model' ||
      modal.kind === 'mode' ||
      modal.kind === 'perm'
    ) {
      const items =
        modal.kind === 'model'
          ? MODEL_PRESETS.map((p) => p.id)
          : modal.kind === 'mode'
            ? ['agent', 'ask']
            : ['ask', 'run-all'];
      if (key === 'up') {
        modal.idx = (modal.idx - 1 + items.length) % items.length;
        markDirty();
      } else if (key === 'down') {
        modal.idx = (modal.idx + 1) % items.length;
        markDirty();
      } else if (key === 'enter') {
        applyModalPick(items[modal.idx]!);
      }
    }
  };

  // --- boot ---
  enterAltScreen();
  const onData = createInputParser((ev) => {
    void onKey(ev);
  });
  process.stdin.on('data', onData);
  const onResize = () => {
    markDirty();
  };
  process.stdout.on('resize', onResize);

  try {
    while (!shouldExit) {
      if (dirty) {
        dirty = false;
        render();
      }
      await new Promise((r) => setTimeout(r, 16));
    }
  } finally {
    process.stdin.off('data', onData);
    process.stdout.off('resize', onResize);
    leaveAltScreen();
  }
}

function formatToolPreview(
  name: string,
  args: Record<string, unknown>,
): string {
  if (name === 'shell' && typeof args.command === 'string') {
    return `shell: ${args.command.slice(0, 160)}`;
  }
  if (typeof args.path === 'string') {
    return `${name}: ${args.path}`;
  }
  const raw = JSON.stringify(args);
  return `${name}: ${raw.slice(0, 120)}`;
}

function drawModal(
  frame: Frame,
  cols: number,
  rows: number,
  modal: Exclude<Modal, null>,
  model: string,
  mode: AgentMode,
  yolo: boolean,
): void {
  const w = Math.min(56, cols - 4);
  const h =
    modal.kind === 'settings'
      ? 12
      : modal.kind === 'confirm'
        ? 11
        : modal.kind === 'model'
          ? Math.min(16, MODEL_PRESETS.length + 6)
          : 10;
  const x = Math.floor((cols - w) / 2);
  const y = Math.floor((rows - h) / 2);

  // dim backdrop hint
  frame.box(x, y, w, h, {
    title:
      modal.kind === 'settings'
        ? 'settings'
        : modal.kind === 'model'
          ? 'model'
          : modal.kind === 'mode'
            ? 'mode'
            : 'permissions',
    focus: true,
  });

  if (modal.kind === 'settings') {
    const lines = [
      { id: 'modal:goto:model', t: `1  Model        ${modelLabel(model)}` },
      {
        id: 'modal:goto:mode',
        t: `2  Mode         ${mode === 'ask' ? 'ask mode' : 'agent mode'}`,
      },
      {
        id: 'modal:goto:perm',
        t: `3  Permissions  ${yolo && mode === 'agent' ? 'run all' : 'ask'}`,
      },
    ];
    for (let i = 0; i < lines.length; i++) {
      const yy = y + 2 + i * 2;
      frame.text(x + 2, yy, ansi.cyan(lines[i]!.t));
      frame.hit(lines[i]!.id, x + 2, yy, w - 4, 1);
    }
    frame.text(x + 2, y + h - 2, ansi.dim('click · 1/2/3 · esc close'));
    frame.hit('modal:close', x + w - 6, y, 4, 1);
    return;
  }

  if (modal.kind === 'confirm') {
    frame.text(x + 2, y + 2, ansi.bold(truncate(modal.title, w - 4)), w - 4);
    const bodyLines = modal.body.split('\n');
    for (let i = 0; i < Math.min(3, bodyLines.length); i++) {
      frame.text(
        x + 2,
        y + 4 + i,
        ansi.dim(truncate(bodyLines[i]!, w - 4)),
        w - 4,
      );
    }
    frame.text(x + 3, y + h - 3, ansi.green('[ y ] allow'), 12);
    frame.hit('modal:yes', x + 3, y + h - 3, 12, 1);
    frame.text(x + 18, y + h - 3, ansi.red('[ n ] deny'), 12);
    frame.hit('modal:no', x + 18, y + h - 3, 12, 1);
    frame.text(x + 2, y + h - 2, ansi.dim('y / n / esc'), w - 4);
    return;
  }

  const items =
    modal.kind === 'model'
      ? MODEL_PRESETS.map((p) => ({
          value: p.id,
          label: `${modelLabel(p.id).padEnd(8)} ${p.blurb}`,
        }))
      : modal.kind === 'mode'
        ? [
            { value: 'agent', label: 'agent mode — edit & run tools' },
            { value: 'ask', label: 'ask mode — read-only' },
          ]
        : [
            { value: 'ask', label: 'ask — confirm before tools' },
            { value: 'run-all', label: 'run all — skip confirms (yolo)' },
          ];

  const idx = modal.idx;
  for (let i = 0; i < items.length && i < h - 4; i++) {
    const it = items[i]!;
    const yy = y + 2 + i;
    const mark = i === idx ? ansi.accent('❯ ') : '  ';
    const lab =
      i === idx ? ansi.bold(truncate(it.label, w - 6)) : truncate(it.label, w - 6);
    frame.text(x + 2, yy, mark + lab);
    frame.hit(`modal:pick:${it.value}`, x + 2, yy, w - 4, 1);
  }
  frame.text(x + 2, y + h - 2, ansi.dim('↑↓ · enter · esc'));
}
