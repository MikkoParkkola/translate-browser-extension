import type { Strategy, TranslationProviderId } from '../../types';
import { normalizeTranslationProviderId } from '../../shared/provider-options';
import {
  buildValidatedCloudProviderMutation,
  readEnumValue,
  readNonEmptyString,
  type ValidatedAnthropicConfig,
  type ValidatedCloudProviderOptions,
  type ValidatedDeepLConfig,
  type ValidatedGoogleCloudConfig,
  type ValidatedOpenAIConfig,
  validateAnthropicStoredConfig,
  validateCloudProviderOptions,
  validateDeepLStoredConfig,
  validateGoogleCloudStoredConfig,
  validateOpenAIStoredConfig,
} from '../../shared/cloud-provider-config-state';
import type { UserSettingsStorageRecord } from './provider-config-types';

const STRATEGY_VALUES = ['smart', 'fast', 'quality', 'cost', 'balanced'] as const satisfies readonly Strategy[];

export interface NormalizedUserSettings {
  sourceLang: string;
  targetLang: string;
  provider: TranslationProviderId;
  strategy: Strategy;
}

export function normalizeUserSettings(
  stored: UserSettingsStorageRecord,
  defaultProvider: TranslationProviderId,
): NormalizedUserSettings {
  return {
    sourceLang: readNonEmptyString(stored.sourceLang) ?? 'auto',
    targetLang: readNonEmptyString(stored.targetLang) ?? 'en',
    provider: normalizeTranslationProviderId(stored.provider, defaultProvider),
    strategy: readEnumValue(stored.strategy, STRATEGY_VALUES) ?? 'smart',
  };
}

export {
  buildValidatedCloudProviderMutation,
  validateAnthropicStoredConfig,
  validateCloudProviderOptions,
  validateDeepLStoredConfig,
  validateGoogleCloudStoredConfig,
  validateOpenAIStoredConfig,
};

export type {
  ValidatedAnthropicConfig,
  ValidatedCloudProviderOptions,
  ValidatedDeepLConfig,
  ValidatedGoogleCloudConfig,
  ValidatedOpenAIConfig,
};
