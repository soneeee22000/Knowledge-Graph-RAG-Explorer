const MS_PER_SECOND = 1_000;

/** Most client keys held at once; new keys are refused while the table is full. */
export const DEFAULT_MAX_TRACKED_KEYS = 10_000;

/** Result of one attempt to take a slot. */
export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the key's window resets; 0 when allowed. */
  retryAfterSeconds: number;
}

interface Window {
  startedAt: number;
  count: number;
}

/**
 * In-memory fixed-window limiter keyed by client (IP). One process only: with
 * several instances each keeps its own counts, so the effective limit is
 * multiplied by the instance count. At most `maxKeys` clients are tracked per
 * window; a new client arriving while the table is full is refused until
 * entries expire, so a flood of distinct keys cannot grow memory without bound.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys: number = DEFAULT_MAX_TRACKED_KEYS,
  ) {}

  /** Number of keys currently held in memory. */
  get trackedKeys(): number {
    return this.windows.size;
  }

  /** Count one request for `key` and say whether it is within the limit. */
  take(key: string): RateLimitDecision {
    const now = this.now();
    this.forgetExpired(now);
    const current = this.windows.get(key);
    if (!current && this.windows.size >= this.maxKeys) {
      return { allowed: false, retryAfterSeconds: this.secondsUntilSlotFrees(now) };
    }
    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count < this.limit) {
      current.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const remainingMs = current.startedAt + this.windowMs - now;
    return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / MS_PER_SECOND) };
  }

  private secondsUntilSlotFrees(now: number): number {
    let oldest = now;
    for (const window of this.windows.values()) oldest = Math.min(oldest, window.startedAt);
    return Math.max(1, Math.ceil((oldest + this.windowMs - now) / MS_PER_SECOND));
  }

  private forgetExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
