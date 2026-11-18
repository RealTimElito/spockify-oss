/**
 * Pure composer buffer: grapheme-safe caret, wrap layout, word ops, history.
 * Used by the boxed REPL prompt (inputRaw + paintBoxedPrompt).
 */

export const MAX_INPUT_ROWS = 8;

/** Grapheme clusters when Intl.Segmenter exists; else UTF-16 code points. */
export function segmentGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(seg.segment(text), (p) => p.segment);
  }
  return [...text];
}

/** Terminal display columns for one grapheme (CJK/emoji ≈ 2). */
export function graphemeWidth(g: string): number {
  if (!g || g === '\n' || g === '\t') return g === '\t' ? 2 : 0;
  let w = 0;
  for (const ch of g) {
    const cp = ch.codePointAt(0)!;
    w = Math.max(w, codePointWidth(cp));
  }
  return w || 1;
}

function codePointWidth(cp: number): number {
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return 0;
  if (cp >= 0x300 && cp <= 0x36f) return 0; // combining
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x1f000 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

export function displayWidth(graphemes: string[]): number {
  let w = 0;
  for (const g of graphemes) w += graphemeWidth(g);
  return w;
}

export interface VisualRow {
  /** Inclusive start index into grapheme array. */
  start: number;
  /** Exclusive end index. */
  end: number;
}

export interface WrapLayout {
  rows: VisualRow[];
  /** Row index of caret (0-based); length if caret at end after last row. */
  caretRow: number;
  /** Display column of caret within its row (0 = first content col). */
  caretCol: number;
  scrollTop: number;
  visibleRows: VisualRow[];
}

/**
 * Soft-wrap graphemes to `width` columns. Hard `\n` always breaks.
 * Caps visible window to maxRows, scrolling so the caret stays in view.
 */
export function layoutWrap(
  graphemes: string[],
  caret: number,
  width: number,
  maxRows = MAX_INPUT_ROWS,
  scrollTop = 0,
): WrapLayout {
  const w = Math.max(1, width);
  const rows: VisualRow[] = [];
  let i = 0;
  while (i < graphemes.length) {
    const start = i;
    if (graphemes[i] === '\n') {
      rows.push({ start, end: i + 1 });
      i += 1;
      continue;
    }
    let col = 0;
    while (i < graphemes.length && graphemes[i] !== '\n') {
      const gw = graphemeWidth(graphemes[i]!);
      if (col > 0 && col + gw > w) break;
      col += gw;
      i += 1;
      if (col >= w) break;
    }
    if (i === start) {
      // Pathological: single wide glyph wider than w — still advance.
      i += 1;
    }
    rows.push({ start, end: i });
  }
  if (rows.length === 0) {
    rows.push({ start: 0, end: 0 });
  } else {
    const last = rows[rows.length - 1]!;
    // Empty line after trailing newline
    if (
      graphemes.length > 0 &&
      graphemes[graphemes.length - 1] === '\n' &&
      last.end === graphemes.length
    ) {
      rows.push({ start: graphemes.length, end: graphemes.length });
    }
  }

  let caretRow = rows.length - 1;
  let caretCol = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    if (caret >= row.start && caret <= row.end) {
      // Caret on a row that ends with \n: end index is after \n; treat
      // caret === end as start of next row when that exists.
      if (caret === row.end && r + 1 < rows.length && caret < graphemes.length) {
        continue;
      }
      caretRow = r;
      caretCol = displayWidth(graphemes.slice(row.start, caret));
      // If row includes trailing \n and caret is on it, col stays at pre-newline.
      if (
        caret > row.start &&
        graphemes[caret - 1] === '\n' &&
        caret === row.end
      ) {
        caretCol = displayWidth(graphemes.slice(row.start, caret - 1));
      }
      break;
    }
  }
  if (caret >= graphemes.length) {
    caretRow = rows.length - 1;
    const row = rows[caretRow]!;
    const end = row.end;
    const sliceEnd =
      end > row.start && graphemes[end - 1] === '\n' ? end - 1 : end;
    caretCol = displayWidth(graphemes.slice(row.start, sliceEnd));
  }

  let st = Math.max(0, scrollTop);
  if (caretRow < st) st = caretRow;
  if (caretRow >= st + maxRows) st = caretRow - maxRows + 1;
  const maxSt = Math.max(0, rows.length - maxRows);
  if (st > maxSt) st = maxSt;

  return {
    rows,
    caretRow,
    caretCol,
    scrollTop: st,
    visibleRows: rows.slice(st, st + maxRows),
  };
}

export interface ComposerState {
  graphemes: string[];
  caret: number;
  history: string[];
  /** Index into history while browsing; `history.length` = editing live draft. */
  histIdx: number;
  stash: string;
  scrollTop: number;
}

