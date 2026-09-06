/**
 * Fast local Tab-complete heuristics (no network).
 * Covers sequential numbers, missing commas, bracket closers, common stubs.
 */

export interface LocalHeuristicResult {
  insert: string;
  reason: string;
}

const LANG_FENCE_SKIP = new Set([
  'bash',
  'sh',
  'shell',
  'zsh',
  'fish',
  'powershell',
  'pwsh',
  'console',
  'terminal',
  'cmd',
  'bat',
  'diff',
  'text',
]);

/**
 * Suggest an immediate local completion, or undefined to fall through to LLM.
 */
export function suggestLocalCompletion(
  full: string,
  offset: number,
  languageId: string,
): LocalHeuristicResult | undefined {
  const lineStart = full.lastIndexOf('\n', offset - 1) + 1;
  const lineEndIdx = full.indexOf('\n', offset);
  const lineEnd = lineEndIdx < 0 ? full.length : lineEndIdx;
  const line = full.slice(lineStart, lineEnd);
  const col = offset - lineStart;
  const before = line.slice(0, col);
  const after = line.slice(col);
  const lang = languageId.toLowerCase();

  const missingComma = suggestMissingComma(before, after, full, offset);
  if (missingComma) return missingComma;

  const seq = suggestSequentialNumber(before, after, full, lineStart);
  if (seq) return seq;

  const stub = suggestLanguageStub(before, after, lang);
  if (stub) return stub;

  const closer = suggestBracketCloser(before, after);
  if (closer) return closer;

  return undefined;
}

/** After `key: 8105` with no comma, when next line looks like another key. */
function suggestMissingComma(
  before: string,
  after: string,
  full: string,
  offset: number,
): LocalHeuristicResult | undefined {
  if (after.trim().length > 0) return undefined;
  // Ends with a JSON/JS value (number, string, true/false/null, ident) and no trailing comma
  if (
    !/(?:,|\(|\[|\{)\s*$/.test(before) &&
    /:\s*(?:-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'|true|false|null|[A-Za-z_][\w.]*)\s*$/.test(
      before,
    )
  ) {
    if (/,\s*$/.test(before)) return undefined;
    const rest = full.slice(offset);
    const nextNonEmpty = /^\s*\n(\s*)(\S[^\n]*)/.exec(rest);
    if (!nextNonEmpty) return undefined;
    const next = nextNonEmpty[2].trim();
    // Next line is another object entry or closing brace
    if (
      /^[A-Za-z_$'"][\w$.'"-]*\s*:/.test(next) ||
      /^["'][^"']+["']\s*:/.test(next) ||
      /^[}\]]/.test(next)
    ) {
      // Prefer comma before newline when next is another key; skip if closing only
      if (/^[}\]]/.test(next)) return undefined;
      return { insert: ',', reason: 'missing-comma' };
    }
  }
  return undefined;
}

/**
 * Continue numeric sequences in object literals:
 *   foo: 8100, bar: 8101, … overwater: |  → 8108
 * Also after `key: ` with empty value.
 */
function suggestSequentialNumber(
  before: string,
  after: string,
  full: string,
  lineStart: number,
): LocalHeuristicResult | undefined {
  if (after.trim().length > 0) return undefined;

  // Cursor after `key:` or `key: ` with no value yet
  const keyAwaiting = /^(\s*)([A-Za-z_$][\w$]*|["'][^"']+["'])\s*:\s*$/.exec(
    before,
  );
  if (!keyAwaiting) {
    return undefined;
  }

  const block = nearestObjectBlock(full, lineStart);
  if (!block) return undefined;
  const nums = [...block.matchAll(/:\s*(-?\d+)\s*,?\s*(?:\/\/[^\n]*)?$/gm)].map(
    (m) => Number(m[1]),
  );
  if (nums.length < 2) {
    if (nums.length === 1) {
      return { insert: String(nums[0] + 1), reason: 'seq-number-inc' };
    }
    return undefined;
  }

  // Prefer arithmetic step from last two; else +1 from max if dense ascending
  const last = nums[nums.length - 1];
  const prev = nums[nums.length - 2];
  const step = last - prev;
  if (step !== 0 && Number.isFinite(step)) {
    const next = last + step;
    // Sanity: same sign magnitude as peers
    if (Math.abs(next) < 1e15) {
      return { insert: String(next), reason: 'seq-number-step' };
    }
  }

  const sorted = [...nums].sort((a, b) => a - b);
  let denseStep = 1;
  if (sorted.length >= 2) {
    const gaps = new Map<number, number>();
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i] - sorted[i - 1];
      if (g > 0) gaps.set(g, (gaps.get(g) || 0) + 1);
    }
    let best = 1;
    let bestN = 0;
    for (const [g, n] of gaps) {
      if (n > bestN) {
        best = g;
        bestN = n;
      }
    }
    denseStep = best;
  }
  const max = Math.max(...nums);
  return { insert: String(max + denseStep), reason: 'seq-number-max' };
}

