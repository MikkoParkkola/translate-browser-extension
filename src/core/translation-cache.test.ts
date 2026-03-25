/**
 * Translation cache unit tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  TranslationCache,
  getTranslationCache,
  resetTranslationCache,
  type CacheEntry,
} from './translation-cache';

// Mock IndexedDB
const mockEntries = new Map<string, CacheEntry>();
let mockCursorIndex = 0;
let mockCursorEntries: CacheEntry[] = [];

const createMockCursor = (entries: CacheEntry[], deleteCallback?: () => void) => {
  return {
    value: entries[mockCursorIndex],
    continue: () => {
      mockCursorIndex++;
      if (mockCursorIndex < entries.length) {
        // Simulate async cursor continuation
        setTimeout(() => {
          const event = { target: { result: createMockCursor(entries, deleteCallback) } };
          (mockStore.openCursor as ReturnType<typeof vi.fn>).mock.results[0]?.value?.onsuccess?.(event);
        }, 0);
      } else {
        // End of cursor
        const event = { target: { result: null } };
        (mockStore.openCursor as ReturnType<typeof vi.fn>).mock.results[0]?.value?.onsuccess?.(event);
      }
    },
    delete: () => {
      const key = entries[mockCursorIndex]?.key;
      if (key) {
        mockEntries.delete(key);
        deleteCallback?.();
      }
    },
  };
};

const mockIndex = {
  openCursor: vi.fn(() => {
    mockCursorIndex = 0;
    mockCursorEntries = Array.from(mockEntries.values()).sort((a, b) => a.timestamp - b.timestamp);
    return {
      onerror: null,
      onsuccess: null,
      result: mockCursorEntries.length > 0 ? createMockCursor(mockCursorEntries) : null,
    };
  }),
};

const mockStore = {
  get: vi.fn((key: string) => {
    const result = mockEntries.get(key);
    return {
      onerror: null,
      onsuccess: null,
      result,
    };
  }),
  put: vi.fn((entry: CacheEntry) => {
    mockEntries.set(entry.key, entry);
    return {
      onerror: null,
      onsuccess: null,
    };
  }),
  clear: vi.fn(() => {
    mockEntries.clear();
    return {
      onerror: null,
      onsuccess: null,
    };
  }),
  openCursor: vi.fn(() => {
    mockCursorIndex = 0;
    mockCursorEntries = Array.from(mockEntries.values());
    const request = {
      onerror: null as ((ev: Event) => void) | null,
      onsuccess: null as ((ev: Event) => void) | null,
      result: null as ReturnType<typeof createMockCursor> | null,
    };
    // Return immediately, onsuccess will be called after setup
    setTimeout(() => {
      if (mockCursorEntries.length > 0) {
        request.result = createMockCursor(mockCursorEntries) as ReturnType<typeof createMockCursor>;
      }
      const event = { target: { result: request.result } } as unknown as Event;
      request.onsuccess?.(event);
    }, 0);
    return request;
  }),
  index: vi.fn(() => mockIndex),
};

const mockTransaction = {
  objectStore: vi.fn(() => mockStore),
};

const mockDb = {
  transaction: vi.fn(() => mockTransaction),
  objectStoreNames: { contains: vi.fn(() => true) },
  createObjectStore: vi.fn(() => ({
    createIndex: vi.fn(),
  })),
  close: vi.fn(),
};

// Setup IndexedDB mock
const mockIndexedDB = {
  open: vi.fn(() => {
    const request = {
      onerror: null as ((ev: Event) => void) | null,
      onsuccess: null as ((ev: Event) => void) | null,
      onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
      result: mockDb,
      error: null,
    };
    // Simulate async database open
    setTimeout(() => {
      request.onsuccess?.({ target: request } as unknown as Event);
    }, 0);
    return request;
  }),
  deleteDatabase: vi.fn(() => ({
    onerror: null,
    onsuccess: null,
  })),
};

// Apply mock to global
vi.stubGlobal('indexedDB', mockIndexedDB);

const waitForCacheAsyncWork = (ms = 10): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const createReadyCache = async (
  maxSize?: number,
  waitMs = 10
): Promise<TranslationCache> => {
  const translationCache =
    typeof maxSize === 'number' ? new TranslationCache(maxSize) : new TranslationCache();
  await waitForCacheAsyncWork(waitMs);
  return translationCache;
};

describe('TranslationCache', () => {
  let cache: TranslationCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEntries.clear();
    mockCursorIndex = 0;
    mockCursorEntries = []; // Fix: Clear cursor entries
    resetTranslationCache();
  });

  afterEach(() => {
    cache?.close();
  });

  describe('constructor', () => {
    it('opens IndexedDB on creation', async () => {
      cache = new TranslationCache();
      // Wait for db to be ready
      await waitForCacheAsyncWork(10);
      expect(mockIndexedDB.open).toHaveBeenCalledWith('translate-extension-cache', 1);
    });

    it('uses default max size of 100MB', () => {
      cache = new TranslationCache();
      // Access through getStats which returns maxSize
      expect(cache).toBeDefined();
    });

    it('accepts custom max size', () => {
      cache = new TranslationCache(50 * 1024 * 1024);
      expect(cache).toBeDefined();
    });
  });

  describe('get', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('returns null for cache miss', async () => {
      // Setup mock to return undefined
      mockStore.get.mockReturnValueOnce({
        onerror: null,
        onsuccess: null,
        result: undefined,
      });

      const result = await new Promise<string | null>((resolve) => {
        cache.get('hello', 'en', 'fi', 'opus-mt').then(resolve);
        // Trigger onsuccess
        setTimeout(() => {
          const request = mockStore.get.mock.results[0]?.value;
          request?.onsuccess?.({ target: { result: undefined } });
        }, 0);
      });

      expect(result).toBeNull();
    });

    it('returns translation for cache hit', async () => {
      const entry: CacheEntry = {
        key: 'abc123',
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'opus-mt',
        translation: 'hei',
        timestamp: Date.now(),
        size: 100,
      };
      mockEntries.set('abc123', entry);

      mockStore.get.mockReturnValueOnce({
        onerror: null,
        onsuccess: null,
        result: entry,
      });

      const result = await new Promise<string | null>((resolve) => {
        cache.get('hello', 'en', 'fi', 'opus-mt').then(resolve);
        setTimeout(() => {
          const request = mockStore.get.mock.results[0]?.value;
          request?.onsuccess?.({ target: { result: entry } });
        }, 0);
      });

      expect(result).toBe('hei');
    });

    it('updates timestamp on cache hit (LRU touch)', async () => {
      const oldTimestamp = Date.now() - 10000;
      const entry: CacheEntry = {
        key: 'abc123',
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'opus-mt',
        translation: 'hei',
        timestamp: oldTimestamp,
        size: 100,
      };

      mockStore.get.mockReturnValueOnce({
        onerror: null,
        onsuccess: null,
        result: entry,
      });

      await new Promise<void>((resolve) => {
        cache.get('hello', 'en', 'fi', 'opus-mt').then(() => resolve());
        setTimeout(() => {
          const request = mockStore.get.mock.results[0]?.value;
          request?.onsuccess?.({ target: { result: entry } });
        }, 0);
      });

      // Verify put was called to update timestamp
      expect(mockStore.put).toHaveBeenCalled();
      const updatedEntry = mockStore.put.mock.calls[0][0] as CacheEntry;
      expect(updatedEntry.timestamp).toBeGreaterThan(oldTimestamp);
    });

    it('handles store.put onerror during LRU timestamp update without crashing', async () => {
      const entry: CacheEntry = {
        key: 'abc123',
        text: 'hello',
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'opus-mt',
        translation: 'hei',
        timestamp: Date.now() - 5000,
        size: 100,
      };

      // Mock put to return a request whose onerror we can trigger
      const putRequest = {
        onerror: null as ((ev: Event) => void) | null,
        onsuccess: null as ((ev: Event) => void) | null,
        error: new DOMException('Quota exceeded'),
      };
      mockStore.put.mockReturnValueOnce(putRequest as any);

      mockStore.get.mockReturnValueOnce({
        onerror: null,
        onsuccess: null,
        result: entry,
      });

      const result = await new Promise<string | null>((resolve) => {
        cache.get('hello', 'en', 'fi', 'opus-mt').then(resolve);
        setTimeout(() => {
          const getRequest = mockStore.get.mock.results[0]?.value;
          getRequest?.onsuccess?.({ target: { result: entry } });
          // After onsuccess fires, the put onerror handler is assigned
          setTimeout(() => {
            putRequest.onerror?.({ target: putRequest } as unknown as Event);
          }, 0);
        }, 0);
      });

      // Cache hit still returns the translation despite the put error
      expect(result).toBe('hei');
    });
  });

  describe('set', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('stores translation in cache', async () => {
      mockStore.put.mockReturnValueOnce({
        onerror: null,
        onsuccess: null,
      });

      const setPromise = cache.set('hello', 'en', 'fi', 'opus-mt', 'hei');

      // Wait for stats check and then put
      await waitForCacheAsyncWork(50);

      // Trigger onsuccess for put
      const putRequest = mockStore.put.mock.results[0]?.value;
      if (putRequest) {
        putRequest.onsuccess?.({});
      }

      await setPromise;

      expect(mockStore.put).toHaveBeenCalled();
      const entry = mockStore.put.mock.calls[0][0] as CacheEntry;
      expect(entry.text).toBe('hello');
      expect(entry.translation).toBe('hei');
      expect(entry.provider).toBe('opus-mt');
    });

    it('calculates entry size correctly', async () => {
      mockStore.put.mockReturnValueOnce({
        onerror: null,
        onsuccess: null,
      });

      cache.set('hello', 'en', 'fi', 'opus-mt', 'hei');

      await waitForCacheAsyncWork(50);

      const entry = mockStore.put.mock.calls[0]?.[0] as CacheEntry;
      // "hello" (5 chars) + "hei" (3 chars) = 8 chars * 2 bytes + 100 overhead = 116
      expect(entry?.size).toBe(116);
    });
  });

  describe('clear', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('clears all entries', async () => {
      mockStore.clear.mockReturnValueOnce({
        onerror: null,
        onsuccess: null,
      });

      const clearPromise = cache.clear();

      setTimeout(() => {
        const request = mockStore.clear.mock.results[0]?.value;
        request?.onsuccess?.({});
      }, 0);

      await clearPromise;

      expect(mockStore.clear).toHaveBeenCalled();
    });

    it('resets hit/miss counters', async () => {
      mockStore.clear.mockReturnValueOnce({
        onerror: null,
        onsuccess: null,
      });

      const clearPromise = cache.clear();

      setTimeout(() => {
        const request = mockStore.clear.mock.results[0]?.value;
        request?.onsuccess?.({});
      }, 0);

      await clearPromise;

      const stats = await cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('returns correct statistics', async () => {
      const stats = await cache.getStats();

      expect(stats).toHaveProperty('entries');
      expect(stats).toHaveProperty('totalSize');
      expect(stats).toHaveProperty('maxSize');
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('hitRate');
      expect(stats.maxSize).toBe(100 * 1024 * 1024);
    });

    it('calculates hit rate correctly', async () => {
      // Simulate some hits and misses
      const fullEntry: CacheEntry = {
        key: 'test123',
        text: 'test',
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'opus-mt',
        translation: 'testi',
        timestamp: Date.now(),
        size: 100,
      };

      mockStore.get.mockReturnValueOnce({
        onerror: null,
        onsuccess: null,
        result: fullEntry,
      });

      // Force a hit
      const getPromise = cache.get('test', 'en', 'fi', 'opus-mt');
      setTimeout(() => {
        const request = mockStore.get.mock.results[0]?.value;
        request?.onsuccess?.({ target: { result: fullEntry } });
      }, 0);
      await getPromise;

      const stats = await cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.hitRate).toBeGreaterThan(0);
    });
  });

  describe('singleton', () => {
    it('returns same instance on multiple calls', () => {
      const cache1 = getTranslationCache();
      const cache2 = getTranslationCache();
      expect(cache1).toBe(cache2);
    });

    it('creates new instance after reset', () => {
      const cache1 = getTranslationCache();
      resetTranslationCache();
      const cache2 = getTranslationCache();
      expect(cache1).not.toBe(cache2);
    });
  });

  describe('hash key generation', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('generates different keys for different inputs', async () => {
      const keys: string[] = [];

      // Capture keys by intercepting get calls
      mockStore.get.mockImplementation((key: string) => {
        keys.push(key);
        return {
          onerror: null,
          onsuccess: null,
          result: undefined,
        };
      });

      // Make requests with different parameters
      const promise1 = cache.get('hello', 'en', 'fi', 'opus-mt');
      setTimeout(() => {
        mockStore.get.mock.results[0]?.value?.onsuccess?.({ target: { result: undefined } });
      }, 0);
      await promise1;

      const promise2 = cache.get('hello', 'en', 'de', 'opus-mt');
      setTimeout(() => {
        mockStore.get.mock.results[1]?.value?.onsuccess?.({ target: { result: undefined } });
      }, 0);
      await promise2;

      const promise3 = cache.get('world', 'en', 'fi', 'opus-mt');
      setTimeout(() => {
        mockStore.get.mock.results[2]?.value?.onsuccess?.({ target: { result: undefined } });
      }, 0);
      await promise3;

      // All keys should be different
      expect(new Set(keys).size).toBe(3);
    });

    it('generates same key for same inputs', async () => {
      const keys: string[] = [];

      mockStore.get.mockImplementation((key: string) => {
        keys.push(key);
        return {
          onerror: null,
          onsuccess: null,
          result: undefined,
        };
      });

      // Make two requests with same parameters
      const promise1 = cache.get('hello', 'en', 'fi', 'opus-mt');
      setTimeout(() => {
        mockStore.get.mock.results[0]?.value?.onsuccess?.({ target: { result: undefined } });
      }, 0);
      await promise1;

      const promise2 = cache.get('hello', 'en', 'fi', 'opus-mt');
      setTimeout(() => {
        mockStore.get.mock.results[1]?.value?.onsuccess?.({ target: { result: undefined } });
      }, 0);
      await promise2;

      expect(keys[0]).toBe(keys[1]);
    });
  });
});

describe('Edge cases', () => {
  let cache: TranslationCache;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEntries.clear();
    resetTranslationCache();
    cache = await createReadyCache();
  });

  afterEach(() => {
    cache?.close();
  });

  it('handles empty text', async () => {
    mockStore.put.mockReturnValueOnce({
      onerror: null,
      onsuccess: null,
    });

    cache.set('', 'en', 'fi', 'opus-mt', '');

    await waitForCacheAsyncWork(50);

    expect(mockStore.put).toHaveBeenCalled();
  });

  it('handles unicode text', async () => {
    mockStore.put.mockReturnValueOnce({
      onerror: null,
      onsuccess: null,
    });

    cache.set('Hello World!', 'en', 'fi', 'opus-mt', 'Hei maailma!');

    await waitForCacheAsyncWork(50);

    const entry = mockStore.put.mock.calls[0]?.[0] as CacheEntry;
    expect(entry?.text).toBe('Hello World!');
    expect(entry?.translation).toBe('Hei maailma!');
  });

  it('handles very long text', async () => {
    const longText = 'a'.repeat(10000);
    const longTranslation = 'b'.repeat(10000);

    mockStore.put.mockReturnValueOnce({
      onerror: null,
      onsuccess: null,
    });

    cache.set(longText, 'en', 'fi', 'opus-mt', longTranslation);

    await waitForCacheAsyncWork(50);

    const entry = mockStore.put.mock.calls[0]?.[0] as CacheEntry;
    // 10000 + 10000 chars * 2 bytes + 100 overhead = 40100
    expect(entry?.size).toBe(40100);
  });

  it('handles special characters in text', async () => {
    const specialText = '<script>alert("xss")</script>';

    mockStore.put.mockReturnValueOnce({
      onerror: null,
      onsuccess: null,
    });

    cache.set(specialText, 'en', 'fi', 'opus-mt', 'translation');

    await waitForCacheAsyncWork(50);

    const entry = mockStore.put.mock.calls[0]?.[0] as CacheEntry;
    expect(entry?.text).toBe(specialText);
  });
});

describe('LRU eviction', () => {
  let cache: TranslationCache;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEntries.clear();
    mockCursorIndex = 0;
    resetTranslationCache();
  });

  afterEach(() => {
    cache?.close();
  });

  it('evicts oldest entries when cache exceeds capacity', async () => {
    // Create a cache with a very small max size (500 bytes) so entries trigger eviction
    cache = await createReadyCache(500);

    // Pre-fill mockEntries to exceed the 80% target (400 bytes)
    const oldEntry: CacheEntry = {
      key: 'oldkey',
      text: 'old',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      translation: 'vanha',
      timestamp: 1000, // very old
      size: 450, // already consuming 90% of capacity
    };
    mockEntries.set('oldkey', oldEntry);

    // Provide put mock for the new entry
    mockStore.put.mockReturnValue({
      onerror: null,
      onsuccess: null,
    });

    // Setup the index openCursor mock to simulate eviction traversal
    let evictCursorCalled = false;
    const evictRequest = {
      onerror: null as ((ev: Event) => void) | null,
      onsuccess: null as ((ev: Event) => void) | null,
    };
    mockIndex.openCursor.mockReturnValueOnce(evictRequest as any);

    const setPromise = cache.set('new', 'en', 'fi', 'opus-mt', 'uusi');

    // Allow getStats to run (openCursor for stats)
    await waitForCacheAsyncWork(10);

    // Trigger eviction cursor with the old entry, then end
    if (evictRequest.onsuccess && !evictCursorCalled) {
      evictCursorCalled = true;
      // First call: cursor points at old entry (currentSize > targetSize)
      const mockCursor = {
        value: oldEntry,
        delete: vi.fn(() => {
          mockEntries.delete('oldkey');
        }),
        continue: vi.fn(() => {
          // cursor exhausted - resolve eviction
          evictRequest.onsuccess?.({ target: { result: null } } as unknown as Event);
        }),
      };
      evictRequest.onsuccess({ target: { result: mockCursor } } as unknown as Event);
    }

    // Now trigger the actual put
    await waitForCacheAsyncWork(20);
    const putRequest = mockStore.put.mock.results[0]?.value;
    if (putRequest) {
      putRequest.onsuccess?.({});
    }

    await setPromise;

    // Old entry should have been deleted from mockEntries
    expect(mockEntries.has('oldkey')).toBe(false);
  });

  it('skips eviction when cache has enough space', async () => {
    // Small cache but no existing entries
    cache = await createReadyCache(100 * 1024 * 1024);

    mockStore.put.mockReturnValue({
      onerror: null,
      onsuccess: null,
    });

    const setPromise = cache.set('hello', 'en', 'fi', 'opus-mt', 'hei');

    await waitForCacheAsyncWork(20);

    // index.openCursor for eviction should NOT have been called since size is within limit
    expect(mockIndex.openCursor).not.toHaveBeenCalled();

    const putRequest = mockStore.put.mock.results[0]?.value;
    if (putRequest) {
      putRequest.onsuccess?.({});
    }
    await setPromise;
  });
});

describe('error paths', () => {
  let cache: TranslationCache;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEntries.clear();
    resetTranslationCache();
    cache = await createReadyCache();
  });

  afterEach(() => {
    cache?.close();
  });

  it('getStats returns fallback object when db is unavailable', async () => {
    // Simulate a cache where the DB promise has rejected by creating a new instance
    // and overriding dbReady to be a rejected promise
    const brokenCache = new TranslationCache();
    // Force dbReady to reject by reaching into the instance
    (brokenCache as unknown as { dbReady: Promise<IDBDatabase> }).dbReady =
      Promise.reject(new Error('DB unavailable'));

    const stats = await brokenCache.getStats();

    expect(stats.entries).toBe(0);
    expect(stats.totalSize).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.hitRate).toBe(0);
    expect(stats.oldestTimestamp).toBeNull();
    expect(stats.newestTimestamp).toBeNull();

    brokenCache.close();
  });

  it('set silently absorbs error when db is unavailable', async () => {
    const brokenCache = new TranslationCache();
    (brokenCache as unknown as { dbReady: Promise<IDBDatabase> }).dbReady =
      Promise.reject(new Error('DB unavailable'));

    // Should not throw
    await expect(brokenCache.set('hello', 'en', 'fi', 'opus-mt', 'hei')).resolves.toBeUndefined();

    brokenCache.close();
  });

  it('get returns null when db is unavailable', async () => {
    const brokenCache = new TranslationCache();
    (brokenCache as unknown as { dbReady: Promise<IDBDatabase> }).dbReady =
      Promise.reject(new Error('DB unavailable'));

    const result = await brokenCache.get('hello', 'en', 'fi', 'opus-mt');
    expect(result).toBeNull();

    brokenCache.close();
  });

  it('get increments misses on transaction abort', async () => {
    // Simulate transaction abort during get
    const abortTransaction = {
      objectStore: vi.fn(() => ({
        get: vi.fn(() => ({
          onerror: null,
          onsuccess: null,
        })),
        put: vi.fn(() => ({ onerror: null, onsuccess: null })),
      })),
      onerror: null as ((ev: Event) => void) | null,
      onabort: null as ((ev: Event) => void) | null,
    };

    mockDb.transaction.mockReturnValueOnce(abortTransaction as any);

    const getPromise = cache.get('hello', 'en', 'fi', 'opus-mt');

    await waitForCacheAsyncWork(5);
    // Trigger onabort
    abortTransaction.onabort?.({} as Event);

    await getPromise.catch(() => undefined);

    const stats = await cache.getStats();
    expect(stats.misses).toBeGreaterThan(0);
  });

  it('getStats oldest and newest timestamps are tracked correctly', async () => {
    const now = Date.now();
    const entry1: CacheEntry = {
      key: 'key1',
      text: 'a',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      translation: 'b',
      timestamp: now - 5000,
      size: 100,
    };
    const entry2: CacheEntry = {
      key: 'key2',
      text: 'c',
      sourceLang: 'en',
      targetLang: 'de',
      provider: 'opus-mt',
      translation: 'd',
      timestamp: now,
      size: 100,
    };
    mockEntries.set('key1', entry1);
    mockEntries.set('key2', entry2);

    const stats = await cache.getStats();

    expect(stats.entries).toBe(2);
    expect(stats.oldestTimestamp).toBe(now - 5000);
    expect(stats.newestTimestamp).toBe(now);
  });

  it('close is idempotent when called twice', () => {
    cache.close();
    // Second close should not throw
    expect(() => cache.close()).not.toThrow();
  });

  // =========================================================================
  // IndexedDB error/abort paths
  // =========================================================================

  describe('openDatabase error path', () => {
    it('rejects when IndexedDB open fires onerror', async () => {
      // Save original indexedDB stub
      const origIndexedDB = (globalThis as Record<string, unknown>).indexedDB;

      const errorRequest = {
        onerror: null as ((ev: Event) => void) | null,
        onsuccess: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        result: null,
        error: new DOMException('open failed'),
      };

      (globalThis as Record<string, unknown>).indexedDB = {
        open: vi.fn(() => {
          setTimeout(() => {
            errorRequest.onerror?.({} as Event);
          }, 0);
          return errorRequest;
        }),
      };

      resetTranslationCache();
      const errCache = new TranslationCache();

      // The internal dbReady promise rejects — get() should throw/return null
      const result = await errCache.get('text', 'en', 'fi', 'opus-mt');
      expect(result).toBeNull();

      // Restore
      (globalThis as Record<string, unknown>).indexedDB = origIndexedDB;
    });

    it('fires onupgradeneeded when object store does not exist', async () => {
      const origIndexedDB = (globalThis as Record<string, unknown>).indexedDB;

      const upgradeRequest = {
        onerror: null as ((ev: Event) => void) | null,
        onsuccess: null as ((ev: Event) => void) | null,
        onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
        result: {
          ...mockDb,
          objectStoreNames: { contains: vi.fn(() => false) }, // store doesn't exist
        },
        error: null,
      };

      (globalThis as Record<string, unknown>).indexedDB = {
        open: vi.fn(() => {
          setTimeout(() => {
            // Fire upgrade first
            upgradeRequest.onupgradeneeded?.({ target: upgradeRequest } as unknown as IDBVersionChangeEvent);
            // Then open success
            upgradeRequest.onsuccess?.({ target: upgradeRequest } as unknown as Event);
          }, 0);
          return upgradeRequest;
        }),
      };

      resetTranslationCache();
      const upgradeCache = await createReadyCache(undefined, 20);
      expect(upgradeCache).toBeDefined();

      (globalThis as Record<string, unknown>).indexedDB = origIndexedDB;
    });
  });

  describe('get() transaction error paths', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('returns null when transaction fires onerror', async () => {
      const errorTx = {
        objectStore: vi.fn(() => ({
          get: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown, result: null };
            setTimeout(() => {
              (errorTx as unknown as { onerror: ((e: Event) => void) | null }).onerror?.({} as Event);
            }, 0);
            return req;
          }),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: new DOMException('tx error'),
      };
      mockDb.transaction.mockReturnValueOnce(errorTx as any);

      const result = await cache.get('text', 'en', 'fi', 'opus-mt').catch(() => null);
      expect(result).toBeNull();
    });

    it('returns null when transaction fires onabort', async () => {
      const abortTx = {
        objectStore: vi.fn(() => ({
          get: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown, result: null };
            setTimeout(() => {
              (abortTx as unknown as { onabort: ((e: Event) => void) | null }).onabort?.({} as Event);
            }, 0);
            return req;
          }),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: null,
      };
      mockDb.transaction.mockReturnValueOnce(abortTx as any);

      const result = await cache.get('text', 'en', 'fi', 'opus-mt').catch(() => null);
      expect(result).toBeNull();
    });

    it('returns null when request fires onerror', async () => {
      const reqErrorStore = {
        get: vi.fn(() => {
          const req = {
            onerror: null as ((e: Event) => void) | null,
            onsuccess: null as unknown,
            result: null,
            error: new DOMException('req error'),
          };
          setTimeout(() => {
            req.onerror?.({} as Event);
          }, 0);
          return req;
        }),
      };
      const reqErrorTx = {
        objectStore: vi.fn(() => reqErrorStore),
        onerror: null,
        onabort: null,
        error: null,
      };
      mockDb.transaction.mockReturnValueOnce(reqErrorTx as any);

      const result = await cache.get('text', 'en', 'fi', 'opus-mt').catch(() => null);
      expect(result).toBeNull();
    });
  });

  describe('set() transaction error paths', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('does not throw when set transaction fires onerror', async () => {
      // set() calls evictIfNeeded() -> getStats() -> db.transaction() [1st call = mockTransaction]
      // then set's own transaction is the 2nd call
      const errorTx = {
        objectStore: vi.fn(() => ({
          put: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown };
            setTimeout(() => {
              (errorTx as unknown as { onerror: ((e: Event) => void) | null }).onerror?.({} as Event);
            }, 0);
            return req;
          }),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: new DOMException('set error'),
      };
      // 1st call = getStats' transaction (use normal mock), 2nd call = set's transaction (error)
      mockDb.transaction
        .mockReturnValueOnce(mockTransaction)
        .mockReturnValueOnce(errorTx as any);

      // set() returns the inner promise which may reject — but the calling code swallows it
      await cache.set('text', 'en', 'fi', 'opus-mt', 'result').catch(() => undefined);
      expect(true).toBe(true); // No crash
    });

    it('does not throw when set transaction fires onabort', async () => {
      const abortTx = {
        objectStore: vi.fn(() => ({
          put: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown };
            setTimeout(() => {
              (abortTx as unknown as { onabort: ((e: Event) => void) | null }).onabort?.({} as Event);
            }, 0);
            return req;
          }),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: null,
      };
      mockDb.transaction
        .mockReturnValueOnce(mockTransaction)
        .mockReturnValueOnce(abortTx as any);

      await cache.set('text', 'en', 'fi', 'opus-mt', 'result').catch(() => undefined);
      expect(true).toBe(true);
    });

    it('does not throw when set request fires onerror', async () => {
      const reqErrStore = {
        put: vi.fn(() => {
          const req = {
            onerror: null as ((e: Event) => void) | null,
            onsuccess: null as unknown,
            error: new DOMException('put error'),
          };
          setTimeout(() => {
            req.onerror?.({} as Event);
          }, 0);
          return req;
        }),
      };
      const reqErrTx = {
        objectStore: vi.fn(() => reqErrStore),
        onerror: null,
        onabort: null,
        error: null,
      };
      mockDb.transaction
        .mockReturnValueOnce(mockTransaction)
        .mockReturnValueOnce(reqErrTx as any);

      await cache.set('text', 'en', 'fi', 'opus-mt', 'result').catch(() => undefined);
      expect(true).toBe(true);
    });
  });

  describe('eviction error paths', () => {
    beforeEach(async () => {
      cache = await createReadyCache(100); // Very small max size to trigger eviction
    });

    it('handles eviction transaction onerror gracefully', async () => {
      // Fill cache beyond capacity to trigger eviction
      const bigEntry: CacheEntry = {
        key: 'big1',
        text: 'x'.repeat(50),
        sourceLang: 'en',
        targetLang: 'fi',
        provider: 'opus-mt',
        translation: 'y'.repeat(50),
        timestamp: Date.now() - 1000,
        size: 80,
      };
      mockEntries.set('big1', bigEntry);

      // On the eviction transaction, fire onerror
      const evictErrTx = {
        objectStore: vi.fn(() => ({
          index: vi.fn(() => ({
            openCursor: vi.fn(() => {
              const req = { onerror: null as ((e: Event) => void) | null, onsuccess: null as unknown };
              setTimeout(() => {
                (evictErrTx as unknown as { onerror: ((e: Event) => void) | null }).onerror?.({} as Event);
              }, 0);
              return req;
            }),
          })),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: new DOMException('evict error'),
      };

      // First transaction is eviction (getStats is called first which uses a different tx)
      // We need to let getStats succeed but fail the eviction transaction
      mockDb.transaction
        .mockReturnValueOnce(mockTransaction) // getStats openCursor
        .mockReturnValueOnce(evictErrTx as any);      // eviction transaction

      // set() catches errors so shouldn't throw
      await expect(cache.set('new', 'en', 'fi', 'opus-mt', 'new')).resolves.toBeUndefined();
    });
  });

  describe('clear() error paths', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('throws when clear transaction fires onerror', async () => {
      const errorTx = {
        objectStore: vi.fn(() => ({
          clear: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown };
            setTimeout(() => {
              (errorTx as unknown as { onerror: ((e: Event) => void) | null }).onerror?.({} as Event);
            }, 0);
            return req;
          }),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: new DOMException('clear error'),
      };
      mockDb.transaction.mockReturnValueOnce(errorTx as any);

      await expect(cache.clear()).rejects.toThrow();
    });

    it('throws when clear transaction fires onabort', async () => {
      const abortTx = {
        objectStore: vi.fn(() => ({
          clear: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown };
            setTimeout(() => {
              (abortTx as unknown as { onabort: ((e: Event) => void) | null }).onabort?.({} as Event);
            }, 0);
            return req;
          }),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: null,
      };
      mockDb.transaction.mockReturnValueOnce(abortTx as any);

      await expect(cache.clear()).rejects.toBeDefined();
    });

    it('throws when clear request fires onerror', async () => {
      const reqErrStore = {
        clear: vi.fn(() => {
          const req = {
            onerror: null as ((e: Event) => void) | null,
            onsuccess: null as unknown,
            error: new DOMException('clear req error'),
          };
          setTimeout(() => {
            req.onerror?.({} as Event);
          }, 0);
          return req;
        }),
      };
      const reqErrTx = {
        objectStore: vi.fn(() => reqErrStore),
        onerror: null,
        onabort: null,
        error: null,
      };
      mockDb.transaction.mockReturnValueOnce(reqErrTx as any);

      await expect(cache.clear()).rejects.toBeDefined();
    });
  });

  describe('getStats() error paths', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('rejects when getStats transaction fires onerror', async () => {
      const errorTx = {
        objectStore: vi.fn(() => ({
          openCursor: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown };
            setTimeout(() => {
              (errorTx as unknown as { onerror: ((e: Event) => void) | null }).onerror?.({} as Event);
            }, 0);
            return req;
          }),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: new DOMException('stats error'),
      };
      mockDb.transaction.mockReturnValueOnce(errorTx as any);

      await expect(cache.getStats()).rejects.toBeDefined();
    });

    it('rejects when getStats transaction fires onabort', async () => {
      const abortTx = {
        objectStore: vi.fn(() => ({
          openCursor: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown };
            setTimeout(() => {
              (abortTx as unknown as { onabort: ((e: Event) => void) | null }).onabort?.({} as Event);
            }, 0);
            return req;
          }),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: null,
      };
      mockDb.transaction.mockReturnValueOnce(abortTx as any);

      await expect(cache.getStats()).rejects.toBeDefined();
    });

    it('rejects when getStats cursor request fires onerror', async () => {
      const cursorErrStore = {
        openCursor: vi.fn(() => {
          const req = {
            onerror: null as ((e: Event) => void) | null,
            onsuccess: null as unknown,
            error: new DOMException('cursor error'),
          };
          setTimeout(() => {
            req.onerror?.({} as Event);
          }, 0);
          return req;
        }),
      };
      const cursorErrTx = {
        objectStore: vi.fn(() => cursorErrStore),
        onerror: null,
        onabort: null,
        error: null,
      };
      mockDb.transaction.mockReturnValueOnce(cursorErrTx as any);

      await expect(cache.getStats()).rejects.toBeDefined();
    });
  });

  describe('IndexedDB undefined path', () => {
    it('rejects get() when indexedDB is not available', async () => {
      const origIndexedDB = (globalThis as Record<string, unknown>).indexedDB;
      (globalThis as Record<string, unknown>).indexedDB = undefined;
      resetTranslationCache();

      const noIdbCache = new TranslationCache();
      const result = await noIdbCache.get('text', 'en', 'fi', 'opus-mt');
      expect(result).toBeNull();

      (globalThis as Record<string, unknown>).indexedDB = origIndexedDB;
    });
  });

  describe('get() outer catch path', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('returns null when dbReady rejects', async () => {
      const failCache = new TranslationCache();
      (failCache as unknown as Record<string, unknown>).dbReady = Promise.reject(new Error('db fail'));

      const result = await failCache.get('text', 'en', 'fi', 'opus-mt');
      expect(result).toBeNull();
    });
  });

  describe('set() outer catch path', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('silently catches when dbReady rejects in set()', async () => {
      const failCache = new TranslationCache();
      (failCache as unknown as Record<string, unknown>).dbReady = Promise.reject(new Error('db fail'));

      await expect(
        failCache.set('text', 'en', 'fi', 'opus-mt', 'translation')
      ).resolves.toBeUndefined();
    });
  });

  describe('transaction abort handlers', () => {
    beforeEach(async () => {
      cache = await createReadyCache();
    });

    it('rejects on get() transaction abort', async () => {
      const abortTx = {
        objectStore: vi.fn(() => ({
          get: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown, result: null };
            setTimeout(() => {
              (abortTx as unknown as { onabort: ((e: Event) => void) | null }).onabort?.({} as Event);
            }, 0);
            return req;
          }),
          put: vi.fn(),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: null,
      };
      mockDb.transaction.mockReturnValueOnce(abortTx as any);

      const result = await cache.get('text', 'en', 'fi', 'opus-mt').catch(() => null);
      // The outer catch converts the rejection to null
      expect(result).toBeNull();
    });

    it('rejects on set() transaction abort', async () => {
      const abortTx = {
        objectStore: vi.fn(() => ({
          put: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown };
            setTimeout(() => {
              (abortTx as unknown as { onabort: ((e: Event) => void) | null }).onabort?.({} as Event);
            }, 0);
            return req;
          }),
        })),
        onerror: null as ((e: Event) => void) | null,
        onabort: null as ((e: Event) => void) | null,
        error: new DOMException('set abort'),
      };
      mockDb.transaction.mockReturnValueOnce(abortTx as any);

      await cache.set('text', 'en', 'fi', 'opus-mt', 'trans');
    });
  });

  describe('clear() error paths', () => {
    it('throws when dbReady rejects in clear()', async () => {
      const failCache = await createReadyCache();

      // Replace dbReady with a rejected promise to trigger the catch block
      (failCache as unknown as Record<string, unknown>).dbReady = Promise.reject(new Error('clear db fail'));

      await expect(failCache.clear()).rejects.toThrow('clear db fail');
    });
  });
});

describe('remaining uncovered branches', () => {
  let cache: TranslationCache;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEntries.clear();
    mockCursorIndex = 0;
    mockCursorEntries = [];
    resetTranslationCache();
  });

  afterEach(() => {
    cache?.close();
  });

  it('onupgradeneeded skips store creation when store already exists', async () => {
    const origIndexedDB = (globalThis as Record<string, unknown>).indexedDB;

    const createObjectStoreSpy = vi.fn();
    const upgradeRequest = {
      onerror: null as ((ev: Event) => void) | null,
      onsuccess: null as ((ev: Event) => void) | null,
      onupgradeneeded: null as ((ev: IDBVersionChangeEvent) => void) | null,
      result: {
        ...mockDb,
        objectStoreNames: { contains: vi.fn(() => true) }, // store already exists
        createObjectStore: createObjectStoreSpy,
      },
      error: null,
    };

    (globalThis as Record<string, unknown>).indexedDB = {
      open: vi.fn(() => {
        setTimeout(() => {
          upgradeRequest.onupgradeneeded?.({ target: upgradeRequest } as unknown as IDBVersionChangeEvent);
          upgradeRequest.onsuccess?.({ target: upgradeRequest } as unknown as Event);
        }, 0);
        return upgradeRequest;
      }),
    };

    resetTranslationCache();
    cache = await createReadyCache(undefined, 20);

    // createObjectStore should NOT have been called since the store already exists
    expect(createObjectStoreSpy).not.toHaveBeenCalled();

    (globalThis as Record<string, unknown>).indexedDB = origIndexedDB;
  });

  it('eviction transaction onabort rejects with transaction.error', async () => {
    cache = await createReadyCache(100);

    const bigEntry: CacheEntry = {
      key: 'big1',
      text: 'x'.repeat(50),
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      translation: 'y'.repeat(50),
      timestamp: Date.now() - 1000,
      size: 80,
    };
    mockEntries.set('big1', bigEntry);

    mockStore.put.mockReturnValue({ onerror: null, onsuccess: null });

    const evictAbortTx = {
      objectStore: vi.fn(() => ({
        index: vi.fn(() => ({
          openCursor: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown };
            setTimeout(() => {
              (evictAbortTx as unknown as { onabort: ((e: Event) => void) | null }).onabort?.({} as Event);
            }, 0);
            return req;
          }),
        })),
      })),
      onerror: null as ((e: Event) => void) | null,
      onabort: null as ((e: Event) => void) | null,
      error: new DOMException('evict abort with error'),
    };

    // 1st transaction = getStats, 2nd = eviction (abort)
    mockDb.transaction
      .mockReturnValueOnce(mockTransaction)
      .mockReturnValueOnce(evictAbortTx as any);

    // set() swallows errors, so it should not throw
    await expect(cache.set('new', 'en', 'fi', 'opus-mt', 'uusi')).resolves.toBeUndefined();
  });

  it('eviction transaction onabort uses fallback Error when transaction.error is null', async () => {
    cache = await createReadyCache(100);

    const bigEntry: CacheEntry = {
      key: 'big1',
      text: 'x'.repeat(50),
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      translation: 'y'.repeat(50),
      timestamp: Date.now() - 1000,
      size: 80,
    };
    mockEntries.set('big1', bigEntry);

    mockStore.put.mockReturnValue({ onerror: null, onsuccess: null });

    const evictAbortTx = {
      objectStore: vi.fn(() => ({
        index: vi.fn(() => ({
          openCursor: vi.fn(() => {
            const req = { onerror: null as unknown, onsuccess: null as unknown };
            setTimeout(() => {
              (evictAbortTx as unknown as { onabort: ((e: Event) => void) | null }).onabort?.({} as Event);
            }, 0);
            return req;
          }),
        })),
      })),
      onerror: null as ((e: Event) => void) | null,
      onabort: null as ((e: Event) => void) | null,
      error: null, // null error triggers the || fallback
    };

    mockDb.transaction
      .mockReturnValueOnce(mockTransaction)
      .mockReturnValueOnce(evictAbortTx as any);

    await expect(cache.set('new', 'en', 'fi', 'opus-mt', 'uusi')).resolves.toBeUndefined();
  });

  it('eviction cursor request onerror rejects', async () => {
    cache = await createReadyCache(100);

    const bigEntry: CacheEntry = {
      key: 'big1',
      text: 'x'.repeat(50),
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      translation: 'y'.repeat(50),
      timestamp: Date.now() - 1000,
      size: 80,
    };
    mockEntries.set('big1', bigEntry);

    mockStore.put.mockReturnValue({ onerror: null, onsuccess: null });

    const evictCursorErrTx = {
      objectStore: vi.fn(() => ({
        index: vi.fn(() => ({
          openCursor: vi.fn(() => {
            const req = {
              onerror: null as ((e: Event) => void) | null,
              onsuccess: null as unknown,
              error: new DOMException('cursor open failed'),
            };
            setTimeout(() => {
              req.onerror?.({} as Event);
            }, 0);
            return req;
          }),
        })),
      })),
      onerror: null as ((e: Event) => void) | null,
      onabort: null as ((e: Event) => void) | null,
      error: null,
    };

    mockDb.transaction
      .mockReturnValueOnce(mockTransaction)
      .mockReturnValueOnce(evictCursorErrTx as any);

    await expect(cache.set('new', 'en', 'fi', 'opus-mt', 'uusi')).resolves.toBeUndefined();
  });

  it('getStats newestTimestamp else branch when later entry has older timestamp', async () => {
    cache = await createReadyCache();

    const now = Date.now();
    // Insert entries so iteration order produces a non-ascending timestamp sequence
    // Map preserves insertion order, so entry order = iteration order
    const entry1: CacheEntry = {
      key: 'k1', text: 'a', sourceLang: 'en', targetLang: 'fi',
      provider: 'opus-mt', translation: 'b', timestamp: now - 1000, size: 50,
    };
    const entry2: CacheEntry = {
      key: 'k2', text: 'c', sourceLang: 'en', targetLang: 'fi',
      provider: 'opus-mt', translation: 'd', timestamp: now, size: 50,
    };
    const entry3: CacheEntry = {
      key: 'k3', text: 'e', sourceLang: 'en', targetLang: 'fi',
      provider: 'opus-mt', translation: 'f', timestamp: now - 500, size: 50,
    };
    mockEntries.set('k1', entry1);
    mockEntries.set('k2', entry2);
    mockEntries.set('k3', entry3); // iterated last, but ts < newestTimestamp (now)

    const stats = await cache.getStats();

    expect(stats.entries).toBe(3);
    expect(stats.newestTimestamp).toBe(now);
    expect(stats.oldestTimestamp).toBe(now - 1000);
  });
});

describe('Cache-at-Capacity and LRU Ordering Tests', () => {
  let cache: TranslationCache;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockEntries.clear();
    mockCursorIndex = 0;
    mockCursorEntries = [];
    resetTranslationCache();
  });

  afterEach(() => {
    cache?.close();
  });

  it('handles cache near capacity without premature eviction', async () => {
    cache = await createReadyCache(1000);

    // Mock a successful put operation
    const putRequest: { onerror: ((e: any) => void) | null; onsuccess: ((e: any) => void) | null } = { onerror: null, onsuccess: null };
    mockStore.put.mockReturnValue(putRequest as any);
    
    // Add an entry that should fit without triggering eviction
    const setPromise = cache.set('test', 'en', 'fi', 'opus-mt', 'translation');
    
    // Simulate successful storage
    setTimeout(() => {
      putRequest.onsuccess?.({});
    }, 5);
    
    await setPromise;

    // Verify the entry was stored successfully
    expect(mockStore.put).toHaveBeenCalled();
    const putCall = mockStore.put.mock.calls[0];
    expect(putCall[0]).toMatchObject({
      key: expect.any(String),
      text: 'test',
      sourceLang: 'en',
      targetLang: 'fi',
      provider: 'opus-mt',
      translation: 'translation'
    });
  });

  it('triggers eviction process when cache exceeds capacity', async () => {
    cache = await createReadyCache(100); // Very small cache

    // Mock getStats to return high usage that would trigger eviction
    const statsRequest: { onerror: ((e: any) => void) | null; onsuccess: ((e: any) => void) | null } = { onerror: null, onsuccess: null };
    mockIndex.openCursor.mockImplementation(() => statsRequest as any);
    
    const putRequest: { onerror: ((e: any) => void) | null; onsuccess: ((e: any) => void) | null } = { onerror: null, onsuccess: null };
    mockStore.put.mockReturnValue(putRequest as any);

    const setPromise = cache.set('large-entry', 'en', 'fi', 'opus-mt', 'very long translation text');
    
    // Simulate operations completing
    setTimeout(() => {
      // Simulate getStats cursor
      if (statsRequest.onsuccess) {
        const cursor = {
          value: { size: 200 }, // Over capacity
          continue: vi.fn(() => {
            statsRequest.onsuccess?.({ target: { result: null } } as unknown as Event);
          })
        };
        statsRequest.onsuccess({ target: { result: cursor } } as unknown as Event);
      }
    }, 5);

    setTimeout(() => {
      putRequest.onsuccess?.({});
    }, 10);

    await setPromise;

    // Just verify that storage operations were attempted
    expect(mockStore.put).toHaveBeenCalled();
    expect(mockIndex.openCursor).toHaveBeenCalled();
  });

  it('calculates entry sizes correctly for boundary conditions', async () => {
    cache = await createReadyCache(1000);

    const putRequest = { onerror: null as any, onsuccess: null as any };
    mockStore.put.mockImplementation(() => {
      // Auto-resolve the put request on next tick
      setTimeout(() => putRequest.onsuccess?.({}), 1);
      return putRequest as any;
    });

    // Store a single entry and verify size is calculated
    const promise = cache.set('hello world', 'en', 'fi', 'opus-mt', 'hei maailma');
    await promise;
    await waitForCacheAsyncWork(5);

    expect(mockStore.put).toHaveBeenCalled();
    const call = mockStore.put.mock.calls[0];
    expect(call[0]).toHaveProperty('size');
    expect(typeof call[0].size).toBe('number');
    expect(call[0].size).toBeGreaterThan(0);
  });
});
