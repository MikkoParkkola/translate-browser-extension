/**
 * Chaos/Fault Injection: Storage corruption
 * Verifies the system handles corrupt, missing, or overflowing storage gracefully.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeStorageGet, safeStorageSet, lastStorageError as _lastStorageError } from '../core/storage';

// Mock the browser-api module that storage.ts imports
vi.mock('../core/browser-api', () => ({
  browserAPI: {
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
  },
}));

// Import AFTER mock is set up so the mock is used
import { browserAPI } from '../core/browser-api';

const mockGet = browserAPI.storage.local.get as ReturnType<typeof vi.fn>;
const mockSet = browserAPI.storage.local.set as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Storage Chaos — get returns undefined', () => {
  it('safeStorageGet returns empty object when storage throws', async () => {
    mockGet.mockRejectedValueOnce(new Error('Storage area not available'));

    const result = await safeStorageGet<{ theme: string }>('theme');
    expect(result).toEqual({});
  });

  it('safeStorageGet returns empty object on generic error', async () => {
    mockGet.mockRejectedValueOnce(new TypeError('Cannot read properties of undefined'));

    const result = await safeStorageGet<{ settings: object }>('settings');
    expect(result).toEqual({});
  });
});

describe('Storage Chaos — malformed data', () => {
  it('safeStorageGet returns whatever chrome.storage returns (caller validates)', async () => {
    // Chrome storage returns already-parsed values.
    // If the value is somehow garbage, the caller must validate.
    mockGet.mockResolvedValueOnce({ config: 'not-a-valid-config-object' });

    const result = await safeStorageGet<{ config: string }>('config');
    expect(result).toEqual({ config: 'not-a-valid-config-object' });
  });
});

describe('Storage Chaos — partial config (missing keys)', () => {
  it('returns only the keys that exist', async () => {
    mockGet.mockResolvedValueOnce({ sourceLang: 'en' });

    const result = await safeStorageGet<{
      sourceLang: string;
      targetLang: string;
      strategy: string;
    }>(['sourceLang', 'targetLang', 'strategy']);

    expect(result.sourceLang).toBe('en');
    expect(result.targetLang).toBeUndefined();
    expect(result.strategy).toBeUndefined();
  });
});

describe('Storage Chaos — quota exceeded on write', () => {
  it('safeStorageSet returns false and sets lastStorageError', async () => {
    mockSet.mockRejectedValueOnce(
      new Error('QUOTA_BYTES_PER_ITEM quota exceeded'),
    );

    const ok = await safeStorageSet({ hugePayload: 'x'.repeat(100_000) });
    expect(ok).toBe(false);
    // Dynamically re-import to check the module-level variable
    const { lastStorageError: err } = await import('../core/storage');
    expect(err).toContain('Failed to save');
  });

  it('safeStorageSet returns true on success', async () => {
    mockSet.mockResolvedValueOnce(undefined);

    const ok = await safeStorageSet({ key: 'value' });
    expect(ok).toBe(true);
  });
});

describe('Storage Chaos — concurrent reads/writes', () => {
  it('parallel safeStorageGet calls do not corrupt each other', async () => {
    mockGet.mockImplementation(async (keys: string | string[]) => {
      await new Promise((r) => setTimeout(r, Math.random() * 10));
      const keyArr = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, string> = {};
      for (const k of keyArr) {
        result[k] = `value-for-${k}`;
      }
      return result;
    });

    const results = await Promise.all([
      safeStorageGet<Record<string, string>>('a'),
      safeStorageGet<Record<string, string>>('b'),
      safeStorageGet<Record<string, string>>('c'),
    ]);

    expect(results[0]).toEqual({ a: 'value-for-a' });
    expect(results[1]).toEqual({ b: 'value-for-b' });
    expect(results[2]).toEqual({ c: 'value-for-c' });
  });

  it('interleaved read/write does not lose writes', async () => {
    const store: Record<string, unknown> = {};

    mockSet.mockImplementation(async (items: Record<string, unknown>) => {
      await new Promise((r) => setTimeout(r, 5));
      Object.assign(store, items);
    });

    mockGet.mockImplementation(async (keys: string | string[]) => {
      await new Promise((r) => setTimeout(r, 5));
      const keyArr = Array.isArray(keys) ? keys : [keys];
      const result: Record<string, unknown> = {};
      for (const k of keyArr) {
        if (k in store) result[k] = store[k];
      }
      return result;
    });

    await Promise.all([
      safeStorageSet({ x: 1 }),
      safeStorageSet({ y: 2 }),
      safeStorageSet({ z: 3 }),
    ]);

    const read = await safeStorageGet<Record<string, number>>(['x', 'y', 'z']);
    expect(read.x).toBe(1);
    expect(read.y).toBe(2);
    expect(read.z).toBe(3);
  });
});
