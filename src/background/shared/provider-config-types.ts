export interface DeepLStoredConfig {
  deepl_api_key?: unknown;
  deepl_is_pro?: unknown;
  deepl_formality?: unknown;
}

export interface OpenAIStoredConfig {
  openai_api_key?: unknown;
  openai_model?: unknown;
  openai_formality?: unknown;
  openai_temperature?: unknown;
  openai_tokens_used?: unknown;
}

export interface AnthropicStoredConfig {
  anthropic_api_key?: unknown;
  anthropic_model?: unknown;
  anthropic_formality?: unknown;
  anthropic_tokens_used?: unknown;
}

export interface GoogleCloudStoredConfig {
  google_cloud_api_key?: unknown;
  google_cloud_chars_used?: unknown;
}

export type CloudProviderStorageRecord =
  & DeepLStoredConfig
  & OpenAIStoredConfig
  & AnthropicStoredConfig
  & GoogleCloudStoredConfig;

export type CloudProviderStorageKey = keyof CloudProviderStorageRecord;

export type CloudProviderStorageValue = string | number | boolean;

export type CloudProviderStorageMutation = Partial<Record<CloudProviderStorageKey, CloudProviderStorageValue>>;

export type CloudProviderStatusStorageRecord = Pick<
  CloudProviderStorageRecord,
  'deepl_api_key' | 'openai_api_key' | 'anthropic_api_key' | 'google_cloud_api_key'
>;

export interface UserSettingsStorageRecord {
  sourceLang?: unknown;
  targetLang?: unknown;
  provider?: unknown;
  strategy?: unknown;
}
