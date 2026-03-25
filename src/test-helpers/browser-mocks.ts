import { vi } from 'vitest';

export function setupNavigatorLanguageMock(language = 'en-US') {
  vi.stubGlobal('navigator', {
    ...globalThis.navigator,
    language,
  });
}

export function setupNavigatorStorageEstimateMock(
  initialValue: { usage: number; quota: number } = { usage: 0, quota: 0 }
) {
  const mockEstimate = vi.fn().mockResolvedValue(initialValue);

  Object.defineProperty(globalThis.navigator, 'storage', {
    value: { estimate: mockEstimate },
    writable: true,
    configurable: true,
  });

  return mockEstimate;
}

export function setupCachesMock() {
  const cachesMock = {
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };

  vi.stubGlobal('caches', cachesMock);
  return cachesMock;
}
