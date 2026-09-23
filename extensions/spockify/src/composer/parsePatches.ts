import type { FilePatch } from './types';

export interface ParsedFencePatch {
  path: string;
  /** Fence body (may be a snippet or full file). */
  content: string;
  /** 1-based inclusive line range when known (cite or ```start:end:path). */
  startLine?: number;
  endLine?: number;
}

const FENCE_RE = /```([^\n`]+)\n([\s\S]*?)```/g;

const LANG_ONLY =
  /^(bash|sh|shell|zsh|fish|powershell|pwsh|console|terminal|cmd|bat|json|yaml|yml|diff|text|typescript|tsx|javascript|jsx|python|go|rust|java|c|cpp|csharp|ruby|php|swift|kotlin|html|css|scss|sql|toml|xml|markdown|md|plaintext|ts|js|py|rs)$/i;

/**
 * Parse Cursor-style / path-tagged fence info into path + optional line range.
 * Handles: path/file.ts | lang path/file.ts | start:end:path | path:line
 */
export function parseFenceInfo(raw: string): {
  path?: string;
  startLine?: number;
  endLine?: number;
} {
  const info = raw.trim();
  if (!info || LANG_ONLY.test(info)) return {};

  // Cursor start:end:path (path may include dots)
  const cursor = /^(\d+):(\d+):(.+)$/.exec(info);
  if (cursor) {
    const pathPart = cursor[3].trim();
    if (looksLikePath(pathPart)) {
      const a = Number(cursor[1]);
      const b = Number(cursor[2]);
      return {
        path: normalizePath(pathPart),
        startLine: Math.min(a, b),
        endLine: Math.max(a, b),
      };
    }
  }

  // lang + path tokens: ```typescript src/foo.ts
  const parts = info.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const ref = parsePathRef(parts[i]);
      if (ref?.path) return ref;
    }
  }

  const single = parsePathRef(info);
  if (single?.path) return single;

  // Legacy: strip leading "lang:" if remainder is a path
  if (info.includes(':')) {
    const after = info.split(':').slice(1).join(':').trim();
    if (looksLikePath(after) && !/^\d+/.test(after)) {
      return { path: normalizePath(after) };
    }
  }

  return {};
}

function parsePathRef(token: string): {
  path?: string;
  startLine?: number;
  endLine?: number;
} | undefined {
  const t = token.trim();
  if (!t) return undefined;

  const cursor = /^(\d+):(\d+):(.+)$/.exec(t);
  if (cursor && looksLikePath(cursor[3])) {
    const a = Number(cursor[1]);
    const b = Number(cursor[2]);
    return {
      path: normalizePath(cursor[3]),
      startLine: Math.min(a, b),
      endLine: Math.max(a, b),
    };
  }

  const range = /^(.+?):(\d+)-(\d+)$/.exec(t);
  if (range && looksLikePath(range[1])) {
    return {
      path: normalizePath(range[1]),
      startLine: Number(range[2]),
      endLine: Number(range[3]),
    };
  }

  const withLine = /^(.+?):(\d+)$/.exec(t);
  if (withLine && looksLikePath(withLine[1]) && !/^\d+$/.test(withLine[1])) {
    return {
      path: normalizePath(withLine[1]),
      startLine: Number(withLine[2]),
      endLine: Number(withLine[2]),
    };
  }

  if (looksLikePath(t)) return { path: normalizePath(t) };
  return undefined;
}

function looksLikePath(p: string): boolean {
  if (!p || LANG_ONLY.test(p)) return false;
  if (p.includes('/') || p.includes('\\')) return true;
  return /\.\w{1,16}$/.test(p);
}

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/^\/+/, '');
}

/**
 * Parse assistant output for file patches from path-tagged fences and
 * path cites immediately before language fences.
 */
export function parseChatFencePatches(text: string): ParsedFencePatch[] {
  const patches: ParsedFencePatch[] = [];
  const re = new RegExp(FENCE_RE.source, FENCE_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const info = m[1].trim();
    const content = m[2].replace(/\n$/, '');
    if (!content.trim()) continue;
    if (/^(tool|tool_call|toolcall)\b/i.test(info)) continue;
    // Unified diffs are staged via materializeUnifiedDiffPatches — never treat
    // ```diff bodies (or path-cite + ```diff) as full-file nextContent.
    if (/^diff\b/i.test(info)) continue;

    const fromInfo = parseFenceInfo(info);
    if (fromInfo.path) {
      patches.push({
        path: fromInfo.path,
        content,
        startLine: fromInfo.startLine,
        endLine: fromInfo.endLine,
      });
      continue;
    }

    // Language-only fence: try cite in prose immediately before
    const before = text.slice(0, m.index);
    const cite = extractCiteBeforeFence(before);
    if (cite?.path) {
      patches.push({
        path: cite.path,
        content,
        startLine: cite.startLine,
        endLine: cite.endLine,
      });
    }
  }
  return dedupePatches(patches);
}

