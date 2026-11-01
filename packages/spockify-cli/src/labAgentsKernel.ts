/**
 * Lab kernel entry — re-exports path to runHarness stdio adapter.
 * Prefer this over growing Python tool implementations.
 */
import path from 'node:path';

/** Absolute path to the lab → runHarness stdio script. */
export function labKernelStdioScript(repoRoot?: string): string {
  const root = repoRoot || path.resolve(__dirname, '../../..');
  return path.join(
    root,
    'packages/spockify-harness/scripts/lab-kernel-stdio.ts',
  );
}

/** Marker for Phase 4 grep: lab clients call runHarness through this adapter. */
export const LAB_CALLS_RUN_HARNESS = true as const;
