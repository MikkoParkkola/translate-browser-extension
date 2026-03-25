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
  CLOUD_PROVIDER_CONFIGS,
  DEFAULT_ANTHROPIC_FORMALITY,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_DEEPL_FORMALITY,
  DEFAULT_OPENAI_FORMALITY,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TEMPERATURE,
  DEEPL_FORMALITY_VALUES,
  OPENAI_FORMALITY_VALUES,
  OPENAI_MODEL_VALUES,
} from './cloud-provider-configs';
import {
  normalizeCloudProviderFormalityValue,
  normalizeCloudProviderModelValue,
} from './provider-options';
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

interface StoredConfigSchema<TStored, TValidated extends { apiKey: string }> {
  readApiKey: (stored: TStored) => string | undefined;
  readFields: (stored: TStored) => Omit<TValidated, 'apiKey'>;
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

function validateStoredConfig<TStored, TValidated extends { apiKey: string }>(
  stored: TStored,
  schema: StoredConfigSchema<TStored, TValidated>
): TValidated | null {
  const apiKey = schema.readApiKey(stored);
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    ...schema.readFields(stored),
  } as TValidated;
}

const DEEPL_STORED_CONFIG_SCHEMA: StoredConfigSchema<DeepLStoredConfig, ValidatedDeepLConfig> = {
  readApiKey: (stored) => readNonEmptyString(stored.deepl_api_key),
  readFields: (stored) => ({
    isPro: readBoolean(stored.deepl_is_pro) ?? false,
    formality: readDeepLFormality(stored.deepl_formality) ?? DEFAULT_DEEPL_FORMALITY,
  }),
};

const OPENAI_STORED_CONFIG_SCHEMA: StoredConfigSchema<OpenAIStoredConfig, ValidatedOpenAIConfig> = {
  readApiKey: (stored) => readNonEmptyString(stored.openai_api_key),
  readFields: (stored) => ({
    model: readOpenAIModel(stored.openai_model) ?? DEFAULT_OPENAI_MODEL,
    formality: readOpenAIFormality(stored.openai_formality) ?? DEFAULT_OPENAI_FORMALITY,
    temperature: readFiniteNumber(stored.openai_temperature) ?? DEFAULT_OPENAI_TEMPERATURE,
    tokensUsed: readFiniteNumber(stored.openai_tokens_used) ?? 0,
  }),
};

const ANTHROPIC_STORED_CONFIG_SCHEMA: StoredConfigSchema<
  AnthropicStoredConfig,
  ValidatedAnthropicConfig
> = {
  readApiKey: (stored) => readNonEmptyString(stored.anthropic_api_key),
  readFields: (stored) => ({
    model: readClaudeModel(stored.anthropic_model) ?? DEFAULT_ANTHROPIC_MODEL,
    formality:
      readAnthropicFormality(stored.anthropic_formality) ?? DEFAULT_ANTHROPIC_FORMALITY,
    tokensUsed: readFiniteNumber(stored.anthropic_tokens_used) ?? 0,
  }),
};

const GOOGLE_CLOUD_STORED_CONFIG_SCHEMA: StoredConfigSchema<
  GoogleCloudStoredConfig,
  ValidatedGoogleCloudConfig
> = {
  readApiKey: (stored) => readNonEmptyString(stored.google_cloud_api_key),
  readFields: (stored) => ({
    charactersUsed: readFiniteNumber(stored.google_cloud_chars_used) ?? 0,
  }),
};

export function validateDeepLStoredConfig(stored: DeepLStoredConfig): ValidatedDeepLConfig | null {
  return validateStoredConfig(stored, DEEPL_STORED_CONFIG_SCHEMA);
}

export function validateOpenAIStoredConfig(stored: OpenAIStoredConfig): ValidatedOpenAIConfig | null {
  return validateStoredConfig(stored, OPENAI_STORED_CONFIG_SCHEMA);
}

export function validateAnthropicStoredConfig(stored: AnthropicStoredConfig): ValidatedAnthropicConfig | null {
  return validateStoredConfig(stored, ANTHROPIC_STORED_CONFIG_SCHEMA);
}

export function validateGoogleCloudStoredConfig(stored: GoogleCloudStoredConfig): ValidatedGoogleCloudConfig | null {
  return validateStoredConfig(stored, GOOGLE_CLOUD_STORED_CONFIG_SCHEMA);
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
