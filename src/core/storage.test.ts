/**
 * Storage wrapper unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBrowserApiModuleMock } from '../test-helpers/module-mocks';

vi.mock('./browser-api', () =>
  createBrowserApiModuleMock({
    storageLocalGet: vi.fn(),
    storageLocalSet: vi.fn(),
    storageLocalRemove: vi.fn(),
  })
);

import { browserAPI } from './browser-api';
import {
  safeStorageGet,
  safeStorageSet,
  safeStorageRemove,
  strictStorageGet,
  strictStorageSet,
  strictStorageRemove,
  lastStorageError,
} from './storage';

const mockStorage = {
  local: browserAPI.storage.local as unknown as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  },
};

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

  it('logs error on failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockStorage.local.get.mockRejectedValue(new Error('Quota exceeded'));

    await safeStorageGet('test');

    expect(errorSpy).toHaveBeenCalledWith(
      '[Storage]',
      'Storage read failed for keys [test]:',
      'Quota exceeded'
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

  it('logs error on failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockStorage.local.set.mockRejectedValue(new Error('Write failed'));

    await safeStorageSet({ key: 'val' });

    expect(errorSpy).toHaveBeenCalledWith(
      '[Storage]',
      'Storage save failed for keys [key]:',
      'Write failed'
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

describe('lastStorageError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('is null after successful get', async () => {
    mockStorage.local.get.mockResolvedValue({ key: 'val' });
    await safeStorageGet('key');
    expect(lastStorageError).toBeNull();
  });

  it('contains descriptive message after failed get', async () => {
    mockStorage.local.get.mockRejectedValue(new Error('Quota exceeded'));
    await safeStorageGet('settings');
    expect(lastStorageError).toContain('Failed to read settings');
    expect(lastStorageError).toContain('settings');
    expect(lastStorageError).toContain('Quota exceeded');
  });

  it('is null after successful set', async () => {
    mockStorage.local.set.mockResolvedValue(undefined);
    await safeStorageSet({ key: 'val' });
    expect(lastStorageError).toBeNull();
  });

  it('contains descriptive message after failed set', async () => {
    mockStorage.local.set.mockRejectedValue(new Error('Disk full'));
    await safeStorageSet({ theme: 'dark' });
    expect(lastStorageError).toContain('Failed to save settings');
    expect(lastStorageError).toContain('theme');
    expect(lastStorageError).toContain('Disk full');
  });

  it('is cleared on subsequent success', async () => {
    // First: fail
    mockStorage.local.get.mockRejectedValue(new Error('Fail'));
    await safeStorageGet('key');
    expect(lastStorageError).not.toBeNull();

    // Then: succeed
    mockStorage.local.get.mockResolvedValue({});
    await safeStorageGet('key');
    expect(lastStorageError).toBeNull();
  });
});

describe('safeStorageGet - branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('handles non-Error thrown values (string)', async () => {
    mockStorage.local.get.mockRejectedValue('string error');
    const result = await safeStorageGet('key');
    expect(result).toEqual({});
    expect(lastStorageError).toContain('string error');
  });

  it('formats array keys in error messages', async () => {
    mockStorage.local.get.mockRejectedValue(new Error('fail'));
    await safeStorageGet(['key1', 'key2']);
    expect(lastStorageError).toContain('key1, key2');
  });
});

describe('safeStorageSet - branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('handles non-Error thrown values (string) in set', async () => {
    mockStorage.local.set.mockRejectedValue('raw string error');
    const result = await safeStorageSet({ key: 'val' });
    expect(result).toBe(false);
    expect(lastStorageError).toContain('raw string error');
  });
});

describe('strictStorageGet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns data on success', async () => {
    mockStorage.local.get.mockResolvedValue({ key: 'val' });
    const result = await strictStorageGet('key');
    expect(result).toEqual({ key: 'val' });
    expect(lastStorageError).toBeNull();
  });

  it('rethrows the original error on failure', async () => {
    const err = new Error('hard fail');
    mockStorage.local.get.mockRejectedValue(err);
    await expect(strictStorageGet('key')).rejects.toThrow('hard fail');
  });

  it('records lastStorageError before rethrowing', async () => {
    mockStorage.local.get.mockRejectedValue(new Error('boom'));
    await expect(strictStorageGet('key')).rejects.toThrow();
    expect(lastStorageError).toContain('Failed to read settings');
    expect(lastStorageError).toContain('boom');
  });
});

describe('strictStorageSet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('resolves without error on success', async () => {
    mockStorage.local.set.mockResolvedValue(undefined);
    await expect(strictStorageSet({ key: 'val' })).resolves.toBeUndefined();
    expect(lastStorageError).toBeNull();
  });

  it('rethrows the original error on failure', async () => {
    const err = new Error('write fail');
    mockStorage.local.set.mockRejectedValue(err);
    await expect(strictStorageSet({ key: 'val' })).rejects.toThrow('write fail');
  });

  it('records lastStorageError before rethrowing', async () => {
    mockStorage.local.set.mockRejectedValue(new Error('quota'));
    await expect(strictStorageSet({ theme: 'dark' })).rejects.toThrow();
    expect(lastStorageError).toContain('Failed to save settings');
    expect(lastStorageError).toContain('theme');
    expect(lastStorageError).toContain('quota');
  });
});

describe('safeStorageRemove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('returns true on successful remove', async () => {
    mockStorage.local.remove.mockResolvedValue(undefined);
    const result = await safeStorageRemove('key');
    expect(mockStorage.local.remove).toHaveBeenCalledWith('key');
    expect(result).toBe(true);
    expect(lastStorageError).toBeNull();
  });

  it('accepts array of keys', async () => {
    mockStorage.local.remove.mockResolvedValue(undefined);
    const result = await safeStorageRemove(['a', 'b']);
    expect(mockStorage.local.remove).toHaveBeenCalledWith(['a', 'b']);
    expect(result).toBe(true);
  });

  it('returns false on error', async () => {
    mockStorage.local.remove.mockRejectedValue(new Error('remove fail'));
    const result = await safeStorageRemove('key');
    expect(result).toBe(false);
  });

  it('logs error and records lastStorageError on failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockStorage.local.remove.mockRejectedValue(new Error('remove fail'));
    await safeStorageRemove('key');
    expect(errorSpy).toHaveBeenCalledWith(
      '[Storage]',
      'Storage remove failed for keys [key]:',
      'remove fail',
    );
    expect(lastStorageError).toContain('Failed to remove settings');
    expect(lastStorageError).toContain('key');
    expect(lastStorageError).toContain('remove fail');
  });

  it('formats array keys in error messages', async () => {
    mockStorage.local.remove.mockRejectedValue(new Error('fail'));
    await safeStorageRemove(['x', 'y']);
    expect(lastStorageError).toContain('x, y');
  });
});

describe('strictStorageRemove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('resolves without error on success', async () => {
    mockStorage.local.remove.mockResolvedValue(undefined);
    await expect(strictStorageRemove('key')).resolves.toBeUndefined();
    expect(lastStorageError).toBeNull();
  });

  it('rethrows the original error on failure', async () => {
    const err = new Error('remove hard fail');
    mockStorage.local.remove.mockRejectedValue(err);
    await expect(strictStorageRemove('key')).rejects.toThrow('remove hard fail');
  });

  it('records lastStorageError before rethrowing', async () => {
    mockStorage.local.remove.mockRejectedValue(new Error('gone'));
    await expect(strictStorageRemove(['a', 'b'])).rejects.toThrow();
    expect(lastStorageError).toContain('Failed to remove settings');
    expect(lastStorageError).toContain('a, b');
    expect(lastStorageError).toContain('gone');
  });
});
