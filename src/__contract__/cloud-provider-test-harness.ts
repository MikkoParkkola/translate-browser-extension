import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderType, QualityTier } from '../types';
import { installChromeStorageMock } from './shared-provider-mocks';

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

type InspectableCloudProvider = InspectableCloudProviderLifecycle & InspectableCloudProviderHooks;

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

export interface CloudProviderLifecycleContractSpec<TProvider extends InspectableCloudProvider> {
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
    storage: Record<string, unknown>
  ): void;
}

export function installCloudProviderTestHarness() {
  const storageHarness = installChromeStorageMock();
  const mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);

  return {
    ...storageHarness,
    mockFetch,
  };
}

export function inspectCloudProvider<TProvider extends InspectableCloudProviderLifecycle>(
  provider: TProvider
): TProvider & InspectableCloudProviderHooks {
  return provider as TProvider & InspectableCloudProviderHooks;
}

export function okJsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    headers: { get: () => null },
  };
}

export function httpErrorResponse(status: number, body = '') {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
    headers: { get: () => null },
  };
}

export function defineCloudProviderLifecycleContract<TProvider extends InspectableCloudProvider>(
  spec: CloudProviderLifecycleContractSpec<TProvider>
): void {
  describe(`${spec.name} lifecycle contract`, () => {
    let provider: TProvider;

    beforeEach(() => {
      vi.clearAllMocks();
      spec.resetStorage();
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
      const ancillaryKey = provider.getStorageKeys().find((key) => key !== spec.apiKeyKey);

      if (!ancillaryKey) {
        expect(provider.hasConfig()).toBe(false);
        await provider.initialize();
        expect(await provider.isAvailable()).toBe(false);
        return;
      }

      spec.mockStorage[ancillaryKey] = ancillaryKey.includes('used') ? 1 : 'placeholder';

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
        spec.assertConfiguredInfo(provider.getInfo() as InspectableProviderInfo);
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
          spec.mockStorage
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
