import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_TRACKED_KEYS, FixedWindowRateLimiter } from './rateLimit.js';

const WINDOW_MS = 60_000;

describe('FixedWindowRateLimiter', () => {
  it('allows up to the limit per key, then refuses with the time left in the window', () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter(2, WINDOW_MS, () => now);
    expect(limiter.take('1.1.1.1').allowed).toBe(true);
    expect(limiter.take('1.1.1.1').allowed).toBe(true);
    now += 10_000;
    const refused = limiter.take('1.1.1.1');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(50);
  });

  it('counts each key separately', () => {
    const limiter = new FixedWindowRateLimiter(1, WINDOW_MS, () => 0);
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
  });

  it('starts a fresh window once the old one has passed', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(1, WINDOW_MS, () => now);
    expect(limiter.take('a').allowed).toBe(true);
    now = WINDOW_MS;
    expect(limiter.take('a').allowed).toBe(true);
  });

  it('forgets expired keys so memory does not grow without bound', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(1, WINDOW_MS, () => now);
    for (let i = 0; i < 50; i++) limiter.take(`ip-${i}`);
    now = WINDOW_MS * 2;
    limiter.take('fresh');
    expect(limiter.trackedKeys).toBe(1);
  });
});

describe('FixedWindowRateLimiter key cap', () => {
  it('refuses new keys once the cap is reached, but keeps serving tracked keys', () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(2, WINDOW_MS, () => now, 3);
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('b').allowed).toBe(true);
    expect(limiter.take('c').allowed).toBe(true);
    const refused = limiter.take('d');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(limiter.trackedKeys).toBe(3);
    expect(limiter.take('a').allowed).toBe(true);
    now = WINDOW_MS;
    expect(limiter.take('d').allowed).toBe(true);
  });

  it('has a default cap, so a flood of distinct keys cannot grow memory without bound', () => {
    const limiter = new FixedWindowRateLimiter(1, WINDOW_MS, () => 0);
    for (let i = 0; i < DEFAULT_MAX_TRACKED_KEYS + 50; i++) limiter.take(`ip-${i}`);
    expect(limiter.trackedKeys).toBe(DEFAULT_MAX_TRACKED_KEYS);
  });
});
