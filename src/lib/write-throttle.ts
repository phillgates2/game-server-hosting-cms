/**
 * Per-key "write at most once per interval" throttle with bounded memory.
 *
 * Used where a hot path wants to skip a database write unless enough time
 * has passed since the last one for the same key (e.g. session last-seen
 * stamps). A plain Map keyed by session would keep one entry per token for
 * the life of the process; this one drops entries whose interval has elapsed,
 * sweeping at most once per interval, so memory tracks the keys active in the
 * last interval rather than every key ever seen.
 */
export class WriteThrottle {
  private readonly last = new Map<string, number>();
  private lastSweep = 0;

  constructor(private readonly intervalMs: number) {}

  /**
   * Returns true (and records `now`) when the key is due for a write.
   * Returns false while the key was written less than `intervalMs` ago.
   */
  shouldWrite(key: string, now: number = Date.now()): boolean {
    if (now - this.lastSweep >= this.intervalMs) this.sweep(now);
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < this.intervalMs) return false;
    this.last.set(key, now);
    return true;
  }

  /** Stop tracking a key immediately (e.g. the entity it belongs to was removed). */
  forget(key: string): void {
    this.last.delete(key);
  }

  /** Number of keys currently tracked (for tests and diagnostics). */
  size(): number {
    return this.last.size;
  }

  private sweep(now: number): void {
    for (const [key, at] of this.last) {
      if (now - at >= this.intervalMs) this.last.delete(key);
    }
    this.lastSweep = now;
  }
}
