/**
 * Shared cloud provider config validation and derived state helpers.
 */

import type { CloudProviderConfiguredStatus, CloudProviderId } from '../types';
import type { ClaudeFormality, ClaudeModel } from '../providers/anthropic';
import type { DeepLFormality } from '../providers/deepl';
import type { OpenAIFormality, OpenAIModel } from '../providers/openai';
import {
  ANTHROPIC_FORMALITY_VALUES,
  ANTHROPIC_MODEL_VALUES,
  DEEPL_FORMALITY_VALUES,
  OPENAI_FORMALITY_VALUES,
  OPENAI_MODEL_VALUES,
  normalizeCloudProviderFormalityValue,
  normalizeCloudProviderModelValue,
} from './provider-options';
import { CLOUD_PROVIDER_CONFIGS } from './cloud-provider-configs';
import type {
  AnthropicStoredConfig,
  CloudProviderStorageMutation,
  CloudProviderStorageRecord,
  DeepLStoredConfig,
  GoogleCloudStoredConfig,
  OpenAIStoredConfig,
} from './cloud-provider-storage';

export function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function readEnumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : undefined;
}

export interface ValidatedDeepLConfig {
  apiKey: string;
  isPro: boolean;
  formality: DeepLFormality;
}

export interface ValidatedOpenAIConfig {
  apiKey: string;
  model: OpenAIModel;
  formality: OpenAIFormality;
  temperature: number;
  tokensUsed: number;
}

export interface ValidatedAnthropicConfig {
  apiKey: string;
  model: ClaudeModel;
  formality: ClaudeFormality;
  tokensUsed: number;
}

export interface ValidatedGoogleCloudConfig {
  apiKey: string;
  charactersUsed: number;
}

export interface CloudProviderConfigState {
  hasKey: boolean;
  isPro?: boolean;
  model?: string;
}

export type ValidatedCloudProviderOptions = Partial<{
  isPro: boolean;
  formality: string;
  model: string;
  temperature: number;
}>;

export function readDeepLFormality(value: unknown): DeepLFormality | undefined {
  const formality = normalizeCloudProviderFormalityValue('deepl', value);
  return formality ? readEnumValue(formality, DEEPL_FORMALITY_VALUES) : undefined;
}

export function readOpenAIFormality(value: unknown): OpenAIFormality | undefined {
  const formality = normalizeCloudProviderFormalityValue('openai', value);
  return formality ? readEnumValue(formality, OPENAI_FORMALITY_VALUES) : undefined;
}

export function readOpenAIModel(value: unknown): OpenAIModel | undefined {
  const model = normalizeCloudProviderModelValue('openai', value);
  return model ? readEnumValue(model, OPENAI_MODEL_VALUES) : undefined;
}

export function readAnthropicFormality(value: unknown): ClaudeFormality | undefined {
  const formality = normalizeCloudProviderFormalityValue('anthropic', value);
  return formality ? readEnumValue(formality, ANTHROPIC_FORMALITY_VALUES) : undefined;
}

export function readClaudeModel(value: unknown): ClaudeModel | undefined {
  const model = normalizeCloudProviderModelValue('anthropic', value);
  return model ? readEnumValue(model, ANTHROPIC_MODEL_VALUES) : undefined;
}

export function validateDeepLStoredConfig(stored: DeepLStoredConfig): ValidatedDeepLConfig | null {
  const apiKey = readNonEmptyString(stored.deepl_api_key);
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    isPro: readBoolean(stored.deepl_is_pro) ?? false,
    formality: readDeepLFormality(stored.deepl_formality) ?? 'default',
  };
}

export function validateOpenAIStoredConfig(stored: OpenAIStoredConfig): ValidatedOpenAIConfig | null {
  const apiKey = readNonEmptyString(stored.openai_api_key);
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: readOpenAIModel(stored.openai_model) ?? 'gpt-4o-mini',
    formality: readOpenAIFormality(stored.openai_formality) ?? 'neutral',
    temperature: readFiniteNumber(stored.openai_temperature) ?? 0.3,
    tokensUsed: readFiniteNumber(stored.openai_tokens_used) ?? 0,
  };
}

