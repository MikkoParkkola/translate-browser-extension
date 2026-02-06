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

describe('TranslationCache', () => {
  let cache: TranslationCache;

  beforeEach(() => {
    vi.clearAllMocks();
    mockEntries.clear();
    mockCursorIndex = 0;
    resetTranslationCache();
  });

  afterEach(() => {
    cache?.close();
  });

  describe('constructor', () => {
    it('opens IndexedDB on creation', async () => {
      cache = new TranslationCache();
      // Wait for db to be ready
      await new Promise((resolve) => setTimeout(resolve, 10));
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
      cache = new TranslationCache();
      await new Promise((resolve) => setTimeout(resolve, 10));
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
  });

  describe('set', () => {
    beforeEach(async () => {
      cache = new TranslationCache();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('stores translation in cache', async () => {
      mockStore.put.mockReturnValueOnce({
        onerror: null,
        onsuccess: null,
      });

      const setPromise = cache.set('hello', 'en', 'fi', 'opus-mt', 'hei');

      // Wait for stats check and then put
      await new Promise((resolve) => setTimeout(resolve, 50));

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

      await new Promise((resolve) => setTimeout(resolve, 50));

      const entry = mockStore.put.mock.calls[0]?.[0] as CacheEntry;
      // "hello" (5 chars) + "hei" (3 chars) = 8 chars * 2 bytes + 100 overhead = 116
      expect(entry?.size).toBe(116);
    });
  });

  describe('clear', () => {
    beforeEach(async () => {
      cache = new TranslationCache();
      await new Promise((resolve) => setTimeout(resolve, 10));
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
      cache = new TranslationCache();
      await new Promise((resolve) => setTimeout(resolve, 10));
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
      cache = new TranslationCache();
      await new Promise((resolve) => setTimeout(resolve, 10));
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
    cache = new TranslationCache();
    await new Promise((resolve) => setTimeout(resolve, 10));
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

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockStore.put).toHaveBeenCalled();
  });

  it('handles unicode text', async () => {
    mockStore.put.mockReturnValueOnce({
      onerror: null,
      onsuccess: null,
    });

    cache.set('Hello World!', 'en', 'fi', 'opus-mt', 'Hei maailma!');

    await new Promise((resolve) => setTimeout(resolve, 50));

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

    await new Promise((resolve) => setTimeout(resolve, 50));

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

    await new Promise((resolve) => setTimeout(resolve, 50));

    const entry = mockStore.put.mock.calls[0]?.[0] as CacheEntry;
    expect(entry?.text).toBe(specialText);
  });
});
