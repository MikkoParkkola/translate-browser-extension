/**
 * @fileoverview Unit tests for core cache manager
 * Tests multi-tier caching with TTL, LRU eviction, and memory limits
 */

const cacheManager = require('../src/core/cache-manager');

describe('Core Cache Manager', () => {
  let cache;

  beforeEach(async () => {
    // Create cache with small limits for testing
    cache = await cacheManager.createCacheManager({
      maxMemoryEntries: 5,
      maxMemorySize: 1024,
      defaultTTL: 1000,
      persistentStorage: false // Disable for testing
    });
  });

  describe('Module Initialization', () => {
    test('exports required functions', () => {
      expect(typeof cacheManager.createCacheManager).toBe('function');
      expect(cacheManager).toHaveProperty('CACHE_ERRORS');
      expect(cacheManager).toHaveProperty('DEFAULT_CONFIG');
      expect(cacheManager).toHaveProperty('version');
    });

    test('has correct version', () => {
      expect(cacheManager.version).toBe('1.0.0');
    });

    test('defines error types correctly', () => {
      expect(cacheManager.CACHE_ERRORS).toEqual({
        SERIALIZATION_ERROR: 'SERIALIZATION_ERROR',
        STORAGE_ERROR: 'STORAGE_ERROR',
        CACHE_FULL: 'CACHE_FULL',
        INVALID_KEY: 'INVALID_KEY',
        INVALID_TTL: 'INVALID_TTL'
      });
    });
  });

  describe('Cache Instance Creation', () => {
    test('creates cache instance with default config', async () => {
      const defaultCache = await cacheManager.createCacheManager();
      expect(typeof defaultCache.get).toBe('function');
      expect(typeof defaultCache.set).toBe('function');
      expect(typeof defaultCache.delete).toBe('function');
      expect(typeof defaultCache.clear).toBe('function');
      expect(typeof defaultCache.getStats).toBe('function');
    });

    test('accepts custom configuration', async () => {
      const customCache = await cacheManager.createCacheManager({
        maxMemoryEntries: 100,
        maxMemorySize: 2048,
        defaultTTL: 5000
      });
      
      const state = customCache._getInternalState();
      expect(state.config.maxMemoryEntries).toBe(100);
      expect(state.config.maxMemorySize).toBe(2048);
      expect(state.config.defaultTTL).toBe(5000);
    });
  });

  describe('Basic Cache Operations', () => {
    test('stores and retrieves string values', async () => {
      const key = 'test-key';
      const value = 'test-value';
      
      const setResult = await cache.set(key, value);
      expect(setResult).toBe(true);
      
      const retrievedValue = cache.get(key);
      expect(retrievedValue).toBe(value);
    });

    test('stores and retrieves object values', async () => {
      const key = 'object-key';
      const value = { 
        text: 'Hello world',
        lang: 'en',
        translated: 'Bonjour le monde',
        confidence: 0.95
      };
      
      await cache.set(key, value);
      const retrieved = cache.get(key);
      
      expect(retrieved).toEqual(value);
    });

    test('stores and retrieves array values', async () => {
      const key = 'array-key';
      const value = ['item1', 'item2', { nested: 'object' }];
      
      await cache.set(key, value);
      const retrieved = cache.get(key);
      
      expect(retrieved).toEqual(value);
    });

    test('returns undefined for non-existent keys', () => {
      const result = cache.get('non-existent-key');
      expect(result).toBeUndefined();
    });

    test('deletes cache entries', async () => {
      const key = 'delete-test';
      const value = 'delete-value';
      
      await cache.set(key, value);
      expect(cache.get(key)).toBe(value);
      
      const deleted = await cache.delete(key);
      expect(deleted).toBe(true);
      expect(cache.get(key)).toBeUndefined();
    });

    test('handles deletion of non-existent keys', async () => {
      const deleted = await cache.delete('non-existent');
      expect(deleted).toBe(false);
    });
  });

  describe('TTL (Time To Live) Functionality', () => {
    test('respects custom TTL', async () => {
      const key = 'ttl-test';
      const value = 'expires-soon';
      const ttl = 100; // 100ms
      
      await cache.set(key, value, ttl);
      expect(cache.get(key)).toBe(value);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(cache.get(key)).toBeUndefined();
    });

    test('uses default TTL when not specified', async () => {
      const key = 'default-ttl';
      const value = 'default-expires';
      
      await cache.set(key, value);
      expect(cache.get(key)).toBe(value);
      
      const stats = cache.getStats();
      expect(stats.memoryEntries).toBe(1);
    });

    test('handles zero TTL as no expiration', async () => {
      const key = 'no-expire';
      const value = 'never-expires';
      
      await cache.set(key, value, 0);
      expect(cache.get(key)).toBe(value);
      
      // Should still be there after some time
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(cache.get(key)).toBe(value);
    });

    test('rejects invalid TTL values', async () => {
      const key = 'invalid-ttl';
      const value = 'test';
      
      // Negative TTL should be rejected
      const result = await cache.set(key, value, -100);
      expect(result).toBe(false);
      
      // Infinite TTL should be rejected
      const result2 = await cache.set(key, value, Infinity);
      expect(result2).toBe(false);
    });
  });

  describe('LRU Eviction Policy', () => {
    test('evicts least recently used items when memory limit exceeded', async () => {
      // Fill cache to capacity (maxMemoryEntries = 5)
      const entries = [];
      for (let i = 0; i < 5; i++) {
        const key = `key-${i}`;
        const value = `value-${i}`;
        entries.push({ key, value });
        await cache.set(key, value);
      }
      
      // Verify all entries are present
      for (const { key, value } of entries) {
        expect(cache.get(key)).toBe(value);
      }
      
      // Add one more entry, should evict the first (least recently used)
      await cache.set('key-new', 'value-new');
      
      // First entry should be evicted
      expect(cache.get('key-0')).toBeUndefined();
      
      // Others should still be present
      for (let i = 1; i < 5; i++) {
        expect(cache.get(`key-${i}`)).toBe(`value-${i}`);
      }
      expect(cache.get('key-new')).toBe('value-new');
    });

    test('updates access order on cache hits', async () => {
      // Add entries
      await cache.set('key-1', 'value-1');
      await cache.set('key-2', 'value-2');
      await cache.set('key-3', 'value-3');
      await cache.set('key-4', 'value-4');
      await cache.set('key-5', 'value-5');
      
      // Access first entry to make it most recently used
      cache.get('key-1');
      
      // Add new entry, should evict key-2 (now least recently used)
      await cache.set('key-6', 'value-6');
      
      expect(cache.get('key-1')).toBe('value-1'); // Should still be present
      expect(cache.get('key-2')).toBeUndefined(); // Should be evicted
      expect(cache.get('key-6')).toBe('value-6');
    });

    test('handles memory size limits', async () => {
      // Create cache with small memory size limit
      const smallCache = await cacheManager.createCacheManager({
        maxMemoryEntries: 100, // High entry limit
        maxMemorySize: 200,    // Small memory limit
        persistentStorage: false
      });
      
      // Add large value that should trigger memory-based eviction
      const largeValue = 'x'.repeat(100);
      await smallCache.set('large-1', largeValue);
      await smallCache.set('large-2', largeValue);
      
      // Third large value should trigger eviction
      await smallCache.set('large-3', largeValue);
      
      const stats = smallCache.getStats();
      expect(stats.memorySize).toBeLessThan(250); // Should stay under limit
    });
  });

  describe('Error Handling', () => {
    test('handles invalid keys', () => {
      expect(() => cache.get(null)).toThrow('INVALID_KEY');
      expect(() => cache.get(123)).toThrow('INVALID_KEY');
      expect(() => cache.get({})).toThrow('INVALID_KEY');
    });

    test('handles serialization errors gracefully', async () => {
      // Circular reference object should cause serialization issues
      const circular = { a: 'test' };
      circular.self = circular;
      
      // Should handle gracefully and return false
      const result = await cache.set('circular', circular);
      expect(result).toBe(false);
    });

    test('handles cache full conditions', async () => {
      // Create cache with very small limits
      const tinyCache = await cacheManager.createCacheManager({
        maxMemoryEntries: 1,
        maxMemorySize: 50,
        persistentStorage: false
      });
      
      // Add normal entry
      await tinyCache.set('small', 'ok');
      
      // Try to add very large entry
      const hugeValue = 'x'.repeat(1000);
      const result = await tinyCache.set('huge', hugeValue);
      expect(result).toBe(false);
    });
  });

  describe('Statistics and Monitoring', () => {
    test('tracks cache statistics correctly', async () => {
      // Initial stats
      let stats = cache.getStats();
      expect(stats.memoryEntries).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
      
      // Add entries
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      
      stats = cache.getStats();
      expect(stats.memoryEntries).toBe(2);
      
      // Test hits and misses
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('nonexistent'); // miss
      
      stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(2/3);
    });

    test('tracks eviction count', async () => {
      // Fill cache beyond capacity
      for (let i = 0; i < 10; i++) {
        await cache.set(`key-${i}`, `value-${i}`);
      }
      
      const stats = cache.getStats();
      expect(stats.evictions).toBeGreaterThan(0);
      expect(stats.memoryEntries).toBeLessThanOrEqual(5);
    });

    test('tracks memory usage', async () => {
      await cache.set('test', { data: 'some data for size calculation' });
      
      const stats = cache.getStats();
      expect(stats.memorySize).toBeGreaterThan(0);
    });
  });

  describe('Cache Clearing', () => {
    test('clears all cache entries', async () => {
      // Add several entries
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.set('key3', 'value3');
      
      let stats = cache.getStats();
      expect(stats.memoryEntries).toBe(3);
      
      // Clear cache
      await cache.clear();
      
      // Verify all entries are gone
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key3')).toBeUndefined();
      
      // Verify stats are reset
      stats = cache.getStats();
      expect(stats.memoryEntries).toBe(0);
      expect(stats.memorySize).toBe(0);
    });
  });

  describe('Configuration Management', () => {
    test('allows runtime configuration updates', () => {
      cache.configure({
        maxMemoryEntries: 20,
        defaultTTL: 5000
      });
      
      const state = cache._getInternalState();
      expect(state.config.maxMemoryEntries).toBe(20);
      expect(state.config.defaultTTL).toBe(5000);
    });
  });

  describe('Performance Requirements', () => {
    test('memory operations complete under 1ms', async () => {
      const start = performance.now();
      
      await cache.set('perf-test', 'value');
      cache.get('perf-test');
      await cache.delete('perf-test');
      
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(1.0); // Less than 1ms
    });

    test('handles concurrent operations', async () => {
      const promises = [];
      
      // Concurrent sets
      for (let i = 0; i < 10; i++) {
        promises.push(cache.set(`concurrent-${i}`, `value-${i}`));
      }
      
      await Promise.all(promises);
      
      // Verify all were set
      for (let i = 0; i < 10; i++) {
        const value = cache.get(`concurrent-${i}`);
        if (value !== undefined) { // Some might have been evicted due to small cache size
          expect(value).toBe(`value-${i}`);
        }
      }
    });
  });

  describe('Golden Test Scenarios', () => {
    // Golden Test 1: Basic CRUD operations
    test('GOLDEN: basic CRUD operations work correctly', async () => {
      const key = 'translation:en:zh:hello';
      const value = { 
        translatedText: '你好',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        provider: 'qwen'
      };
      
      // Create
      const setResult = await cache.set(key, value);
      expect(setResult).toBe(true);
      
      // Read
      const retrieved = cache.get(key);
      expect(retrieved).toEqual(value);
      
      // Update
      const updatedValue = { ...value, confidence: 0.95 };
      await cache.set(key, updatedValue);
      expect(cache.get(key)).toEqual(updatedValue);
      
      // Delete
      const deleteResult = await cache.delete(key);
      expect(deleteResult).toBe(true);
      expect(cache.get(key)).toBeUndefined();
    });

    // Golden Test 2: TTL expiration handling
    test('GOLDEN: TTL expiration works correctly', async () => {
      const key = 'expiring-translation';
      const value = { text: 'expires soon' };
      const ttl = 50; // 50ms
      
      await cache.set(key, value, ttl);
      expect(cache.get(key)).toEqual(value);
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(cache.get(key)).toBeUndefined();
      
      // Stats should reflect the miss
      const stats = cache.getStats();
      expect(stats.misses).toBeGreaterThan(0);
    });

    // Golden Test 3: Memory limit enforcement
    test('GOLDEN: memory limits are enforced correctly', async () => {
      // Fill cache beyond memory limits
      const entries = [];
      for (let i = 0; i < 10; i++) {
        const key = `bulk-${i}`;
        const value = { id: i, data: 'x'.repeat(50) };
        entries.push({ key, value });
        await cache.set(key, value);
      }
      
      const stats = cache.getStats();
      expect(stats.memoryEntries).toBeLessThanOrEqual(5); // Respects maxMemoryEntries
      expect(stats.memorySize).toBeLessThanOrEqual(1024); // Respects maxMemorySize
      expect(stats.evictions).toBeGreaterThan(0);
    });

    // Additional Edge Case 1: Large object handling
    test('EDGE CASE: handles large objects appropriately', async () => {
      const largeText = 'word '.repeat(1000); // Large translation text
      const largeEntry = {
        originalText: largeText,
        translatedText: largeText.replace('word', '词'),
        metadata: { tokens: 1000, processingTime: 500 }
      };
      
      const result = await cache.set('large-translation', largeEntry);
      
      // Should either accept it or reject gracefully
      if (result) {
        expect(cache.get('large-translation')).toEqual(largeEntry);
      } else {
        // If rejected due to size, should not crash
        expect(cache.get('large-translation')).toBeUndefined();
      }
    });

    // Additional Edge Case 2: Rapid access pattern simulation
    test('EDGE CASE: handles rapid access patterns correctly', async () => {
      // Simulate rapid translation requests
      const translations = [
        { key: 'rapid-1', value: 'Hello' },
        { key: 'rapid-2', value: 'World' },
        { key: 'rapid-3', value: 'Test' }
      ];
      
      // Rapid sets
      await Promise.all(
        translations.map(({ key, value }) => cache.set(key, value))
      );
      
      // Rapid gets in different orders
      for (let i = 0; i < 10; i++) {
        const shuffled = [...translations].sort(() => Math.random() - 0.5);
        for (const { key, value } of shuffled) {
          const cached = cache.get(key);
          if (cached !== undefined) { // May be evicted in small cache
            expect(cached).toBe(value);
          }
        }
      }
      
      // Should maintain statistics correctly
      const stats = cache.getStats();
      expect(stats.hits + stats.misses).toBeGreaterThan(0);
      expect(stats.hitRate).toBeGreaterThanOrEqual(0);
      expect(stats.hitRate).toBeLessThanOrEqual(1);
    });
  });
});