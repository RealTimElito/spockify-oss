import fs from 'node:fs/promises';
import path from 'node:path';
import type { HarnessSession } from './types';

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
    tick: session.tick,
    cwd: session.cwd,
    model: session.model,
    readSet: session.readSet,
    toolLog: session.toolLog,
    todos: session.todos,
    napkin: session.napkin,
    activeSkillIds: session.activeSkillIds,
    messages: session.messages,
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
    return JSON.parse(last) as HarnessSession;
  } catch {
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
