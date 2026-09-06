/**
 * Plain promise-chain FIFO (pure, no vscode) — not a job scheduler. Used by
 * AgentsTreeProvider to serialize the actual agent-run create call: if
 * "Spawn Agents" fires again (double-click, or a second trigger) while an
 * earlier create is still in flight, the second one runs strictly after
 * the first settles instead of racing it as a second concurrent request.
 */
export class SpawnQueue {
  private tail: Promise<void> = Promise.resolve();
  private depth = 0;

  /** Tasks currently queued ahead of one submitted right now (0 = would run immediately). */
  get aheadCount(): number {
    return this.depth;
  }

  /**
   * Run `task` after every previously submitted task has settled.
   * `onQueued(ahead)` fires synchronously, before `task` is chained, only
   * when this submission has to wait (ahead > 0) — the caller uses it to
   * surface a "queued (N ahead)" notice.
   */
  async run<T>(task: () => Promise<T>, onQueued?: (ahead: number) => void): Promise<T> {
    const ahead = this.depth;
    this.depth += 1;
    if (ahead > 0) {
      onQueued?.(ahead);
    }
    const result = this.tail.then(task, task);
    // Keep the chain alive regardless of this task's outcome so the next
    // caller still queues behind it; the real success/failure propagates
    // to this caller via `result`, not via `tail`.
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await result;
    } finally {
      this.depth = Math.max(0, this.depth - 1);
    }
  }
}
