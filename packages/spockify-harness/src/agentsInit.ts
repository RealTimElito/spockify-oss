import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_AGENTS = `# AGENTS.md

## Stack
- Language / package manager: (fill in)
- Test command: pytest -q
- Lint: (fill in)

## Conventions
- Prefer SEARCH/REPLACE apply_patch over full-file dumps
- Prefer grep/glob/read-range over cat/ls thrash
- Do not invent invent-slug evals

## Do not
- Commit secrets
- Run destructive shell without asking (plan mode blocks shell)
`;

/**
 * OpenCode-shaped /init: write AGENTS.md (or .spockify/AGENT.md).
 */
export async function initAgentsMd(
  cwd: string,
  opts?: { force?: boolean; preferSpockifyDir?: boolean },
): Promise<{ path: string; created: boolean; content: string }> {
  const spockifyDir = path.join(cwd, '.spockify');
  const primary = opts?.preferSpockifyDir
    ? path.join(spockifyDir, 'AGENT.md')
    : path.join(cwd, 'AGENTS.md');
  const alt = opts?.preferSpockifyDir
    ? path.join(cwd, 'AGENTS.md')
    : path.join(spockifyDir, 'AGENT.md');

  for (const p of [primary, alt]) {
    try {
      const existing = await fs.readFile(p, 'utf8');
      if (!opts?.force) {
        return { path: p, created: false, content: existing };
      }
    } catch {
      /* missing */
    }
  }

  const target = primary;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, DEFAULT_AGENTS, 'utf8');
  return { path: target, created: true, content: DEFAULT_AGENTS };
}

export async function loadAgentsMd(cwd: string): Promise<string | undefined> {
  for (const p of [
    path.join(cwd, 'AGENTS.md'),
    path.join(cwd, '.spockify', 'AGENT.md'),
  ]) {
    try {
      return await fs.readFile(p, 'utf8');
    } catch {
      /* next */
    }
  }
  return undefined;
}
