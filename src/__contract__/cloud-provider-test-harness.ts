import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderType, QualityTier } from '../types';
import {
  installChromeStorageMock,
  seedMockStorage,
  type MockStorageResetOptions,
} from './shared-provider-mocks';

export interface InspectableCloudProviderHooks {
  getStorageKeys(): string[];
  hasConfig(): boolean;
}

export interface InspectableCloudProviderLifecycle {
  initialize(): Promise<void>;
  isAvailable(): Promise<boolean>;
  clearApiKey(): Promise<void>;
  getInfo(): object;
}

type InspectableCloudProvider = InspectableCloudProviderLifecycle &
  InspectableCloudProviderHooks;

type InspectableProviderInfo = {
  id?: string;
  name?: string;
  type?: ProviderType;
  qualityTier?: QualityTier;
  costPerMillion?: number;
  [key: string]: unknown;
};

export interface CloudProviderInfoExpectation {
  id: string;
  name: string;
  type: ProviderType;
  qualityTier: QualityTier;
  costPerMillion: number;
}

export interface CloudProviderLifecycleContractSpec<
  TProvider extends InspectableCloudProvider,
> {
  name: string;
  create: () => TProvider;
  mockStorage: Record<string, unknown>;
  resetStorage: () => void;
  storageLocal: {
    remove(keys: string | string[]): Promise<void>;
  };
  apiKeyKey: string;
  expectedInfo: CloudProviderInfoExpectation;
  seedConfiguredStorage(storage: Record<string, unknown>): void;
  assertLoadedInfo(info: InspectableProviderInfo): void;
  configure(provider: TProvider): Promise<void>;
  assertConfiguredStorage(storage: Record<string, unknown>): void;
  assertConfiguredInfo?(info: InspectableProviderInfo): void;
  reconfigure?(provider: TProvider): Promise<void>;
  assertReconfiguredInfo?(
    info: InspectableProviderInfo,
    storage: Record<string, unknown>,
  ): void;
}

export interface MockFetchHeaders {
  [key: string]: string;
}

export interface MockJsonResponseOptions {
  status?: number;
  headers?: MockFetchHeaders;
  text?: string;
}

export interface MockHttpErrorOptions {
  headers?: MockFetchHeaders;
  jsonBody?: unknown;
}

export type MockFetchSequenceStep =
  | {
      type: 'json';
      body: unknown;
      options?: MockJsonResponseOptions;
    }
  | {
      type: 'httpError';
      status: number;
      body?: string;
      options?: MockHttpErrorOptions;
    }
  | {
      type: 'reject';
      error: unknown;
    };

export interface CloudProviderStorageHelpers {
  mockStorage: Record<string, unknown>;
  seedStorage(seed?: Record<string, unknown>): Record<string, unknown>;
  resetStorageState(options?: MockStorageResetOptions): Record<string, unknown>;
  resetCloudProviderState(
    options?: MockStorageResetOptions,
  ): Record<string, unknown>;
}

export interface ProviderErrorExpectation {
  category?: string;
  retryable?: boolean;
  messagePattern?: RegExp;
  technicalDetailsPattern?: RegExp;
}

export interface ProviderErrorTestCase {
  title: string;
  arrange: () => void;
  expected?: ProviderErrorExpectation;
}

function createMockHeaders(headers: MockFetchHeaders = {}) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );

  return {
    get: (key: string) => normalizedHeaders.get(key.toLowerCase()) ?? null,
  };
}

export function createCloudProviderStorageHelpers(storageHarness: {
  mockStorage: Record<string, unknown>;
  resetStorage: () => void;
}): CloudProviderStorageHelpers {
  const seedStorage = (seed: Record<string, unknown> = {}) =>
    seedMockStorage(storageHarness.mockStorage, seed);

  const resetStorageState = (options: MockStorageResetOptions = {}) => {
    if (options.clearMocks ?? true) {
      vi.clearAllMocks();
    }

    storageHarness.resetStorage();

    if (options.seed) {
      seedStorage(options.seed);
    }

    return storageHarness.mockStorage;
  };

  return {
    mockStorage: storageHarness.mockStorage,
    seedStorage,
    resetStorageState,
    resetCloudProviderState: resetStorageState,
  };
}

