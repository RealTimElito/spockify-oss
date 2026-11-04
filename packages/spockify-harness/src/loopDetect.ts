import { createHash } from 'node:crypto';

/** Wichy-style loop detector: SHA of name|args|result. */
export class LoopDetector {
  private readonly window: number;
  private readonly threshold: number;
  private readonly enabled: boolean;
  private readonly ring: string[] = [];
  private readonly counts = new Map<string, number>();

  constructor(opts?: {
    window?: number;
    threshold?: number;
    enabled?: boolean;
  }) {
    this.window = opts?.window ?? 20;
    this.threshold = opts?.threshold ?? 5;
    this.enabled = opts?.enabled !== false;
  }

  signature(name: string, args: unknown, result: string): string {
    const raw = `${name}|${stableJson(args)}|${result.slice(0, 4000)}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 16);
  }

  /** Returns warning count when threshold hit; else 0. */
  observe(sig: string): number {
    if (!this.enabled) return 0;
    this.ring.push(sig);
    this.counts.set(sig, (this.counts.get(sig) || 0) + 1);
    while (this.ring.length > this.window) {
      const old = this.ring.shift()!;
      const n = (this.counts.get(old) || 1) - 1;
      if (n <= 0) this.counts.delete(old);
      else this.counts.set(old, n);
    }
    return this.counts.get(sig) || 0;
  }

  shouldWarn(count: number): boolean {
    return this.enabled && count >= this.threshold;
  }

  reset(): void {
    this.ring.length = 0;
    this.counts.clear();
  }
}

function stableJson(v: unknown): string {
  try {
    return JSON.stringify(v, Object.keys((v as object) || {}).sort());
  } catch {
    return String(v);
  }
}