export function validateAnthropicStoredConfig(stored: AnthropicStoredConfig): ValidatedAnthropicConfig | null {
  const apiKey = readNonEmptyString(stored.anthropic_api_key);
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: readClaudeModel(stored.anthropic_model) ?? 'claude-3-5-haiku-20241022',
    formality: readAnthropicFormality(stored.anthropic_formality) ?? 'neutral',
    tokensUsed: readFiniteNumber(stored.anthropic_tokens_used) ?? 0,
  };
}

export function validateGoogleCloudStoredConfig(stored: GoogleCloudStoredConfig): ValidatedGoogleCloudConfig | null {
  const apiKey = readNonEmptyString(stored.google_cloud_api_key);
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    charactersUsed: readFiniteNumber(stored.google_cloud_chars_used) ?? 0,
  };
}

export function validateCloudProviderOptions(
  provider: CloudProviderId,
  options: Record<string, unknown>,
): ValidatedCloudProviderOptions {
  switch (provider) {
    case 'deepl': {
      const validated: ValidatedCloudProviderOptions = {};
      const isPro = readBoolean(options.isPro);
      const formality = readDeepLFormality(options.formality);
      if (isPro !== undefined) {
        validated.isPro = isPro;
      }
      if (formality !== undefined) {
        validated.formality = formality;
      }
      return validated;
    }
    case 'openai': {
      const validated: ValidatedCloudProviderOptions = {};
      const model = readOpenAIModel(options.model);
      const formality = readOpenAIFormality(options.formality);
      const temperature = readFiniteNumber(options.temperature);
      if (model !== undefined) {
        validated.model = model;
      }
      if (formality !== undefined) {
        validated.formality = formality;
      }
      if (temperature !== undefined) {
        validated.temperature = temperature;
      }
      return validated;
    }
    case 'anthropic': {
      const validated: ValidatedCloudProviderOptions = {};
      const model = readClaudeModel(options.model);
      const formality = readAnthropicFormality(options.formality);
      if (model !== undefined) {
        validated.model = model;
      }
      if (formality !== undefined) {
        validated.formality = formality;
      }
      return validated;
    }
    case 'google-cloud':
      return {};
  }
}

export function buildValidatedCloudProviderMutation(
  provider: CloudProviderId,
  options: Record<string, unknown>,
  optionFields: Readonly<Record<string, string>>,
): CloudProviderStorageMutation {
  const validatedOptions = validateCloudProviderOptions(provider, options);
  const mutation: CloudProviderStorageMutation = {};

  for (const [optionKey, optionStorageKey] of Object.entries(optionFields)) {
    const optionValue = validatedOptions[optionKey as keyof ValidatedCloudProviderOptions];
    if (optionValue !== undefined) {
      mutation[optionStorageKey as keyof CloudProviderStorageMutation] = optionValue;
    }
  }

  return mutation;
}

export function extractCloudProviderConfigState(
  provider: CloudProviderId,
  stored: CloudProviderStorageRecord,
): CloudProviderConfigState {
  switch (provider) {
    case 'deepl': {
      const config = validateDeepLStoredConfig(stored);
      return {
        hasKey: config !== null,
        isPro: config?.isPro,
      };
    }
    case 'openai': {
      const config = validateOpenAIStoredConfig(stored);
      return {
        hasKey: config !== null,
        model: config?.model,
      };
    }
    case 'anthropic': {
      const config = validateAnthropicStoredConfig(stored);
      return {
        hasKey: config !== null,
        model: config?.model,
      };
    }
    case 'google-cloud': {
      const config = validateGoogleCloudStoredConfig(stored);
      return {
        hasKey: config !== null,
      };
    }
  }
}

const EMPTY_CLOUD_PROVIDER_CONFIGURED_STATUS = Object.freeze(
  Object.fromEntries(CLOUD_PROVIDER_CONFIGS.map((config) => [config.id, false] as const))
) as CloudProviderConfiguredStatus;

export function createEmptyCloudProviderConfiguredStatus(): CloudProviderConfiguredStatus {
  return { ...EMPTY_CLOUD_PROVIDER_CONFIGURED_STATUS };
}

export function buildCloudProviderConfiguredStatusRecord(
  stored: CloudProviderStorageRecord,
): CloudProviderConfiguredStatus {
  const status = createEmptyCloudProviderConfiguredStatus();

  for (const provider of CLOUD_PROVIDER_CONFIGS) {
    status[provider.id] = extractCloudProviderConfigState(provider.id, stored).hasKey;
  }

  return status;
}
