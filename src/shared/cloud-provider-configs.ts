/**
 * Shared cloud provider configuration used across popup and options pages.
 */
import type { CloudProviderId } from '../types';

export interface CloudProviderConfig {
  id: CloudProviderId;
  name: string;
  keyField: string;
  hasProTier: boolean;
  proField?: string;
  placeholder: string;
  helpUrl: string;
  description: string;
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
  },
  {
    id: 'openai',
    name: 'OpenAI',
    keyField: 'openai_api_key',
    hasProTier: false,
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
    description: 'LLM-powered translations with context understanding.',
  },
  {
    id: 'google-cloud',
    name: 'Google Cloud',
    keyField: 'google_cloud_api_key',
    hasProTier: false,
    placeholder: 'AIza...',
    helpUrl: 'https://cloud.google.com/translate/docs/setup',
    description: 'Google Cloud Translation API v2.',
  },
  {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    keyField: 'anthropic_api_key',
    hasProTier: false,
    placeholder: 'sk-ant-...',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    description: 'Claude-powered translations with nuanced understanding.',
  },
];
