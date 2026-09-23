import type { ToolCallRequest, ToolCallResult } from './types';
import type { ToolRegistry } from './registry';
import type { ToolExecutionContext } from './types';

export type ParallelToolOutcome = {
  call: ToolCallRequest;
  result: ToolCallResult;
};

/**
 * Run tools in parallel; return results in LLM order.
 * One failure does not drop the other.
 */
export async function runToolsParallel(
  calls: ToolCallRequest[],
  registry: ToolRegistry,
  ctx: ToolExecutionContext,
  opts?: { parallel?: boolean },
): Promise<ParallelToolOutcome[]> {
  const parallel = opts?.parallel !== false;
  if (!parallel || calls.length <= 1) {
    const out: ParallelToolOutcome[] = [];
    for (const call of calls) {
      const result = await registry.call(call.name, call.arguments, ctx);
      out.push({ call, result });
    }
    return out;
  }
  const settled = await Promise.all(
    calls.map(async (call) => {
      const result = await registry.call(call.name, call.arguments, ctx);
      return { call, result };
    }),
  );
  // Preserve original order
  const byId = new Map(settled.map((s) => [s.call.id, s]));
  return calls.map((c) => byId.get(c.id)!);
}

/** Replay protection: reject reused tool_call_id in the same turn batch. */
export class ReplayGuard {
  private seen = new Set<string>();

  /** Returns error if id reused; else records id. */
  check(id: string): string | null {
    if (!id) return null;
    if (this.seen.has(id)) {
      return `replay_protection: reused tool_call_id ${id}`;
    }
    this.seen.add(id);
    return null;
  }

  resetTurn(): void {
    /* ids unique across session by default; keep set */
  }

  clear(): void {
    this.seen.clear();
  }
}
