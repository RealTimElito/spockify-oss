/**
 * Cursor-like collapsed summaries for long +/- runs in File changes UI.
 * Example: `+203 … subject=email_subject(payload) | +28 … 'notification_id'`
 *
 * Chat File changes / HTML diff panels only. Do NOT feed these rows into
 * inline editor decorations — that paints fake `+N …snippet` buffer lines.
 */

/** Collapse a consecutive add/remove run when over this many lines. */
export const COLLAPSE_MIN_LINES = 4;

/** Or when total chars in the run exceed this. */
export const COLLAPSE_MIN_CHARS = 120;

/** Max peek snippets joined with ` | ` inside one collapsed row. */
export const COLLAPSE_MAX_SNIPPETS = 3;

export type CollapsedDiffLine = {
  kind: 'raw' | 'collapsed';
  /** For raw: original unified-diff line. For collapsed: display text without prefix sig. */
  text: string;
  /** '+' | '-' for collapsed rows; undefined for raw. */
  sig?: '+' | '-';
  /** Original unified-diff lines this row replaces (for expand). */
  expanded?: string[];
};

function significantPeek(line: string): string {
  const body = line.replace(/^\s+/, '').replace(/\s+$/, '');
  if (!body) return '·';
  // Prefer identifier / string-ish tokens for the Cursor-style snippet.
  const ident = body.match(/[A-Za-z_][A-Za-z0-9_]{2,}/);
  const str = body.match(/['"`][^'"`]{3,}['"`]/g);
  let peek = ident?.[0] ?? body;
  if (str?.length) {
    const s = str[0].replace(/^['"`]|['"`]$/g, '');
    if (s.length >= 4) peek = s.length > 36 ? `${s.slice(0, 34)}…` : s;
  }
  if (peek.length > 40) peek = `${peek.slice(0, 38)}…`;
  return peek;
}

function chunkSnippets(
  bodies: string[],
  totalChars: number,
): Array<{ chars: number; peek: string }> {
  if (!bodies.length) return [];
  if (bodies.length === 1 || totalChars < COLLAPSE_MIN_CHARS * 2) {
    return [{ chars: totalChars, peek: significantPeek(bodies[0]!) }];
  }
  const n = Math.min(COLLAPSE_MAX_SNIPPETS, Math.max(2, Math.ceil(bodies.length / 8)));
  const size = Math.ceil(bodies.length / n);
  const out: Array<{ chars: number; peek: string }> = [];
  for (let i = 0; i < bodies.length && out.length < COLLAPSE_MAX_SNIPPETS; i += size) {
    const slice = bodies.slice(i, i + size);
    const chars = slice.reduce((a, b) => a + b.length + 1, 0);
    out.push({ chars, peek: significantPeek(slice[0]!) });
  }
  return out;
}

function shouldCollapse(bodies: string[]): boolean {
  if (bodies.length >= COLLAPSE_MIN_LINES) return true;
  const chars = bodies.reduce((a, b) => a + b.length + 1, 0);
  return chars >= COLLAPSE_MIN_CHARS && bodies.length >= 2;
}

function flushRun(
  out: CollapsedDiffLine[],
  sig: '+' | '-',
  rawLines: string[],
): void {
  if (!rawLines.length) return;
  const bodies = rawLines.map((l) => l.slice(1));
  if (!shouldCollapse(bodies)) {
    for (const line of rawLines) out.push({ kind: 'raw', text: line });
    return;
  }
  const totalChars = bodies.reduce((a, b) => a + b.length + 1, 0);
  const parts = chunkSnippets(bodies, totalChars);
  const summary = parts
    .map((p) => `${sig}${p.chars} … ${p.peek}`)
    .join(' | ');
  out.push({
    kind: 'collapsed',
    text: summary,
    sig,
    expanded: rawLines,
  });
}

/**
 * Walk unified-diff body lines and collapse long add/remove runs.
 * Headers (---/+++/@@/diff) stay raw.
 */
export function collapseUnifiedDiffLines(lines: string[]): CollapsedDiffLine[] {
  const out: CollapsedDiffLine[] = [];
  let runSig: '+' | '-' | undefined;
  let run: string[] = [];

  const endRun = (): void => {
    if (runSig && run.length) flushRun(out, runSig, run);
    runSig = undefined;
    run = [];
  };

  for (const line of lines) {
    const isHeader =
      line.startsWith('+++') ||
      line.startsWith('---') ||
      line.startsWith('diff ') ||
      line.startsWith('@@');
    const prefix = line[0];
    if (
      !isHeader &&
      (prefix === '+' || prefix === '-') &&
      !line.startsWith('+++') &&
      !line.startsWith('---')
    ) {
      const sig = prefix as '+' | '-';
      if (runSig && runSig !== sig) endRun();
      runSig = sig;
      run.push(line);
      continue;
    }
    endRun();
    out.push({ kind: 'raw', text: line });
  }
  endRun();
  return out;
}

/** HTML-friendly collapsed render tokens (no escaping). */
export function collapseUnifiedDiff(unified: string): CollapsedDiffLine[] {
  return collapseUnifiedDiffLines(String(unified || '').split('\n'));
}
