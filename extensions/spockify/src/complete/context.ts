/**
 * Context window selection heuristics for Ghost Tab complete.
 */

export interface CompleteContext {
  prefix: string;
  suffix: string;
  code: string;
  /**
   * Extra hints when the FIM window misses file head: imports / package block,
   * plus optional open-tab names. Kept small — not a repo dump.
   */
  context: string;
  multilinePreferred: boolean;
  /** Hint for adaptive debounce (ms adjustment). */
  debounceHint: 'fast' | 'normal' | 'slow';
}

const SINGLE_LINE_LANGS = new Set([
  'json',
  'jsonc',
  'csv',
  'properties',
  'ini',
]);

/** Prefer multi-line completions for these. */
const MULTILINE_LANGS = new Set([
  'typescript',
  'typescriptreact',
  'javascript',
  'javascriptreact',
  'python',
  'go',
  'rust',
  'java',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'swift',
  'kotlin',
]);

/** Match router GHOST_COMPLETE_* defaults (ghost_writer). */
export const COMPLETE_PREFIX_BUDGET = 4000;
export const COMPLETE_SUFFIX_BUDGET = 1200;
export const COMPLETE_CONTEXT_BUDGET = 1200;
const CODE_BUDGET = 6_000;
const FILE_HEAD_BUDGET = 900;

/**
 * Build FIM-ish prefix/suffix windows. Larger prefix for structured langs.
 * When the cursor is deep in a large file, attach a small file-head CONTEXT
 * (imports) so the model still sees symbols that fell outside the prefix window.
 */
