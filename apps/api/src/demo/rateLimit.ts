const MS_PER_SECOND = 1_000;

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
 * multiplied by the instance count.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
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

  private forgetExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}
