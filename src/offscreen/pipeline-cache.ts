/**
 * LRU Pipeline Cache
 *
 * Manages ML pipeline caching with LRU eviction to prevent memory exhaustion.
 * Each OPUS-MT model ~170MB, TranslateGemma ~3.6GB.
 */

import { createLogger } from '../core/logger';

const log = createLogger('PipelineCache');

// Maximum number of cached pipelines (~500MB max for OPUS-MT models)
export const MAX_CACHED_PIPELINES = 3;

export interface PipelineCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pipeline: any;
  lastUsed: number;
  modelId: string;
}

const pipelineCache = new Map<string, PipelineCacheEntry>();

/**
 * Evict least-recently-used pipelines when cache exceeds limit.
 */
export function evictLRUPipelines(): void {
  while (pipelineCache.size >= MAX_CACHED_PIPELINES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of pipelineCache) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const evicted = pipelineCache.get(oldestKey);
      pipelineCache.delete(oldestKey);
      log.info(` Evicted LRU pipeline: ${evicted?.modelId} (cache: ${pipelineCache.size}/${MAX_CACHED_PIPELINES})`);
    }
  }
}

/**
 * Get pipeline from cache and update LRU timestamp.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCachedPipeline(modelId: string): any | null {
  const entry = pipelineCache.get(modelId);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.pipeline;
  }
  return null;
}

/**
 * Store pipeline in cache with LRU eviction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function cachePipeline(modelId: string, pipeline: any): void {
  evictLRUPipelines();
  pipelineCache.set(modelId, {
    pipeline,
    lastUsed: Date.now(),
    modelId,
  });
  log.info(` Cached pipeline: ${modelId} (cache: ${pipelineCache.size}/${MAX_CACHED_PIPELINES})`);
}

/**
 * Get current cache size.
 */
export function getCacheSize(): number {
  return pipelineCache.size;
}

/**
 * Clear all cached pipelines.
 */
export function clearCache(): void {
  pipelineCache.clear();
  log.info(' Pipeline cache cleared');
}
