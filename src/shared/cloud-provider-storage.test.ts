import { describe, expect, it } from 'vitest';
import {
  getCloudProviderStorageKeys,
  hasStoredApiKey,
  readStoredBoolean,
  readStoredString,
} from './cloud-provider-storage';
import { CLOUD_PROVIDER_CONFIGS } from './cloud-provider-configs';
import { OPTIONS_CLOUD_PROVIDERS } from './provider-options';

describe('cloud-provider-storage helpers', () => {
  it('collects unique storage keys from provider metadata', () => {
    const popupKeys = getCloudProviderStorageKeys(CLOUD_PROVIDER_CONFIGS);
    const optionsKeys = getCloudProviderStorageKeys(OPTIONS_CLOUD_PROVIDERS);

    expect(popupKeys).toContain('deepl_api_key');
    expect(popupKeys).toContain('deepl_is_pro');
    expect(optionsKeys).toContain('deepl_enabled');
    expect(optionsKeys).toContain('openai_model');
    expect(optionsKeys.filter((key) => key === 'deepl_api_key')).toHaveLength(1);
  });

  it('reads booleans only when the stored value is a boolean', () => {
    expect(readStoredBoolean({ deepl_enabled: true }, 'deepl_enabled')).toBe(true);
    expect(readStoredBoolean({ deepl_enabled: 'true' }, 'deepl_enabled')).toBeUndefined();
    expect(readStoredBoolean({}, undefined)).toBeUndefined();
  });

  it('reads non-empty strings only when the stored value is a string', () => {
    expect(readStoredString({ openai_model: 'gpt-4o' }, 'openai_model')).toBe('gpt-4o');
    expect(readStoredString({ openai_model: '' }, 'openai_model')).toBeUndefined();
    expect(readStoredString({ openai_model: 42 }, 'openai_model')).toBeUndefined();
    expect(readStoredString({}, undefined)).toBeUndefined();
  });

  it('treats only non-empty strings as configured API keys', () => {
    expect(hasStoredApiKey({ deepl_api_key: 'key' }, 'deepl_api_key')).toBe(true);
    expect(hasStoredApiKey({ deepl_api_key: '' }, 'deepl_api_key')).toBe(false);
    expect(hasStoredApiKey({ deepl_api_key: true }, 'deepl_api_key')).toBe(false);
  });

  it('collects keys from providers without optional metadata', () => {
    expect(
      getCloudProviderStorageKeys([
        {
          keyField: 'google_cloud_api_key',
        },
      ]),
    ).toEqual(['google_cloud_api_key']);
  });
});
