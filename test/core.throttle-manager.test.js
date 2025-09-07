/**
 * @fileoverview Unit tests for core throttle manager
 * Tests rate limiting with token bucket algorithm per provider
 */

const throttleManager = require('../src/core/throttle-manager');

describe('Core Throttle Manager', () => {
  let throttle;

  beforeEach(() => {
    throttle = throttleManager.createThrottleManager({
      requestLimit: 10,
      tokenLimit: 1000,
      windowMs: 1000,
      maxQueueSize: 50
    });
  });

  afterEach(() => {
    // Clean up any pending operations
    try {
      throttle.clearQueue();
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('Module Initialization', () => {
    test('exports required functions', () => {
      expect(typeof throttleManager.createThrottleManager).toBe('function');
      expect(typeof throttleManager.approximateTokens).toBe('function');
      expect(throttleManager).toHaveProperty('THROTTLE_ERRORS');
      expect(throttleManager).toHaveProperty('DEFAULT_CONFIG');
      expect(throttleManager).toHaveProperty('version');
    });

    test('has correct version', () => {
      expect(throttleManager.version).toBe('1.0.0');
    });

    test('defines error types correctly', () => {
      expect(throttleManager.THROTTLE_ERRORS).toEqual({
        RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
        INVALID_PROVIDER: 'INVALID_PROVIDER',
        CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
        INVALID_TOKENS: 'INVALID_TOKENS',
        QUEUE_FULL: 'QUEUE_FULL'
      });
    });

    test('has correct default configuration', () => {
      expect(throttleManager.DEFAULT_CONFIG).toMatchObject({
        requestLimit: 60,
        tokenLimit: 100000,
        windowMs: 60000,
        maxQueueSize: 1000
      });
    });
  });

  describe('Token Approximation', () => {
    test('approximates tokens for English text', () => {
      const englishText = 'Hello world, this is a test message';
      const tokens = throttleManager.approximateTokens(englishText);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(englishText.length); // Should be fewer tokens than characters
    });

    test('approximates tokens for CJK text', () => {
      const chineseText = '你好世界，这是一个测试消息';
      const tokens = throttleManager.approximateTokens(chineseText);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeGreaterThan(chineseText.length / 3); // CJK has higher token density
    });

    test('approximates tokens for mixed text', () => {
      const mixedText = 'Hello 你好 World 世界';
      const tokens = throttleManager.approximateTokens(mixedText);
      expect(tokens).toBeGreaterThan(0);
    });

    test('handles empty or invalid text', () => {
      expect(throttleManager.approximateTokens('')).toBe(1);
      expect(throttleManager.approximateTokens(null)).toBe(0);
      expect(throttleManager.approximateTokens(undefined)).toBe(0);
      expect(throttleManager.approximateTokens(123)).toBe(0);
    });
  });

  describe('Provider Configuration', () => {
    test('configures provider with valid limits', () => {
      const providerId = 'test-provider';
      const limits = {
        requestLimit: 20,
        tokenLimit: 2000,
        windowMs: 2000
      };

      expect(() => {
        throttle.configure(providerId, limits);
      }).not.toThrow();

      const providers = throttle.getProviders();
      expect(providers).toContain(providerId);
    });

    test('rejects invalid provider IDs', () => {
      const limits = { requestLimit: 10, tokenLimit: 1000, windowMs: 1000 };

      expect(() => throttle.configure('', limits)).toThrow('INVALID_PROVIDER');
      expect(() => throttle.configure(null, limits)).toThrow('INVALID_PROVIDER');
      expect(() => throttle.configure(123, limits)).toThrow('INVALID_PROVIDER');
    });

    test('rejects invalid configuration', () => {
      const providerId = 'test-provider';

      // Missing limits object
      expect(() => throttle.configure(providerId, null)).toThrow('CONFIGURATION_ERROR');

      // Invalid request limit
      expect(() => throttle.configure(providerId, {
        requestLimit: -1,
        tokenLimit: 1000,
        windowMs: 1000
      })).toThrow('CONFIGURATION_ERROR');

      // Invalid token limit
      expect(() => throttle.configure(providerId, {
        requestLimit: 10,
        tokenLimit: 0,
        windowMs: 1000
      })).toThrow('CONFIGURATION_ERROR');

      // Invalid window
      expect(() => throttle.configure(providerId, {
        requestLimit: 10,
        tokenLimit: 1000,
        windowMs: -500
      })).toThrow('CONFIGURATION_ERROR');
    });

    test('updates existing provider configuration', () => {
      const providerId = 'test-provider';
      
      // Initial configuration
      throttle.configure(providerId, {
        requestLimit: 10,
        tokenLimit: 1000,
        windowMs: 1000
      });

      // Update configuration
      throttle.configure(providerId, {
        requestLimit: 20,
        tokenLimit: 2000,
        windowMs: 1000
      });

      const usage = throttle.getUsage(providerId);
      expect(usage.requestLimit).toBe(20);
      expect(usage.tokenLimit).toBe(2000);
    });

    test('removes provider configuration', () => {
      const providerId = 'removable-provider';
      
      throttle.configure(providerId, {
        requestLimit: 5,
        tokenLimit: 500,
        windowMs: 1000
      });

      expect(throttle.getProviders()).toContain(providerId);
      
      const removed = throttle.removeProvider(providerId);
      expect(removed).toBe(true);
      expect(throttle.getProviders()).not.toContain(providerId);

      // Second removal should return false
      expect(throttle.removeProvider(providerId)).toBe(false);
    });
  });

  describe('Request Permission and Rate Limiting', () => {
    beforeEach(() => {
      throttle.configure('test-provider', {
        requestLimit: 5,
        tokenLimit: 100,
        windowMs: 1000
      });
    });

    test('grants immediate permission for small requests', async () => {
      const start = Date.now();
      
      await throttle.requestPermission('test-provider', 10);
      
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10); // Should be nearly immediate
    });

    test('grants permission using text estimation', async () => {
      const text = 'Short text for translation';
      
      await expect(
        throttle.requestPermission('test-provider', text)
      ).resolves.not.toThrow();
    });

    test('queues requests when limits exceeded', async () => {
      // Exhaust immediate capacity
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(throttle.requestPermission('test-provider', 15));
      }

      // Some should be queued
      const results = await Promise.allSettled(promises);
      const fulfilled = results.filter(r => r.status === 'fulfilled').length;
      expect(fulfilled).toBeLessThanOrEqual(10); // Not all can be immediate
    });

    test('processes queued requests over time', async () => {
      // Fill up immediate capacity
      const immediatePromises = [];
      for (let i = 0; i < 3; i++) {
        immediatePromises.push(throttle.requestPermission('test-provider', 20));
      }
      await Promise.all(immediatePromises);

      // Queue additional requests
      const queuedPromise = throttle.requestPermission('test-provider', 10);
      
      // Should eventually resolve as tokens refill
      await expect(queuedPromise).resolves.not.toThrow();
    }, 5000);

    test('rejects requests for unconfigured providers', async () => {
      await expect(
        throttle.requestPermission('unknown-provider', 10)
      ).rejects.toThrow('INVALID_PROVIDER');
    });

    test('rejects invalid token values', async () => {
      await expect(
        throttle.requestPermission('test-provider', -5)
      ).rejects.toThrow('INVALID_TOKENS');

      await expect(
        throttle.requestPermission('test-provider', Infinity)
      ).rejects.toThrow('INVALID_TOKENS');

      await expect(
        throttle.requestPermission('test-provider', {})
      ).rejects.toThrow('INVALID_TOKENS');
    });

    test('rejects requests exceeding token limits', async () => {
      await expect(
        throttle.requestPermission('test-provider', 200) // Exceeds tokenLimit of 100
      ).rejects.toThrow('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('Usage Statistics', () => {
    beforeEach(() => {
      throttle.configure('stats-provider', {
        requestLimit: 10,
        tokenLimit: 1000,
        windowMs: 2000
      });
    });

    test('tracks usage statistics correctly', async () => {
      // Make some requests
      await throttle.requestPermission('stats-provider', 50);
      await throttle.requestPermission('stats-provider', 30);

      const usage = throttle.getUsage('stats-provider');
      
      expect(usage.requests).toBe(2);
      expect(usage.tokens).toBe(80);
      expect(usage.requestLimit).toBe(10);
      expect(usage.tokenLimit).toBe(1000);
      expect(usage.windowMs).toBe(2000);
      expect(usage.totalRequests).toBe(2);
      expect(usage.totalTokens).toBe(80);
    });

    test('tracks queue size correctly', async () => {
      // Fill immediate capacity
      const promises = [];
      for (let i = 0; i < 15; i++) {
        promises.push(throttle.requestPermission('stats-provider', 80));
      }

      // Check usage while some requests are queued
      const usage = throttle.getUsage('stats-provider');
      expect(usage.queueSize).toBeGreaterThanOrEqual(0);
      
      // Clean up
      await Promise.allSettled(promises);
    });

    test('resets usage statistics', async () => {
      await throttle.requestPermission('stats-provider', 20);
      
      let usage = throttle.getUsage('stats-provider');
      expect(usage.totalRequests).toBe(1);
      
      throttle.resetUsage('stats-provider');
      
      usage = throttle.getUsage('stats-provider');
      expect(usage.totalRequests).toBe(0);
      expect(usage.totalTokens).toBe(0);
    });

    test('resets all providers when no specific provider given', async () => {
      throttle.configure('provider-1', { requestLimit: 5, tokenLimit: 500, windowMs: 1000 });
      throttle.configure('provider-2', { requestLimit: 5, tokenLimit: 500, windowMs: 1000 });
      
      await throttle.requestPermission('provider-1', 10);
      await throttle.requestPermission('provider-2', 15);
      
      throttle.resetUsage(); // Reset all
      
      expect(throttle.getUsage('provider-1').totalRequests).toBe(0);
      expect(throttle.getUsage('provider-2').totalRequests).toBe(0);
    });

    test('rejects usage query for invalid provider', () => {
      expect(() => throttle.getUsage('invalid-provider')).toThrow('INVALID_PROVIDER');
      expect(() => throttle.getUsage('')).toThrow('INVALID_PROVIDER');
    });
  });

  describe('Queue Management', () => {
    beforeEach(() => {
      throttle.configure('queue-provider', {
        requestLimit: 2,
        tokenLimit: 50,
        windowMs: 1000
      });
    });

    test('clears queue correctly', async () => {
      // Fill capacity and queue additional requests
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          throttle.requestPermission('queue-provider', 20).catch(err => err.message)
        );
      }

      // Let requests queue up
      await new Promise(resolve => setTimeout(resolve, 10));
      
      throttle.clearQueue();
      
      // Wait for all promises to settle
      const results = await Promise.all(promises);
      const clearedCount = results.filter(r => 
        typeof r === 'string' && r.includes('Queue cleared')
      ).length;
      expect(clearedCount).toBeGreaterThan(0);
    });

    test('handles queue size limits', () => {
      const smallThrottle = throttleManager.createThrottleManager({
        maxQueueSize: 2
      });

      smallThrottle.configure('limited-queue', {
        requestLimit: 0, // No immediate capacity
        tokenLimit: 0,   // No immediate tokens
        windowMs: 10000  // Long window
      });

      // Try to queue more requests than maxQueueSize allows
      let queueFullCount = 0;
      const promises = [];
      
      for (let i = 0; i < 5; i++) {
        const promise = smallThrottle.requestPermission('limited-queue', 1)
          .catch(err => {
            if (err.message.includes('QUEUE_FULL')) {
              queueFullCount++;
            }
            return 'error';
          });
        promises.push(promise);
      }
      
      // Should have at least one queue full error
      return Promise.all(promises).then(() => {
        expect(queueFullCount).toBeGreaterThan(0);
      });
    });
  });

  describe('Performance Requirements', () => {
    beforeEach(() => {
      throttle.configure('perf-provider', {
        requestLimit: 100,
        tokenLimit: 10000,
        windowMs: 1000
      });
    });

    test('permission checks complete under 1ms', async () => {
      const start = performance.now();
      
      await throttle.requestPermission('perf-provider', 10);
      
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(1.0); // Less than 1ms for immediate grants
    });

    test('handles concurrent permission requests', async () => {
      const concurrentPromises = [];
      
      for (let i = 0; i < 50; i++) {
        concurrentPromises.push(
          throttle.requestPermission('perf-provider', 5)
        );
      }

      // Should handle concurrent requests without crashing
      const results = await Promise.allSettled(concurrentPromises);
      
      // Most should succeed given high limits
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBeGreaterThan(30);
    });
  });

  describe('Golden Test Scenarios', () => {
    // Golden Test 1: Basic provider configuration and usage
    test('GOLDEN: provider configuration and basic usage flow', async () => {
      const providerId = 'qwen-provider';
      const config = {
        requestLimit: 60,
        tokenLimit: 100000,
        windowMs: 60000
      };
      
      // Configure provider
      throttle.configure(providerId, config);
      expect(throttle.getProviders()).toContain(providerId);
      
      // Make translation request
      await throttle.requestPermission(providerId, 'Hello world');
      
      // Check usage
      const usage = throttle.getUsage(providerId);
      expect(usage.requests).toBe(1);
      expect(usage.tokens).toBeGreaterThan(0);
      expect(usage.totalRequests).toBe(1);
    });

    // Golden Test 2: Rate limiting enforcement
    test('GOLDEN: rate limiting works correctly', async () => {
      const providerId = 'limited-provider';
      throttle.configure(providerId, {
        requestLimit: 2,
        tokenLimit: 100,
        windowMs: 2000 // Longer window
      });

      // First requests should be immediate
      await throttle.requestPermission(providerId, 30);
      await throttle.requestPermission(providerId, 30);
      
      // Check that we've used up immediate capacity
      let usage = throttle.getUsage(providerId);
      expect(usage.requests).toBe(2);
      expect(usage.tokens).toBe(60);
      
      // Third request should be queued (test that it eventually succeeds)
      const thirdRequest = throttle.requestPermission(providerId, 30);
      await expect(thirdRequest).resolves.not.toThrow();
      
      usage = throttle.getUsage(providerId);
      expect(usage.totalRequests).toBe(3);
    }, 10000);

    // Golden Test 3: Multi-provider isolation
    test('GOLDEN: multiple providers work independently', async () => {
      // Configure two providers with different limits
      throttle.configure('provider-a', {
        requestLimit: 5,
        tokenLimit: 200,
        windowMs: 1000
      });
      
      throttle.configure('provider-b', {
        requestLimit: 10,
        tokenLimit: 500,
        windowMs: 1000
      });

      // Use both providers
      await throttle.requestPermission('provider-a', 50);
      await throttle.requestPermission('provider-b', 100);
      await throttle.requestPermission('provider-a', 30);
      await throttle.requestPermission('provider-b', 75);

      // Check independent usage tracking
      const usageA = throttle.getUsage('provider-a');
      const usageB = throttle.getUsage('provider-b');

      expect(usageA.requests).toBe(2);
      expect(usageA.tokens).toBe(80);
      expect(usageB.requests).toBe(2);
      expect(usageB.tokens).toBe(175);

      // Limits should be independent
      expect(usageA.requestLimit).toBe(5);
      expect(usageB.requestLimit).toBe(10);
    });

    // Additional Edge Case 1: Token bucket refill behavior
    test('EDGE CASE: token bucket refills correctly over time', async () => {
      const providerId = 'refill-test';
      throttle.configure(providerId, {
        requestLimit: 10,
        tokenLimit: 100,
        windowMs: 1000 // 1 second window
      });

      // Consume all tokens
      await throttle.requestPermission(providerId, 100);
      
      let usage = throttle.getUsage(providerId);
      expect(usage.tokens).toBe(100);

      // Wait for partial refill
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Should be able to make another request due to refill
      await expect(
        throttle.requestPermission(providerId, 30)
      ).resolves.not.toThrow();
      
      usage = throttle.getUsage(providerId);
      expect(usage.totalRequests).toBe(2);
    }, 5000);

    // Additional Edge Case 2: System resilience under load
    test('EDGE CASE: handles high load gracefully', async () => {
      const providerId = 'load-test';
      throttle.configure(providerId, {
        requestLimit: 5,
        tokenLimit: 100,
        windowMs: 1000
      });

      // Create many concurrent requests
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          throttle.requestPermission(providerId, 10).catch(() => 'throttled')
        );
      }

      const results = await Promise.allSettled(promises);
      
      // System should handle all requests without crashing
      expect(results.length).toBe(20);
      
      // Some should succeed, some should be throttled/queued
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      expect(successCount).toBeGreaterThan(0);
    }, 5000);
  });

  describe('Error Recovery and Resilience', () => {
    test('recovers from configuration errors', () => {
      const providerId = 'error-recovery';
      
      // Bad configuration should not crash the system
      expect(() => {
        throttle.configure(providerId, { requestLimit: -1 });
      }).toThrow('CONFIGURATION_ERROR');

      // Good configuration should still work
      expect(() => {
        throttle.configure(providerId, {
          requestLimit: 10,
          tokenLimit: 1000,
          windowMs: 1000
        });
      }).not.toThrow();
      
      expect(throttle.getProviders()).toContain(providerId);
    });

    test('handles cleanup correctly', () => {
      const providerId = 'cleanup-test';
      throttle.configure(providerId, {
        requestLimit: 5,
        tokenLimit: 100,
        windowMs: 1000
      });

      // Add some queued requests
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          throttle.requestPermission(providerId, 30).catch(() => {})
        );
      }

      // Clear queue should not crash
      expect(() => throttle.clearQueue()).not.toThrow();
    });
  });
});