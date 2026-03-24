/**
 * Shared cloud provider configuration used across popup and options pages.
 */
import type { CloudProviderId } from '../types';

export interface CloudProviderStorageConfig {
  apiKey: string;
  related: readonly string[];
}

export interface CloudProviderConfig {
  id: CloudProviderId;
  name: string;
  keyField: string;
  hasProTier: boolean;
  proField?: string;
  placeholder: string;
  helpUrl: string;
  description: string;
  storage: CloudProviderStorageConfig;
  optionFields?: Readonly<Record<string, string>>;
}

export const CLOUD_PROVIDER_CONFIGS: CloudProviderConfig[] = [
  {
    id: 'deepl',
    name: 'DeepL',
    keyField: 'deepl_api_key',
    hasProTier: true,
    proField: 'deepl_is_pro',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx',
    helpUrl: 'https://www.deepl.com/pro-api',
    description: 'Premium translation quality. Free tier: 500K chars/month.',
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
    hasProTier: false,
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    description: 'LLM-powered translations with context understanding.',
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
    hasProTier: false,
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Claude-powered translations with nuanced understanding.',
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
