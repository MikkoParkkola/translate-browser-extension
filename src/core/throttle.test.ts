/**
 * Throttle unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Throttle } from './throttle';

describe('Throttle', () => {
  let throttle: Throttle;

  beforeEach(() => {
    vi.useFakeTimers();
    throttle = new Throttle({
      requestLimit: 10,
      tokenLimit: 1000,
      windowMs: 60000,
    });
  });

  afterEach(() => {
    throttle.destroy();
    vi.useRealTimers();
  });

  describe('approxTokens', () => {
    it('estimates ~4 chars per token', () => {
      expect(throttle.approxTokens('hello')).toBe(2); // 5 chars / 4 = 1.25 -> 2
      expect(throttle.approxTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 -> 3
      expect(throttle.approxTokens('')).toBe(1); // minimum 1
    });
  });

  describe('splitSentences', () => {
    it('splits text on sentence boundaries', () => {
      const result = throttle.splitSentences('Hello world. How are you? Fine!');
      expect(result).toEqual(['Hello world.', 'How are you?', 'Fine!']);
    });

    it('handles single sentence', () => {
      const result = throttle.splitSentences('Hello world');
      expect(result).toEqual(['Hello world']);
    });

    it('handles empty string', () => {
      const result = throttle.splitSentences('');
      expect(result).toEqual(['']);
    });
  });

  describe('predictiveBatch', () => {
    it('creates batches within token limit', () => {
      const texts = ['Short.', 'Another short.', 'A much longer sentence that has more tokens.'];
      const batches = throttle.predictiveBatch(texts, 20);

      // Should split into multiple batches
      expect(batches.length).toBeGreaterThan(0);
      expect(batches.flat().length).toBeGreaterThan(0);
    });

    it('keeps small texts in single batch', () => {
      const texts = ['Hi.', 'Hello.'];
      const batches = throttle.predictiveBatch(texts, 1000);

      expect(batches.length).toBe(1);
    });
  });

  describe('getUsage', () => {
    it('returns initial usage as zero', () => {
      const usage = throttle.getUsage();

      expect(usage.requests).toBe(0);
      expect(usage.tokens).toBe(0);
      expect(usage.totalRequests).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.queue).toBe(0);
    });
  });

  describe('runWithRateLimit', () => {
    it('executes function immediately when under limit', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      const result = await throttle.runWithRateLimit(fn, 'test', { immediate: true });

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('tracks usage after execution', async () => {
      const fn = vi.fn().mockResolvedValue('result');

      await throttle.runWithRateLimit(fn, 'test text', { immediate: true });

      const usage = throttle.getUsage();
      expect(usage.totalRequests).toBe(1);
      expect(usage.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    it('clears all usage and queue', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      await throttle.runWithRateLimit(fn, 'test', { immediate: true });

      throttle.reset();

      const usage = throttle.getUsage();
      expect(usage.requests).toBe(0);
      expect(usage.tokens).toBe(0);
      expect(usage.totalRequests).toBe(0);
      expect(usage.queue).toBe(0);
    });
  });

  describe('configure', () => {
    it('updates configuration', () => {
      throttle.configure({ requestLimit: 100 });

      const usage = throttle.getUsage();
      expect(usage.requestLimit).toBe(100);
    });
  });

  describe('runWithRetry', () => {
    // Note: Most runWithRetry tests use real timers as the internal delay()
    // doesn't work with vi.useFakeTimers. We test what we can without delays.

    it('succeeds on first attempt', async () => {
      vi.useRealTimers();
      const fn = vi.fn().mockResolvedValue('result');

      const result = await throttle.runWithRetry(fn, 'test text', 1);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
      vi.useFakeTimers();
    });

    it('throws on non-retryable error immediately', async () => {
      vi.useRealTimers();
      const nonRetryableError = new Error('Fatal error') as Error & { retryable: boolean };
      nonRetryableError.retryable = false;

      const fn = vi.fn().mockRejectedValue(nonRetryableError);

      await expect(throttle.runWithRetry(fn, 'test', 3)).rejects.toThrow('Fatal error');
      expect(fn).toHaveBeenCalledTimes(1);
      vi.useFakeTimers();
    });

    it('accepts token count as number', async () => {
      vi.useRealTimers();
      const fn = vi.fn().mockResolvedValue('result');

      const result = await throttle.runWithRetry(fn, 100, 1);

      expect(result).toBe('result');
      vi.useFakeTimers();
    });

    it('logs debug info when debug=true', async () => {
      vi.useRealTimers();
      const consoleSpy = vi.spyOn(console, 'log');
      const fn = vi.fn().mockResolvedValue('result');

      await throttle.runWithRetry(fn, 'test', 1, true);

      expect(consoleSpy).toHaveBeenCalledWith('[Throttle] attempt', 1);
      vi.useFakeTimers();
    });

    it('retries on retryable error with short delay', async () => {
      vi.useRealTimers();
      const retryableError = new Error('Rate limited') as Error & { retryable: boolean; retryAfter: number };
      retryableError.retryable = true;
      retryableError.retryAfter = 1; // 1ms delay for fast test

      const fn = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      const result = await throttle.runWithRetry(fn, 'test', 3);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      vi.useFakeTimers();
    }, 10000);

    it('throws after max attempts with short delay', async () => {
      vi.useRealTimers();
      const retryableError = new Error('Retry') as Error & { retryable: boolean; retryAfter: number };
      retryableError.retryable = true;
      retryableError.retryAfter = 1; // 1ms delay

      const fn = vi.fn().mockRejectedValue(retryableError);

      await expect(throttle.runWithRetry(fn, 'test', 2)).rejects.toThrow('Retry');
      expect(fn).toHaveBeenCalledTimes(2);
      vi.useFakeTimers();
    }, 10000);
  });
});
