import type { CloudProviderId, Strategy, TranslationProviderId } from '../../types';
import { normalizeTranslationProviderId } from '../../shared/provider-options';
import type { ClaudeFormality, ClaudeModel } from '../../providers/anthropic';
import type { DeepLFormality } from '../../providers/deepl';
import type { OpenAIFormality, OpenAIModel } from '../../providers/openai';
import type {
  AnthropicStoredConfig,
  CloudProviderStorageMutation,
  DeepLStoredConfig,
  GoogleCloudStoredConfig,
  OpenAIStoredConfig,
  UserSettingsStorageRecord,
} from './provider-config-types';

const STRATEGY_VALUES = ['smart', 'fast', 'quality', 'cost', 'balanced'] as const satisfies readonly Strategy[];
const DEEPL_FORMALITY_VALUES = ['default', 'more', 'less', 'prefer_more', 'prefer_less'] as const satisfies readonly DeepLFormality[];
const OPENAI_FORMALITY_VALUES = ['formal', 'informal', 'neutral'] as const satisfies readonly OpenAIFormality[];
const OPENAI_MODEL_VALUES = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] as const satisfies readonly OpenAIModel[];
const CLAUDE_FORMALITY_VALUES = ['formal', 'informal', 'neutral'] as const satisfies readonly ClaudeFormality[];
const CLAUDE_MODEL_VALUES = [
  'claude-sonnet-4-20250514',
  'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet-20241022',
] as const satisfies readonly ClaudeModel[];

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readEnumValue<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? value as T
    : undefined;
}

export interface NormalizedUserSettings {
  sourceLang: string;
  targetLang: string;
  provider: TranslationProviderId;
  strategy: Strategy;
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

export type ValidatedCloudProviderOptions = Partial<{
  isPro: boolean;
  formality: string;
  model: string;
  temperature: number;
}>;

const DEEPL_FORMALITY_ALIASES: Partial<Record<string, DeepLFormality>> = {
  formal: 'more',
  informal: 'less',
};

const CLAUDE_MODEL_ALIASES: Partial<Record<string, ClaudeModel>> = {
  'claude-3-5-haiku-latest': 'claude-3-5-haiku-20241022',
  'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
  'claude-3-haiku-20240307': 'claude-3-5-haiku-20241022',
};

function readDeepLFormality(value: unknown): DeepLFormality | undefined {
  const formality = readNonEmptyString(value);
  if (!formality) {
    return undefined;
  }

  return readEnumValue(formality, DEEPL_FORMALITY_VALUES) ?? DEEPL_FORMALITY_ALIASES[formality];
}

function readClaudeModel(value: unknown): ClaudeModel | undefined {
  const model = readNonEmptyString(value);
  if (!model) {
    return undefined;
  }

  return readEnumValue(model, CLAUDE_MODEL_VALUES) ?? CLAUDE_MODEL_ALIASES[model];
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
    model: readEnumValue(stored.openai_model, OPENAI_MODEL_VALUES) ?? 'gpt-4o-mini',
    formality: readEnumValue(stored.openai_formality, OPENAI_FORMALITY_VALUES) ?? 'neutral',
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
    formality: readEnumValue(stored.anthropic_formality, CLAUDE_FORMALITY_VALUES) ?? 'neutral',
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
      const formality = readNonEmptyString(options.formality);
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
      const model = readNonEmptyString(options.model);
      const formality = readNonEmptyString(options.formality);
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
      const model = readNonEmptyString(options.model);
      const formality = readNonEmptyString(options.formality);
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
