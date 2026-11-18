/**
 * Cheap parse checks folded into edit results so the agent sees
 * failures without the user pasting them.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export type FileDiagnostic = {
  path: string;
  message: string;
};

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

/** Empty string means clean. null means the checker could not run. */
function spawnCapture(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve(null);
    }, 8000);
    child.stderr?.on('data', (buf: Buffer) => {
      stderr += buf.toString('utf8');
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve('');
      else resolve(oneLine(stderr) || `exit ${code ?? 1}`);
    });
  });
}

export async function diagnosticsForFile(
  cwd: string,
  rel: string,
): Promise<FileDiagnostic[]> {
  const norm = rel.replace(/\\/g, '/');
  const abs = path.resolve(cwd, norm);
  const ext = path.extname(norm).toLowerCase();
  if (ext === '.json') {
    try {
      JSON.parse(await fs.readFile(abs, 'utf8'));
      return [];
    } catch (err) {
      const message = err instanceof Error ? oneLine(err.message) : 'invalid JSON';
      return [{ path: norm, message }];
    }
  }
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const err = await spawnCapture(process.execPath, ['--check', abs], cwd);
    if (!err) return [];
    return [{ path: norm, message: err }];
  }
  if (ext === '.py') {
    const err = await spawnCapture('python3', ['-m', 'py_compile', abs], cwd);
    if (!err) return [];
    return [{ path: norm, message: err }];
  }
  return [];
}

export function appendDiagnostics(
  summary: string,
  hits: readonly FileDiagnostic[],
): string {
  if (!hits.length) return summary;
  const lines = hits.map((hit) => `${hit.path}: ${hit.message}`);
  return `${summary}\n\ndiagnostics:\n${lines.join('\n')}`;
}
