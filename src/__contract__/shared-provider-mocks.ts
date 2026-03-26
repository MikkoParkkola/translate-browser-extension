import { vi } from 'vitest';

export interface MockStorageResetOptions {
  clearMocks?: boolean;
  seed?: Record<string, unknown>;
}

export function normalizeKeys(keys?: string | string[] | null): string[] | null {
  if (keys == null) return null;
  return Array.isArray(keys) ? keys : [keys];
}

export function readStorage(
  mockStorage: Record<string, unknown>,
  keys?: string | string[] | null,
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

export function seedMockStorage(
  mockStorage: Record<string, unknown>,
  seed: Record<string, unknown> = {},
) {
  Object.assign(mockStorage, seed);
  return mockStorage;
}

export function clearMockStorage(mockStorage: Record<string, unknown>) {
  Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
}

export function resetMockStorage(
  mockStorage: Record<string, unknown>,
  options: MockStorageResetOptions = {},
) {
  if (options.clearMocks ?? true) {
    vi.clearAllMocks();
  }

  clearMockStorage(mockStorage);

  if (options.seed) {
    seedMockStorage(mockStorage, options.seed);
  }

  return mockStorage;
}

export function installChromeStorageMock() {
  const mockStorage: Record<string, unknown> = {};
  const storageLocal = {
    get: vi.fn((keys?: string | string[] | null) =>
      Promise.resolve(readStorage(mockStorage, keys)),
    ),
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
      clearMockStorage(mockStorage);
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
    seedStorage(seed: Record<string, unknown> = {}) {
      return seedMockStorage(mockStorage, seed);
    },
    resetStorage() {
      clearMockStorage(mockStorage);
    },
    resetStorageState(options: MockStorageResetOptions = {}) {
      return resetMockStorage(mockStorage, options);
    },
  };
}
