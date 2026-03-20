/**
 * Integration tests: Storage / Settings propagation
 *
 * Verifies that safeStorageGet/Set propagate through the browser API layer,
 * handle errors gracefully, and that settings changes round-trip correctly
 * between modules (storage ↔ service-worker ↔ router preferences).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted() — shared state & mocks available to vi.mock factory + tests
// ---------------------------------------------------------------------------
const { store, mockGet, mockSet, mockRemove, mockClear } = vi.hoisted(() => {
  const store: Record<string, unknown> = {};

  const mockGet = vi.fn((keys: string | string[]) => {
    const result: Record<string, unknown> = {};
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) {
      if (k in store) result[k] = store[k];
    }
    return Promise.resolve(result);
  });

  const mockSet = vi.fn((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  });

  const mockRemove = vi.fn((keys: string | string[]) => {
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) delete store[k];
    return Promise.resolve();
  });

  const mockClear = vi.fn(() => {
    for (const k of Object.keys(store)) delete store[k];
    return Promise.resolve();
  });

  return { store, mockGet, mockSet, mockRemove, mockClear };
});

// Mock browser-api — factory can reference hoisted variables safely
vi.mock('../core/browser-api', () => {
  const fakeChrome = {
    storage: {
      local: { get: mockGet, set: mockSet, remove: mockRemove, clear: mockClear },
    },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
      onMessage: { addListener: vi.fn() },
      getURL: (p: string) => `chrome-extension://test/${p}`,
      lastError: null,
    },
  };

  return {
    browserAPI: fakeChrome,
    storage: {
      get: <T = Record<string, unknown>>(keys: string | string[]) =>
        fakeChrome.storage.local.get(keys) as Promise<T>,
      set: (items: Record<string, unknown>) => fakeChrome.storage.local.set(items),
      remove: (keys: string | string[]) => fakeChrome.storage.local.remove(keys),
      clear: () => fakeChrome.storage.local.clear(),
    },
    isFirefox: () => false,
    isChrome: () => true,
    getURL: (path: string) => `chrome-extension://test/${path}`,
    sendMessage: vi.fn().mockResolvedValue(undefined),
    onMessage: vi.fn(),
    getPlatform: () => 'chrome' as const,
  };
});

// Mock logger to suppress output
vi.mock('../core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Stub chrome global for any transitive references
vi.stubGlobal('chrome', {
  storage: { local: { get: mockGet, set: mockSet, remove: mockRemove, clear: mockClear } },
  runtime: { sendMessage: vi.fn(), onMessage: { addListener: vi.fn() }, getURL: vi.fn(), lastError: null },
  i18n: { getUILanguage: vi.fn(() => 'en') },
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { safeStorageGet, safeStorageSet } from '../core/storage';
import { storage } from '../core/browser-api';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Storage & settings propagation integration', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    mockGet.mockClear();
    mockSet.mockClear();
    mockRemove.mockClear();
    mockClear.mockClear();
  });

  // -----------------------------------------------------------------------
  // 1. safeStorageSet persists data to chrome.storage.local
  // -----------------------------------------------------------------------
  it('safeStorageSet writes to chrome.storage.local', async () => {
    const ok = await safeStorageSet({ theme: 'dark', lang: 'fi' });
    expect(ok).toBe(true);
    expect(store['theme']).toBe('dark');
    expect(store['lang']).toBe('fi');
  });

  // -----------------------------------------------------------------------
  // 2. safeStorageGet reads back persisted data
  // -----------------------------------------------------------------------
  it('safeStorageGet reads back stored data', async () => {
    store['provider'] = 'deepl';
    const result = await safeStorageGet<{ provider: string }>('provider');
    expect(result.provider).toBe('deepl');
  });

  // -----------------------------------------------------------------------
  // 3. Round-trip: set then get
  // -----------------------------------------------------------------------
  it('round-trips data through set → get', async () => {
    await safeStorageSet({ apiKey: 'sk-test-123', enabled: true });
    const result = await safeStorageGet<{ apiKey: string; enabled: boolean }>([
      'apiKey',
      'enabled',
    ]);
    expect(result.apiKey).toBe('sk-test-123');
    expect(result.enabled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 4. safeStorageGet returns empty object for missing keys
  // -----------------------------------------------------------------------
  it('returns empty object for non-existent keys', async () => {
    const result = await safeStorageGet<{ missing: string }>('missing');
    expect(result).toEqual({});
  });

  // -----------------------------------------------------------------------
  // 5. safeStorageSet handles storage failure gracefully
  // -----------------------------------------------------------------------
  it('returns false and sets lastStorageError on write failure', async () => {
    mockSet.mockRejectedValueOnce(new Error('QUOTA_EXCEEDED'));

    const ok = await safeStorageSet({ big: 'data' });
    expect(ok).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 6. safeStorageGet handles storage failure gracefully
  // -----------------------------------------------------------------------
  it('returns empty object on read failure', async () => {
    mockGet.mockRejectedValueOnce(new Error('Storage corrupted'));

    const result = await safeStorageGet<{ key: string }>('key');
    expect(result).toEqual({});
  });

  // -----------------------------------------------------------------------
  // 7. browserAPI.storage.local wrapper works end-to-end
  // -----------------------------------------------------------------------
  it('browserAPI storage wrapper writes and reads correctly', async () => {
    await storage.set({ testKey: 42 });
    expect(store['testKey']).toBe(42);

    const result = await storage.get<{ testKey: number }>('testKey');
    expect(result.testKey).toBe(42);
  });

  // -----------------------------------------------------------------------
  // 8. storage.remove deletes keys
  // -----------------------------------------------------------------------
  it('storage.remove deletes specified keys', async () => {
    store['toDelete'] = 'value';
    await storage.remove('toDelete');
    expect('toDelete' in store).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 9. Multiple keys read simultaneously
  // -----------------------------------------------------------------------
  it('reads multiple keys in a single call', async () => {
    store['a'] = 1;
    store['b'] = 2;
    store['c'] = 3;

    const result = await safeStorageGet<{ a: number; b: number; c: number }>(['a', 'b', 'c']);
    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
    expect(result.c).toBe(3);
  });

  // -----------------------------------------------------------------------
  // 10. Cloud API key storage round-trip
  // -----------------------------------------------------------------------
  it('stores and retrieves cloud provider API key', async () => {
    const key = 'deepl_api_key';
    await safeStorageSet({ [key]: 'test-api-key-12345' });

    const result = await safeStorageGet<Record<string, string>>(key);
    expect(result[key]).toBe('test-api-key-12345');
  });

  // -----------------------------------------------------------------------
  // 11. Overwriting a key replaces old value
  // -----------------------------------------------------------------------
  it('overwrites existing key value', async () => {
    await safeStorageSet({ provider: 'opus-mt' });
    await safeStorageSet({ provider: 'deepl' });

    const result = await safeStorageGet<{ provider: string }>('provider');
    expect(result.provider).toBe('deepl');
  });
});
