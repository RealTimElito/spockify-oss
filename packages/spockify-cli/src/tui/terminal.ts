/** Low-level terminal control for fullscreen TUI. */

export function enterAltScreen(): void {
  const out = process.stdout;
  out.write('\x1b[?1049h'); // alt screen
  out.write('\x1b[?25l'); // hide cursor (shown when typing in input)
  out.write('\x1b[?1000h\x1b[?1006h'); // mouse + SGR
  out.write('\x1b[?2004h'); // bracketed paste
  try {
    process.stdin.setRawMode(true);
  } catch {
    /* ignore */
  }
  process.stdin.resume();
}

export function leaveAltScreen(): void {
  const out = process.stdout;
  out.write('\x1b[?2004l');
  out.write('\x1b[?1000l\x1b[?1006l\x1b[?1003l');
  out.write('\x1b[?25h');
  out.write('\x1b[?1049l');
  try {
    process.stdin.setRawMode(false);
  } catch {
    /* ignore */
  }
}

export function showCursor(): void {
  process.stdout.write('\x1b[?25h');
}

export function hideCursor(): void {
  process.stdout.write('\x1b[?25l');
}

export function termSize(): { cols: number; rows: number } {
  return {
    cols: Math.max(40, process.stdout.columns || 80),
    rows: Math.max(12, process.stdout.rows || 24),
  };
}

export type MouseEvent = {
  button: number;
  col: number; // 1-based
  row: number;
  release: boolean;
};

export type KeyEvent =
  | { type: 'key'; key: string; ctrl?: boolean }
  | { type: 'mouse'; mouse: MouseEvent }
  | { type: 'resize' };

/** Parse stdin chunks into keys / mouse. */
export function createInputParser(
  onEvent: (ev: KeyEvent) => void,
): (chunk: Buffer) => void {
  let buf = '';

  return (chunk: Buffer) => {
    buf += chunk.toString('utf8');
    while (buf.length) {
      // SGR mouse
      const m = buf.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
      if (m) {
        onEvent({
          type: 'mouse',
          mouse: {
            button: Number(m[1]),
            col: Number(m[2]),
            row: Number(m[3]),
            release: m[4] === 'm',
          },
        });
        buf = buf.slice(m[0].length);
        continue;
      }

      // CSI / SS3 arrows etc.
      const csi = buf.match(/^\x1b\[[\d;]*[A-Za-z]/);
      if (csi) {
        const seq = csi[0];
        if (seq === '\x1b[A') onEvent({ type: 'key', key: 'up' });
        else if (seq === '\x1b[B') onEvent({ type: 'key', key: 'down' });
        else if (seq === '\x1b[C') onEvent({ type: 'key', key: 'right' });
        else if (seq === '\x1b[D') onEvent({ type: 'key', key: 'left' });
        else if (seq === '\x1b[Z') onEvent({ type: 'key', key: 'tab', ctrl: true });
        // ignore other CSI (focus, etc.)
        buf = buf.slice(seq.length);
        continue;
      }

      if (buf.startsWith('\x1b') && buf.length === 1) {
        // wait for more (or lone esc)
        return;
      }
      if (buf.startsWith('\x1b') && buf.length >= 2 && buf[1] !== '[') {
        // alt+key → treat as esc cancel
        onEvent({ type: 'key', key: 'escape' });
        buf = buf.slice(2);
        continue;
      }
      if (buf.startsWith('\x1b')) {
        // incomplete CSI
        if (buf.length < 6) return;
        buf = buf.slice(1);
        continue;
      }

      const ch = buf[0]!;
      buf = buf.slice(1);
      const code = ch.charCodeAt(0);
      if (code === 3) onEvent({ type: 'key', key: 'c', ctrl: true });
      else if (code === 4) onEvent({ type: 'key', key: 'd', ctrl: true });
      else if (code === 13 || code === 10)
        onEvent({ type: 'key', key: 'enter' });
      else if (code === 127 || code === 8)
        onEvent({ type: 'key', key: 'backspace' });
      else if (code === 9) onEvent({ type: 'key', key: 'tab' });
      else if (code === 27) onEvent({ type: 'key', key: 'escape' });
      else if (code >= 32) onEvent({ type: 'key', key: ch });
    }
  };
}
