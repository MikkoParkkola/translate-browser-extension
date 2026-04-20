import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOUD_PROVIDER_CONFIGS } from './cloud-provider-configs';
import {
  applySavedCloudProviderStatus,
  buildCloudProviderSaveMutation,
  buildCloudProviderUiStatusRecord,
  createRemovedCloudProviderStatus,
  getCloudProviderEditDefaults,
  getManagedCloudProviderKeys,
  loadCloudProviderUiStatus,
} from './cloud-provider-ui-state';
import { safeStorageGet } from '../core/storage';

vi.mock('../core/storage', () => ({
  safeStorageGet: vi.fn(),
}));

const deeplProvider = CLOUD_PROVIDER_CONFIGS.find((provider) => provider.id === 'deepl')!;
const openAiProvider = CLOUD_PROVIDER_CONFIGS.find((provider) => provider.id === 'openai')!;
const googleCloudProvider = CLOUD_PROVIDER_CONFIGS.find(
  (provider) => provider.id === 'google-cloud',
)!;

describe('cloud-provider-ui-state helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds status records from stored provider settings', () => {
    const status = buildCloudProviderUiStatusRecord(
      [deeplProvider, openAiProvider, googleCloudProvider],
      {
        deepl_api_key: 'deepl-key',
        deepl_enabled: true,
        deepl_is_pro: true,
        openai_api_key: 'openai-key',
        openai_enabled: 'yes',
        openai_model: 'gpt-4o',
        google_cloud_api_key: '',
        google_cloud_enabled: true,
      },
    );

    expect(status.deepl).toEqual({
      hasKey: true,
      enabled: true,
      isPro: true,
      model: undefined,
    });
    expect(status.openai).toEqual({
      hasKey: true,
      enabled: false,
      isPro: undefined,
      model: 'gpt-4o',
    });
    expect(status['google-cloud']).toEqual({
      hasKey: false,
      enabled: true,
      isPro: undefined,
      model: undefined,
    });
  });

  it('falls back to disabled status when provider metadata omits optional flags', () => {
    const status = buildCloudProviderUiStatusRecord(
      [
        {
          ...googleCloudProvider,
          enabledField: '',
          modelField: undefined,
        } as typeof googleCloudProvider,
      ],
      {
        google_cloud_api_key: 'google-key',
      },
    );

    expect(status['google-cloud']).toEqual({
      hasKey: true,
      enabled: false,
      isPro: undefined,
      model: undefined,
    });
  });

  it('loads provider UI status from storage using managed keys', async () => {
    vi.mocked(safeStorageGet).mockResolvedValueOnce({
      openai_api_key: 'openai-key',
      openai_enabled: true,
      openai_model: 'gpt-4o-mini',
    });

    const status = await loadCloudProviderUiStatus([openAiProvider]);

    expect(vi.mocked(safeStorageGet)).toHaveBeenCalledWith(
      expect.arrayContaining(['openai_api_key', 'openai_enabled', 'openai_model']),
    );
    expect(status.openai).toEqual({
      hasKey: true,
      enabled: true,
      isPro: undefined,
      model: 'gpt-4o-mini',
    });
  });

  it('returns edit defaults from status or provider metadata', () => {
    expect(
      getCloudProviderEditDefaults(openAiProvider, {
        hasKey: true,
        enabled: true,
        isPro: false,
        model: 'gpt-4-turbo',
      }),
    ).toEqual({
      isProTier: false,
      selectedModel: 'gpt-4-turbo',
    });

    expect(getCloudProviderEditDefaults(openAiProvider)).toEqual({
      isProTier: false,
      selectedModel: openAiProvider.models?.[0],
    });

    expect(getCloudProviderEditDefaults(undefined)).toEqual({
      isProTier: false,
      selectedModel: '',
    });
  });

  it('builds save mutations with validated optional fields only', () => {
    expect(
      buildCloudProviderSaveMutation(deeplProvider, 'deepl-key', {
        enabled: true,
        isPro: true,
        model: 'ignored-for-deepl',
      }),
    ).toEqual({
      deepl_api_key: 'deepl-key',
      deepl_enabled: true,
      deepl_is_pro: true,
    });

    expect(
      buildCloudProviderSaveMutation(openAiProvider, 'openai-key', {
        model: 'invalid-model',
      }),
    ).toEqual({
      openai_api_key: 'openai-key',
    });

    expect(
      buildCloudProviderSaveMutation(googleCloudProvider, 'google-key', {
        enabled: true,
      }),
    ).toEqual({
      google_cloud_api_key: 'google-key',
      google_cloud_enabled: true,
    });
  });

  it('applies saved status updates using provider capabilities and previous fallback values', () => {
    expect(
      applySavedCloudProviderStatus(
        {
          hasKey: false,
          enabled: false,
          isPro: true,
          model: 'gpt-4o-mini',
        },
        openAiProvider,
        {
          enabled: true,
          model: 'invalid-model',
        },
      ),
    ).toEqual({
      hasKey: true,
      enabled: true,
      isPro: undefined,
      model: 'invalid-model',
    });

    expect(
      applySavedCloudProviderStatus(undefined, deeplProvider, {
        enabled: true,
        isPro: true,
      }),
    ).toEqual({
      hasKey: true,
      enabled: true,
      isPro: true,
      model: undefined,
    });

    expect(
      applySavedCloudProviderStatus(
        {
          hasKey: false,
          enabled: true,
        },
        googleCloudProvider,
        {},
      ),
    ).toEqual({
      hasKey: true,
      enabled: true,
      isPro: undefined,
      model: undefined,
    });
  });

  it('creates removed status records and clears transient test state', () => {
    expect(
      createRemovedCloudProviderStatus({
        hasKey: true,
        enabled: true,
        isPro: true,
        model: 'gpt-4o',
        testing: true,
        testResult: 'success',
        testMessage: 'ok',
      }),
    ).toEqual({
      hasKey: false,
      enabled: false,
      isPro: undefined,
      model: undefined,
      testing: false,
      testResult: null,
      testMessage: undefined,
    });
  });

  it('returns unique managed keys for each provider', () => {
    expect(getManagedCloudProviderKeys(deeplProvider)).toEqual(
      expect.arrayContaining(['deepl_api_key', 'deepl_enabled', 'deepl_is_pro', 'deepl_formality']),
    );
    expect(new Set(getManagedCloudProviderKeys(deeplProvider)).size).toBe(
      getManagedCloudProviderKeys(deeplProvider).length,
    );

    expect(
      getManagedCloudProviderKeys({
        ...googleCloudProvider,
        enabledField: '',
        storage: {
          apiKey: 'google_cloud_api_key',
          related: ['google_cloud_api_key', 'google_cloud_chars_used'],
        },
      } as typeof googleCloudProvider),
    ).toEqual(['google_cloud_api_key', 'google_cloud_chars_used']);
  });
});
