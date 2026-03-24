import { vi } from 'vitest';

function normalizeKeys(keys?: string | string[] | null): string[] | null {
  if (keys == null) return null;
  return Array.isArray(keys) ? keys : [keys];
}

function readStorage(
  mockStorage: Record<string, unknown>,
  keys?: string | string[] | null
): Record<string, unknown> {
  const keyList = normalizeKeys(keys);
  if (keyList === null) {
    return { ...mockStorage };
  }

  const result: Record<string, unknown> = {};
  for (const key of keyList) {
    if (mockStorage[key] !== undefined) {
      result[key] = mockStorage[key];
    }
  }
  return result;
}

export function installChromeStorageMock() {
  const mockStorage: Record<string, unknown> = {};
  const storageLocal = {
    get: vi.fn((keys?: string | string[] | null) => Promise.resolve(readStorage(mockStorage, keys))),
    set: vi.fn((items: Record<string, unknown>) => {
      Object.assign(mockStorage, items);
      return Promise.resolve();
    }),
    remove: vi.fn((keys: string | string[]) => {
      for (const key of normalizeKeys(keys) ?? []) {
        delete mockStorage[key];
      }
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
      return Promise.resolve();
    }),
  };

  vi.stubGlobal('chrome', {
    storage: {
      local: storageLocal,
    },
  });

  return {
    mockStorage,
    storageLocal,
    resetStorage() {
      Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    },
  };
}
