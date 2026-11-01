/**
 * Pure path helpers for codebase indexing (no vscode import — unit-testable).
 */

/** Normalize to forward-slash path for POSIX remote roots. */
export function normFsPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Relative path segments of abs under rootFs, or null if outside.
 */
export function relSegmentsUnderRoot(
  rootFs: string,
  absPath: string,
): string[] | null {
  const root = normFsPath(rootFs);
  const abs = normFsPath(absPath);
  if (abs === root) {
    return [];
  }
  if (!abs.startsWith(`${root}/`)) {
    return null;
  }
  return abs.slice(root.length + 1).split('/').filter(Boolean);
}
