/**
 * Extract workspace file edits from assistant prose (unified diffs).
 * Pure helpers — materialization that needs FS lives in materializeChatPatches.
 */

import {
  parseBareUnifiedDiff,
  parseFencedFilePatches,
  mergePatchFiles,
} from '../apply/parse';
import {
  applyHunksToContent,
  parseHunksFromUnifiedDiff,
} from '../apply/hunks';
import type { ApplyPatchFile } from '../apply/types';

/** True when text looks like a unified / git diff worth staging. */
export function looksLikeUnifiedDiff(text: string): boolean {
  if (!text.trim()) return false;
  if (/^\s*diff --git\s+/m.test(text)) return true;
  // Require a/ or /dev/null path form — plain markdown `---` rules alone are not diffs.
  return (
    /^\s*---\s+(?:a\/|\/dev\/null)\b/m.test(text) &&
    /^\s*\+\+\+\s+(?:b\/|\/dev\/null)\b/m.test(text)
  );
}

/**
 * Parse ```diff fences + bare ---/+++ (or diff --git) blocks into ApplyPatchFile
 * entries that carry unifiedDiff (not full-file nextContent from path fences).
 */
export function parseAssistantUnifiedDiffFiles(text: string): ApplyPatchFile[] {
  if (!looksLikeUnifiedDiff(text)) return [];
  const fenced = parseFencedFilePatches(text).filter((f) =>
    Boolean(f.unifiedDiff?.trim()),
  );
  const bare = parseBareUnifiedDiff(text).filter((f) =>
    Boolean(f.unifiedDiff?.trim()),
  );
  return mergePatchFiles([fenced, bare]).filter((f) =>
    Boolean(f.unifiedDiff?.trim() && f.path && f.path !== 'unknown'),
  );
}

/** Apply a unified diff body to current file contents. */
export function applyUnifiedDiffBody(
  path: string,
  current: string,
  unifiedDiff: string,
): string {
  const hunks = parseHunksFromUnifiedDiff(path, unifiedDiff);
  if (!hunks.length) return current;
  return applyHunksToContent(current, hunks, undefined);
}

/** Tool names that already stage/apply file edits. */
export function isFileEditToolName(name: string | undefined): boolean {
  return name === 'apply_patch' || name === 'write_file';
}

export function messagesUsedFileEditTools(
  messages: ReadonlyArray<{
    role: string;
    name?: string;
    content?: unknown;
    toolCalls?: ReadonlyArray<{ name: string }>;
  }>,
  fromIndex = 0,
): boolean {
  for (let i = Math.max(0, fromIndex); i < messages.length; i++) {
    const m = messages[i];
    if (
      m.role === 'assistant' &&
      m.toolCalls?.some((t) => isFileEditToolName(t.name))
    ) {
      return true;
    }
    if (m.role === 'tool' && isFileEditToolName(m.name)) {
      return true;
    }
  }
  return false;
}

/**
 * True when an apply_patch/write_file tool result this turn looks successful
 * (staged or applied). Failed/refused tools return content starting with Error:.
 */
export function messagesFileEditToolsSucceeded(
  messages: ReadonlyArray<{
    role: string;
    name?: string;
    content?: unknown;
  }>,
  fromIndex = 0,
): boolean {
  for (let i = Math.max(0, fromIndex); i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'tool' || !isFileEditToolName(m.name)) continue;
    const c =
      typeof m.content === 'string'
        ? m.content
        : m.content == null
          ? ''
          : String(m.content);
    if (!c.trim() || /^Error:/i.test(c)) continue;
    if (
      /"staged"\s*:/i.test(c) ||
      /"applied"\s*:/i.test(c) ||
      /staged for (inline )?review/i.test(c) ||
      /File edits staged/i.test(c)
    ) {
      return true;
    }
  }
  return false;
}
