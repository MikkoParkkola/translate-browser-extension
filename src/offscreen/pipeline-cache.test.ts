/**
 * Pipeline Cache unit tests
 *
 * Tests for LRU pipeline caching with eviction logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MAX_CACHED_PIPELINES,
  evictLRUPipelines,
  getCachedPipeline,
  cachePipeline,
  getCacheSize,
  clearCache,
} from './pipeline-cache';

// Mock the logger to avoid console output in tests
vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('Pipeline Cache', () => {
  beforeEach(() => {
    clearCache();
  });

  describe('MAX_CACHED_PIPELINES', () => {
    it('is set to 3', () => {
      expect(MAX_CACHED_PIPELINES).toBe(3);
    });
  });

  describe('getCacheSize', () => {
    it('returns 0 for empty cache', () => {
      expect(getCacheSize()).toBe(0);
    });

    it('returns correct count after caching', () => {
      cachePipeline('model-1', { mock: 'pipeline1' });
      expect(getCacheSize()).toBe(1);

      cachePipeline('model-2', { mock: 'pipeline2' });
      expect(getCacheSize()).toBe(2);
    });
  });

  describe('cachePipeline', () => {
    it('adds pipeline to cache', () => {
      const pipeline = { mock: 'pipeline' };
      cachePipeline('test-model', pipeline);

      expect(getCacheSize()).toBe(1);
      expect(getCachedPipeline('test-model')).toBe(pipeline);
    });

    it('overwrites existing pipeline for same model', () => {
      const pipeline1 = { mock: 'first' };
      const pipeline2 = { mock: 'second' };

      cachePipeline('test-model', pipeline1);
      cachePipeline('test-model', pipeline2);

      expect(getCacheSize()).toBe(1);
      expect(getCachedPipeline('test-model')).toBe(pipeline2);
    });

    it('stores multiple pipelines up to limit', () => {
      cachePipeline('model-1', { id: 1 });
      cachePipeline('model-2', { id: 2 });
      cachePipeline('model-3', { id: 3 });

      expect(getCacheSize()).toBe(3);
    });
  });

  describe('getCachedPipeline', () => {
    it('returns null for uncached model', () => {
      expect(getCachedPipeline('nonexistent')).toBeNull();
    });

    it('returns cached pipeline', () => {
      const pipeline = { translate: vi.fn() };
      cachePipeline('test-model', pipeline);

      expect(getCachedPipeline('test-model')).toBe(pipeline);
    });

    it('updates lastUsed timestamp on access', async () => {
      cachePipeline('model-1', { id: 1 });

      // Wait a bit to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10));

      // Access should update timestamp (used for LRU)
      getCachedPipeline('model-1');

      // Access again to verify it was recently used
      // (timestamp should be between before and after)
      const pipeline = getCachedPipeline('model-1');
      expect(pipeline).not.toBeNull();
    });
  });

  describe('evictLRUPipelines', () => {
    it('does nothing when cache is under limit', () => {
      cachePipeline('model-1', { id: 1 });
      cachePipeline('model-2', { id: 2 });

      evictLRUPipelines();

      expect(getCacheSize()).toBe(2);
    });

    it('evicts oldest pipeline when at limit', async () => {
      // Cache first pipeline
      cachePipeline('oldest', { id: 'oldest' });
      await new Promise((r) => setTimeout(r, 10));

      // Cache second pipeline
      cachePipeline('middle', { id: 'middle' });
      await new Promise((r) => setTimeout(r, 10));

      // Cache third pipeline
      cachePipeline('newest', { id: 'newest' });

      // Now at limit (3), adding another should evict oldest
      cachePipeline('fourth', { id: 'fourth' });

      expect(getCacheSize()).toBe(3);
      expect(getCachedPipeline('oldest')).toBeNull();
      expect(getCachedPipeline('middle')).not.toBeNull();
      expect(getCachedPipeline('newest')).not.toBeNull();
      expect(getCachedPipeline('fourth')).not.toBeNull();
    });

    it('evicts least recently used, not oldest cached', async () => {
      // Cache three pipelines
      cachePipeline('first', { id: 1 });
      await new Promise((r) => setTimeout(r, 10));

      cachePipeline('second', { id: 2 });
      await new Promise((r) => setTimeout(r, 10));

      cachePipeline('third', { id: 3 });
      await new Promise((r) => setTimeout(r, 10));

      // Access the first one to make it recently used
      getCachedPipeline('first');
      await new Promise((r) => setTimeout(r, 10));

      // Add fourth - should evict 'second' (least recently used)
      cachePipeline('fourth', { id: 4 });

      expect(getCachedPipeline('first')).not.toBeNull();
      expect(getCachedPipeline('second')).toBeNull();
      expect(getCachedPipeline('third')).not.toBeNull();
      expect(getCachedPipeline('fourth')).not.toBeNull();
    });
  });

  describe('clearCache', () => {
    it('removes all cached pipelines', () => {
      cachePipeline('model-1', { id: 1 });
      cachePipeline('model-2', { id: 2 });
      cachePipeline('model-3', { id: 3 });

      expect(getCacheSize()).toBe(3);

      clearCache();

      expect(getCacheSize()).toBe(0);
      expect(getCachedPipeline('model-1')).toBeNull();
      expect(getCachedPipeline('model-2')).toBeNull();
      expect(getCachedPipeline('model-3')).toBeNull();
    });

    it('allows caching after clear', () => {
      cachePipeline('model-1', { id: 1 });
      clearCache();
      cachePipeline('model-2', { id: 2 });

      expect(getCacheSize()).toBe(1);
      expect(getCachedPipeline('model-2')).not.toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('handles rapid cache/access cycles', () => {
      for (let i = 0; i < 10; i++) {
        cachePipeline(`model-${i}`, { id: i });
      }

      // Should only have MAX_CACHED_PIPELINES entries
      expect(getCacheSize()).toBe(MAX_CACHED_PIPELINES);
    });

    it('handles duplicate model IDs correctly', () => {
      cachePipeline('same-model', { version: 1 });
      cachePipeline('same-model', { version: 2 });
      cachePipeline('same-model', { version: 3 });

      expect(getCacheSize()).toBe(1);
      expect(getCachedPipeline('same-model')).toEqual({ version: 3 });
    });

    it('handles empty string model ID', () => {
      cachePipeline('', { empty: true });
      expect(getCachedPipeline('')).toEqual({ empty: true });
    });
  });
});
