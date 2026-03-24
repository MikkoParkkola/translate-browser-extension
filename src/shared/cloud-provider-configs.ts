/**
 * Shared cloud provider configuration used across popup and options pages.
 */
import type { CloudProviderId } from '../types';
import type { CloudProviderStorageFields } from './cloud-provider-storage';

export const DEEPL_FORMALITY_VALUES = [
  'default',
  'more',
  'less',
  'prefer_more',
  'prefer_less',
] as const;

export const OPENAI_FORMALITY_VALUES = ['formal', 'informal', 'neutral'] as const;
export const OPENAI_MODEL_VALUES = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] as const;
export const ANTHROPIC_FORMALITY_VALUES = ['formal', 'informal', 'neutral'] as const;
export const ANTHROPIC_MODEL_VALUES = [
  'claude-sonnet-4-20250514',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
] as const;

export interface CloudProviderStorageConfig {
  apiKey: string;
  related: readonly string[];
}

export interface CloudProviderConfig extends CloudProviderStorageFields {
  id: CloudProviderId;
  name: string;
  enabledField: string;
  hasProTier: boolean;
  placeholder: string;
  helpUrl: string;
  description: string;
  storage: CloudProviderStorageConfig;
  testEndpoint?: string;
  models?: readonly string[];
  optionFields?: Readonly<Record<string, string>>;
}

export const CLOUD_PROVIDER_CONFIGS: CloudProviderConfig[] = [
  {
    id: 'deepl',
    name: 'DeepL',
    keyField: 'deepl_api_key',
    enabledField: 'deepl_enabled',
    hasProTier: true,
    proField: 'deepl_is_pro',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx',
    helpUrl: 'https://www.deepl.com/pro-api',
    description: 'Premium translation quality. Free tier: 500K chars/month.',
    testEndpoint: 'https://api-free.deepl.com/v2/usage',
    storage: {
      apiKey: 'deepl_api_key',
      related: ['deepl_is_pro', 'deepl_formality'],
    },
    optionFields: {
      isPro: 'deepl_is_pro',
      formality: 'deepl_formality',
    },
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keyField: 'openai_api_key',
    enabledField: 'openai_enabled',
    hasProTier: false,
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    description: 'LLM-powered translations with context understanding.',
    modelField: 'openai_model',
    models: OPENAI_MODEL_VALUES,
    storage: {
      apiKey: 'openai_api_key',
      related: ['openai_model', 'openai_formality', 'openai_temperature', 'openai_tokens_used'],
    },
    optionFields: {
      model: 'openai_model',
      formality: 'openai_formality',
    },
  },
  {
    id: 'google-cloud',
    name: 'Google Cloud',
    keyField: 'google_cloud_api_key',
    enabledField: 'google_cloud_enabled',
    hasProTier: false,
    placeholder: 'AIza...',
    helpUrl: 'https://cloud.google.com/translate/docs/setup',
    description: 'Google Cloud Translation API v2.',
    storage: {
      apiKey: 'google_cloud_api_key',
      related: ['google_cloud_chars_used'],
    },
  },
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    keyField: 'anthropic_api_key',
    enabledField: 'anthropic_enabled',
    hasProTier: false,
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Claude-powered translations with nuanced understanding.',
    modelField: 'anthropic_model',
    models: ANTHROPIC_MODEL_VALUES,
    storage: {
      apiKey: 'anthropic_api_key',
      related: ['anthropic_model', 'anthropic_formality', 'anthropic_tokens_used'],
    },
    optionFields: {
      model: 'anthropic_model',
      formality: 'anthropic_formality',
    },
  },
];

export const CLOUD_PROVIDER_CONFIG_MAP = Object.freeze(
  Object.fromEntries(CLOUD_PROVIDER_CONFIGS.map((config) => [config.id, config]))
) as Readonly<Record<CloudProviderId, CloudProviderConfig>>;

export function getCloudProviderConfig(providerId: CloudProviderId): CloudProviderConfig {
  return CLOUD_PROVIDER_CONFIG_MAP[providerId];
}
