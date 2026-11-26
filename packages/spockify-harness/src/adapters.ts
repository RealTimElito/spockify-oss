/**
 * Phase 4 — unify clients on @spockify/harness.
 *
 * CLI thin-wraps runAgentTurn from this package (OK).
 * IDE: runIdeAgentTurn → runHarness event stream (private loop archived).
 * Lab: orch/exec policy may call lab-kernel-stdio (runHarness); no second Python tool kernel.
 */

export const KERNEL_IMPORT_HINT =
  "import { runHarness, runAgentTurn } from '@spockify/harness'";

/** Paths that must eventually call runHarness (not a private loop). */
export const CLIENT_LOOP_OWNERS = [
  'packages/spockify-cli/src/agent/loop.ts', // thin re-export — OK
  'extensions/spockify/src/runtime/agentLoop.ts', // Phase 4 → runHarness
  'packages/spockify-harness/scripts/lab-kernel-stdio.ts', // lab TaskAgent bridge
] as const;

/**
 * Exit gate for Phase 4: fail if a second full agent loop implementation
 * still exists outside harness (heuristic: "export async function runAgentTurn"
 * outside harness + cli thin wrapper).
 */
export function assertClientsOnKernel(grepHits: string[]): {
  ok: boolean;
  offenders: string[];
} {
  const offenders = grepHits.filter((line) => {
    const lower = line.toLowerCase();
    if (lower.includes('spockify-harness')) return false;
    if (lower.includes('packages/spockify-cli/src/agent/loop.ts')) return false;
    if (lower.includes('packages/spockify-cli/src/agent/')) return false;
    if (lower.includes('runideagentturn')) return false;
    if (lower.includes('_archive')) return false;
    return /export async function runagentturn/.test(lower);
  });
  return { ok: offenders.length === 0, offenders };
}

/** IDE bridge: prefer harness events; map to existing AgentRuntimeEvent consumers. */
export function ideShouldImportHarness(): string {
  return (
    'Phase 4: extensions/spockify/src/runtime/agentLoop.ts imports runHarness ' +
    'from @spockify/harness; private clone archived under _archive/.'
  );
}

/** Lab bridge: orch/exec policy stays Python; tools must not fork a second TS loop. */
export function labKernelPolicy(): string {
  return (
    'Lab calls runHarness via packages/spockify-harness/scripts/lab-kernel-stdio.ts ' +
    '(kernel_bridge.py is stdio-only; no Python read/shell/edit).'
  );
}
