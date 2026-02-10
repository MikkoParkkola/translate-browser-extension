/**
 * Request deduplication pattern tests.
 *
 * Tests the in-flight request deduplication logic used by the service worker
 * to prevent duplicate API calls when multiple content script frames request
 * the same translation simultaneously.
 */

import { describe, it, expect, vi } from 'vitest';
import { generateCacheKey } from './hash';

/**
 * Extracted deduplication logic for testability.
 * This mirrors the pattern used in handleTranslate in service-worker.ts.
 */
function createDeduplicator<T>() {
  const inFlight = new Map<string, Promise<T>>();

  return {
    /**
     * Execute a function with deduplication. If the same key is already
     * in-flight, return the existing promise instead of calling fn again.
     */
    async dedupe(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing) {
        return existing;
      }

      const promise = fn();
      inFlight.set(key, promise);

      try {
        return await promise;
      } finally {
        inFlight.delete(key);
      }
    },

    /** Number of currently in-flight requests */
    get size(): number {
      return inFlight.size;
    },
  };
}

describe('Request Deduplication', () => {
  describe('generateCacheKey for dedup', () => {
    it('generates same key for identical requests', () => {
      const key1 = generateCacheKey('Hello', 'en', 'fi', 'opus-mt');
      const key2 = generateCacheKey('Hello', 'en', 'fi', 'opus-mt');
      expect(key1).toBe(key2);
    });

    it('generates different keys for different text', () => {
      const key1 = generateCacheKey('Hello', 'en', 'fi', 'opus-mt');
      const key2 = generateCacheKey('World', 'en', 'fi', 'opus-mt');
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different languages', () => {
      const key1 = generateCacheKey('Hello', 'en', 'fi', 'opus-mt');
      const key2 = generateCacheKey('Hello', 'en', 'de', 'opus-mt');
      expect(key1).not.toBe(key2);
    });

    it('generates different keys for different providers', () => {
      const key1 = generateCacheKey('Hello', 'en', 'fi', 'opus-mt');
      const key2 = generateCacheKey('Hello', 'en', 'fi', 'deepl');
      expect(key1).not.toBe(key2);
    });

    it('generates same key for identical array inputs', () => {
      const key1 = generateCacheKey(['Hello', 'World'], 'en', 'fi', 'opus-mt');
      const key2 = generateCacheKey(['Hello', 'World'], 'en', 'fi', 'opus-mt');
      expect(key1).toBe(key2);
    });
  });

  describe('deduplication behavior', () => {
    it('calls the function once for a unique key', async () => {
      const dedup = createDeduplicator<string>();
      const fn = vi.fn().mockResolvedValue('result');

      const result = await dedup.dedupe('key1', fn);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(result).toBe('result');
    });

    it('reuses in-flight promise for same key', async () => {
      const dedup = createDeduplicator<string>();

      let resolvePromise: (value: string) => void;
      const slowFn = vi.fn().mockImplementation(() => {
        return new Promise<string>((resolve) => {
          resolvePromise = resolve;
        });
      });

      // Start first request
      const promise1 = dedup.dedupe('key1', slowFn);
      // Start second request with same key (should deduplicate)
      const promise2 = dedup.dedupe('key1', slowFn);

      // Function should only be called once
      expect(slowFn).toHaveBeenCalledTimes(1);
      expect(dedup.size).toBe(1);

      // Resolve the shared promise
      resolvePromise!('shared result');

      const [result1, result2] = await Promise.all([promise1, promise2]);
      expect(result1).toBe('shared result');
      expect(result2).toBe('shared result');
    });

    it('allows new requests after in-flight completes', async () => {
      const dedup = createDeduplicator<string>();
      const fn = vi.fn().mockResolvedValue('result');

      await dedup.dedupe('key1', fn);
      expect(dedup.size).toBe(0); // Cleaned up

      await dedup.dedupe('key1', fn);
      expect(fn).toHaveBeenCalledTimes(2); // Called again
    });

    it('does not deduplicate different keys', async () => {
      const dedup = createDeduplicator<string>();

      let resolve1: (value: string) => void;
      let resolve2: (value: string) => void;

      const fn1 = vi.fn().mockImplementation(() =>
        new Promise<string>((r) => { resolve1 = r; })
      );
      const fn2 = vi.fn().mockImplementation(() =>
        new Promise<string>((r) => { resolve2 = r; })
      );

      const promise1 = dedup.dedupe('key1', fn1);
      const promise2 = dedup.dedupe('key2', fn2);

      expect(fn1).toHaveBeenCalledTimes(1);
      expect(fn2).toHaveBeenCalledTimes(1);
      expect(dedup.size).toBe(2);

      resolve1!('result1');
      resolve2!('result2');

      const [r1, r2] = await Promise.all([promise1, promise2]);
      expect(r1).toBe('result1');
      expect(r2).toBe('result2');
    });

    it('cleans up on error', async () => {
      const dedup = createDeduplicator<string>();
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(dedup.dedupe('key1', fn)).rejects.toThrow('fail');
      expect(dedup.size).toBe(0); // Cleaned up even on error
    });

    it('propagates error to all deduplicated callers', async () => {
      const dedup = createDeduplicator<string>();

      let rejectPromise: (error: Error) => void;
      const slowFn = vi.fn().mockImplementation(() => {
        return new Promise<string>((_resolve, reject) => {
          rejectPromise = reject;
        });
      });

      const promise1 = dedup.dedupe('key1', slowFn);
      const promise2 = dedup.dedupe('key1', slowFn);

      rejectPromise!(new Error('shared error'));

      await expect(promise1).rejects.toThrow('shared error');
      await expect(promise2).rejects.toThrow('shared error');
    });

    it('handles many concurrent deduplicated requests', async () => {
      const dedup = createDeduplicator<string>();

      let resolvePromise: (value: string) => void;
      const slowFn = vi.fn().mockImplementation(() => {
        return new Promise<string>((resolve) => {
          resolvePromise = resolve;
        });
      });

      // 10 concurrent requests for the same key
      const promises = Array.from({ length: 10 }, () =>
        dedup.dedupe('key1', slowFn)
      );

      expect(slowFn).toHaveBeenCalledTimes(1);

      resolvePromise!('result');
      const results = await Promise.all(promises);
      expect(results.every((r) => r === 'result')).toBe(true);
    });
  });
});