/** Close simple unbalanced brackets/quotes on the current line. */
function suggestBracketCloser(
  before: string,
  after: string,
): LocalHeuristicResult | undefined {
  if (after.trim().length > 0) return undefined;
  const closers = unbalancedClosers(before);
  if (!closers || closers.length > 4) return undefined;
  return { insert: closers, reason: 'close-bracket' };
}

function unbalancedClosers(stripped: string): string {
  const pairs: Record<string, string> = {
    '(': ')',
    '[': ']',
    '{': '}',
    '"': '"',
    "'": "'",
    '`': '`',
  };
  const stack: string[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '\\' && i + 1 < stripped.length) {
      i++;
      continue;
    }
    if (stack.length && (stack[stack.length - 1] === '"' || stack[stack.length - 1] === "'" || stack[stack.length - 1] === '`')) {
      if (ch === stack[stack.length - 1]) stack.pop();
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      stack.push(ch);
    } else if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack[stack.length - 1];
      if (top && pairs[top] === ch) stack.pop();
    }
  }
  if (!stack.length) return '';
  return stack
    .slice()
    .reverse()
    .map((c) => pairs[c])
    .join('');
}

  /** Small language stubs that should never wait on the network. */
function suggestLanguageStub(
  before: string,
  after: string,
  lang: string,
): LocalHeuristicResult | undefined {
  if (after.trim().length > 0) return undefined;
  const end = before;

  if (lang === 'python' || lang === 'py' || lang === 'python3') {
    if (/def\s*$/.test(end)) {
      return { insert: 'name():\n    pass', reason: 'py-def' };
    }
    if (/\bprint\s*\(\s*$/.test(end)) {
      return { insert: ')', reason: 'py-print' };
    }
  }

  if (
    lang === 'typescript' ||
    lang === 'javascript' ||
    lang === 'typescriptreact' ||
    lang === 'javascriptreact' ||
    lang === 'ts' ||
    lang === 'js' ||
    lang === 'tsx' ||
    lang === 'jsx'
  ) {
    if (/console\.log\(\s*$/.test(end)) {
      return { insert: ')', reason: 'js-log' };
    }
  }

  return undefined;
}

/** Slice text of the nearest enclosing `{ ... }` around offset. */
function nearestObjectBlock(full: string, offset: number): string | undefined {
  let depth = 0;
  let start = -1;
  for (let i = offset; i >= 0; i--) {
    const ch = full[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return undefined;
  depth = 0;
  for (let i = start; i < full.length; i++) {
    const ch = full[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return full.slice(start, i + 1);
    }
  }
  // Unclosed object — use from `{` to cursor
  return full.slice(start, offset);
}

/** True when fence info is a bare language tag (not a path). */
export function isBareLanguageFence(info: string): boolean {
  const t = info.trim().toLowerCase();
  if (!t) return true;
  if (LANG_FENCE_SKIP.has(t)) return true;
  if (/^[a-z0-9+#._-]+$/i.test(t) && !t.includes('/') && !/\.\w{1,12}$/.test(t)) {
    // language ids like typescript, python, jsonc
    return !/^\d+:\d+:/.test(info.trim());
  }
  return false;
}
