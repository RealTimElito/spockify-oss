import fs from 'node:fs/promises';
import path from 'node:path';
import type { HarnessSession } from './types';

/** Bump only with a documented migration. Older files without the field load as v1. */
export const SESSION_SCHEMA_VERSION = 1;

export class SessionSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionSchemaError';
  }
}

/**
 * Atomic JSONL session persist: temp → fsync → rename.
 * Compact failure must leave the previous file intact.
 */
export async function persistSession(
  sessionDir: string,
  sessionId: string,
  session: HarnessSession,
): Promise<string> {
  await fs.mkdir(sessionDir, { recursive: true });
  const target = path.join(sessionDir, `${sessionId}.jsonl`);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const line = JSON.stringify({
    schemaVersion: SESSION_SCHEMA_VERSION,
    tick: session.tick,
    cwd: session.cwd,
    model: session.model,
    readSet: session.readSet,
    toolLog: session.toolLog,
    todos: session.todos,
    napkin: session.napkin,
    activeSkillIds: session.activeSkillIds,
    messages: session.messages,
    pinLocked: session.pinLocked,
  });
  const fh = await fs.open(tmp, 'w');
  try {
    await fh.writeFile(line + '\n', 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  // Validate before swap
  const raw = await fs.readFile(tmp, 'utf8');
  JSON.parse(raw.trim());
  await fs.rename(tmp, target);
  return target;
}

export async function loadSession(
  sessionDir: string,
  sessionId: string,
): Promise<HarnessSession | null> {
  const target = path.join(sessionDir, `${sessionId}.jsonl`);
  try {
    const raw = await fs.readFile(target, 'utf8');
    const last = raw.trim().split('\n').pop();
    if (!last) return null;
    const parsed = JSON.parse(last) as HarnessSession & { schemaVersion?: number };
    const ver = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 1;
    if (ver > SESSION_SCHEMA_VERSION) {
      throw new SessionSchemaError(
        `incompatible session schema ${ver} (supported ${SESSION_SCHEMA_VERSION})`,
      );
    }
    parsed.schemaVersion = ver;
    return parsed;
  } catch (err) {
    if (err instanceof SessionSchemaError) throw err;
    return null;
  }
}

/** Compact: write new summary to temp; only swap if valid. On fail, old file remains. */
export async function compactSessionAtomic(
  sessionDir: string,
  sessionId: string,
  next: HarnessSession,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const p = await persistSession(sessionDir, sessionId, next);
    return { ok: true, path: p };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