export function buildCompleteContext(
  full: string,
  offset: number,
  languageId: string,
  opts?: { openTabs?: string[] },
): CompleteContext {
  const prefixBudget = MULTILINE_LANGS.has(languageId)
    ? COMPLETE_PREFIX_BUDGET
    : Math.min(COMPLETE_PREFIX_BUDGET, 2800);
  const suffixBudget = MULTILINE_LANGS.has(languageId)
    ? COMPLETE_SUFFIX_BUDGET
    : Math.min(COMPLETE_SUFFIX_BUDGET, 800);

  const prefix = full.slice(Math.max(0, offset - prefixBudget), offset);
  const suffix = full.slice(offset, offset + suffixBudget);
  const code = full.slice(0, CODE_BUDGET);

  const parts: string[] = [];
  const head = extractFileHead(full, offset, prefixBudget, FILE_HEAD_BUDGET);
  if (head) {
    parts.push(`FILE_HEAD:\n${head}`);
  }
  const tabs = (opts?.openTabs || [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (tabs.length) {
    parts.push(`OPEN_TABS: ${tabs.join(', ')}`);
  }
  let context = parts.join('\n\n');
  if (context.length > COMPLETE_CONTEXT_BUDGET) {
    context = context.slice(0, COMPLETE_CONTEXT_BUDGET);
  }

  const multilinePreferred = preferMultiline(prefix, languageId);
  const debounceHint = computeDebounceHint(prefix, languageId);

  return { prefix, suffix, code, context, multilinePreferred, debounceHint };
}

/**
 * When prefix does not include the start of the file, return a short head
 * (imports / package / use) so FIM still sees dependency names.
 */
export function extractFileHead(
  full: string,
  offset: number,
  prefixBudget: number,
  headBudget: number,
): string {
  if (offset <= prefixBudget) {
    return '';
  }
  const head = full.slice(0, Math.min(headBudget * 2, offset - prefixBudget));
  const lines = head.split('\n');
  const kept: string[] = [];
  let chars = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      if (kept.length) break;
      continue;
    }
    const isHeader =
      /^(import|from|package|use |using |#include|require\(|export |module )/i.test(
        trimmed,
      ) ||
      /^\/[/*]/.test(trimmed) ||
      /^#\s*(?!region)/.test(trimmed) ||
      /^"""/.test(trimmed) ||
      /^'''/.test(trimmed);
    // Stop at first non-header once we have some imports
    if (!isHeader && kept.length >= 3) {
      break;
    }
    if (!isHeader && kept.length === 0 && i > 12) {
      break;
    }
    kept.push(line);
    chars += line.length + 1;
    if (chars >= headBudget) {
      break;
    }
  }
  return kept.join('\n').trim();
}

/** True when cursor looks like a block / statement start. */
export function preferMultiline(prefix: string, languageId: string): boolean {
  if (SINGLE_LINE_LANGS.has(languageId)) {
    return false;
  }
  if (!MULTILINE_LANGS.has(languageId)) {
    return false;
  }
  const tail = prefix.slice(-80);
  // After `{`, `:`, `=>`, or blank line → multi-line body likely
  if (/[{:]\s*$/.test(tail) || /=>\s*$/.test(tail) || /\n\s*$/.test(tail)) {
    return true;
  }
  // Inside unbalanced braces / parens → prefer multi-line fill
  const open = (tail.match(/[{[(]/g) || []).length;
  const close = (tail.match(/[}\])]/g) || []).length;
  if (open > close) {
    return true;
  }
  // Default for structured langs
  return true;
}

/**
 * Adaptive debounce: fast after punctuation/newline, slow while typing an identifier.
 */
export function computeDebounceHint(
  prefix: string,
  _languageId: string,
): 'fast' | 'normal' | 'slow' {
  const tail = prefix.slice(-24);
  if (!tail.trim()) {
    return 'fast';
  }
  // Just typed newline, `;`, `{`, `}`, `)`, `]`, `,`, `:` → fire sooner
  if (/[\n;{}\])\],:]\s*$/.test(tail) || /=>\s*$/.test(tail)) {
    return 'fast';
  }
  // Mid-identifier (ends with alnum/_/$ and no trailing space) → wait longer
  if (/[A-Za-z0-9_$]$/.test(tail)) {
    return 'slow';
  }
  return 'normal';
}

/** Resolve debounce ms from base + hint. Floor ~20ms for snappy Tab. */
export function resolveDebounceMs(
  baseMs: number,
  hint: 'fast' | 'normal' | 'slow',
  adaptive: boolean,
): number {
  const base = Math.max(0, baseMs);
  if (!adaptive) {
    return Math.max(20, base || 20);
  }
  if (hint === 'fast') {
    return Math.max(20, Math.round((base || 30) * 0.5));
  }
  if (hint === 'slow') {
    // Cap mid-identifier wait — keep reactive (~80ms), not 150+.
    return Math.min(80, Math.round((base || 30) * 1.6));
  }
  return Math.max(20, base || 30);
}

/**
 * Skip noisy triggers: mid-identifier typing, empty docs, comment-only noise.
 */
export function shouldSkipCompletion(
  documentText: string,
  offset: number,
  languageId: string,
): boolean {
  if (!documentText.trim()) {
    return true;
  }
  const before = documentText.slice(Math.max(0, offset - 1), offset);
  const after = documentText.slice(offset, offset + 1);
  // Mid-word: alphanumeric on both sides of cursor
  if (/[A-Za-z0-9_$]/.test(before) && /[A-Za-z0-9_$]/.test(after)) {
    return true;
  }
  // Extremely short prefix for non-markup langs
  const lineStart = documentText.lastIndexOf('\n', offset - 1) + 1;
  const linePrefix = documentText.slice(lineStart, offset).trim();
  if (
    linePrefix.length === 0 &&
    offset < 2 &&
    !['markdown', 'plaintext', 'html'].includes(languageId)
  ) {
    return true;
  }
  return false;
}

/**
 * Cap multi-line ghost text; prefer balanced brace/paren endings when truncating.
 */
export function normalizeInsertText(
  raw: string,
  multilinePreferred: boolean,
  maxLines: number,
): string {
  let insert = raw.replace(/^\r?\n/, '').replace(/\r\n/g, '\n');
  if (!insert.trim()) {
    return '';
  }
  // Strip markdown fences if model wraps them
  const fence = /^```[\w.-]*\n([\s\S]*?)```\s*$/.exec(insert.trim());
  if (fence) {
    insert = fence[1].replace(/\n$/, '');
  }

  const lines = insert.split('\n');
  if (!multilinePreferred) {
    const first = lines.find((l) => l.length > 0) ?? '';
    return first;
  }
  if (lines.length > maxLines) {
    insert = trimToBalanced(lines.slice(0, maxLines).join('\n'));
  } else {
    insert = trimToBalanced(insert);
  }
  // Drop trailing incomplete line that is only whitespace-ish mid-token noise
  return insert.replace(/\n[ \t]*$/, (m) => (insert.includes('\n') ? m : ''));
}

/** Trim trailing incomplete block when clearly unbalanced. */
export function trimToBalanced(text: string): string {
  const openCurl = (text.match(/{/g) || []).length;
  const closeCurl = (text.match(/}/g) || []).length;
  if (openCurl <= closeCurl) {
    return text;
  }
  // Walk back to last line that closes a brace or ends a statement
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 1; i--) {
    const slice = lines.slice(0, i).join('\n');
    const o = (slice.match(/{/g) || []).length;
    const c = (slice.match(/}/g) || []).length;
    if (o <= c || /[;}]\s*$/.test(lines[i - 1])) {
      return slice;
    }
  }
  return text;
}

/** Cheap cache key — prefix tail + language + line + doc version. */
export function cacheKey(
  languageId: string,
  line: number,
  prefixTail: string,
  version = 0,
): string {
  return `${languageId}:${line}:v${version}:${prefixTail}`;
}
