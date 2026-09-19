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

export async function gitReset(
  snapshot: GitSnapshot,
): Promise<{ ok: boolean; message: string }> {
  if (snapshot.dirtyBefore) {
    return { ok: false, message: 'refusing reset: worktree was dirty at snapshot' };
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
