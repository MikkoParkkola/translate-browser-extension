import {
  buildValidatedCloudProviderMutation,
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
import {
  normalizeUserSettings,
  type NormalizedUserSettings,
} from '../../shared/extension-settings';

export {
  buildValidatedCloudProviderMutation,
  normalizeUserSettings,
  validateAnthropicStoredConfig,
  validateCloudProviderOptions,
  validateDeepLStoredConfig,
  validateGoogleCloudStoredConfig,
  validateOpenAIStoredConfig,
};

export type {
  NormalizedUserSettings,
  ValidatedAnthropicConfig,
  ValidatedCloudProviderOptions,
  ValidatedDeepLConfig,
  ValidatedGoogleCloudConfig,
  ValidatedOpenAIConfig,
};
