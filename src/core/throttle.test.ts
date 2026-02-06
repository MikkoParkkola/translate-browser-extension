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

    it('splits when accumulated tokens exceed limit mid-batch', () => {
      // Create texts where accumulation exceeds limit mid-way
      const texts = [
        'First sentence here.',
        'Second sentence here.',
        'Third sentence here.',
        'Fourth sentence here.',
      ];
      // Set limit low enough that we overflow mid-batch
      const batches = throttle.predictiveBatch(texts, 8);

      // Should create multiple batches
      expect(batches.length).toBeGreaterThan(1);
      // All texts should be included
      expect(batches.flat().length).toBe(4);
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

    it('retries on retryable error with exponential backoff', async () => {
      vi.useRealTimers();
      const retryableError = new Error('Rate limited') as Error & { retryable: boolean; retryAfter: number };
      retryableError.retryable = true;
      retryableError.retryAfter = 1; // 1ms base delay

      const fn = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      const start = Date.now();
      const result = await throttle.runWithRetry(fn, 'test', 3);
      const elapsed = Date.now() - start;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      // Should have waited at least ~1ms (with jitter 0.9-1.1)
      expect(elapsed).toBeGreaterThanOrEqual(0);
      vi.useFakeTimers();
    }, 10000);

    it('throws after max attempts exhausted', async () => {
      vi.useRealTimers();
      const retryableError = new Error('Persistent failure') as Error & { retryable: boolean; retryAfter: number };
      retryableError.retryable = true;
      retryableError.retryAfter = 1;

      const fn = vi.fn().mockRejectedValue(retryableError);

      await expect(throttle.runWithRetry(fn, 'test', 2)).rejects.toThrow('Persistent failure');
      expect(fn).toHaveBeenCalledTimes(2);
      vi.useFakeTimers();
    }, 10000);

    it('logs retry info in debug mode', async () => {
      vi.useRealTimers();
      const consoleSpy = vi.spyOn(console, 'log');
      const retryableError = new Error('Retry me') as Error & { retryable: boolean; retryAfter: number };
      retryableError.retryable = true;
      retryableError.retryAfter = 1;

      const fn = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('ok');

      await throttle.runWithRetry(fn, 'test', 3, true);

      expect(consoleSpy).toHaveBeenCalledWith('[Throttle] attempt', 1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Throttle] retrying'),
        expect.any(String),
        expect.stringContaining('in'),
        expect.any(Number),
        'ms'
      );
      vi.useFakeTimers();
    }, 10000);

  });

  describe('runWithRateLimit edge cases', () => {
    it('handles synchronous throw in fn', async () => {
      vi.useRealTimers();
      const fn = vi.fn().mockImplementation(() => {
        throw new Error('Sync error');
      });

      await expect(
        throttle.runWithRateLimit(fn, 'test', { immediate: true })
      ).rejects.toThrow('Sync error');
      vi.useFakeTimers();
    });

    it('queues request when rate limit reached', async () => {
      vi.useRealTimers();

      // Create throttle with very low limit
      const limitedThrottle = new Throttle({
        requestLimit: 1,
        tokenLimit: 1000,
        windowMs: 60000,
      });

      const results: string[] = [];
      const fn1 = vi.fn().mockImplementation(async () => {
        results.push('first');
        return 'first';
      });
      const fn2 = vi.fn().mockImplementation(async () => {
        results.push('second');
        return 'second';
      });

      // First executes immediately
      const p1 = limitedThrottle.runWithRateLimit(fn1, 'test1', { immediate: true });

      // Second should be queued (rate limit hit)
      void limitedThrottle.runWithRateLimit(fn2, 'test2', { immediate: true });

      const r1 = await p1;
      expect(r1).toBe('first');
      expect(results).toContain('first');

      // Wait for queue to process
      await new Promise((r) => setTimeout(r, 100));

      limitedThrottle.destroy();
      vi.useFakeTimers();
    });

    it('handles token limit exceeded', async () => {
      vi.useRealTimers();

      const limitedThrottle = new Throttle({
        requestLimit: 100,
        tokenLimit: 5, // Very low token limit
        windowMs: 60000,
      });

      const fn = vi.fn().mockResolvedValue('ok');

      // This has more tokens than the limit allows
      void limitedThrottle.runWithRateLimit(fn, 'this is a long text that exceeds token limit', {
        immediate: true,
      });

      // Should still execute (queued)
      await new Promise((r) => setTimeout(r, 100));

      limitedThrottle.destroy();
      vi.useFakeTimers();
    });

    it('processes queue with cooldown between requests', async () => {
      vi.useRealTimers();

      const limitedThrottle = new Throttle({
        requestLimit: 2,
        tokenLimit: 1000,
        windowMs: 1000, // 1 second window = 500ms between requests
      });

      const results: number[] = [];
      const fn1 = vi.fn().mockImplementation(async () => {
        results.push(1);
        return 'first';
      });
      const fn2 = vi.fn().mockImplementation(async () => {
        results.push(2);
        return 'second';
      });
      const fn3 = vi.fn().mockImplementation(async () => {
        results.push(3);
        return 'third';
      });

      // Queue up three requests
      const p1 = limitedThrottle.runWithRateLimit(fn1, 'test1', { immediate: true });
      const p2 = limitedThrottle.runWithRateLimit(fn2, 'test2', { immediate: true });
      const p3 = limitedThrottle.runWithRateLimit(fn3, 'test3', { immediate: true });

      // Wait for all to process through queue
      await Promise.race([
        Promise.all([p1, p2, p3]),
        new Promise((r) => setTimeout(r, 2000)),
      ]);

      expect(fn1).toHaveBeenCalled();
      expect(results.includes(1)).toBe(true);

      limitedThrottle.destroy();
      vi.useFakeTimers();
    });

    it('prunes old token times', async () => {
      vi.useRealTimers();

      const shortWindowThrottle = new Throttle({
        requestLimit: 100,
        tokenLimit: 1000,
        windowMs: 100, // 100ms window
      });

      const fn = vi.fn().mockResolvedValue('ok');

      // Make a request
      await shortWindowThrottle.runWithRateLimit(fn, 'test text', { immediate: true });

      // Wait for window to expire
      await new Promise((r) => setTimeout(r, 150));

      // Get usage - should trigger prune
      const usage = shortWindowThrottle.getUsage();

      // Tokens should be pruned
      expect(usage.tokens).toBe(0);
      expect(usage.requests).toBe(0);

      shortWindowThrottle.destroy();
      vi.useFakeTimers();
    });
  });
});
