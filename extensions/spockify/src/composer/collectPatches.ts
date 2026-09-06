/**
 * Collect FilePatch proposals from assistant fences + apply_patch tool args.
 */

import type { AgentMessage } from '../runtime';
import { parseFilePatches } from './parsePatches';
import type { FilePatch } from './types';

function asPatch(path: unknown, content: unknown): FilePatch | undefined {
  if (typeof path !== 'string' || !path.trim()) return undefined;
  if (typeof content !== 'string') return undefined;
  return { path: path.replace(/^\.\//, ''), content };
}

/** Pull {path,content} from apply_patch-style argument bags. */
export function patchesFromApplyArgs(
  args: Record<string, unknown>,
): FilePatch[] {
  const out: FilePatch[] = [];
  const files = args.files;
  if (Array.isArray(files)) {
    for (const f of files) {
      if (!f || typeof f !== 'object') continue;
      const rec = f as Record<string, unknown>;
      const p = asPatch(rec.path, rec.content ?? rec.nextContent);
      if (p) out.push(p);
    }
  }
  // Single-file shorthand some models invent
  const single = asPatch(args.path, args.content ?? args.nextContent);
  if (single) out.push(single);
  return out;
}

/** Dedup by path — later content wins (iterative apply). */
export function mergePatchesByPath(patches: FilePatch[]): FilePatch[] {
  const map = new Map<string, FilePatch>();
  for (const p of patches) {
    map.set(p.path.replace(/^\.\//, ''), {
      path: p.path.replace(/^\.\//, ''),
      content: p.content,
    });
  }
  return [...map.values()];
}

/**
 * Prefer tool-driven apply_patch payloads; fall back to path-tagged fences.
 */
export function collectComposerPatches(opts: {
  assistantText: string;
  toolApplyArgs?: Array<Record<string, unknown>>;
  messages?: AgentMessage[];
}): FilePatch[] {
  const fromTools: FilePatch[] = [];
  for (const args of opts.toolApplyArgs ?? []) {
    fromTools.push(...patchesFromApplyArgs(args));
  }
  // Recover args from tool result messages if caller only has history
  if (opts.messages) {
    for (const m of opts.messages) {
      if (m.role !== 'tool' || m.name !== 'apply_patch') continue;
      // Tool result content is a summary; patches come from prior toolStart args.
    }
  }
  const fromFences = parseFilePatches(opts.assistantText);
  return mergePatchesByPath([...fromFences, ...fromTools]);
}
