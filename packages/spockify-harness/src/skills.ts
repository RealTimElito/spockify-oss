import fs from 'node:fs/promises';
import path from 'node:path';

export type SkillMeta = {
  id: string;
  title: string;
  path: string;
  body: string;
};

export const MAX_ATTACHED_SKILLS = 2;

/** Attach at most two skills by id or title (case-insensitive). */
export function pickSkillsByName(all: SkillMeta[], names: string[]): SkillMeta[] {
  const out: SkillMeta[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    if (out.length >= MAX_ATTACHED_SKILLS) break;
    const key = (raw || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    const hit = all.find(
      (s) => s.id.toLowerCase() === key || s.title.toLowerCase() === key,
    );
    if (!hit) continue;
    seen.add(hit.id.toLowerCase());
    out.push(hit);
  }
  return out;
}

/** Load markdown skills from a directory (Wichy Phase 3). */
export async function loadSkills(dir: string): Promise<SkillMeta[]> {
  const out: SkillMeta[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const p = path.join(dir, name);
    const body = await fs.readFile(p, 'utf8');
    const title = (body.match(/^#\s+(.+)$/m) || [])[1] || name.replace(/\.md$/, '');
    out.push({
      id: name.replace(/\.md$/, ''),
      title: title.trim(),
      path: p,
      body,
    });
  }
  return out;
}

export type HookName =
  | 'beforeTurn'
  | 'afterTurn'
  | 'beforeTool'
  | 'afterTool'
  | 'onCompact'
  | 'onDone';

export type HookFn = (ctx: Record<string, unknown>) => void | Promise<void>;

export class HookRegistry {
  private hooks = new Map<HookName, HookFn[]>();

  on(name: HookName, fn: HookFn): void {
    const list = this.hooks.get(name) || [];
    list.push(fn);
    this.hooks.set(name, list);
  }

  async emit(name: HookName, ctx: Record<string, unknown>): Promise<void> {
    for (const fn of this.hooks.get(name) || []) {
      await fn(ctx);
    }
  }
}

const NAPKIN = '.spockify/napkin.md';

export async function readNapkin(cwd: string): Promise<string> {
  try {
    return await fs.readFile(path.join(cwd, NAPKIN), 'utf8');
  } catch {
    return '';
  }
}

export async function writeNapkin(cwd: string, text: string): Promise<string> {
  const p = path.join(cwd, NAPKIN);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text, 'utf8');
  return p;
}
