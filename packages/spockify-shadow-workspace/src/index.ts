/**
 * Durable shadow workspace — Phase 4
 * Stores under workspace `.spockify/shadow/<sessionId>` when workspaceRoot given,
 * else falls back to os.tmpdir(). Supports copy-on-write read + unified diffs.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export interface ShadowFileDiff {
  path: string;
  shadowContent: string;
  realContent: string | undefined;
  changed: boolean;
  /** Unified diff (shadow vs real); empty if unchanged. */
  unifiedDiff?: string;
}

export interface ShadowWorkspaceHandle {
  root: string;
  sessionId: string;
  writeProposed(relPath: string, content: string): Promise<string>;
  readProposed(relPath: string): Promise<string | undefined>;
  /** Read shadow if present, else copy from real workspace (COW). */
  readOrCopyFromReal(
    relPath: string,
    workspaceRoot: string,
  ): Promise<string | undefined>;
  listProposed(): Promise<string[]>;
  diffAgainstReal(workspaceRoot: string): Promise<ShadowFileDiff[]>;
  /** Persist a small session manifest for reopen after IDE restart. */
  writeManifest(extra?: Record<string, unknown>): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateShadowOptions {
  /** Prefer durable path under this workspace: `.spockify/shadow/<id>`. */
  workspaceRoot?: string;
  /** Keep prior shadow contents if the dir already exists. */
  reuse?: boolean;
}

async function walkRel(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === '.spockify-shadow.json') continue;
    const abs = path.join(dir, name);
    const rel = path.join(base, name).replace(/\\/g, '/');
    const st = await fs.stat(abs);
    if (st.isDirectory()) {
      out.push(...(await walkRel(abs, rel)));
    } else if (st.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function cleanRel(relPath: string): string {
  return relPath.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\\/g, '/');
}

/** Minimal unified diff for full-file replace (enough for review UIs). */
export function unifiedDiffForFile(
  relPath: string,
  before: string | undefined,
  after: string,
): string {
  const a = (before ?? '').split('\n');
  const b = after.split('\n');
  if (before === after) return '';
  const lines: string[] = [
    `--- a/${relPath}`,
    `+++ b/${relPath}`,
    `@@ -1,${a.length || 1} +1,${b.length || 1} @@`,
  ];
  for (const line of a) lines.push(`-${line}`);
  for (const line of b) lines.push(`+${line}`);
  return lines.join('\n');
}

export async function createShadowWorkspace(
  sessionId: string,
  opts: CreateShadowOptions = {},
): Promise<ShadowWorkspaceHandle> {
  const root = opts.workspaceRoot
    ? path.join(opts.workspaceRoot, '.spockify', 'shadow', sessionId)
    : path.join(os.tmpdir(), `spockify-shadow-${sessionId}`);

  if (!opts.reuse) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
  await fs.mkdir(root, { recursive: true });

  const handle: ShadowWorkspaceHandle = {
    root,
    sessionId,

    async writeProposed(relPath: string, content: string): Promise<string> {
      const clean = cleanRel(relPath);
      const full = path.join(root, clean);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, content, 'utf8');
      return full;
    },

    async readProposed(relPath: string): Promise<string | undefined> {
      const clean = cleanRel(relPath);
      const full = path.join(root, clean);
      try {
        return await fs.readFile(full, 'utf8');
      } catch {
        return undefined;
      }
    },

    async readOrCopyFromReal(
      relPath: string,
      workspaceRoot: string,
    ): Promise<string | undefined> {
      const existing = await handle.readProposed(relPath);
      if (existing !== undefined) return existing;
      const clean = cleanRel(relPath);
      try {
        const real = await fs.readFile(
          path.join(workspaceRoot, clean),
          'utf8',
        );
        await handle.writeProposed(clean, real);
        return real;
      } catch {
        return undefined;
      }
    },

    async listProposed(): Promise<string[]> {
      return walkRel(root, '');
    },

    async diffAgainstReal(workspaceRoot: string): Promise<ShadowFileDiff[]> {
      const files = await walkRel(root, '');
      const diffs: ShadowFileDiff[] = [];
      for (const rel of files) {
        const shadowContent = await fs.readFile(path.join(root, rel), 'utf8');
        let realContent: string | undefined;
        try {
          realContent = await fs.readFile(
            path.join(workspaceRoot, rel),
            'utf8',
          );
        } catch {
          realContent = undefined;
        }
        const changed = shadowContent !== realContent;
        diffs.push({
          path: rel,
          shadowContent,
          realContent,
          changed,
          unifiedDiff: changed
            ? unifiedDiffForFile(rel, realContent, shadowContent)
            : '',
        });
      }
      return diffs;
    },

    async writeManifest(extra: Record<string, unknown> = {}): Promise<void> {
      const files = await walkRel(root, '');
      const payload = {
        sessionId,
        root,
        files,
        updatedAt: new Date().toISOString(),
        ...extra,
      };
      await fs.writeFile(
        path.join(root, '.spockify-shadow.json'),
        JSON.stringify(payload, null, 2),
        'utf8',
      );
    },

    async dispose(): Promise<void> {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
    },
  };

  await handle.writeManifest();
  return handle;
}

/** List durable shadows under a workspace `.spockify/shadow`. */
export async function listDurableShadows(
  workspaceRoot: string,
): Promise<Array<{ sessionId: string; root: string; updatedAt?: string }>> {
  const base = path.join(workspaceRoot, '.spockify', 'shadow');
  let names: string[];
  try {
    names = await fs.readdir(base);
  } catch {
    return [];
  }
  const out: Array<{ sessionId: string; root: string; updatedAt?: string }> =
    [];
  for (const name of names) {
    const root = path.join(base, name);
    const st = await fs.stat(root).catch(() => undefined);
    if (!st?.isDirectory()) continue;
    let updatedAt: string | undefined;
    try {
      const raw = await fs.readFile(
        path.join(root, '.spockify-shadow.json'),
        'utf8',
      );
      updatedAt = (JSON.parse(raw) as { updatedAt?: string }).updatedAt;
    } catch {
      /* ignore */
    }
    out.push({ sessionId: name, root, updatedAt });
  }
  return out;
}
