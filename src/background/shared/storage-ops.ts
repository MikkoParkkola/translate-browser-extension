/**
 * Shared Translation Cache (Persistent LRU)
 *
 * Platform-agnostic translation cache with pluggable storage backend.
 * Both Chrome (chrome.storage.local) and Firefox (browserAPI.storage.local)
 * provide a StorageAdapter to abstract the difference.
 */

import { generateCacheKey } from '../../core/hash';
import { createLogger } from '../../core/logger';
import { CONFIG } from '../../config';

const log = createLogger('TranslationCache');

// ============================================================================
// Types
// ============================================================================

/**
 * Persistent cache entry with usage tracking.
 * Stores translation result along with metadata for smart eviction.
 */
export interface PersistentCacheEntry {
  result: string | string[];
  timestamp: number;
  sourceLang: string;
  targetLang: string;
  useCount: number;
}

/**
 * Detailed cache statistics for diagnostics and UI display.
 */
export interface DetailedCacheStats {
  size: number;
  maxSize: number;
  hitRate: string;
  totalHits: number;
  totalMisses: number;
  oldestEntry: number | null;
  mostUsed: Array<{ text: string; useCount: number; langs: string }>;
  memoryEstimate: string;
  languagePairs: Record<string, number>;
}

/**
 * Minimal storage adapter — both Chrome and Firefox implement this.
 */
export interface StorageAdapter {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(data: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

// ============================================================================
// Translation Cache
// ============================================================================

// Cache schema version. Increment when PersistentCacheEntry shape changes
// to force a cache clear on upgrade instead of risking type errors.
const CACHE_VERSION = 1;
const CACHE_VERSION_KEY = 'translationCacheVersion';

export interface TranslationCacheOptions {
  /** Enable cache version checking (Chrome uses this, Firefox may skip). */
  enableVersioning?: boolean;
}

export interface TranslationCache {
  /** Load cache from persistent storage. Safe to call multiple times. */
  load(): Promise<void>;
  /** Get the cache key for a translation request. */
  getKey(text: string | string[], sourceLang: string, targetLang: string, provider?: string): string;
  /** Get a cached translation (updates LRU order and use count). */
  get(key: string): PersistentCacheEntry | undefined;
  /** Store a translation in cache with smart eviction. */
  set(key: string, result: string | string[], sourceLang: string, targetLang: string): void;
  /** Get detailed cache statistics. */
  getStats(): DetailedCacheStats;
  /** Clear cache and reset statistics. */
  clear(): Promise<void>;
  /** Flush pending cache save immediately (for shutdown). */
  flush(): void;
  /** Increment miss counter (for callers that skip get() on auto-detect). */
  recordMiss(): void;
  /** Current cache size. */
  readonly size: number;
  /** Total hit count. */
  readonly hits: number;
  /** Total miss count. */
  readonly misses: number;
}

/**
 * Create a translation cache backed by the given storage adapter.
 *
 * @param storage       Platform storage adapter (chrome.storage.local / browserAPI.storage.local)
 * @param getProvider   Returns the current provider ID (for cache key generation)
 * @param options       Optional feature flags
 */
export function createTranslationCache(
  storage: StorageAdapter,
  getProvider: () => string,
  options: TranslationCacheOptions = {},
): TranslationCache {
  const enableVersioning = options.enableVersioning ?? false;

  // In-memory cache
  const cache = new Map<string, PersistentCacheEntry>();
  let cacheHits = 0;
  let cacheMisses = 0;
  let initialized = false;
  let loadingPromise: Promise<void> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  // ------------------------------------------------------------------
  // Persistence helpers
  // ------------------------------------------------------------------

  async function load(): Promise<void> {
    if (initialized) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      try {
        const keysToGet: string[] = [CONFIG.cache.storageKey, CONFIG.cache.cacheStatsKey];
        if (enableVersioning) keysToGet.push(CACHE_VERSION_KEY);

        const stored = await storage.get(keysToGet);

        // Version check (Chrome only — prevents type errors from stale entries)
        if (enableVersioning) {
          const storedVersion = stored[CACHE_VERSION_KEY] as number | undefined;
          if (storedVersion !== CACHE_VERSION) {
            log.info(
              `Cache version mismatch (stored: ${storedVersion}, current: ${CACHE_VERSION}), clearing stale cache`,
            );
            await storage.remove([CONFIG.cache.storageKey, CONFIG.cache.cacheStatsKey]);
            await storage.set({ [CACHE_VERSION_KEY]: CACHE_VERSION });
            initialized = true;
            return;
          }
        }

        if (stored[CONFIG.cache.storageKey]) {
          const entries = stored[CONFIG.cache.storageKey] as [string, PersistentCacheEntry][];
          entries.forEach(([key, value]) => {
            cache.set(key, value);
          });
          log.info(`Loaded ${cache.size} cached translations from storage`);
        }

        if (stored.cacheStats) {
          const stats = stored.cacheStats as { hits: number; misses: number };
          cacheHits = stats.hits || 0;
          cacheMisses = stats.misses || 0;
        }

        initialized = true;
      } catch (error) {
        log.warn('Failed to load persistent cache:', error);
        initialized = true; // Prevent retry loops
      } finally {
        loadingPromise = null;
      }
    })();

    return loadingPromise;
  }

  function scheduleSave(): void {
    if (saveTimer) return;

    saveTimer = setTimeout(async () => {
      saveTimer = null;
      try {
        const entries = Array.from(cache.entries());
        const data: Record<string, unknown> = {
          [CONFIG.cache.storageKey]: entries,
          cacheStats: { hits: cacheHits, misses: cacheMisses },
        };
        if (enableVersioning) {
          data[CACHE_VERSION_KEY] = CACHE_VERSION;
        }
        await storage.set(data);
        log.debug(`Saved ${entries.length} translations to persistent storage`);
      } catch (error) {
        log.warn('Failed to save cache:', error);
      }
    }, CONFIG.cache.saveDebounceMs);
  }

