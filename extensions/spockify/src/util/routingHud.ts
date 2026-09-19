/**
 * Last-turn routing HUD (latency + optional cost) for status bar / chat footer.
 */

export interface TurnRoutingStats {
  latencyMs: number;
  /** USD when API provides it (cost / total_cost / cost_usd). */
  costUsd?: number;
  model?: string;
  attribution?: string;
  at: number;
}

let last: TurnRoutingStats | undefined;
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

export function recordTurnRouting(stats: {
  latencyMs: number;
  costUsd?: number;
  model?: string;
  attribution?: string;
}): void {
  last = {
    latencyMs: stats.latencyMs,
    costUsd: stats.costUsd,
    model: stats.model,
    attribution: stats.attribution,
    at: Date.now(),
  };
  notify();
}

export function getLastTurnRouting(): TurnRoutingStats | undefined {
  return last;
}

export function onTurnRouting(cb: () => void): { dispose: () => void } {
  listeners.add(cb);
  return {
    dispose: () => {
      listeners.delete(cb);
    },
  };
}

/** Compact status / footer: `312ms` or `312ms · ~$0.0012`. */
export function formatRoutingHud(stats: TurnRoutingStats): string {
  const ms = `${Math.round(stats.latencyMs)}ms`;
  if (stats.costUsd != null && Number.isFinite(stats.costUsd)) {
    return `${ms} · ~$${stats.costUsd.toFixed(4)}`;
  }
  return ms;
}

/** Pull cost from OpenAI-ish usage blobs when present. */
export function costUsdFromUsage(
  usage: Record<string, unknown> | undefined,
): number | undefined {
  if (!usage) return undefined;
  for (const key of ['cost_usd', 'cost', 'total_cost', 'total_cost_usd']) {
    const v = usage[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) {
      return Number(v);
    }
  }
  return undefined;
}