export function installCloudProviderTestHarness() {
  const storageHarness = installChromeStorageMock();
  const storageHelpers = createCloudProviderStorageHelpers(storageHarness);
  const mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);

  return {
    ...storageHarness,
    ...storageHelpers,
    mockFetch,
    queueJsonResponse(body: unknown, options?: MockJsonResponseOptions) {
      return queueJsonResponse(mockFetch, body, options);
    },
    queueHttpError(status: number, body = '', options?: MockHttpErrorOptions) {
      return queueHttpError(mockFetch, status, body, options);
    },
    queueRejectedFetch(error: unknown) {
      return queueRejectedFetch(mockFetch, error);
    },
    queueFetchSequence(...steps: MockFetchSequenceStep[]) {
      return queueFetchSequence(mockFetch, ...steps);
    },
  };
}

export function inspectCloudProvider<
  TProvider extends InspectableCloudProviderLifecycle,
>(provider: TProvider): TProvider & InspectableCloudProviderHooks {
  return provider as TProvider & InspectableCloudProviderHooks;
}

export function okJsonResponse(
  body: unknown,
  options: MockJsonResponseOptions = {},
) {
  const status = options.status ?? 200;

  return {
    ok: true,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(options.text ?? JSON.stringify(body)),
    headers: createMockHeaders(options.headers),
  };
}

export function httpErrorResponse(
  status: number,
  body = '',
  options: MockHttpErrorOptions = {},
) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(options.jsonBody ?? {}),
    text: () => Promise.resolve(body),
    headers: createMockHeaders(options.headers),
  };
}

export function queueJsonResponse(
  mockFetch: ReturnType<typeof vi.fn>,
  body: unknown,
  options?: MockJsonResponseOptions,
) {
  mockFetch.mockResolvedValueOnce(okJsonResponse(body, options));
  return mockFetch;
}

export function queueHttpError(
  mockFetch: ReturnType<typeof vi.fn>,
  status: number,
  body = '',
  options?: MockHttpErrorOptions,
) {
  mockFetch.mockResolvedValueOnce(httpErrorResponse(status, body, options));
  return mockFetch;
}

export function queueRejectedFetch(
  mockFetch: ReturnType<typeof vi.fn>,
  error: unknown,
) {
  mockFetch.mockRejectedValueOnce(error);
  return mockFetch;
}

export function queueFetchSequence(
  mockFetch: ReturnType<typeof vi.fn>,
  ...steps: MockFetchSequenceStep[]
) {
  for (const step of steps) {
    if (step.type === 'json') {
      queueJsonResponse(mockFetch, step.body, step.options);
      continue;
    }

    if (step.type === 'httpError') {
      queueHttpError(mockFetch, step.status, step.body, step.options);
      continue;
    }

    queueRejectedFetch(mockFetch, step.error);
  }

  return mockFetch;
}

function stringifyThrownError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return String(error);
}

export function assertProviderError(
  error: unknown,
  expectation: ProviderErrorExpectation = {},
) {
  const err = error as Record<string, unknown>;
  const message = stringifyThrownError(error);
  const technicalDetails = String(err.technicalDetails ?? message);
  const searchableErrorText = `${message} ${technicalDetails}`.trim();

  if (expectation.category && 'category' in err) {
    expect(err.category).toBe(expectation.category);
  }

  if (
    expectation.retryable !== undefined &&
    'retryable' in err
  ) {
    expect(err.retryable).toBe(expectation.retryable);
  }

  if (expectation.messagePattern) {
    expect(searchableErrorText).toMatch(expectation.messagePattern);
  }

  if (expectation.technicalDetailsPattern) {
    expect(technicalDetails).toMatch(expectation.technicalDetailsPattern);
  }
}

export async function expectProviderError(
  operation: Promise<unknown>,
  expectation: ProviderErrorExpectation = {},
) {
  try {
    await operation;
  } catch (error: unknown) {
    assertProviderError(error, expectation);
    return error;
  }

  expect.unreachable('Expected provider operation to throw');
}

