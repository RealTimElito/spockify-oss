import fs from 'node:fs/promises';
import path from 'node:path';
import { skillDisplayTitle } from './skillFile';

export type SkillMeta = {
  id: string;
  title: string;
  path: string;
  body: string;
};

export const MAX_ATTACHED_SKILLS = 2;

const ATTACHED_SKILLS_MARK = '\nAttached skills:\n';

/**
 * Replace a trailing attached-skills block. Called each model turn so
 * activate_skill (which pushes onto the same array) shows up before the next call.
 */
export function applyAttachedSkills(
  system: string,
  bodies: readonly string[] | undefined,
): string {
  const mark = system.lastIndexOf(ATTACHED_SKILLS_MARK);
  const base = mark >= 0 ? system.slice(0, mark) : system;
  const skills = (bodies || [])
    .map((body) => body.trim())
    .filter(Boolean)
    .slice(0, MAX_ATTACHED_SKILLS);
  if (!skills.length) return base;
  return `${base}${ATTACHED_SKILLS_MARK}${skills.join('\n\n')}\n`;
}

/** Push a skill body onto the live session list. Caps at {@link MAX_ATTACHED_SKILLS}. */
export function attachSkillBody(
  active: string[] | undefined,
  body: string,
): { ok: true; already: boolean } | { ok: false; error: string } {
  if (!active) return { ok: false, error: 'activeSkills not bound' };
  if (active.includes(body)) return { ok: true, already: true };
  if (active.length >= MAX_ATTACHED_SKILLS) {
    return { ok: false, error: 'at most 2 skills can be attached' };
  }
  active.push(body);
  return { ok: true, already: false };
}

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

/**
 * Load markdown skills from a directory.
 * Layout: `<id>/SKILL.md` or flat `<id>.md`. Directory form wins on id.
 */
export async function loadSkills(dir: string): Promise<SkillMeta[]> {
  const out: SkillMeta[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const seen = new Set<string>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.') || entry.name === 'INDEX.json') continue;
    if (entry.isDirectory()) {
      const skillPath = path.join(dir, entry.name, 'SKILL.md');
      try {
        const body = await fs.readFile(skillPath, 'utf8');
        seen.add(entry.name);
        out.push({
          id: entry.name,
          title: skillDisplayTitle(body, entry.name),
          path: skillPath,
          body,
        });
      } catch {
        /* no SKILL.md */
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const id = entry.name.replace(/\.md$/, '');
    if (seen.has(id)) continue;
    const p = path.join(dir, entry.name);
    const body = await fs.readFile(p, 'utf8');
    seen.add(id);
    out.push({
      id,
      title: skillDisplayTitle(body, id),
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
