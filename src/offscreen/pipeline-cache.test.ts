/**
 * Pipeline Cache unit tests
 *
 * Tests for LRU pipeline caching with eviction logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLoggerModuleMock } from '../test-helpers/module-mocks';
import {
  MAX_CACHED_PIPELINES,
  evictLRUPipelines,
  getCachedPipeline,
  cachePipeline,
  getCacheSize,
  clearCache,
} from './pipeline-cache';
import type { TranslationPipeline } from '../types';

// Mock the logger to avoid console output in tests
vi.mock('../core/logger', () => createLoggerModuleMock());

const waitForPipelineCacheAsyncWork = (ms = 10): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const cachePipelineWithDelay = async (
  modelId: string,
  pipeline: TranslationPipeline,
  delayMs = 10
): Promise<void> => {
  cachePipeline(modelId, pipeline);
  await waitForPipelineCacheAsyncWork(delayMs);
};

describe('Pipeline Cache', () => {
  beforeEach(async () => {
    await clearCache();
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
      cachePipeline('model-1', { mock: 'pipeline1' } as unknown as TranslationPipeline);
      expect(getCacheSize()).toBe(1);

      cachePipeline('model-2', { mock: 'pipeline2' } as unknown as TranslationPipeline);
      expect(getCacheSize()).toBe(2);
    });
  });

  describe('cachePipeline', () => {
    it('adds pipeline to cache', () => {
      const pipeline = { mock: 'pipeline' } as unknown as TranslationPipeline;
      cachePipeline('test-model', pipeline);

      expect(getCacheSize()).toBe(1);
      expect(getCachedPipeline('test-model')).toBe(pipeline);
    });

    it('overwrites existing pipeline for same model', () => {
      const pipeline1 = { mock: 'first' } as unknown as TranslationPipeline;
      const pipeline2 = { mock: 'second' } as unknown as TranslationPipeline;

      cachePipeline('test-model', pipeline1);
      cachePipeline('test-model', pipeline2);

      expect(getCacheSize()).toBe(1);
      expect(getCachedPipeline('test-model')).toBe(pipeline2);
    });

    it('stores multiple pipelines up to limit', () => {
      cachePipeline('model-1', { id: 1 } as unknown as TranslationPipeline);
      cachePipeline('model-2', { id: 2 } as unknown as TranslationPipeline);
      cachePipeline('model-3', { id: 3 } as unknown as TranslationPipeline);

      expect(getCacheSize()).toBe(3);
    });
  });

  describe('getCachedPipeline', () => {
    it('returns null for uncached model', () => {
      expect(getCachedPipeline('nonexistent')).toBeNull();
    });

    it('returns cached pipeline', () => {
      const pipeline = { translate: vi.fn() } as unknown as TranslationPipeline;
      cachePipeline('test-model', pipeline);

      expect(getCachedPipeline('test-model')).toBe(pipeline);
    });

    it('updates lastUsed timestamp on access', async () => {
      cachePipeline('model-1', { id: 1 } as unknown as TranslationPipeline);

      // Wait a bit to ensure timestamp changes
      await waitForPipelineCacheAsyncWork(10);

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
      cachePipeline('model-1', { id: 1 } as unknown as TranslationPipeline);
      cachePipeline('model-2', { id: 2 } as unknown as TranslationPipeline);

      evictLRUPipelines();

      expect(getCacheSize()).toBe(2);
    });

    it('evicts oldest pipeline when at limit', async () => {
      // Cache first pipeline
      await cachePipelineWithDelay('oldest', { id: 'oldest' } as unknown as TranslationPipeline);

      // Cache second pipeline
      await cachePipelineWithDelay('middle', { id: 'middle' } as unknown as TranslationPipeline);

      // Cache third pipeline
      cachePipeline('newest', { id: 'newest' } as unknown as TranslationPipeline);

      // Now at limit (3), adding another should evict oldest
      cachePipeline('fourth', { id: 'fourth' } as unknown as TranslationPipeline);

      expect(getCacheSize()).toBe(3);
      expect(getCachedPipeline('oldest')).toBeNull();
      expect(getCachedPipeline('middle')).not.toBeNull();
      expect(getCachedPipeline('newest')).not.toBeNull();
      expect(getCachedPipeline('fourth')).not.toBeNull();
    });

    it('evicts least recently used, not oldest cached', async () => {
      // Cache three pipelines
      await cachePipelineWithDelay('first', { id: 1 } as unknown as TranslationPipeline);

      await cachePipelineWithDelay('second', { id: 2 } as unknown as TranslationPipeline);

      await cachePipelineWithDelay('third', { id: 3 } as unknown as TranslationPipeline);

      // Access the first one to make it recently used
      getCachedPipeline('first');
      await waitForPipelineCacheAsyncWork(10);

      // Add fourth - should evict 'second' (least recently used)
      cachePipeline('fourth', { id: 4 } as unknown as TranslationPipeline);

      expect(getCachedPipeline('first')).not.toBeNull();
      expect(getCachedPipeline('second')).toBeNull();
      expect(getCachedPipeline('third')).not.toBeNull();
      expect(getCachedPipeline('fourth')).not.toBeNull();
    });
  });

  describe('clearCache', () => {
    it('removes all cached pipelines', async () => {
      cachePipeline('model-1', { id: 1 } as unknown as TranslationPipeline);
      cachePipeline('model-2', { id: 2 } as unknown as TranslationPipeline);
      cachePipeline('model-3', { id: 3 } as unknown as TranslationPipeline);

      expect(getCacheSize()).toBe(3);

      await clearCache();

      expect(getCacheSize()).toBe(0);
      expect(getCachedPipeline('model-1')).toBeNull();
      expect(getCachedPipeline('model-2')).toBeNull();
      expect(getCachedPipeline('model-3')).toBeNull();
    });

    it('calls dispose on all cached pipelines during clearCache', async () => {
      const dispose1 = vi.fn().mockResolvedValue(undefined);
      const dispose2 = vi.fn().mockResolvedValue(undefined);
      cachePipeline('clear-d1', { id: 1, dispose: dispose1 } as unknown as TranslationPipeline);
      cachePipeline('clear-d2', { id: 2, dispose: dispose2 } as unknown as TranslationPipeline);

      await clearCache();

      expect(dispose1).toHaveBeenCalled();
      expect(dispose2).toHaveBeenCalled();
      expect(getCacheSize()).toBe(0);
    });

    it('clears cache even if some pipelines lack dispose method', async () => {
      // Mix of pipelines: one with dispose, one without
      const dispose1 = vi.fn().mockResolvedValue(undefined);
      cachePipeline('mix-1', { id: 1, dispose: dispose1 } as unknown as TranslationPipeline);
      cachePipeline('mix-2', { id: 2 } as unknown as TranslationPipeline); // no dispose

      await clearCache();

      expect(dispose1).toHaveBeenCalled();
      expect(getCacheSize()).toBe(0);
    });

    it('clears cache even if dispose() rejects', async () => {
      const dispose1 = vi.fn().mockRejectedValue(new Error('GPU disposed'));
      cachePipeline('fail-d1', { id: 1, dispose: dispose1 } as unknown as TranslationPipeline);

      await clearCache();

      expect(dispose1).toHaveBeenCalled();
      expect(getCacheSize()).toBe(0);
    });

    it('allows caching after clear', async () => {
      cachePipeline('model-1', { id: 1 } as unknown as TranslationPipeline);
      await clearCache();
      cachePipeline('model-2', { id: 2 } as unknown as TranslationPipeline);

      expect(getCacheSize()).toBe(1);
      expect(getCachedPipeline('model-2')).not.toBeNull();
    });
  });

  describe('integration scenarios', () => {
    it('handles rapid cache/access cycles', () => {
      for (let i = 0; i < 10; i++) {
        cachePipeline(`model-${i}`, { id: i } as unknown as TranslationPipeline);
      }

      // Should only have MAX_CACHED_PIPELINES entries
      expect(getCacheSize()).toBe(MAX_CACHED_PIPELINES);
    });

    it('handles duplicate model IDs correctly', () => {
      cachePipeline('same-model', { version: 1 } as unknown as TranslationPipeline);
      cachePipeline('same-model', { version: 2 } as unknown as TranslationPipeline);
      cachePipeline('same-model', { version: 3 } as unknown as TranslationPipeline);

      expect(getCacheSize()).toBe(1);
      expect(getCachedPipeline('same-model')).toEqual({ version: 3 });
    });

    it('handles empty string model ID', () => {
      cachePipeline('', { empty: true } as unknown as TranslationPipeline);
      expect(getCachedPipeline('')).toEqual({ empty: true });
    });
  });

  // ------------------------------------------------------------------
  // Additional coverage: disposePipeline paths (lines 35-39)
  // disposePipeline is async fire-and-forget during eviction, so we
  // must wait for microtasks to settle before asserting.
  // ------------------------------------------------------------------
  describe('disposePipeline coverage', () => {
    it('calls dispose on evicted pipeline that has dispose()', async () => {
      const disposeFn = vi.fn().mockResolvedValue(undefined);
      // Fill cache: slot 1 with dispose method, slots 2-3 plain
      await cachePipelineWithDelay('disp-1', { id: 1, dispose: disposeFn } as unknown as TranslationPipeline);
      await cachePipelineWithDelay('disp-2', { id: 2 } as unknown as TranslationPipeline);
      await cachePipelineWithDelay('disp-3', { id: 3 } as unknown as TranslationPipeline);

      // 4th entry evicts disp-1 (LRU) — its .dispose() should be called
      cachePipeline('disp-4', { id: 4 } as unknown as TranslationPipeline);
      // Wait for fire-and-forget disposePipeline to complete
      await waitForPipelineCacheAsyncWork(50);

      expect(disposeFn).toHaveBeenCalled();
      expect(getCacheSize()).toBe(3);
      expect(getCachedPipeline('disp-1')).toBeNull();
    });

    it('handles evicted pipeline without dispose method', async () => {
      // Pipeline that has NO dispose() method at all
      await cachePipelineWithDelay('no-dispose-1', { id: 1 } as unknown as TranslationPipeline);
      await cachePipelineWithDelay('no-dispose-2', { id: 2 } as unknown as TranslationPipeline);
      await cachePipelineWithDelay('no-dispose-3', { id: 3 } as unknown as TranslationPipeline);

      // 4th entry evicts no-dispose-1 — no dispose() to call, should not throw
      await cachePipelineWithDelay('no-dispose-4', { id: 4 } as unknown as TranslationPipeline, 50);

      expect(getCacheSize()).toBe(3);
      expect(getCachedPipeline('no-dispose-1')).toBeNull();
    });

    it('gracefully handles dispose() that throws', async () => {
      const disposeFn = vi.fn().mockRejectedValue(new Error('Dispose failed'));
      await cachePipelineWithDelay('throw-1', { id: 1, dispose: disposeFn } as unknown as TranslationPipeline);
      await cachePipelineWithDelay('throw-2', { id: 2 } as unknown as TranslationPipeline);
      await cachePipelineWithDelay('throw-3', { id: 3 } as unknown as TranslationPipeline);

      // Evicts throw-1 — dispose() rejects but error is caught
      await cachePipelineWithDelay('throw-4', { id: 4 } as unknown as TranslationPipeline, 50);

      expect(disposeFn).toHaveBeenCalled();
      expect(getCacheSize()).toBe(3);
      expect(getCachedPipeline('throw-1')).toBeNull();
      expect(getCachedPipeline('throw-4')).not.toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // Additional coverage: falsy branches for evicted?.pipeline and
  // entry.pipeline when pipeline is null/undefined (defensive guards)
  // ------------------------------------------------------------------
  describe('null pipeline defensive guards', () => {
    it('evicts entry whose pipeline is null without calling dispose', async () => {
      // Cache a null pipeline as the oldest entry
      await cachePipelineWithDelay('null-pipe', null as unknown as TranslationPipeline);
      await cachePipelineWithDelay('real-2', { id: 2 } as unknown as TranslationPipeline);
      await cachePipelineWithDelay('real-3', { id: 3 } as unknown as TranslationPipeline);

      // 4th entry evicts null-pipe — evicted.pipeline is null → falsy branch
      await cachePipelineWithDelay('real-4', { id: 4 } as unknown as TranslationPipeline, 50);

      expect(getCacheSize()).toBe(3);
      expect(getCachedPipeline('null-pipe')).toBeNull();
    });

    it('clearCache skips dispose for entries with null pipeline', async () => {
      cachePipeline('null-clear', null as unknown as TranslationPipeline);

      await clearCache();

      expect(getCacheSize()).toBe(0);
    });
  });
});
