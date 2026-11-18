/**
 * Last Tab-complete latency for status-bar chrome.
 */

let lastMs: number | undefined;
const listeners = new Set<() => void>();

export function recordTabLatency(ms: number): void {
  lastMs = ms;
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

export function getLastTabLatency(): number | undefined {
  return lastMs;
}

export function onTabLatency(
  cb: () => void,
): { dispose: () => void } {
  listeners.add(cb);
  return {
    dispose: () => {
      listeners.delete(cb);
    },
  };
}