/**
 * Parse assistant output for path-tagged / cited fences.
 * Back-compat for composer collectPatches (body as content; chat materializes ranges).
 */
export function parseFilePatches(text: string): FilePatch[] {
  return parseChatFencePatches(text).map((p) => ({
    path: p.path,
    content: p.content,
  }));
}

/** Pull path + optional lines from prose just before a fence. */
export function extractCiteBeforeFence(before: string): {
  path: string;
  startLine?: number;
  endLine?: number;
} | undefined {
  const trimmed = before.replace(/\s+$/, '');
  if (!trimmed) return undefined;
  const tail = trimmed.slice(Math.max(0, trimmed.length - 500));

  const cursorAtEnd =
    /`?(\d+:\d+:(?:\.\/)?(?:[\w.@-]+\/)*[\w.@-]+\.\w+)`?\s*[:.]?\s*$/.exec(tail);
  if (cursorAtEnd) {
    const ref = parsePathRef(cursorAtEnd[1]);
    if (ref?.path) {
      return {
        path: ref.path,
        startLine: ref.startLine,
        endLine: ref.endLine,
      };
    }
  }

  const bt =
    /`((?:\.\/)?(?:[\w.@-]+\/)*[\w.@-]+\.\w+(?::\d+(?:-\d+)?)?)`(?:[^`\n]*(?:\blines?\s+(\d+)\s*[-–—]\s*(\d+)|\bline\s+(\d+)))?[^\n]*$/i.exec(
      tail,
    );
  if (bt) {
    const ref = parsePathRef(bt[1]);
    if (ref?.path) {
      if (bt[2]) {
        return {
          path: ref.path,
          startLine: Number(bt[2]),
          endLine: bt[3] ? Number(bt[3]) : Number(bt[2]),
        };
      }
      if (bt[4]) {
        return {
          path: ref.path,
          startLine: Number(bt[4]),
          endLine: Number(bt[4]),
        };
      }
      return {
        path: ref.path,
        startLine: ref.startLine,
        endLine: ref.endLine,
      };
    }
  }

  // Bare path:line at end of line
  const bare =
    /(?:^|\s)((?:\.\/)?(?:[\w.@-]+\/)+[\w.@-]+\.\w+(?::\d+(?:-\d+)?)?)\s*[:.]?\s*$/.exec(
      tail,
    );
  if (bare) {
    const ref = parsePathRef(bare[1]);
    if (ref?.path) {
      return {
        path: ref.path,
        startLine: ref.startLine,
        endLine: ref.endLine,
      };
    }
  }

  return undefined;
}

function dedupePatches(patches: ParsedFencePatch[]): ParsedFencePatch[] {
  const map = new Map<string, ParsedFencePatch>();
  for (const p of patches) {
    const key = `${p.path}#${p.startLine ?? ''}-${p.endLine ?? ''}`;
    map.set(key, p);
  }
  // Prefer last full-file (no range) per path over snippets when both exist
  const byPath = new Map<string, ParsedFencePatch>();
  for (const p of map.values()) {
    const prev = byPath.get(p.path);
    if (!prev) {
      byPath.set(p.path, p);
      continue;
    }
    if (prev.startLine != null && p.startLine == null) {
      byPath.set(p.path, p);
    } else if (prev.startLine == null && p.startLine != null) {
      // keep full file
    } else {
      byPath.set(p.path, p);
    }
  }
  return [...byPath.values()];
}

/** Soft cap for cite ranges that would otherwise wipe mid-file → EOF. */
const MAX_LINE_RANGE_SPAN = 20;

/** Splice snippet into full file text (1-based inclusive lines). */
export function spliceLineRange(
  current: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string {
  const lines = current.split('\n');
  const start = Math.max(0, startLine - 1);
  let end = Math.min(lines.length, Math.max(startLine, endLine));
  const repl = replacement.replace(/\n$/, '').split('\n');
  const span = end - start;
  const rangeOversize = span > repl.length + 2;
  // Oversized cite (9:999:path / mid→EOF) with a small wrap body → surgical splice.
  if (rangeOversize && repl.length > 0 && repl.length <= MAX_LINE_RANGE_SPAN) {
    // Reflow/wrap of one statement: replace a single original line.
    if (repl.length >= 2 && (span > MAX_LINE_RANGE_SPAN || end >= lines.length)) {
      end = start + 1;
    } else if (span > MAX_LINE_RANGE_SPAN) {
      end = Math.min(
        lines.length,
        start + Math.max(1, Math.min(span, Math.max(repl.length, 1))),
      );
    }
  }
  return [...lines.slice(0, start), ...repl, ...lines.slice(end)].join('\n');
}
