/**
 * Coding mid-think spawn — TaskAgent children inside @spockify/harness.
 *
 * Chat SPAWN stays on the router. Do not import services/router/midthought_spawn.py.
 * Spawn only when the parent emits structured SPAWN_CODING JSON or a task tool call.
 * No prompt stanza (no speculative spawn). One round per user turn. Children cannot spawn.
 */
import type { AgentMessage, ToolCallRequest } from './types';
import type { TaskKind } from './taskAgent';

/** Hard ceiling. Compose may set SPOCKIFY_CODING_SPAWN_MAX=2 later. */
export const CODING_SPAWN_MAX = 2;
/** Canary path default — one child so spawn cannot steal calc's only round. */
export const CODING_SPAWN_DEFAULT = 1;
export const CODING_SPAWN_ROUNDS_PER_TURN = 1;
export const DEFAULT_CHILD_TIMEOUT_MS = 45_000;

const SPAWN_RE = /SPAWN_CODING\s*:\s*(\[[\s\S]*?\])/i;
const FORBIDDEN_CHILD = /\b(nmap|masscan|nikto|pentest|metasploit|sqlmap)\b/i;

export type CodingSpawnSpec = {
  kind: TaskKind;
  prompt: string;
  command?: string;
};

export function codingSpawnEnabled(): boolean {
  const env = (process.env.SPOCKIFY_CODING_SPAWN || '').trim().toLowerCase();
  if (env === '0' || env === 'false' || env === 'off') return false;
  return true;
}

export function codingSpawnCap(): number {
  const raw = (process.env.SPOCKIFY_CODING_SPAWN_MAX || '').trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) {
      return Math.min(CODING_SPAWN_MAX, Math.floor(n));
    }
  }
  return CODING_SPAWN_DEFAULT;
}

export function codingChildTimeoutMs(): number {
  const n = Number(process.env.SPOCKIFY_CODING_SPAWN_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 1000) return Math.min(Math.floor(n), 180_000);
  return DEFAULT_CHILD_TIMEOUT_MS;
}

export function spawnMarkerComplete(text: string): boolean {
  const m = SPAWN_RE.exec(text || '');
  if (!m) return false;
  try {
    const raw = JSON.parse(m[1] || '');
    return Array.isArray(raw);
  } catch {
    return false;
  }
}

export function stripSpawnCoding(text: string): string {
  return (text || '')
    .replace(SPAWN_RE, '')
    .replace(/```tool(?:\s+\w+)?\s*\n[\s\S]*?```/gi, (block) => {
      if (/"name"\s*:\s*"task"/i.test(block) || /"tool"\s*:\s*"task"/i.test(block)) {
        return '';
      }
      return block;
    })
    .trim();
}

function asKind(raw: unknown): TaskKind | null {
  const k = String(raw || '').trim().toLowerCase();
  if (k === 'explore' || k === 'bash' || k === 'general') return k;
  return null;
}

export function isForbiddenChild(spec: CodingSpawnSpec): boolean {
  const blob = `${spec.prompt} ${spec.command || ''}`;
  return FORBIDDEN_CHILD.test(blob);
}

export function specOk(spec: CodingSpawnSpec): boolean {
  if (isForbiddenChild(spec)) return false;
  const goal = (spec.kind === 'bash' ? spec.command || spec.prompt : spec.prompt).trim();
  return goal.length >= 4;
}

function specsFromArray(raw: unknown, cap: number): CodingSpawnSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: CodingSpawnSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const kind = asKind(rec.kind || rec.type || 'general');
    if (!kind) continue;
    const prompt = String(rec.prompt || rec.goal || rec.command || '').trim();
    const command = typeof rec.command === 'string' ? rec.command : undefined;
    const spec: CodingSpawnSpec = { kind, prompt, command };
    if (!specOk(spec)) continue;
    out.push(spec);
    if (out.length >= cap) break;
  }
  return out;
}

/** Parse a complete SPAWN_CODING array. Empty = marker missing or incomplete. */
export function parseSpawnCoding(
  text: string,
  cap = codingSpawnCap(),
): CodingSpawnSpec[] {
  const m = SPAWN_RE.exec(text || '');
  if (!m) return [];
  try {
    return specsFromArray(JSON.parse(m[1] || ''), cap);
  } catch {
    return [];
  }
}

export function specsFromTaskCalls(
  calls: ToolCallRequest[],
  cap = codingSpawnCap(),
): CodingSpawnSpec[] {
  const out: CodingSpawnSpec[] = [];
  for (const c of calls) {
    if (c.name !== 'task') continue;
    const kind = asKind(c.arguments.kind);
    if (!kind) continue;
    const prompt = String(c.arguments.prompt || c.arguments.command || '').trim();
    const command =
      typeof c.arguments.command === 'string' ? c.arguments.command : undefined;
    const spec: CodingSpawnSpec = { kind, prompt, command };
    if (!specOk(spec)) continue;
    out.push(spec);
    if (out.length >= cap) break;
  }
  return out;
}

export type DoneDigestInput = {
  id: string;
  kind: TaskKind;
  prompt?: string;
  messages?: AgentMessage[];
  bash?: { ok: boolean; content: string; error?: string };
};

export function formatDoneDigest(input: DoneDigestInput, maxChars = 4000): string {
  const paths = new Set<string>();
  const commands: string[] = [];
  let lastError = '';
  let findings = '';

  if (input.bash) {
    const cmd = (input.prompt || '').trim();
    if (cmd) commands.push(cmd);
    if (!input.bash.ok) {
      lastError = input.bash.error || input.bash.content.slice(-240);
    }
    findings = input.bash.content;
  }

  for (const m of input.messages || []) {
    if (m.role === 'assistant') {
      if (m.content.trim()) findings = m.content.trim();
      for (const c of m.toolCalls || []) {
        const p = c.arguments.path || c.arguments.file;
        if (typeof p === 'string' && p.trim()) paths.add(p.trim());
        if (c.name === 'shell' || c.name === 'bash') {
          const cmd = String(c.arguments.command || '').trim();
          if (cmd) commands.push(cmd);
        }
      }
    }
    if (m.role === 'tool' && /^ERROR:/i.test(m.content || '')) {
      lastError = m.content.slice(0, 300);
    }
  }

  let body = findings.trim() || '(empty)';
  if (body.length > maxChars) body = `${body.slice(0, maxChars - 1)}…`;
  const pathLine = [...paths].join(', ') || '(none)';
  const cmdLine = commands.join(' ; ') || '(none)';
  const errLine = lastError.trim() || '(none)';
  return (
    `### DONE — ${input.kind} ${input.id}\n` +
    `PATHS: ${pathLine}\n` +
    `COMMANDS: ${cmdLine}\n` +
    `LAST_ERROR: ${errLine}\n` +
    `FINDINGS:\n${body}`
  );
}

export function timeoutDigest(id: string, kind: TaskKind, prompt?: string): string {
  return formatDoneDigest({
    id,
    kind,
    prompt,
    bash: { ok: false, content: 'blocked:timeout', error: 'blocked:timeout' },
  });
}

export function mergeDigestUserMessage(digests: string, parentNotes: string): string {
  const notes = parentNotes.trim();
  let user =
    'COMPLETED WORK from TaskAgents (DONE digests, not plans). Read FINDINGS and continue the user goal.\n\n';
  if (notes) {
    user += `Your notes before spawn:\n${notes.slice(0, 4000)}\n\n`;
  }
  user += `${digests}\n\nContinue. Do not emit SPAWN_CODING again this turn. Do not write a tutorial.`;
  return user;
}
