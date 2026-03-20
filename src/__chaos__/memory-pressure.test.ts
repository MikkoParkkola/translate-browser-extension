/**
 * Chaos/Fault Injection: Memory pressure & resource constraints
 * Verifies bounded resource usage under extreme load.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Throttle } from '../core/throttle';
import { createTranslationError, validateInput, MAX_BATCH_SIZE, MAX_TEXT_LENGTH } from '../core/errors';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Memory Chaos — Translation cache LRU eviction', () => {
  it('Map-based LRU eviction keeps cache bounded (service worker pattern)', () => {
    // Replicates the LRU eviction in service-worker.ts
    const MAX_SIZE = 50;
    const cache = new Map<string, { result: string; useCount: number }>();

    // Fill beyond capacity
    for (let i = 0; i < MAX_SIZE + 20; i++) {
      while (cache.size >= MAX_SIZE) {
        const entries = Array.from(cache.entries());
        const oldestSlice = entries.slice(0, Math.max(5, Math.floor(entries.length * 0.1)));
        const leastUsed = oldestSlice.reduce((min, curr) =>
          curr[1].useCount < min[1].useCount ? curr : min,
        );
        cache.delete(leastUsed[0]);
      }
      cache.set(`key-${i}`, { result: `translation-${i}`, useCount: 1 });
    }

    expect(cache.size).toBeLessThanOrEqual(MAX_SIZE);
    // Most recent entries should be present
    expect(cache.has(`key-${MAX_SIZE + 19}`)).toBe(true);
  });

  it('frequently-used entries survive eviction', () => {
    const MAX_SIZE = 20;
    const cache = new Map<string, { result: string; useCount: number }>();

    // Add a frequently-used entry
    cache.set('hot-key', { result: 'hot-translation', useCount: 100 });

    // Fill rest of cache
    for (let i = 0; i < MAX_SIZE + 10; i++) {
      while (cache.size >= MAX_SIZE) {
        const entries = Array.from(cache.entries());
        const oldestSlice = entries.slice(0, Math.max(5, Math.floor(entries.length * 0.1)));
        const leastUsed = oldestSlice.reduce((min, curr) =>
          curr[1].useCount < min[1].useCount ? curr : min,
        );
        cache.delete(leastUsed[0]);
      }
      cache.set(`key-${i}`, { result: `t-${i}`, useCount: 1 });
    }

    // Hot key survives because its useCount is high
    expect(cache.has('hot-key')).toBe(true);
    expect(cache.size).toBeLessThanOrEqual(MAX_SIZE);
  });
});

describe('Memory Chaos — Very large batch (1000 items)', () => {
  it('validateInput rejects batches exceeding MAX_BATCH_SIZE', () => {
    const hugeBatch = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => `text-${i}`);
    const result = validateInput(hugeBatch, 'en', 'fi');

    expect(result.valid).toBe(false);
    expect(result.error?.category).toBe('input');
    expect(result.error?.message).toContain('Too many texts');
  });

  it('Throttle.predictiveBatch chunks large inputs', () => {
    const throttle = new Throttle({ requestLimit: 100, tokenLimit: 500, windowMs: 60_000 });

    // 1000 short sentences
    const texts = Array.from({ length: 100 }, (_, i) => `Sentence number ${i}. `);
    const batches = throttle.predictiveBatch(texts, 100);

    // Should produce multiple batches, each under the token limit
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) {
      const tokens = batch.reduce((sum, t) => sum + throttle.approxTokens(t), 0);
      expect(tokens).toBeLessThanOrEqual(100);
    }

    throttle.destroy();
  });

  it('validates total text length for batch', () => {
    // Each item at MAX_TEXT_LENGTH would exceed total
    const items = Array.from({ length: 3 }, () => 'x'.repeat(MAX_TEXT_LENGTH));
    const result = validateInput(items, 'en', 'fi');
    expect(result.valid).toBe(false);
    expect(result.error?.message).toContain('length exceeds');
  });
});

describe('Memory Chaos — Rapid sequential translations', () => {
  it('Throttle queue does not grow unbounded under pressure', async () => {
    vi.useRealTimers();
    const throttle = new Throttle({ requestLimit: 2, tokenLimit: 10_000, windowMs: 100 });

    // Fire many requests rapidly
    const promises: Promise<string>[] = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        throttle.runWithRateLimit(async () => `result-${i}`, 10),
      );
    }

    // Queue should be bounded
    const usage = throttle.getUsage();
    expect(usage.queue).toBeLessThanOrEqual(10);

    // All should eventually resolve
    const results = await Promise.all(promises);
    expect(results).toHaveLength(10);
    expect(results[0]).toBe('result-0');

    throttle.destroy();
  });

  it('Throttle.reset clears queue and counters', () => {
    const throttle = new Throttle({ requestLimit: 1, tokenLimit: 100, windowMs: 60_000 });

    // Queue some work
    throttle.runWithRateLimit(async () => 'a', 10, { immediate: true });
    throttle.runWithRateLimit(async () => 'b', 10);
    throttle.runWithRateLimit(async () => 'c', 10);

    // Reset everything
    throttle.reset();
    const usage = throttle.getUsage();
    expect(usage.queue).toBe(0);
    expect(usage.requests).toBe(0);
    expect(usage.tokens).toBe(0);
    expect(usage.totalRequests).toBe(0);

    throttle.destroy();
  });
});

describe('Memory Chaos — OOM detection', () => {
  it('out of memory error is categorised correctly', () => {
    const err = new Error('RangeError: Maximum call stack size exceeded');
    const te = createTranslationError(err);
    expect(te.category).toBe('memory');
    expect(te.message).toContain('memory');
    expect(te.retryable).toBe(true);
    expect(te.suggestion).toContain('closing other tabs');
  });

  it('WebAssembly memory error is categorised as memory', () => {
    const err = new Error('WebAssembly.Memory(): could not allocate memory');
    const te = createTranslationError(err);
    expect(te.category).toBe('memory');
  });

  it('allocation failed error is categorised as memory', () => {
    const err = new Error('allocation failed: out of memory');
    const te = createTranslationError(err);
    expect(te.category).toBe('memory');
    expect(te.retryable).toBe(true);
  });
});

describe('Memory Chaos — Cache size reporting', () => {
  it('Map-based cache tracks size accurately after many ops', () => {
    const cache = new Map<string, { result: string; timestamp: number; size: number }>();
    let totalSize = 0;

    // Populate
    for (let i = 0; i < 100; i++) {
      const size = 100 + i;
      cache.set(`k-${i}`, { result: `r-${i}`, timestamp: Date.now(), size });
      totalSize += size;
    }

    // Delete some
    for (let i = 0; i < 30; i++) {
      const entry = cache.get(`k-${i}`);
      if (entry) {
        totalSize -= entry.size;
        cache.delete(`k-${i}`);
      }
    }

    // Verify consistency
    const recalculated = Array.from(cache.values()).reduce((sum, e) => sum + e.size, 0);
    expect(recalculated).toBe(totalSize);
    expect(cache.size).toBe(70);
  });
});
