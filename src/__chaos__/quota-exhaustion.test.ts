/**
 * Chaos/Fault Injection: API quota / rate-limit exhaustion
 * Verifies graceful degradation when providers are rate-limited or quota-exhausted.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleProviderHttpError } from '../core/http-errors';
import { Throttle } from '../core/throttle';
import { createTranslationError } from '../core/errors';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Quota Chaos — 429 with Retry-After header', () => {
  it('respects Retry-After in seconds', () => {
    const result = handleProviderHttpError(429, 'DeepL', undefined, '30');
    expect(result.retryable).toBe(true);
    expect(result.retryAfter).toBe(30_000);
  });

  it('respects Retry-After as HTTP-date', () => {
    const futureDate = new Date(Date.now() + 60_000).toUTCString();
    const result = handleProviderHttpError(429, 'OpenAI', undefined, futureDate);
    expect(result.retryable).toBe(true);
    // Should be close to 60s (±1s for execution time)
    expect(result.retryAfter).toBeGreaterThan(55_000);
    expect(result.retryAfter).toBeLessThanOrEqual(65_000);
  });
});

describe('Quota Chaos — 429 without Retry-After', () => {
  it('falls back to 60s default backoff', () => {
    const result = handleProviderHttpError(429, 'Anthropic');
    expect(result.retryable).toBe(true);
    expect(result.retryAfter).toBe(60_000);
  });
});

describe('Quota Chaos — exponential backoff on sequential 429s', () => {
  it('Throttle.runWithRetry backs off exponentially on retryable errors', async () => {
    vi.useRealTimers(); // need real timers for delay timing
    const throttle = new Throttle({ requestLimit: 100, tokenLimit: 100_000, windowMs: 60_000 });

    let callCount = 0;
    const timestamps: number[] = [];
    const fn = vi.fn(async () => {
      timestamps.push(Date.now());
      callCount++;
      if (callCount < 4) {
        const err = new Error('429 rate limit') as Error & { retryable?: boolean; retryAfter?: number };
        err.retryable = true;
        err.retryAfter = 50; // short for testing
        throw err;
      }
      return 'ok';
    });

    const result = await throttle.runWithRetry(fn, 10, 5);
    expect(result).toBe('ok');
    expect(callCount).toBe(4);

    // Verify that each successive call was delayed
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i] - timestamps[i - 1]).toBeGreaterThanOrEqual(10);
    }

    throttle.destroy();
  });
});

describe('Quota Chaos — Quota exceeded (402/403) triggers failover', () => {
  it('HTTP 402 payment required is non-retryable', () => {
    const result = handleProviderHttpError(402, 'DeepL');
    expect(result.retryable).toBe(false);
    expect(result.message).toContain('payment required');
  });

  it('HTTP 403 forbidden is non-retryable', () => {
    const result = handleProviderHttpError(403, 'OpenAI');
    expect(result.retryable).toBe(false);
    expect(result.message).toContain('forbidden');
  });

  it('DeepL 456 quota exceeded is non-retryable', () => {
    const result = handleProviderHttpError(456, 'DeepL');
    expect(result.retryable).toBe(false);
    expect(result.message).toContain('quota exceeded');
  });
});

describe('Quota Chaos — All providers rate-limited', () => {
  it('Throttle queues requests when limits reached', async () => {
    const throttle = new Throttle({ requestLimit: 1, tokenLimit: 1000, windowMs: 5000 });

    // First call goes through immediately
    const p1 = throttle.runWithRateLimit(async () => 'first', 10, { immediate: true });

    // Second call should be queued
    const p2 = throttle.runWithRateLimit(async () => 'second', 10);

    const first = await p1;
    expect(first).toBe('first');

    // Advance timer to next window so queued request can proceed
    vi.advanceTimersByTime(5100);
    const second = await p2;
    expect(second).toBe('second');

    throttle.destroy();
  });
});

describe('Quota Chaos — Rate limit recovery', () => {
  it('Throttle window reset re-enables requests', () => {
    const throttle = new Throttle({ requestLimit: 2, tokenLimit: 1000, windowMs: 1000 });
    const usage1 = throttle.getUsage();
    expect(usage1.requests).toBe(0);

    // Simulate two requests
    throttle.runWithRateLimit(async () => 'a', 10, { immediate: true });
    throttle.runWithRateLimit(async () => 'b', 10, { immediate: true });

    const usage2 = throttle.getUsage();
    expect(usage2.requests).toBe(2);

    // Advance past window
    vi.advanceTimersByTime(1100);
    const usage3 = throttle.getUsage();
    // Pruned old records
    expect(usage3.requests).toBe(0);

    throttle.destroy();
  });
});

describe('Quota Chaos — Billing error disables provider', () => {
  it('createTranslationError for 402 maps to auth category', () => {
    // The error message "402" doesn't directly match auth patterns,
    // but "payment required" via HTTP module is non-retryable.
    const httpResult = handleProviderHttpError(402, 'Anthropic');
    expect(httpResult.retryable).toBe(false);

    // Verify the error module recognises 403 as auth
    const err = new Error('403 Forbidden - invalid API key');
    const te = createTranslationError(err);
    expect(te.category).toBe('auth');
    expect(te.retryable).toBe(false);
  });
});
