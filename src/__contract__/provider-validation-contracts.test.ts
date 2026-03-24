import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../providers/anthropic';
import { DeepLProvider } from '../providers/deepl';
import { GoogleCloudProvider } from '../providers/google-cloud';
import { OpenAIProvider } from '../providers/openai';
import { installChromeStorageMock } from './shared-provider-mocks';

type ProviderHooks = {
  getStorageKeys(): string[];
  hasConfig(): boolean;
};

interface CloudProviderEntry {
  name: string;
  create: () => object;
  apiKeyKey: string;
  seedConfiguredStorage(storage: Record<string, unknown>): void;
}

const { mockStorage, resetStorage, storageLocal } = installChromeStorageMock();

const CLOUD_PROVIDERS: CloudProviderEntry[] = [
  {
    name: 'Anthropic',
    create: () => new AnthropicProvider(),
    apiKeyKey: 'anthropic_api_key',
    seedConfiguredStorage(storage) {
      storage['anthropic_api_key'] = 'sk-ant-test';
      storage['anthropic_model'] = 'claude-3-5-haiku-20241022';
      storage['anthropic_formality'] = 'neutral';
      storage['anthropic_tokens_used'] = 100;
    },
  },
  {
    name: 'OpenAI',
    create: () => new OpenAIProvider(),
    apiKeyKey: 'openai_api_key',
    seedConfiguredStorage(storage) {
      storage['openai_api_key'] = 'sk-openai-test';
      storage['openai_model'] = 'gpt-4o-mini';
      storage['openai_formality'] = 'neutral';
      storage['openai_temperature'] = 0.3;
      storage['openai_tokens_used'] = 100;
    },
  },
  {
    name: 'DeepL',
    create: () => new DeepLProvider(),
    apiKeyKey: 'deepl_api_key',
    seedConfiguredStorage(storage) {
      storage['deepl_api_key'] = 'deepl-test-key';
      storage['deepl_is_pro'] = true;
      storage['deepl_formality'] = 'default';
    },
  },
  {
    name: 'Google Cloud',
    create: () => new GoogleCloudProvider(),
    apiKeyKey: 'google_cloud_api_key',
    seedConfiguredStorage(storage) {
      storage['google_cloud_api_key'] = 'AIza-test-key';
      storage['google_cloud_chars_used'] = 1000;
    },
  },
];

describe.each(CLOUD_PROVIDERS)('$name validation hook contract', ({ create, apiKeyKey, seedConfiguredStorage }) => {
  const createInspectableProvider = () => create() as {
    initialize(): Promise<void>;
    isAvailable(): Promise<boolean>;
    clearApiKey(): Promise<void>;
  } & ProviderHooks;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStorage();
  });

  it('exposes non-empty storage keys that include the API key', () => {
    const provider = createInspectableProvider();
    const keys = provider.getStorageKeys();

    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain(apiKeyKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not report availability when only ancillary storage keys are present', async () => {
    const provider = createInspectableProvider();
    const ancillaryKey = provider.getStorageKeys().find((key) => key !== apiKeyKey);

    if (!ancillaryKey) {
      expect(provider.hasConfig()).toBe(false);
      await provider.initialize();
      expect(await provider.isAvailable()).toBe(false);
      return;
    }

    mockStorage[ancillaryKey] = ancillaryKey.includes('used') ? 1 : 'placeholder';

    expect(provider.hasConfig()).toBe(false);
    await provider.initialize();
    expect(provider.hasConfig()).toBe(false);
    expect(await provider.isAvailable()).toBe(false);
  });

  it('loads configured storage into the availability lifecycle', async () => {
    const provider = createInspectableProvider();
    seedConfiguredStorage(mockStorage);

    expect(provider.hasConfig()).toBe(false);
    await provider.initialize();

    expect(provider.hasConfig()).toBe(true);
    expect(await provider.isAvailable()).toBe(true);
  });

  it('clearApiKey removes every storage key and resets availability', async () => {
    const provider = createInspectableProvider();
    seedConfiguredStorage(mockStorage);
    await provider.initialize();
    const keys = provider.getStorageKeys();

    await provider.clearApiKey();

    expect(storageLocal.remove).toHaveBeenCalledWith(keys);
    for (const key of keys) {
      expect(mockStorage[key]).toBeUndefined();
    }
    expect(provider.hasConfig()).toBe(false);
    expect(await provider.isAvailable()).toBe(false);
  });
});
