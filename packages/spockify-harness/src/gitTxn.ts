import { spawn } from 'node:child_process';

export type GitSnapshot = {
  cwd: string;
  head: string;
  dirtyBefore: boolean;
};

export { applyEditCascade, applySearchReplace } from './editCascade';

function runGit(
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
    });
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on('error', (e) => {
      resolve({ code: 1, stdout: '', stderr: e.message });
    });
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

/**
 * True when `rel` is tracked and differs from HEAD (unstaged or staged).
 * Untracked paths are false — they never appear in plain `git diff` / SWE model_patch.
 * Non-git workspaces return true (caller already verified a content change).
 */
export async function isTrackedRepoDiff(
  cwd: string,
  relPath: string,
): Promise<boolean> {
  if (!(await isGitRepo(cwd))) return true;
  const rel = relPath.replace(/\\/g, '/');
  const tracked = await runGit(cwd, ['ls-files', '--error-unmatch', '--', rel]);
  if (tracked.code !== 0) return false;
  const unstaged = await runGit(cwd, ['diff', 'HEAD', '--', rel]);
  if (unstaged.stdout.trim()) return true;
  const staged = await runGit(cwd, ['diff', '--cached', 'HEAD', '--', rel]);
  return Boolean(staged.stdout.trim());
}

export async function gitSnapshot(cwd: string): Promise<GitSnapshot | null> {
  if (!(await isGitRepo(cwd))) return null;
  const head = await runGit(cwd, ['rev-parse', 'HEAD']);
  if (head.code !== 0) return null;
  const dirty = await runGit(cwd, ['status', '--porcelain']);
  return {
    cwd,
    head: head.stdout.trim(),
    dirtyBefore: Boolean(dirty.stdout.trim()),
  };
}

function porcelainPaths(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .map((l) => l.slice(3).replace(/^"/, '').replace(/"$/, '').trim())
    .filter(Boolean);
}

export async function gitReset(
  snapshot: GitSnapshot,
  sessionWrites?: string[],
): Promise<{ ok: boolean; message: string }> {
  if (snapshot.dirtyBefore) {
    return { ok: false, message: 'refusing reset: worktree was dirty at snapshot' };
  }
  const dirty = await runGit(snapshot.cwd, ['status', '--porcelain']);
  const changed = porcelainPaths(dirty.stdout);
  const ours = new Set(
    (sessionWrites || []).map((p) => p.replace(/\\/g, '/')),
  );
  const extra = changed.filter((p) => !ours.has(p.replace(/\\/g, '/')));
  if (extra.length) {
    return {
      ok: false,
      message: `refusing reset: unrelated changes would be lost (${extra.slice(0, 8).join(', ')})`,
    };
  }
  if (!ours.size && changed.length === 0) {
    return { ok: true, message: snapshot.head };
  }
  if (ours.size) {
    const checkout = await runGit(snapshot.cwd, [
      'checkout',
      snapshot.head,
      '--',
      ...ours,
    ]);
    if (checkout.code !== 0) {
      const msg = (checkout.stderr || checkout.stdout || 'checkout failed').trim();
      if (!/did not match|pathspec/i.test(msg)) {
        return { ok: false, message: msg };
      }
      for (const rel of ours) {
        const rm = await runGit(snapshot.cwd, ['rm', '-f', '--', rel]);
        if (rm.code !== 0) {
          await runGit(snapshot.cwd, ['clean', '-fd', '--', rel]);
        }
      }
    }
    return { ok: true, message: snapshot.head };
  }
  const hard = await runGit(snapshot.cwd, ['reset', '--hard', snapshot.head]);
  if (hard.code !== 0) {
    return { ok: false, message: (hard.stderr || hard.stdout || 'reset failed').trim() };
  }
  const clean = await runGit(snapshot.cwd, ['clean', '-fd']);
  if (clean.code !== 0) {
    return { ok: false, message: (clean.stderr || clean.stdout || 'clean failed').trim() };
  }
  return { ok: true, message: snapshot.head };
}

export function rejectUnifiedDiff(body: string): string | null {
  if (/^diff --git /m.test(body) || /^--- a\//m.test(body)) {
    return 'unified diff rejected; use SEARCH/REPLACE apply_patch';
  }
  return null;
}

/**
 * True when the only edit is a harness-unlock stub (_noop / "testing harness"
 * comments). Those unlock run_tests without fixing FAIL_TO_PASS (django-12284).
 */
export function isHarnessUnlockStubChange(before: string, after: string): boolean {
  if (before === after) return false;
  if (!/\bdef\s+_noop\s*\(/.test(after) && !/testing harness/i.test(after)) {
    return false;
  }
  const strip = (s: string): string => {
    const out: string[] = [];
    let inNoop = false;
    for (const line of s.split('\n')) {
      if (/^\s*#.*(?:testing harness|required by the testing harness)/i.test(line)) {
        continue;
      }
      if (/^\s*def\s+_noop\s*\([^)]*\)\s*:\s*$/.test(line)) {
        inNoop = true;
        continue;
      }
      if (inNoop) {
        if (/^\s+pass\s*$/.test(line)) continue;
        inNoop = false;
      }
      out.push(line);
    }
    return out
      .join('\n')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{2,}/g, '\n')
      .replace(/\n+$/g, '');
  };
  return strip(after) === strip(before);
}
