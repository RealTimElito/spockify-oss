/** Session grants + shell classifier (Phase 2). */

export type GrantAction = 'auto' | 'ask' | 'deny';

export type SessionGrant = {
  /** Glob-ish pattern, e.g. "bash npm *", "edit src/**" */
  pattern: string;
  createdAt: number;
};

const SHELL_RUNNERS = new Set(['shell', 'bash']);

/** bash and shell share one runner / one grant. */
export function normalizeGrantTool(tool: string): string {
  const t = (tool || '').trim().toLowerCase();
  if (SHELL_RUNNERS.has(t)) return 'shell';
  return t;
}

/** Normalized exe + argv. Same command under bash or shell is one key. */
export function grantKey(tool: string, args: Record<string, unknown>): string {
  const exe = normalizeGrantTool(tool);
  if (typeof args.command === 'string') return `${exe} ${args.command}`;
  return `${exe} ${stableArgs(args)}`;
}

function normalizeGrantPattern(pattern: string): string {
  const raw = (pattern || '').trim();
  if (!raw) return raw;
  const sp = raw.indexOf(' ');
  const tool = sp < 0 ? raw : raw.slice(0, sp);
  const rest = sp < 0 ? '' : raw.slice(sp + 1);
  const exe = normalizeGrantTool(tool);
  return rest ? `${exe} ${rest}` : exe;
}

export class PermissionMemory {
  private grants: SessionGrant[] = [];
  /** Exact normalized command → granted-at. Session-scoped; not persisted. */
  private exact = new Map<string, number>();
  private revoked = false;

  list(): SessionGrant[] {
    const fromExact = [...this.exact.entries()].map(([pattern, createdAt]) => ({
      pattern,
      createdAt,
    }));
    return [...this.grants, ...fromExact];
  }

  grant(pattern: string): void {
    this.revoked = false;
    this.grants.push({
      pattern: normalizeGrantPattern(pattern),
      createdAt: Date.now(),
    });
  }

  /** Remember one Allow for this normalized command until /revoke. */
  remember(tool: string, args: Record<string, unknown>): void {
    this.revoked = false;
    this.exact.set(grantKey(tool, args), Date.now());
  }

  revokeAll(): void {
    this.grants = [];
    this.exact.clear();
    this.revoked = true;
  }

  /** True if a prior grant covers this tool+args. */
  allows(tool: string, args: Record<string, unknown>): boolean {
    if (this.revoked && this.grants.length === 0 && this.exact.size === 0) {
      return false;
    }
    const key = grantKey(tool, args);
    if (this.exact.has(key)) return true;
    return this.grants.some((g) => matchGrant(g.pattern, key));
  }
}

/**
 * One Allow per normalized command. Second call with the same argv
 * does not ask again until /revoke or session end.
 */
export async function confirmOnce(
  permissions: PermissionMemory,
  name: string,
  args: Record<string, unknown>,
  askUser: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>,
): Promise<boolean> {
  if (permissions.allows(name, args)) return true;
  const ok = await askUser(normalizeGrantTool(name), args);
  if (ok) permissions.remember(name, args);
  return ok;
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