export function createComposer(history: string[] = []): ComposerState {
  return {
    graphemes: [],
    caret: 0,
    history: history.slice(),
    histIdx: history.length,
    stash: '',
    scrollTop: 0,
  };
}

export function composerText(state: ComposerState): string {
  return state.graphemes.join('');
}

export function setComposerText(
  state: ComposerState,
  text: string,
  caret?: number,
): void {
  state.graphemes = segmentGraphemes(text);
  state.caret =
    caret == null
      ? state.graphemes.length
      : Math.max(0, Math.min(caret, state.graphemes.length));
  state.scrollTop = 0;
}

function isWordChar(g: string): boolean {
  if (!g || g === '\n' || g === '\t' || g === ' ') return false;
  const c = g.codePointAt(0)!;
  if (c > 127) return true;
  return /[0-9A-Za-z_]/.test(g);
}

export function moveLeft(state: ComposerState): void {
  if (state.caret > 0) state.caret -= 1;
}

export function moveRight(state: ComposerState): void {
  if (state.caret < state.graphemes.length) state.caret += 1;
}

export function moveWordLeft(state: ComposerState): void {
  let i = state.caret;
  while (i > 0 && !isWordChar(state.graphemes[i - 1]!)) i -= 1;
  while (i > 0 && isWordChar(state.graphemes[i - 1]!)) i -= 1;
  state.caret = i;
}

export function moveWordRight(state: ComposerState): void {
  let i = state.caret;
  const n = state.graphemes.length;
  while (i < n && !isWordChar(state.graphemes[i]!)) i += 1;
  while (i < n && isWordChar(state.graphemes[i]!)) i += 1;
  state.caret = i;
}

export function deleteCharLeft(state: ComposerState): void {
  if (state.caret <= 0) return;
  state.graphemes.splice(state.caret - 1, 1);
  state.caret -= 1;
}

export function deleteCharRight(state: ComposerState): void {
  if (state.caret >= state.graphemes.length) return;
  state.graphemes.splice(state.caret, 1);
}

export function deleteWordLeft(state: ComposerState): void {
  const end = state.caret;
  moveWordLeft(state);
  const start = state.caret;
  state.graphemes.splice(start, end - start);
  state.caret = start;
}

export function deleteWordRight(state: ComposerState): void {
  const start = state.caret;
  moveWordRight(state);
  const end = state.caret;
  state.graphemes.splice(start, end - start);
  state.caret = start;
}

export function insertText(state: ComposerState, text: string): void {
  if (!text) return;
  const parts = segmentGraphemes(text.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  state.graphemes.splice(state.caret, 0, ...parts);
  state.caret += parts.length;
}

export function insertNewline(state: ComposerState): void {
  insertText(state, '\n');
}

/** Home/End within the current visual row. */
export function moveLineHome(
  state: ComposerState,
  width: number,
  maxRows = MAX_INPUT_ROWS,
): void {
  const lay = layoutWrap(
    state.graphemes,
    state.caret,
    width,
    maxRows,
    state.scrollTop,
  );
  state.caret = lay.rows[lay.caretRow]!.start;
  state.scrollTop = lay.scrollTop;
}

export function moveLineEnd(
  state: ComposerState,
  width: number,
  maxRows = MAX_INPUT_ROWS,
): void {
  const lay = layoutWrap(
    state.graphemes,
    state.caret,
    width,
    maxRows,
    state.scrollTop,
  );
  const row = lay.rows[lay.caretRow]!;
  let end = row.end;
  if (end > row.start && state.graphemes[end - 1] === '\n') end -= 1;
  state.caret = end;
  state.scrollTop = lay.scrollTop;
}

/**
 * Up: previous visual row, else previous history when at top.
 * Down: next visual row, else next history when at bottom.
 * Returns true if history changed the buffer.
 */
export function moveUp(
  state: ComposerState,
  width: number,
  maxRows = MAX_INPUT_ROWS,
): boolean {
  const lay = layoutWrap(
    state.graphemes,
    state.caret,
    width,
    maxRows,
    state.scrollTop,
  );
  if (lay.caretRow > 0) {
    goToRowCol(state, lay, lay.caretRow - 1, lay.caretCol, width, maxRows);
    return false;
  }
  return historyOlder(state);
}

export function moveDown(
  state: ComposerState,
  width: number,
  maxRows = MAX_INPUT_ROWS,
): boolean {
  const lay = layoutWrap(
    state.graphemes,
    state.caret,
    width,
    maxRows,
    state.scrollTop,
  );
  if (lay.caretRow < lay.rows.length - 1) {
    goToRowCol(state, lay, lay.caretRow + 1, lay.caretCol, width, maxRows);
    return false;
  }
  return historyNewer(state);
}

function goToRowCol(
  state: ComposerState,
  lay: WrapLayout,
  rowIdx: number,
  targetCol: number,
  width: number,
  maxRows: number,
): void {
  const row = lay.rows[rowIdx]!;
  let col = 0;
  let i = row.start;
  const limit =
    row.end > row.start && state.graphemes[row.end - 1] === '\n'
      ? row.end - 1
      : row.end;
  while (i < limit) {
    const gw = graphemeWidth(state.graphemes[i]!);
    if (col + gw > targetCol) break;
    col += gw;
    i += 1;
  }
  state.caret = i;
  const next = layoutWrap(state.graphemes, state.caret, width, maxRows, state.scrollTop);
  state.scrollTop = next.scrollTop;
}

function historyOlder(state: ComposerState): boolean {
  if (state.history.length === 0) return false;
  if (state.histIdx === state.history.length) {
    state.stash = composerText(state);
  }
  if (state.histIdx <= 0) return false;
  state.histIdx -= 1;
  setComposerText(state, state.history[state.histIdx]!);
  return true;
}

function historyNewer(state: ComposerState): boolean {
  if (state.histIdx >= state.history.length) return false;
  state.histIdx += 1;
  if (state.histIdx >= state.history.length) {
    setComposerText(state, state.stash);
  } else {
    setComposerText(state, state.history[state.histIdx]!);
  }
  return true;
}

/** Push a submitted line onto history (no empty / duplicate of last). */
export function pushHistory(history: string[], line: string): void {
  const t = line.replace(/\s+$/, '');
  if (!t) return;
  if (history.length && history[history.length - 1] === t) return;
  history.push(t);
}

export type ComposerKey =
  | { type: 'char'; ch: string }
  | { type: 'enter' }
  | { type: 'newline' }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'left' }
  | { type: 'right' }
  | { type: 'up' }
  | { type: 'down' }
  | { type: 'home' }
  | { type: 'end' }
  | { type: 'wordLeft' }
  | { type: 'wordRight' }
  | { type: 'deleteWordLeft' }
  | { type: 'deleteWordRight' }
  | { type: 'ctrlC' }
  | { type: 'ctrlD' }
  | { type: 'paste'; text: string }
  | { type: 'tab' };

