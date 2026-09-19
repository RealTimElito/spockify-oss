/** Session grants + shell classifier (Phase 2). */

export type GrantAction = 'auto' | 'ask' | 'deny';

export type SessionGrant = {
  /** Glob-ish pattern, e.g. "bash npm *", "edit src/**" */
  pattern: string;
  createdAt: number;
};

export class PermissionMemory {
  private grants: SessionGrant[] = [];
  private revoked = false;

  list(): SessionGrant[] {
    return this.grants.slice();
  }

  grant(pattern: string): void {
    this.revoked = false;
    this.grants.push({ pattern, createdAt: Date.now() });
  }

  revokeAll(): void {
    this.grants = [];
    this.revoked = true;
  }

  /** True if a prior grant covers this tool+args. */
  allows(tool: string, args: Record<string, unknown>): boolean {
    if (this.revoked && this.grants.length === 0) return false;
    const hay = `${tool} ${stableArgs(args)}`;
    return this.grants.some((g) => matchGrant(g.pattern, hay));
  }
}

function stableArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

function matchGrant(pattern: string, hay: string): boolean {
  // Escape regex except * → .*
  const re = new RegExp(
    '^' +
      pattern
        .split('*')
        .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$',
    'i',
  );
  return re.test(hay);
}

/** Classify bash for auto / ask / deny. */
export function classifyBash(command: string): GrantAction {
  const c = command.trim();
  if (!c) return 'deny';
  if (
    /(?:^|[\s;|&])rm\s+-rf\s+\//i.test(c) ||
    /\bdd\s+if=/i.test(c) ||
    /\bmkfs\b/i.test(c) ||
    /\bchmod\s+-R\s+777\b/i.test(c) ||
    /\bkubectl\s+delete\s+ns\b/i.test(c)
  ) {
    return 'deny';
  }
  if (
    /\b(curl\s+|wget\s+|nc\s+|ncat\s+|docker\s+run|kubectl\s+delete|chmod\s+|chown\s+|rm\s+-rf)\b/i.test(
      c,
    )
  ) {
    return 'ask';
  }
  if (/\b(npm\s+|yarn\s+|pnpm\s+|pip\s+|pytest|make\s+test|git\s+)/i.test(c)) {
    return 'auto';
  }
  return 'ask';
}