  function flush(): void {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;

    const entries = Array.from(cache.entries());
    const data: Record<string, unknown> = {
      [CONFIG.cache.storageKey]: entries,
      cacheStats: { hits: cacheHits, misses: cacheMisses },
    };
    if (enableVersioning) {
      data[CACHE_VERSION_KEY] = CACHE_VERSION;
    }
    storage.set(data).catch((error) => {
      log.warn('Failed to flush cache on shutdown:', error);
    });
  }

  // ------------------------------------------------------------------
  // Cache key
  // ------------------------------------------------------------------

  function getKey(
    text: string | string[],
    sourceLang: string,
    targetLang: string,
    provider?: string,
  ): string {
    const providerKey = provider || getProvider();
    return generateCacheKey(text, sourceLang, targetLang, providerKey);
  }

  // ------------------------------------------------------------------
  // Get / Set with LRU + usage tracking
  // ------------------------------------------------------------------

  function get(key: string): PersistentCacheEntry | undefined {
    const entry = cache.get(key);
    if (entry) {
      // Move to end for LRU ordering: delete+set are synchronous Map ops
      // with no await in between, so no other microtask can interleave.
      entry.useCount++;
      cache.delete(key);
      cache.set(key, entry);
      cacheHits++;
      scheduleSave();
      log.debug(`Cache HIT: ${key.substring(0, 40)}... (used ${entry.useCount}x)`);
    } else {
      cacheMisses++;
    }
    return entry;
  }

  function set(
    key: string,
    result: string | string[],
    sourceLang: string,
    targetLang: string,
  ): void {
    // Evict entries if at capacity using smart eviction.
    // The entire eviction loop + insertion below is synchronous (no await),
    // so no concurrent set() can interleave and corrupt ordering.
    while (cache.size >= CONFIG.cache.maxSize) {
      const entries = Array.from(cache.entries());
      const oldestCount = Math.max(10, Math.floor(entries.length * 0.1));
      const oldestEntries = entries.slice(0, oldestCount);

      const leastUsed = oldestEntries.reduce((min, curr) =>
        /* v8 ignore start */
        curr[1].useCount < min[1].useCount ? curr : min,
        /* v8 ignore stop */
      );

      cache.delete(leastUsed[0]);
      log.debug(`Cache evicted: ${leastUsed[0].substring(0, 40)}... (used ${leastUsed[1].useCount}x)`);
    }

    cache.set(key, {
      result,
      timestamp: Date.now(),
      sourceLang,
      targetLang,
      useCount: 1,
    });

    scheduleSave();
    log.debug(`Cached translation (${cache.size}/${CONFIG.cache.maxSize})`);
  }

  function recordMiss(): void {
    cacheMisses++;
  }

  // ------------------------------------------------------------------
  // Stats
  // ------------------------------------------------------------------

  function getStats(): DetailedCacheStats {
    const entries = Array.from(cache.entries());

    let oldestTimestamp: number | null = null;
    for (const [, entry] of entries) {
      if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
      }
    }

    const mostUsed = entries
      .sort((a, b) => b[1].useCount - a[1].useCount)
      .slice(0, 5)
      .map(([key, value]) => ({
        text: key.substring(0, 50) + (key.length > 50 ? '...' : ''),
        useCount: value.useCount,
        langs: `${value.sourceLang} -> ${value.targetLang}`,
      }));

    const languagePairs: Record<string, number> = {};
    for (const [, entry] of entries) {
      const pair = `${entry.sourceLang}-${entry.targetLang}`;
      languagePairs[pair] = (languagePairs[pair] || 0) + 1;
    }

    const totalChars = entries.reduce((sum, [key, value]) => {
      const resultLen = Array.isArray(value.result)
        ? value.result.join('').length
        : value.result.length;
      return sum + key.length + resultLen;
    }, 0);

    const totalTranslations = cacheHits + cacheMisses;
    const hitRatePercent =
      totalTranslations > 0 ? Math.round((cacheHits / totalTranslations) * 100) : 0;

    return {
      size: cache.size,
      maxSize: CONFIG.cache.maxSize,
      hitRate: `${cacheHits}/${totalTranslations} (${hitRatePercent}%)`,
      totalHits: cacheHits,
      totalMisses: cacheMisses,
      oldestEntry: oldestTimestamp,
      mostUsed,
      memoryEstimate: `~${Math.round(totalChars / 1024)}KB`,
      languagePairs,
    };
  }

  // ------------------------------------------------------------------
  // Clear
  // ------------------------------------------------------------------

  async function clearCache(): Promise<void> {
    // Cancel pending debounced save
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    cache.clear();
    cacheHits = 0;
    cacheMisses = 0;

    try {
      const keysToRemove: string[] = [CONFIG.cache.storageKey, CONFIG.cache.cacheStatsKey];
      if (enableVersioning) keysToRemove.push(CACHE_VERSION_KEY);
      await storage.remove(keysToRemove);
      log.info('Translation cache cleared (memory + persistent storage)');
    } catch (error) {
      log.warn('Failed to clear persistent cache:', error);
    }
  }

  // ------------------------------------------------------------------
  // Public interface
  // ------------------------------------------------------------------

  return {
    load,
    getKey,
    get,
    set,
    getStats,
    clear: clearCache,
    flush,
    recordMiss,
    get size() {
      return cache.size;
    },
    get hits() {
      return cacheHits;
    },
    get misses() {
      return cacheMisses;
    },
  };
}