/**
 * Apply an editing key. Does not handle ctrlC/ctrlD/enter (caller owns those).
 * `width` is content wrap width (after ❯ prefix).
 */
export function applyComposerKey(
  state: ComposerState,
  key: ComposerKey,
  width: number,
): void {
  switch (key.type) {
    case 'char':
      insertText(state, key.ch);
      break;
    case 'paste':
      insertText(state, key.text);
      break;
    case 'tab':
      insertText(state, '  ');
      break;
    case 'newline':
      insertNewline(state);
      break;
    case 'backspace':
      deleteCharLeft(state);
      break;
    case 'delete':
      deleteCharRight(state);
      break;
    case 'left':
      moveLeft(state);
      break;
    case 'right':
      moveRight(state);
      break;
    case 'home':
      moveLineHome(state, width);
      break;
    case 'end':
      moveLineEnd(state, width);
      break;
    case 'wordLeft':
      moveWordLeft(state);
      break;
    case 'wordRight':
      moveWordRight(state);
      break;
    case 'deleteWordLeft':
      deleteWordLeft(state);
      break;
    case 'deleteWordRight':
      deleteWordRight(state);
      break;
    case 'up':
      moveUp(state, width);
      break;
    case 'down':
      moveDown(state, width);
      break;
    default:
      break;
  }
  const lay = layoutWrap(
    state.graphemes,
    state.caret,
    width,
    MAX_INPUT_ROWS,
    state.scrollTop,
  );
  state.scrollTop = lay.scrollTop;
}

/** Incremental key parser for raw TTY bytes (keeps incomplete CSI in `pending`). */
export class KeyParser {
  pending = '';
  private pasteMode = false;
  private pasteBuf = '';

