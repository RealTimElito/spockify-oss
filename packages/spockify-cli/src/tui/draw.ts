import { ansi } from '../ui';

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export function visLen(s: string): number {
  return stripAnsi(s).length;
}

export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (visLen(s) <= max) return s;
  // Truncate by visible chars, drop styling (keeps layout correct)
  const plain = stripAnsi(s);
  if (max === 1) return '…';
  return plain.slice(0, max - 1) + '…';
}

export type HitId = string;

export type HitRegion = {
  id: HitId;
  x: number;
  y: number;
  w: number;
  h: number;
};

type Cell = { ch: string; style: string };

/**
 * Fullscreen cell buffer. Call clear → draw → flush each frame.
 */
export class Frame {
  cols: number;
  rows: number;
  hits: HitRegion[] = [];
  private cells: Cell[][];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.cells = this.blank();
  }

  private blank(): Cell[][] {
    return Array.from({ length: this.rows }, () =>
      Array.from({ length: this.cols }, () => ({ ch: ' ', style: '' })),
    );
  }

  clear(): void {
    this.cells = this.blank();
    this.hits = [];
  }

  /**
   * Write ANSI-colored string at 0-based coords.
   * `maxWidth` clips by visible columns (keeps text inside a panel).
   */
  text(x: number, y: number, s: string, maxWidth?: number): void {
    if (y < 0 || y >= this.rows || x >= this.cols) return;
    let cx = Math.max(0, x);
    const limit =
      maxWidth != null
        ? Math.min(this.cols, x + Math.max(0, maxWidth))
        : this.cols;
    let style = '';
    for (let i = 0; i < s.length && cx < limit; ) {
      if (s[i] === '\x1b' && s[i + 1] === '[') {
        const m = s.slice(i).match(/^\x1b\[[0-9;]*m/);
        if (m) {
          style = m[0] === '\x1b[0m' ? '' : m[0];
          i += m[0].length;
          continue;
        }
      }
      // Skip other control chars so they never become visible cells
      const code = s.charCodeAt(i);
      if (code < 32 && code !== 9) {
        i += 1;
        continue;
      }
      this.cells[y]![cx] = { ch: s[i]!, style };
      cx += 1;
      i += 1;
    }
  }

  hit(id: HitId, x: number, y: number, w: number, h = 1): void {
    if (w <= 0 || h <= 0) return;
    this.hits.push({ id, x, y, w, h });
  }

  hitTest(col1: number, row1: number): HitId | null {
    const x = col1 - 1;
    const y = row1 - 1;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const r = this.hits[i]!;
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.id;
    }
    return null;
  }

  box(
    x: number,
    y: number,
    w: number,
    h: number,
    opts?: { title?: string; focus?: boolean },
  ): void {
    if (w < 2 || h < 2) return;
    const edge = opts?.focus ? ansi.accent : ansi.border;
    const color = opts?.focus ? '\x1b[38;5;216m' : '\x1b[38;5;240m';

    // Draw border with a single style run (avoids width mistakes)
    const topPlain = `╭${'─'.repeat(w - 2)}╮`;
    this.text(x, y, color + topPlain + '\x1b[0m', w);
    if (opts?.title) {
      const t = truncate(opts.title, Math.max(1, w - 6));
      const label = ` ${t} `;
      this.text(
        x + 2,
        y,
        opts.focus
          ? ansi.accent(ansi.bold(label))
          : ansi.dim(label),
        w - 4,
      );
    }
    for (let i = 1; i < h - 1; i++) {
      this.text(x, y + i, color + '│' + '\x1b[0m', 1);
      this.text(x + 1, y + i, ' '.repeat(w - 2), w - 2);
      this.text(x + w - 1, y + i, color + '│' + '\x1b[0m', 1);
    }
    this.text(x, y + h - 1, color + `╰${'─'.repeat(w - 2)}╯` + '\x1b[0m', w);
    void edge;
  }

  fill(x: number, y: number, w: number, h: number): void {
    for (let i = 0; i < h; i++) {
      if (y + i < 0 || y + i >= this.rows) continue;
      this.text(x, y + i, ' '.repeat(Math.max(0, w)), w);
    }
  }

  flush(): void {
    // Full clear each frame — prevents leftover glyphs when layout shifts
    const parts: string[] = ['\x1b[H\x1b[J'];
    for (let y = 0; y < this.rows; y++) {
      let cur = '';
      let line = '';
      for (let x = 0; x < this.cols; x++) {
        const cell = this.cells[y]![x]!;
        if (cell.style !== cur) {
          line += '\x1b[0m' + cell.style;
          cur = cell.style;
        }
        line += cell.ch;
      }
      if (cur) line += '\x1b[0m';
      parts.push(line);
      if (y < this.rows - 1) parts.push('\r\n');
    }
    process.stdout.write(parts.join(''));
  }
}
