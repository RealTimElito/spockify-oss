import fs from 'node:fs';
import path from 'node:path';

/**
 * Drop-in skill writer shared by the CLI, the IDE, and pentest-eval.
 * Web chat mirrors these rules in services/router/skills_packs.py
 * (the router cannot import this package). Keep the two in lockstep:
 * title, category, and tags only; path `<skillsDir>/<id>/SKILL.md`.
 */
export const SKILL_INDEX_NOTE =
  'Indexed on the next skill list or search, or on the next session start.';

export class SkillWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillWriteError';
  }
}

export type DropInSkillInput = {
  /** Directory that will contain `<id>/SKILL.md` (not the skill folder itself). */
  skillsDir: string;
  id: string;
  title: string;
  category?: string;
  tags?: string[] | string;
  body: string;
  replace?: boolean;
};

const MAX_BODY = 200_000;

/** `<cwd>/.spockify/skills` — cwd is where spockify was started. */
export function skillsDirForCwd(cwd: string): string {
  return path.join(path.resolve(cwd), '.spockify', 'skills');
}

function oneLine(value: string, label: string): string {
  const text = value.replace(/[\r\n]+/g, ' ').trim();
  if (!text) throw new SkillWriteError(`${label} is empty`);
  return text;
}

/** Refuse path escape and the `.skill.md` filename the loader does not read. */
export function assertSkillId(raw: string): string {
  const id = (raw || '').trim();
  if (
    !id ||
    id === '.' ||
    id === '..' ||
    id.includes('..') ||
    id.includes('/') ||
    id.includes('\\') ||
    /[\u0000-\u001f]/.test(id) ||
    /\s/.test(id)
  ) {
    throw new SkillWriteError('id escapes the skills directory');
  }
  const lower = id.toLowerCase();
  if (lower.includes('.skill.md') || lower.endsWith('.md') || lower === 'skill.md') {
    throw new SkillWriteError(
      'refusing to write a .skill.md file; pass a plain id and this tool writes SKILL.md',
    );
  }
  return id;
}

function normalizeTags(tags: string[] | string | undefined): string[] {
  if (tags == null) return [];
  const parts = Array.isArray(tags) ? tags : tags.split(/[,\s]+/);
  const out: string[] = [];
  for (const part of parts) {
    const t = part.trim().replace(/^["']|["']$/g, '');
    if (!t || /[\r\n]/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

function ensureHeading(body: string, title: string): string {
  const text = body.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (/^#{1,6}\s+\S/m.test(text)) {
    return text.endsWith('\n') ? text : `${text}\n`;
  }
  const trimmed = text.replace(/^\n+/, '');
  const rest = trimmed ? (trimmed.endsWith('\n') ? trimmed : `${trimmed}\n`) : '';
  return `# ${title}\n\n${rest}`;
}

/** Markdown the pentest-eval loader reads: title, and category/tags only when set. */
export function renderSkillMarkdown(input: {
  title: string;
  category?: string;
  tags?: string[] | string;
  body: string;
}): string {
  const title = oneLine(input.title, 'title');
  const lines = ['---', `title: ${title}`];
  const category = (input.category || '').replace(/[\r\n]+/g, ' ').trim();
  if (category) lines.push(`category: ${category}`);
  const tags = normalizeTags(input.tags);
  if (tags.length) lines.push(`tags: ${tags.join(', ')}`);
  lines.push('---', '');
  return `${lines.join('\n')}${ensureHeading(input.body ?? '', title)}`;
}

/** Title the way the loader does: frontmatter title, else the first # heading. */
export function skillDisplayTitle(raw: string, fallback: string): string {
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const body = fm ? raw.slice(fm[0].length) : raw;
  if (fm) {
    for (const line of fm[1].split(/\r?\n/)) {
      const kv = line.match(/^title\s*:\s*(.*)$/i);
      if (kv?.[1].trim()) return kv[1].trim();
    }
  }
  return ((body.match(/^#\s+(.+)$/m) || [])[1] || fallback).trim();
}

export function writeDropInSkill(input: DropInSkillInput): { path: string; note: string } {
  const id = assertSkillId(input.id);
  if (typeof input.body !== 'string') throw new SkillWriteError('body must be text');
  if (input.body.includes('\u0000')) throw new SkillWriteError('body must be text');
  if (!input.body.trim()) throw new SkillWriteError('body is empty');
  if (input.body.length > MAX_BODY) throw new SkillWriteError('body is too large');
  const markdown = renderSkillMarkdown(input);
  const root = path.resolve(input.skillsDir);
  const dir = path.resolve(root, id);
  if (dir !== path.join(root, id) || !dir.startsWith(root + path.sep)) {
    throw new SkillWriteError('id escapes the skills directory');
  }
  const file = path.join(dir, 'SKILL.md');
  if (fs.existsSync(file) && input.replace !== true) {
    throw new SkillWriteError(
      `skill already exists: ${file} (pass replace=true to overwrite)`,
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, markdown, 'utf8');
  return { path: file, note: SKILL_INDEX_NOTE };
}

/** Tool-args adapter. Refuses a parameters schema; does not execute tool_class. */
export function writeDropInSkillFromToolArgs(
  cwd: string,
  args: Record<string, unknown>,
): { path: string; note: string } {
  if (
    Object.prototype.hasOwnProperty.call(args, 'parameters') &&
    args.parameters != null &&
    args.parameters !== ''
  ) {
    throw new SkillWriteError(
      'refusing a parameters schema; skill files use title, category, and tags only',
    );
  }
  const tags = args.tags;
  return writeDropInSkill({
    skillsDir: skillsDirForCwd(cwd),
    id: typeof args.id === 'string' ? args.id : String(args.id ?? ''),
    title: typeof args.title === 'string' ? args.title : String(args.title ?? ''),
    category: typeof args.category === 'string' ? args.category : undefined,
    tags: Array.isArray(tags) || typeof tags === 'string' ? (tags as string[] | string) : undefined,
    body: typeof args.body === 'string' ? args.body : String(args.body ?? ''),
    replace: args.replace === true || args.replace === 'true',
  });
}