  push(chunk: string): ComposerKey[] {
    const out: ComposerKey[] = [];
    this.pending += chunk;
    while (this.pending.length > 0) {
      if (this.pasteMode) {
        const end = this.pending.indexOf('\x1b[201~');
        if (end < 0) {
          this.pasteBuf += this.pending;
          this.pending = '';
          break;
        }
        this.pasteBuf += this.pending.slice(0, end);
        this.pending = this.pending.slice(end + 6);
        this.pasteMode = false;
        if (this.pasteBuf) {
          out.push({ type: 'paste', text: this.pasteBuf });
          this.pasteBuf = '';
        }
        continue;
      }

      const ch0 = this.pending[0]!;
      const code = ch0.charCodeAt(0);

      if (ch0 === '\x1b') {
        const parsed = this.consumeEscape();
        if (parsed === 'need-more') break;
        if (parsed) out.push(parsed);
        continue;
      }

      this.pending = this.pending.slice(1);

      if (code === 3) {
        out.push({ type: 'ctrlC' });
        continue;
      }
      if (code === 4) {
        out.push({ type: 'ctrlD' });
        continue;
      }
      if (code === 23) {
        // Ctrl+W
        out.push({ type: 'deleteWordLeft' });
        continue;
      }
      if (code === 8) {
        // Ctrl+H / some terminals' Ctrl+Backspace
        out.push({ type: 'deleteWordLeft' });
        continue;
      }
      if (ch0 === '\x7f' || ch0 === '\b') {
        out.push({ type: 'backspace' });
        continue;
      }
      if (ch0 === '\r' || ch0 === '\n') {
        out.push({ type: 'enter' });
        continue;
      }
      if (ch0 === '\t') {
        out.push({ type: 'tab' });
        continue;
      }
      if (code >= 32) {
        // Collect a run of printable for fewer events (still char-safe via segment).
        let j = 0;
        const rest = ch0 + this.pending;
        while (j < rest.length) {
          const c = rest.charCodeAt(j);
          if (c < 32 || c === 0x7f || c === 0x1b) break;
          j += 1;
        }
        const text = rest.slice(0, j);
        this.pending = rest.slice(j);
        // First char already sliced from pending as ch0 — adjust:
        // we set pending = rest.slice(j) where rest = ch0+pending_old, OK.
        if (text.length === 1) out.push({ type: 'char', ch: text });
        else out.push({ type: 'paste', text });
        continue;
      }
    }
    return out;
  }

  private consumeEscape(): ComposerKey | null | 'need-more' {
    const s = this.pending;
    if (s.length < 2) return 'need-more';

    // Bracketed paste start
    if (s.startsWith('\x1b[200~')) {
      this.pending = s.slice(6);
      this.pasteMode = true;
      this.pasteBuf = '';
      return null;
    }

    // Alt+Backspace
    if (s[1] === '\x7f' || s[1] === '\b') {
      this.pending = s.slice(2);
      return { type: 'deleteWordLeft' };
    }

    // Esc+Enter → newline
    if (s[1] === '\r' || s[1] === '\n') {
      this.pending = s.slice(2);
      return { type: 'newline' };
    }

    // SS3: ESC O A/B/C/D/H/F
    if (s[1] === 'O') {
      if (s.length < 3) return 'need-more';
      const k = s[2]!;
      this.pending = s.slice(3);
      return mapArrowLetter(k);
    }

    // CSI
    if (s[1] === '[') {
      const m = /^\x1b\[([0-9;]*)(~|[A-Za-z])/.exec(s);
      if (!m) {
        // Incomplete CSI (digits/semicolons only so far)
        if (/^\x1b\[[0-9;]*$/.test(s)) return 'need-more';
        // Unknown — drop ESC
        this.pending = s.slice(1);
        return null;
      }
      this.pending = s.slice(m[0].length);
      const params = m[1] || '';
      const term = m[2]!;
      return mapCsi(params, term);
    }

    // Bare Esc — wait if alone; else drop and continue
    if (s.length === 1) return 'need-more';
    this.pending = s.slice(1);
    return null;
  }
}

function mapArrowLetter(k: string): ComposerKey | null {
  switch (k) {
    case 'A':
      return { type: 'up' };
    case 'B':
      return { type: 'down' };
    case 'C':
      return { type: 'right' };
    case 'D':
      return { type: 'left' };
    case 'H':
      return { type: 'home' };
    case 'F':
      return { type: 'end' };
    default:
      return null;
  }
}

function mapCsi(params: string, term: string): ComposerKey | null {
  const parts = params.split(';').filter((p) => p.length > 0);
  const n = parts[0] ? Number(parts[0]) : 1;
  const mod = parts.length >= 2 ? Number(parts[1]) : 0;
  const ctrl = mod === 5 || mod === 6; // ctrl / ctrl+shift

  if (term === '~') {
    // 3~ delete, 3;5~ ctrl+delete; 13;2~ shift+enter (xterm)
    if (n === 3) return ctrl ? { type: 'deleteWordRight' } : { type: 'delete' };
    if (n === 1 || n === 7) return { type: 'home' };
    if (n === 4 || n === 8) return { type: 'end' };
    if (n === 13 && mod === 2) return { type: 'newline' };
    return null;
  }

  if ('ABCDHF'.includes(term)) {
    if (ctrl && term === 'D') return { type: 'wordLeft' };
    if (ctrl && term === 'C') return { type: 'wordRight' };
    return mapArrowLetter(term);
  }

  // Shift+Enter on some terminals: ESC [ 27;2;13 ~
  // already handled via ~ form when full match

  return null;
}
