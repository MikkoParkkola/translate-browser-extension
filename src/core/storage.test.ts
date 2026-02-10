/**
 * Storage wrapper unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted so mock objects are available in vi.mock factory
const mockStorage = vi.hoisted(() => ({
  local: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('./browser-api', () => ({
  browserAPI: {
    runtime: {
      getURL: vi.fn(),
      sendMessage: vi.fn(),
      onMessage: { addListener: vi.fn() },
    },
    storage: mockStorage,
  },
}));

import { safeStorageGet, safeStorageSet } from './storage';

describe('safeStorageGet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns data from storage on success', async () => {
    mockStorage.local.get.mockResolvedValue({ theme: 'dark', lang: 'fi' });

    const result = await safeStorageGet<{ theme: string; lang: string }>('theme');

    expect(mockStorage.local.get).toHaveBeenCalledWith('theme');
    expect(result).toEqual({ theme: 'dark', lang: 'fi' });
  });

  it('accepts array of keys', async () => {
    mockStorage.local.get.mockResolvedValue({ a: 1, b: 2 });

    const result = await safeStorageGet(['a', 'b']);

    expect(mockStorage.local.get).toHaveBeenCalledWith(['a', 'b']);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('returns empty object on storage error', async () => {
    mockStorage.local.get.mockRejectedValue(new Error('Storage unavailable'));

    const result = await safeStorageGet('anything');

    expect(result).toEqual({});
  });

  it('logs warning on error', async () => {
    const warnSpy = vi.spyOn(console, 'warn');
    mockStorage.local.get.mockRejectedValue(new Error('Quota exceeded'));

    await safeStorageGet('test');

    expect(warnSpy).toHaveBeenCalledWith(
      '[Storage]',
      'Storage get failed:',
      expect.any(Error)
    );
  });

  it('returns empty object when storage returns nothing', async () => {
    mockStorage.local.get.mockResolvedValue({});

    const result = await safeStorageGet('nonexistent');

    expect(result).toEqual({});
  });
});

describe('safeStorageSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns true on successful set', async () => {
    mockStorage.local.set.mockResolvedValue(undefined);

    const result = await safeStorageSet({ theme: 'dark' });

    expect(mockStorage.local.set).toHaveBeenCalledWith({ theme: 'dark' });
    expect(result).toBe(true);
  });

  it('returns false on storage error', async () => {
    mockStorage.local.set.mockRejectedValue(new Error('Quota exceeded'));

    const result = await safeStorageSet({ large: 'data' });

    expect(result).toBe(false);
  });

  it('logs warning on error', async () => {
    const warnSpy = vi.spyOn(console, 'warn');
    mockStorage.local.set.mockRejectedValue(new Error('Write failed'));

    await safeStorageSet({ key: 'val' });

    expect(warnSpy).toHaveBeenCalledWith(
      '[Storage]',
      'Storage set failed:',
      expect.any(Error)
    );
  });

  it('handles empty items object', async () => {
    mockStorage.local.set.mockResolvedValue(undefined);

    const result = await safeStorageSet({});

    expect(result).toBe(true);
    expect(mockStorage.local.set).toHaveBeenCalledWith({});
  });

  it('handles items with various value types', async () => {
    mockStorage.local.set.mockResolvedValue(undefined);

    const items = {
      str: 'hello',
      num: 42,
      bool: true,
      arr: [1, 2, 3],
      obj: { nested: 'value' },
      nil: null,
    };

    const result = await safeStorageSet(items);

    expect(result).toBe(true);
    expect(mockStorage.local.set).toHaveBeenCalledWith(items);
  });
});
