/**
 * Shared cloud provider storage types and readers used across background, popup, and options.
 */

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

export interface CloudProviderEnabledStorageRecord {
  deepl_enabled?: unknown;
  openai_enabled?: unknown;
  google_cloud_enabled?: unknown;
  anthropic_enabled?: unknown;
}

export type CloudProviderStorageRecord =
  & DeepLStoredConfig
  & OpenAIStoredConfig
  & AnthropicStoredConfig
  & GoogleCloudStoredConfig;

export type CloudProviderSettingsStorageRecord =
  & CloudProviderStorageRecord
  & CloudProviderEnabledStorageRecord;

export type CloudProviderStorageKey = keyof CloudProviderStorageRecord;
export type CloudProviderSettingsStorageKey = keyof CloudProviderSettingsStorageRecord;

export type CloudProviderStorageValue = string | number | boolean;

export type CloudProviderStorageMutation = Partial<
  Record<CloudProviderStorageKey, CloudProviderStorageValue>
>;

export type CloudProviderSettingsStorageMutation = Partial<
  Record<CloudProviderSettingsStorageKey, CloudProviderStorageValue>
>;

export type CloudProviderStatusStorageRecord = Pick<
  CloudProviderStorageRecord,
  'deepl_api_key' | 'openai_api_key' | 'anthropic_api_key' | 'google_cloud_api_key'
>;

export interface CloudProviderStorageFields {
  keyField: string;
  enabledField?: string;
  proField?: string;
  modelField?: string;
}

function readStoredValue(stored: object, key?: string): unknown {
  if (!key) {
    return undefined;
  }

  return (stored as Record<string, unknown>)[key];
}

export function readStoredBoolean(stored: object, key?: string): boolean | undefined {
  const value = readStoredValue(stored, key);
  return typeof value === 'boolean' ? value : undefined;
}

export function readStoredString(stored: object, key?: string): string | undefined {
  const value = readStoredValue(stored, key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function hasStoredApiKey(stored: object, key: string): boolean {
  return readStoredString(stored, key) !== undefined;
}

export function getCloudProviderStorageKeys(
  providers: readonly CloudProviderStorageFields[]
): string[] {
  const keys = new Set<string>();

  for (const provider of providers) {
    keys.add(provider.keyField);
    if (provider.enabledField) {
      keys.add(provider.enabledField);
    }
    if (provider.proField) {
      keys.add(provider.proField);
    }
    if (provider.modelField) {
      keys.add(provider.modelField);
    }
  }

  return [...keys];
}
