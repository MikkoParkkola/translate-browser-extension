export type {
  AnthropicStoredConfig,
  CloudProviderEnabledStorageRecord,
  CloudProviderSettingsStorageKey,
  CloudProviderSettingsStorageMutation,
  CloudProviderSettingsStorageRecord,
  CloudProviderStorageKey,
  CloudProviderStorageMutation,
  CloudProviderStorageRecord,
  CloudProviderStorageValue,
  CloudProviderStatusStorageRecord,
  DeepLStoredConfig,
  GoogleCloudStoredConfig,
  OpenAIStoredConfig,
} from '../../shared/cloud-provider-storage';

export interface UserSettingsStorageRecord {
  sourceLang?: unknown;
  targetLang?: unknown;
  provider?: unknown;
  strategy?: unknown;
}
