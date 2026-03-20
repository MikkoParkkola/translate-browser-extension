/**
 * Tests for src/background/shared/storage-ops.ts
 *
 * createTranslationCache — platform-agnostic LRU cache with pluggable storage adapter.
 * Pure logic, no browser APIs needed — just mock the StorageAdapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../core/hash', () => ({
  generateCacheKey: vi.fn((text: string, src: string, tgt: string, prov: string) =>
    `${text}|${src}|${tgt}|${prov}`
  ),
}));

vi.mock('../../config', () => ({
  CONFIG: {
    cache: {
      storageKey: 'translationCache',
      maxSize: 10,
      saveDebounceMs: 100,
    },
  },
}));

import { createTranslationCache } from './storage-ops';
import type { StorageAdapter } from './storage-ops';

// ============================================================================
// Helpers
// ============================================================================

function makeStorage(overrides: Partial<StorageAdapter> = {}): StorageAdapter {
  return {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ============================================================================
// load()
// ============================================================================

describe('load()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads entries from storage on first call', async () => {
    const storage = makeStorage({
      get: vi.fn().mockResolvedValue({
        translationCache: [
          ['key1', { result: 'hello', timestamp: 1000, sourceLang: 'en', targetLang: 'fi', useCount: 1 }],
        ],
      }),
    });

    const cache = createTranslationCache(storage, () => 'opus-mt');
    await cache.load();

    expect(cache.size).toBe(1);
    expect(storage.get).toHaveBeenCalledWith(
      expect.arrayContaining(['translationCache', 'cacheStats'])
    );
  });

  it('loads persisted hit/miss stats', async () => {
    const storage = makeStorage({
      get: vi.fn().mockResolvedValue({
        cacheStats: { hits: 5, misses: 3 },
      }),
    });

    const cache = createTranslationCache(storage, () => 'opus-mt');
    await cache.load();

    expect(cache.hits).toBe(5);
    expect(cache.misses).toBe(3);
  });

  it('returns immediately on second call (idempotent)', async () => {
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    await cache.load();
    await cache.load();

    expect(storage.get).toHaveBeenCalledTimes(1);
  });

  it('handles storage.get error gracefully', async () => {
    const storage = makeStorage({
      get: vi.fn().mockRejectedValue(new Error('storage unavailable')),
    });

    const cache = createTranslationCache(storage, () => 'opus-mt');
    await expect(cache.load()).resolves.toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('deduplicates concurrent load calls', async () => {
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    // Both calls should share the same promise
    await Promise.all([cache.load(), cache.load()]);

    expect(storage.get).toHaveBeenCalledTimes(1);
  });
});

describe('load() with versioning enabled', () => {
  it('clears stale cache when version mismatches', async () => {
    const storage = makeStorage({
      get: vi.fn().mockResolvedValue({
        translationCacheVersion: 99, // not version 1
        translationCache: [['old-key', { result: 'stale', timestamp: 1, sourceLang: 'en', targetLang: 'fi', useCount: 1 }]],
      }),
    });

    const cache = createTranslationCache(storage, () => 'opus-mt', { enableVersioning: true });
    await cache.load();

    // Version mismatch → clear, NOT load entries
    expect(cache.size).toBe(0);
    expect(storage.remove).toHaveBeenCalledWith(
      expect.arrayContaining(['translationCache', 'cacheStats'])
    );
    expect(storage.set).toHaveBeenCalledWith(
      expect.objectContaining({ translationCacheVersion: 1 })
    );
  });

  it('loads entries when version matches', async () => {
    const storage = makeStorage({
      get: vi.fn().mockResolvedValue({
        translationCacheVersion: 1,
        translationCache: [
          ['k1', { result: 'ok', timestamp: 1, sourceLang: 'en', targetLang: 'fi', useCount: 1 }],
        ],
      }),
    });

    const cache = createTranslationCache(storage, () => 'opus-mt', { enableVersioning: true });
    await cache.load();

    expect(cache.size).toBe(1);
  });

  it('includes version key in scheduleSave when versioning enabled', async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt', { enableVersioning: true });
    await cache.load();

    cache.set('k1', 'hello', 'en', 'fi');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    expect(storage.set).toHaveBeenCalledWith(
      expect.objectContaining({ translationCacheVersion: 1 })
    );
    vi.useRealTimers();
  });
});

// ============================================================================
// getKey()
// ============================================================================

describe('getKey()', () => {
  it('uses getProvider() when provider arg is omitted', async () => {
    const { generateCacheKey } = await import('../../core/hash');
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'deepl');

    cache.getKey('hello', 'en', 'fi');

    expect(vi.mocked(generateCacheKey)).toHaveBeenCalledWith('hello', 'en', 'fi', 'deepl');
  });

  it('uses explicit provider arg when provided', async () => {
    const { generateCacheKey } = await import('../../core/hash');
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'default');

    cache.getKey('hello', 'en', 'fi', 'opus-mt');

    expect(vi.mocked(generateCacheKey)).toHaveBeenCalledWith('hello', 'en', 'fi', 'opus-mt');
  });
});

// ============================================================================
// get() / set()
// ============================================================================

describe('get()', () => {
  it('returns undefined on cache miss', async () => {
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    const result = cache.get('nonexistent-key');
    expect(result).toBeUndefined();
    expect(cache.misses).toBe(1);
  });

  it('returns entry on cache hit and increments hit counter', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'translated', 'en', 'fi');
    const result = cache.get('k1');

    expect(result?.result).toBe('translated');
    expect(cache.hits).toBe(1);
    vi.useRealTimers();
  });

  it('increments useCount on hit', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'translated', 'en', 'fi');
    const first = cache.get('k1');
    expect(first?.useCount).toBe(2); // 1 from set + 1 from get

    const second = cache.get('k1');
    expect(second?.useCount).toBe(3);
    vi.useRealTimers();
  });
});

describe('set()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores string result', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'translated text', 'en', 'fi');

    const entry = cache.get('k1');
    expect(entry?.result).toBe('translated text');
    expect(entry?.sourceLang).toBe('en');
    expect(entry?.targetLang).toBe('fi');
  });

  it('stores array result', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', ['a', 'b', 'c'], 'en', 'fi');

    const entry = cache.get('k1');
    expect(entry?.result).toEqual(['a', 'b', 'c']);
  });

  it('schedules a debounced save', async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'hello', 'en', 'fi');
    expect(storage.set).not.toHaveBeenCalled(); // not yet

    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    expect(storage.set).toHaveBeenCalledWith(
      expect.objectContaining({ translationCache: expect.any(Array) })
    );
  });

  it('does not double-schedule save when set is called multiple times', async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'a', 'en', 'fi');
    cache.set('k2', 'b', 'en', 'fi');

    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    // Only one storage.set call for both entries
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  it('handles save error gracefully', async () => {
    vi.useFakeTimers();
    const storage = makeStorage({
      set: vi.fn().mockRejectedValue(new Error('quota exceeded')),
    });
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'hello', 'en', 'fi');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    // Should not throw
    expect(cache.size).toBe(1);
  });
});

// ============================================================================
// LRU eviction
// ============================================================================

describe('LRU eviction', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('evicts least-used entry when maxSize (10) is reached', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    // Fill to maxSize (10 from mocked config)
    for (let i = 0; i < 10; i++) {
      cache.set(`key-${i}`, `val-${i}`, 'en', 'fi');
    }
    expect(cache.size).toBe(10);

    // Add one more — should evict
    cache.set('key-new', 'new-val', 'en', 'fi');
    expect(cache.size).toBe(10);
  });
});

// ============================================================================
// recordMiss()
// ============================================================================

describe('recordMiss()', () => {
  it('increments miss counter', () => {
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.recordMiss();
    cache.recordMiss();

    expect(cache.misses).toBe(2);
  });
});

// ============================================================================
// getStats()
// ============================================================================

describe('getStats()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty stats for empty cache', () => {
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    const stats = cache.getStats();
    expect(stats.size).toBe(0);
    expect(stats.maxSize).toBe(10);
    expect(stats.hitRate).toBe('0/0 (0%)');
    expect(stats.totalHits).toBe(0);
    expect(stats.totalMisses).toBe(0);
    expect(stats.oldestEntry).toBeNull();
    expect(stats.mostUsed).toEqual([]);
    expect(stats.memoryEstimate).toBe('~0KB');
    expect(stats.languagePairs).toEqual({});
  });

  it('calculates hit rate correctly', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'hello', 'en', 'fi');
    cache.get('k1'); // hit
    cache.get('nonexistent'); // miss

    const stats = cache.getStats();
    expect(stats.totalHits).toBe(1);
    expect(stats.totalMisses).toBe(1);
    expect(stats.hitRate).toBe('1/2 (50%)');
  });

  it('tracks oldest entry timestamp', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'a', 'en', 'fi');
    vi.advanceTimersByTime(1000);
    cache.set('k2', 'b', 'en', 'de');

    const stats = cache.getStats();
    expect(stats.oldestEntry).toBeLessThan(Date.now());
    expect(stats.oldestEntry).not.toBeNull();
  });

  it('computes memoryEstimate for array result', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', ['hello', 'world'], 'en', 'fi');

    const stats = cache.getStats();
    // Array result chars = 'hello' + 'world' = 10 chars
    expect(stats.memoryEstimate).toBeDefined();
  });

  it('counts language pairs', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'a', 'en', 'fi');
    cache.set('k2', 'b', 'en', 'fi');
    cache.set('k3', 'c', 'en', 'de');

    const stats = cache.getStats();
    expect(stats.languagePairs['en-fi']).toBe(2);
    expect(stats.languagePairs['en-de']).toBe(1);
  });

  it('returns top 5 most used entries', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    // Add 7 entries with different use counts
    for (let i = 0; i < 7; i++) {
      cache.set(`k-${i}`, `v-${i}`, 'en', 'fi');
      for (let j = 0; j < i; j++) {
        cache.get(`k-${i}`); // use it i times
      }
    }

    const stats = cache.getStats();
    expect(stats.mostUsed.length).toBeLessThanOrEqual(5);
  });
});

// ============================================================================
// flush()
// ============================================================================

describe('flush()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when no pending save timer', () => {
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    // No set() called so no timer pending
    cache.flush();

    expect(storage.set).not.toHaveBeenCalled();
  });

  it('immediately writes when pending save exists', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'hello', 'en', 'fi');
    // Timer is pending — flush should fire now
    cache.flush();

    expect(storage.set).toHaveBeenCalledWith(
      expect.objectContaining({ translationCache: expect.any(Array) })
    );
  });

  it('includes version key when versioning enabled', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt', { enableVersioning: true });

    cache.set('k1', 'hello', 'en', 'fi');
    cache.flush();

    expect(storage.set).toHaveBeenCalledWith(
      expect.objectContaining({ translationCacheVersion: 1 })
    );
  });

  it('handles flush error gracefully', () => {
    vi.useFakeTimers();
    const storage = makeStorage({
      set: vi.fn().mockRejectedValue(new Error('flush failed')),
    });
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'hello', 'en', 'fi');
    expect(() => cache.flush()).not.toThrow();
  });
});

// ============================================================================
// clear()
// ============================================================================

describe('clear()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('empties the in-memory cache', async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'a', 'en', 'fi');
    cache.set('k2', 'b', 'en', 'de');
    expect(cache.size).toBe(2);

    await cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(0);
  });

  it('removes entries from persistent storage', async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    await cache.clear();

    expect(storage.remove).toHaveBeenCalledWith(
      expect.arrayContaining(['translationCache', 'cacheStats'])
    );
  });

  it('also removes version key when versioning enabled', async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt', { enableVersioning: true });

    await cache.clear();

    expect(storage.remove).toHaveBeenCalledWith(
      expect.arrayContaining(['translationCacheVersion'])
    );
  });

  it('cancels pending save timer on clear', async () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    cache.set('k1', 'hello', 'en', 'fi');
    await cache.clear();

    // Advance past debounce — should NOT fire save after clear
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();

    // storage.set should NOT have been called (clear cancelled the timer)
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('handles storage.remove error gracefully', async () => {
    const storage = makeStorage({
      remove: vi.fn().mockRejectedValue(new Error('remove failed')),
    });
    const cache = createTranslationCache(storage, () => 'opus-mt');

    await expect(cache.clear()).resolves.toBeUndefined();
  });
});

// ============================================================================
// size / hits / misses getters
// ============================================================================

describe('size / hits / misses properties', () => {
  it('size reflects number of cached entries', () => {
    vi.useFakeTimers();
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    expect(cache.size).toBe(0);
    cache.set('k1', 'a', 'en', 'fi');
    expect(cache.size).toBe(1);
    vi.useRealTimers();
  });

  it('hits and misses start at zero', () => {
    const storage = makeStorage();
    const cache = createTranslationCache(storage, () => 'opus-mt');

    expect(cache.hits).toBe(0);
    expect(cache.misses).toBe(0);
  });
});
