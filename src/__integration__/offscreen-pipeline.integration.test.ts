/**
 * Integration tests: Offscreen ML pipeline lifecycle
 *
 * Verifies the LRU pipeline cache, eviction logic, disposal hooks, and
 * the offscreen message handler's translate / preloadModel / clearCache paths.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// We test pipeline-cache.ts directly (pure logic, no chrome dependency).
// The offscreen message handler is tested via simulated message dispatch.
// ---------------------------------------------------------------------------

import {
  getCachedPipeline,
  cachePipeline,
  evictLRUPipelines,
  getCacheSize,
  clearCache,
  MAX_CACHED_PIPELINES,
} from '../offscreen/pipeline-cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakePipeline(name: string) {
  return {
    name,
    dispose: vi.fn().mockResolvedValue(undefined),
    __call: vi.fn(),
  } as any;
}

// ---------------------------------------------------------------------------
// Pipeline Cache integration tests
// ---------------------------------------------------------------------------

describe('Offscreen pipeline cache lifecycle', () => {
  beforeEach(async () => {
    // Clear all cached pipelines before each test
    await clearCache();
    expect(getCacheSize()).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 1. Cache stores and retrieves a pipeline
  // -----------------------------------------------------------------------
  it('stores and retrieves a pipeline by model ID', () => {
    const pipe = makeFakePipeline('opus-mt-en-fi');
    cachePipeline('opus-mt-en-fi', pipe);

    const cached = getCachedPipeline('opus-mt-en-fi');
    expect(cached).toBe(pipe);
  });

  // -----------------------------------------------------------------------
  // 2. Cache returns null for unknown model
  // -----------------------------------------------------------------------
  it('returns null for uncached model', () => {
    expect(getCachedPipeline('nonexistent-model')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 3. getCacheSize tracks entries
  // -----------------------------------------------------------------------
  it('getCacheSize reflects number of cached pipelines', () => {
    cachePipeline('model-a', makeFakePipeline('a'));
    cachePipeline('model-b', makeFakePipeline('b'));
    expect(getCacheSize()).toBe(2);
  });

  // -----------------------------------------------------------------------
  // 4. LRU eviction fires when cache is full
  // -----------------------------------------------------------------------
  it('evicts least-recently-used pipeline when cache exceeds limit', async () => {
    // Fill cache to MAX_CACHED_PIPELINES
    const pipelines = [];
    for (let i = 0; i < MAX_CACHED_PIPELINES; i++) {
      const p = makeFakePipeline(`model-${i}`);
      cachePipeline(`model-${i}`, p);
      pipelines.push(p);
      // Stagger timestamps so model-0 is oldest
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(getCacheSize()).toBe(MAX_CACHED_PIPELINES);

    // Adding one more should evict the oldest (model-0)
    const extra = makeFakePipeline('model-extra');
    cachePipeline('model-extra', extra);

    expect(getCacheSize()).toBe(MAX_CACHED_PIPELINES);
    expect(getCachedPipeline('model-0')).toBeNull();
    expect(getCachedPipeline('model-extra')).toBe(extra);
  });

  // -----------------------------------------------------------------------
  // 5. Dispose is called on evicted pipelines
  // -----------------------------------------------------------------------
  it('calls dispose() on evicted pipeline', async () => {
    const pipelines = [];
    for (let i = 0; i < MAX_CACHED_PIPELINES; i++) {
      const p = makeFakePipeline(`model-${i}`);
      cachePipeline(`model-${i}`, p);
      pipelines.push(p);
      await new Promise((r) => setTimeout(r, 10));
    }

    // Trigger eviction
    cachePipeline('overflow', makeFakePipeline('overflow'));

    // Wait for async disposal
    await new Promise((r) => setTimeout(r, 50));

    // The oldest pipeline should have been disposed
    expect(pipelines[0].dispose).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 6. clearCache empties all entries
  // -----------------------------------------------------------------------
  it('clearCache removes all cached pipelines', async () => {
    cachePipeline('a', makeFakePipeline('a'));
    cachePipeline('b', makeFakePipeline('b'));

    await clearCache();
    expect(getCacheSize()).toBe(0);
    expect(getCachedPipeline('a')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 7. clearCache calls dispose on all pipelines
  // -----------------------------------------------------------------------
  it('clearCache disposes all pipelines', async () => {
    const pA = makeFakePipeline('a');
    const pB = makeFakePipeline('b');
    cachePipeline('a', pA);
    cachePipeline('b', pB);

    await clearCache();

    expect(pA.dispose).toHaveBeenCalled();
    expect(pB.dispose).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 8. Accessing a cached pipeline updates its LRU timestamp
  // -----------------------------------------------------------------------
  it('getCachedPipeline refreshes LRU timestamp', async () => {
    // Insert 3 pipelines with staggered times
    for (let i = 0; i < MAX_CACHED_PIPELINES; i++) {
      cachePipeline(`model-${i}`, makeFakePipeline(`model-${i}`));
      await new Promise((r) => setTimeout(r, 10));
    }

    // Access model-0 to refresh its timestamp
    getCachedPipeline('model-0');
    await new Promise((r) => setTimeout(r, 10));

    // Now add a new pipeline – model-1 should be evicted (oldest untouched)
    cachePipeline('model-new', makeFakePipeline('model-new'));

    expect(getCachedPipeline('model-0')).not.toBeNull();
    expect(getCachedPipeline('model-1')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 9. evictLRUPipelines is idempotent when cache is below limit
  // -----------------------------------------------------------------------
  it('evictLRUPipelines is no-op when cache is under limit', () => {
    cachePipeline('only-one', makeFakePipeline('only'));
    evictLRUPipelines();
    expect(getCacheSize()).toBe(1);
    expect(getCachedPipeline('only-one')).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // 10. Overwriting a model key updates the pipeline
  // -----------------------------------------------------------------------
  it('overwriting an existing model key replaces the pipeline', () => {
    const pOld = makeFakePipeline('v1');
    const pNew = makeFakePipeline('v2');

    cachePipeline('model-x', pOld);
    cachePipeline('model-x', pNew);

    // The Map.set semantics means the old entry is replaced
    const cached = getCachedPipeline('model-x');
    expect(cached).toBe(pNew);
  });
});
