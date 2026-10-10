import { ansi } from './ui';

const WINDOW_MS = 3000;

export type ExitKey = 'Ctrl+C' | 'Ctrl+D';

/**
 * First press arms a 3s window with a live countdown;
 * second matching press within that window confirms exit.
 */
export class DoublePressExit {
  private armedUntil = 0;
  private armedKey: ExitKey | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private waiters: Array<() => void> = [];
  private readonly write: (s: string) => void;

  constructor(write: (s: string) => void = (s) => process.stdout.write(s)) {
    this.write = write;
  }

  /** @returns true if the process should exit now */
  press(key: ExitKey): boolean {
    const now = Date.now();
    if (this.armedUntil > now && this.armedKey === key) {
      this.clearCountdown();
      this.armedUntil = 0;
      this.armedKey = null;
      this.write('\n');
      this.notifyWaiters();
      return true;
    }
    // Different key or fresh arm — start a new window for this key
    this.arm(now, key);
    return false;
  }

  isArmed(): boolean {
    return Date.now() < this.armedUntil;
  }

  /** Resolves when the arm window ends or exit is confirmed/disposed. */
  waitUntilClear(): Promise<void> {
    if (!this.isArmed()) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  dispose(): void {
    this.clearCountdown();
    this.armedUntil = 0;
    this.armedKey = null;
    this.notifyWaiters();
  }

  private notifyWaiters(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
  }

  private arm(now: number, key: ExitKey): void {
    this.clearCountdown();
    this.armedUntil = now + WINDOW_MS;
    this.armedKey = key;
    this.render(WINDOW_MS, key);
    this.tick = setInterval(() => {
      const left = this.armedUntil - Date.now();
      if (left <= 0) {
        this.clearCountdown();
        this.armedUntil = 0;
        this.armedKey = null;
        this.write('\r\x1b[2K');
        this.notifyWaiters();
        return;
      }
      this.render(left, key);
    }, 100);
  }

  private render(leftMs: number, key: ExitKey): void {
    const secs = Math.max(0, leftMs / 1000);
    const label = secs.toFixed(1);
    const line =
      `${ansi.yellow('⚠')}  ${ansi.bold(`Press ${key} again to exit`)}  ` +
      `${ansi.dim(`· ${label}s`)}`;
    this.write(`\r\x1b[2K${line}`);
  }

  private clearCountdown(): void {
    if (this.tick) {
      clearInterval(this.tick);
      this.tick = null;
    }
  }
}

/** @deprecated use DoublePressExit */
export const DoubleCtrlCExit = DoublePressExit;
