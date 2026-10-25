import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Canonical workspace path. Resolves symlinks and rejects aliases that
 * leave the workspace root (lexical path.resolve is not enough).
 */
export async function resolveSafe(cwd: string, rel: string): Promise<string> {
  if (typeof rel !== 'string' || rel.includes('\0')) {
    throw new Error(`Path escapes workspace: ${rel}`);
  }
  const root = await fs.realpath(cwd);
  const target = path.resolve(root, rel || '.');
  let cursor = target;
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(cursor);
      const reconstructed = missing.length
        ? path.join(real, ...missing.reverse())
        : real;
      const relToRoot = path.relative(root, reconstructed);
      if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
        throw new Error(`Path escapes workspace: ${rel}`);
      }
      return reconstructed;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (err instanceof Error && /escapes workspace/.test(err.message)) {
        throw err;
      }
      if (code !== 'ENOENT') throw err;
      missing.push(path.basename(cursor));
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new Error(`Path escapes workspace: ${rel}`);
      }
      cursor = parent;
    }
  }
}
