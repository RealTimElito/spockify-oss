/**
 * Deterministic local fixes for common diagnostics (no model round-trip).
 * Used by "Fix with agent" for simple cases like Flake8 E501.
 */

export type LocalFixDiag = {
  message: string;
  code?: string | number;
  source?: string;
  startLine: number; // 0-based
  endLine: number;
};

/** True for Flake8 / pycodestyle / ruff line-too-long diagnostics. */
export function isLineTooLongDiagnostic(diag: LocalFixDiag): boolean {
  const code = diag.code == null ? '' : String(diag.code).toUpperCase();
  if (code === 'E501' || code === 'LINE-TOO-LONG') return true;
  const msg = diag.message.toLowerCase();
  return (
    /line too long/.test(msg) ||
    /\be501\b/.test(msg) ||
    /exceeds maximum line length/.test(msg)
  );
}

/** Prefer limit from "line too long (88 > 79 characters)" else 79. */
export function maxLenFromDiagnostic(diag: LocalFixDiag): number {
  const m = diag.message.match(/>\s*(\d+)\s*(?:characters)?/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 40 && n <= 200) return n;
  }
  return 79;
}

/**
 * Wrap a single long source line (Python-friendly paren wrap).
 * Returns undefined when no safe rewrite is found.
 */
export function wrapLongLine(
  line: string,
  maxLen = 79,
): string | undefined {
  if (line.length <= maxLen) return undefined;
  if (!line.trim()) return undefined;

  const indentMatch = line.match(/^(\s*)/);
  const indent = indentMatch?.[1] ?? '';
  const body = line.slice(indent.length);
  const inner = `${indent}    `;

  // assignment / kwarg: name = <rhs>  →  name = (\n  <rhs>\n)
  const assign = body.match(/^([A-Za-z_][\w.]*\s*=\s*)(.+)$/);
  if (assign) {
    const lhs = assign[1];
    const rhs = assign[2];
    // Already parenthesized multi-line style — don't double-wrap
    if (/^\(/.test(rhs.trim()) && rhs.includes('\n')) return undefined;
    const wrapped = `${indent}${lhs}(\n${inner}${rhs}\n${indent})`;
    if (wrapped.split('\n').every((l) => l.length <= Math.max(maxLen, line.length))) {
      return wrapped;
    }
    // If RHS itself is a long string, break the string
    const brokenRhs = breakLongStringRhs(rhs, maxLen - inner.length);
    if (brokenRhs) {
      return `${indent}${lhs}(\n${inner}${brokenRhs}\n${indent})`;
    }
    return `${indent}${lhs}(\n${inner}${rhs}\n${indent})`;
  }

  // Call / list-ish: break after last comma before limit
  const breakAt = findBreakIndex(body, maxLen - indent.length);
  if (breakAt > 0) {
    const head = body.slice(0, breakAt).trimEnd();
    const tail = body.slice(breakAt).trimStart();
    if (head && tail) {
      return `${indent}${head}\n${inner}${tail}`;
    }
  }

  // Long quoted string alone / return "...."
  const strOnly = body.match(
    /^(return\s+|yield\s+|raise\s+)?((["'])(?:\\.|(?!\3).)*\3)\s*$/,
  );
  if (strOnly) {
    const prefix = strOnly[1] ?? '';
    const lit = strOnly[2];
    const broken = breakLongStringRhs(lit, maxLen - inner.length);
    if (broken) {
      return `${indent}${prefix}(\n${inner}${broken}\n${indent})`;
    }
  }

  return undefined;
}

function breakLongStringRhs(rhs: string, chunkMax: number): string | undefined {
  const m = rhs.match(/^(["'])([\s\S]*)\1(\s*)$/);
  if (!m) return undefined;
  const q = m[1];
  const inner = m[2];
  const trail = m[3] ?? '';
  if (inner.length < 20) return undefined;
  const limit = Math.max(24, chunkMax - 2);
  if (inner.length <= limit) return undefined;
  const parts: string[] = [];
  let i = 0;
  while (i < inner.length) {
    parts.push(`${q}${inner.slice(i, i + limit)}${q}`);
    i += limit;
  }
  // Implicit string concat inside outer parens (caller adds parens)
  return parts.join(`\n    `) + trail;
}

function findBreakIndex(body: string, softMax: number): number {
  const window = body.slice(0, Math.max(8, softMax));
  // Prefer comma, then space after operator-ish
  for (const re of [/,(\s)/g, /\s+(?=[+\-*/%|&^=<>!])/g, /\s+/g]) {
    let best = -1;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(window)) !== null) {
      const at = m.index + (m[0].startsWith(',') ? 1 : 0);
      if (at > 8) best = at + (m[0].startsWith(',') ? m[0].length - 1 : 0);
    }
    if (best > 0) return best;
  }
  return -1;
}

/**
 * Apply a local fix for the diagnostic line range.
 * Returns full-file next content, or undefined if unsupported.
 */
export function applyLocalDiagnosticFix(
  fileText: string,
  diag: LocalFixDiag,
): string | undefined {
  if (!isLineTooLongDiagnostic(diag)) return undefined;
  const lines = fileText.split('\n');
  const start = Math.max(0, diag.startLine);
  const end = Math.min(lines.length - 1, Math.max(start, diag.endLine));
  if (start !== end) {
    // Only single-line E501 for now
    if (end - start > 0) return undefined;
  }
  const line = lines[start];
  if (line == null) return undefined;
  const maxLen = maxLenFromDiagnostic(diag);
  const wrapped = wrapLongLine(line, maxLen);
  if (!wrapped) return undefined;
  const repl = wrapped.replace(/\n$/, '').split('\n');
  return [...lines.slice(0, start), ...repl, ...lines.slice(start + 1)].join(
    '\n',
  );
}
