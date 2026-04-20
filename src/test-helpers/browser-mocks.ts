import { vi } from 'vitest';
import {
  collectMockResetters,
  registerGlobalFixture,
  resetMutableRecord,
} from './global-fixture-registry';

type GlobalFixtureRestoreMode = 'baseline' | 'original';

export function setupNavigatorMock(overrides: Record<string, unknown> = {}) {
  const navigatorMock = {
    ...globalThis.navigator,
    ...overrides,
  };
  const initialNavigatorState = { ...navigatorMock };
  const mockResetters = collectMockResetters(navigatorMock);

  vi.stubGlobal('navigator', navigatorMock);

  registerGlobalFixture('navigator', () => {
    mockResetters.forEach((resetMock) => resetMock());
    resetMutableRecord(
      navigatorMock as Record<string, unknown>,
      initialNavigatorState as Record<string, unknown>,
    );
    vi.stubGlobal('navigator', navigatorMock);
  });

  return navigatorMock;
}

export function setupNavigatorLanguageMock(language = 'en-US') {
  return setupNavigatorMock({ language });
}

export function setupNavigatorStorageEstimateMock(
  initialValue: { usage: number; quota: number } = { usage: 0, quota: 0 }
) {
  const mockEstimate = vi.fn().mockResolvedValue(initialValue);
  const resetMockEstimate = collectMockResetters({ mockEstimate })[0];

  const applyStorageMock = () => {
    Object.defineProperty(globalThis.navigator, 'storage', {
      value: { estimate: mockEstimate },
      writable: true,
      configurable: true,
    });
  };

  applyStorageMock();

  registerGlobalFixture('navigator.storage', () => {
    resetMockEstimate?.();
    applyStorageMock();
  });

  return mockEstimate;
}

function applyGlobalFixtureValue(name: string, value: unknown) {
  if (value === undefined) {
    delete (globalThis as Record<string, unknown>)[name];
    return;
  }

  vi.stubGlobal(name, value);
}

export interface CachesMockOptions {
  restore?: GlobalFixtureRestoreMode;
}

export function setupCachesMock(options: CachesMockOptions = {}) {
  const originalCaches = (globalThis as Record<string, unknown>).caches;
  const cachesMock = {
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const mockResetters = collectMockResetters(cachesMock);

  applyGlobalFixtureValue('caches', cachesMock);

  registerGlobalFixture('caches', () => {
    mockResetters.forEach((resetMock) => resetMock());

    if (options.restore === 'original') {
      applyGlobalFixtureValue('caches', originalCaches);
      return;
    }

    applyGlobalFixtureValue('caches', cachesMock);
  });

  return cachesMock;
}
