import type { ApplyPatchFile, ApplyPatchRequest } from './types';

const FENCE_RE = /```([^\n`]+)\n([\s\S]*?)```/g;

/** Normalize fence info string to a workspace-relative path when possible. */
export function normalizeFencePath(raw: string): string | undefined {
  let path = raw.trim();
  // Cursor-style start:end:path
  const cursor = /^(\d+):(\d+):(.+)$/.exec(path);
  if (cursor) {
    const pathPart = cursor[3].trim();
    if (pathPart.includes('/') || pathPart.includes('.')) {
      return pathPart.replace(/^\.\//, '').replace(/^\/+/, '');
    }
  }
  if (path.includes(':')) {
    const after = path.split(':').slice(1).join(':').trim();
    if (after.includes('/') || after.includes('.')) {
      // Avoid mangling start:end:path leftovers like "34:foo.ts"
      if (!/^\d+:/.test(after) || after.includes('/')) {
        if (!/^\d+:/.test(after)) {
          path = after;
        }
      }
    }
  }
  const parts = path.split(/\s+/);
  if (parts.length > 1 && (parts[1].includes('/') || parts[1].includes('.'))) {
    path = parts[1];
  }
  if (!path.includes('/') && !path.includes('.')) {
    return undefined;
  }
  if (/^(bash|sh|shell|json|yaml|yml|text)$/i.test(path)) {
    return undefined;
  }
  return path.replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Parse ```path blocks into full-file replacements. */
export function parseFencedFilePatches(text: string): ApplyPatchFile[] {
  const files: ApplyPatchFile[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(FENCE_RE.source, FENCE_RE.flags);
  while ((m = re.exec(text)) !== null) {
    const info = m[1].trim();
    const lower = info.toLowerCase();
    if (lower === 'diff' || lower.startsWith('diff ')) {
      const body = m[2].replace(/\n$/, '');
      files.push(...parseUnifiedDiffText(body));
      continue;
    }
    const path = normalizeFencePath(info);
    if (!path) {
      continue;
    }
    files.push({
      path,
      nextContent: m[2].replace(/\n$/, ''),
    });
  }
  return files;
}

const DIFF_FILE_HEADER = /^---\s+(?:a\/|\/dev\/null\s)?(.+?)\s*$/;
const DIFF_NEW_HEADER = /^\+\+\+\s+(?:b\/|\/dev\/null\s)?(.+?)\s*$/;

/** Parse one or more unified diff hunks from raw text (with or without file headers). */
export function parseUnifiedDiffText(text: string): ApplyPatchFile[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const byPath = new Map<string, string[]>();

  let currentPath: string | undefined;
  let buffer: string[] = [];

  const flush = (): void => {
    if (!currentPath || !buffer.length) {
      return;
    }
    const existing = byPath.get(currentPath) ?? [];
    existing.push(buffer.join('\n'));
    byPath.set(currentPath, existing);
    buffer = [];
  };

  for (const line of lines) {
    const oldMatch = line.match(DIFF_FILE_HEADER);
    if (oldMatch) {
      flush();
      currentPath = cleanDiffPath(oldMatch[1]);
      buffer = [line];
      continue;
    }
    if (currentPath && (line.startsWith('+++') || line.startsWith('@@') || line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\'))) {
      buffer.push(line);
    }
  }
  flush();

  const files: ApplyPatchFile[] = [];
  for (const [path, chunks] of byPath) {
    files.push({
      path,
      unifiedDiff: chunks.join('\n'),
    });
  }
  return files;
}

function cleanDiffPath(p: string): string {
  const t = p.trim();
  if (t === '/dev/null') {
    return 'unknown';
  }
  return t.replace(/^a\//, '').replace(/^b\//, '').replace(/^\.\//, '');
}

/** Detect bare unified diff (no fences) in assistant output. */
export function parseBareUnifiedDiff(text: string): ApplyPatchFile[] {
  if (!/^\s*---\s+/m.test(text) || !/^\s*\+\+\+\s+/m.test(text)) {
    return [];
  }
  return parseUnifiedDiffText(text);
}

/** Merge patch lists by path (later entries override unifiedDiff or nextContent). */
export function mergePatchFiles(lists: ApplyPatchFile[][]): ApplyPatchFile[] {
  const map = new Map<string, ApplyPatchFile>();
  for (const list of lists) {
    for (const f of list) {
      const prev = map.get(f.path);
      map.set(f.path, prev ? { ...prev, ...f, path: f.path } : { ...f });
    }
  }
  return [...map.values()];
}

/** Parse assistant / clipboard text into an ApplyPatchRequest. */
export function parsePatchText(
  text: string,
  source: ApplyPatchRequest['source'] = 'chat',
): ApplyPatchRequest {
  const fenced = parseFencedFilePatches(text);
  const bare = parseBareUnifiedDiff(text);
  const files = mergePatchFiles([fenced, bare]);
  return { files, source };
}
