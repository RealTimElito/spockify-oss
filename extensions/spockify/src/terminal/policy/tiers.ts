/**
 * Allowlist tiers for Claude Code–class terminal autonomy.
 * Tiers are cumulative: read ⊂ dev ⊂ build. Custom patterns always union.
 */

export type AllowlistTier = 'read' | 'dev' | 'build' | 'custom';

/** Safe inspection — no writes, no package installs. */
export const TIER_READ: string[] = [
  'ls*',
  'pwd',
  'echo*',
  'cat*',
  'head*',
  'tail*',
  'wc*',
  'file*',
  'which*',
  'type*',
  'env',
  'printenv*',
  'uname*',
  'whoami',
  'date',
  'git status*',
  'git diff*',
  'git log*',
  'git show*',
  'git branch*',
  'git remote*',
  'git rev-parse*',
  'rg*',
  'grep*',
  'find*',
  'tree*',
  'bat*',
  'less*',
  'nl*',
];

/** Read + common build/test/typecheck (no destructive git writes). */
export const TIER_DEV: string[] = [
  ...TIER_READ,
  'npm test*',
  'npm run test*',
  'npm run lint*',
  'npm run build*',
  'npm run compile*',
  'npm run typecheck*',
  'npx tsc*',
  'npx tsx*',
  'npx eslint*',
  'pnpm test*',
  'pnpm run test*',
  'yarn test*',
  'python -m pytest*',
  'pytest*',
  'python -m unittest*',
  'go test*',
  'cargo test*',
  'cargo check*',
  'make test*',
  'make check*',
  'make build*',
  'dotnet test*',
  'mvn test*',
  'gradle test*',
];

/** Dev + longer install/build pipelines (still no rm -rf / curl|bash). */
export const TIER_BUILD: string[] = [
  ...TIER_DEV,
  'npm ci*',
  'npm install*',
  'npm i*',
  'pnpm install*',
  'pnpm i*',
  'yarn install*',
  'pip install*',
  'pip3 install*',
  'python -m pip install*',
  'cargo build*',
  'go build*',
  'make*',
  'cmake*',
  'docker build*',
  'docker compose*',
  'docker-compose*',
];

const TIER_MAP: Record<Exclude<AllowlistTier, 'custom'>, string[]> = {
  read: TIER_READ,
  dev: TIER_DEV,
  build: TIER_BUILD,
};

/**
 * Resolve effective allowlist patterns for a tier + optional custom extras.
 * `custom` tier uses only the provided custom list (no seeded tier).
 */
export function resolveAllowlist(
  tier: AllowlistTier,
  custom: string[] = [],
): string[] {
  const extra = custom.filter((p) => p.trim().length > 0);
  if (tier === 'custom') {
    return [...extra];
  }
  const seeded = TIER_MAP[tier] ?? TIER_DEV;
  const seen = new Set(seeded);
  const out = [...seeded];
  for (const p of extra) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

export function describeTier(tier: AllowlistTier): string {
  switch (tier) {
    case 'read':
      return 'read-only inspection (ls/git status/rg; no writes)';
    case 'dev':
      return 'read + test/typecheck/build scripts';
    case 'build':
      return 'dev + install/build pipelines (npm ci, make, docker build)';
    case 'custom':
      return 'custom allowlist only (no seeded tier)';
    default:
      return String(tier);
  }
}