export function defineProviderErrorTests(spec: {
  run: () => Promise<unknown>;
  cases: ProviderErrorTestCase[];
}) {
  for (const errorCase of spec.cases) {
    it(errorCase.title, async () => {
      errorCase.arrange();
      await expectProviderError(spec.run(), errorCase.expected);
    });
  }
}

export function defineCloudProviderLifecycleContract<
  TProvider extends InspectableCloudProvider,
>(spec: CloudProviderLifecycleContractSpec<TProvider>): void {
  describe(`${spec.name} lifecycle contract`, () => {
    let provider: TProvider;
    const { resetCloudProviderState } = createCloudProviderStorageHelpers({
      mockStorage: spec.mockStorage,
      resetStorage: spec.resetStorage,
    });

    beforeEach(() => {
      resetCloudProviderState();
      provider = spec.create();
    });

    it('reports stable provider metadata', () => {
      const info = provider.getInfo() as InspectableProviderInfo;

      expect(info.id).toBe(spec.expectedInfo.id);
      expect(info.name).toBe(spec.expectedInfo.name);
      expect(info.type).toBe(spec.expectedInfo.type);
      expect(info.qualityTier).toBe(spec.expectedInfo.qualityTier);
      expect(info.costPerMillion).toBe(spec.expectedInfo.costPerMillion);
    });

    it('exposes non-empty storage keys that include the API key', () => {
      const keys = provider.getStorageKeys();

      expect(keys.length).toBeGreaterThan(0);
      expect(keys).toContain(spec.apiKeyKey);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('does not report availability when only ancillary storage keys are present', async () => {
      const ancillaryKey = provider
        .getStorageKeys()
        .find((key) => key !== spec.apiKeyKey);

      if (!ancillaryKey) {
        expect(provider.hasConfig()).toBe(false);
        await provider.initialize();
        expect(await provider.isAvailable()).toBe(false);
        return;
      }

      spec.mockStorage[ancillaryKey] = ancillaryKey.includes('used')
        ? 1
        : 'placeholder';

      expect(provider.hasConfig()).toBe(false);
      await provider.initialize();
      expect(provider.hasConfig()).toBe(false);
      expect(await provider.isAvailable()).toBe(false);
    });

    it('loads configured storage into the availability lifecycle', async () => {
      spec.seedConfiguredStorage(spec.mockStorage);

      expect(provider.hasConfig()).toBe(false);
      await provider.initialize();

      expect(provider.hasConfig()).toBe(true);
      expect(await provider.isAvailable()).toBe(true);
      spec.assertLoadedInfo(provider.getInfo() as InspectableProviderInfo);
    });

    it('stores config through the provider mutation path', async () => {
      await spec.configure(provider);

      spec.assertConfiguredStorage(spec.mockStorage);
      expect(await provider.isAvailable()).toBe(true);

      if (spec.assertConfiguredInfo) {
        spec.assertConfiguredInfo(
          provider.getInfo() as InspectableProviderInfo,
        );
      }
    });

    const reconfigure = spec.reconfigure;
    const assertReconfiguredInfo = spec.assertReconfiguredInfo;

    if (reconfigure && assertReconfiguredInfo) {
      it('preserves loaded settings when reconfigured', async () => {
        await spec.configure(provider);
        await reconfigure(provider);

        assertReconfiguredInfo(
          provider.getInfo() as InspectableProviderInfo,
          spec.mockStorage,
        );
      });
    }

    it('clearApiKey removes every storage key and resets availability', async () => {
      spec.seedConfiguredStorage(spec.mockStorage);
      await provider.initialize();
      const keys = provider.getStorageKeys();

      await provider.clearApiKey();

      expect(spec.storageLocal.remove).toHaveBeenCalledWith(keys);
      for (const key of keys) {
        expect(spec.mockStorage[key]).toBeUndefined();
      }
      expect(provider.hasConfig()).toBe(false);
      expect(await provider.isAvailable()).toBe(false);
    });
  });
}
