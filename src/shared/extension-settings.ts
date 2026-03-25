import type { Strategy, TranslationProviderId } from '../types';
import {
  readBoolean,
  readEnumValue,
  readNonEmptyString,
} from './cloud-provider-config-state';
import {
  DEFAULT_PROVIDER_ID,
  normalizeTranslationProviderId,
} from './provider-options';

const STRATEGY_VALUES = ['smart', 'fast', 'quality', 'cost', 'balanced'] as const satisfies readonly Strategy[];

export interface ExtensionSettingsStorageRecord {
  sourceLang?: unknown;
  targetLang?: unknown;
  provider?: unknown;
  strategy?: unknown;
  autoTranslate?: unknown;
}

export interface NormalizedUserSettings {
  sourceLang: string;
  targetLang: string;
  provider: TranslationProviderId;
  strategy: Strategy;
}

export interface NormalizedExtensionSettings extends NormalizedUserSettings {
  autoTranslate: boolean;
}

export type ExtensionSettingsStorageMutation = Record<string, unknown> & {
  sourceLang?: string;
  targetLang?: string;
  provider?: TranslationProviderId;
  strategy?: Strategy;
  autoTranslate?: boolean;
};

type SettingsDefaults =
  | TranslationProviderId
  | Partial<NormalizedExtensionSettings>;

const BASE_EXTENSION_SETTINGS: Readonly<NormalizedExtensionSettings> = {
  sourceLang: 'auto',
  targetLang: 'en',
  provider: DEFAULT_PROVIDER_ID,
  strategy: 'smart',
  autoTranslate: false,
};

function resolveDefaults(
  defaults: SettingsDefaults = DEFAULT_PROVIDER_ID,
): Readonly<NormalizedExtensionSettings> {
  if (typeof defaults === 'string') {
    return {
      ...BASE_EXTENSION_SETTINGS,
      provider: defaults,
    };
  }

  return {
    sourceLang: defaults.sourceLang ?? BASE_EXTENSION_SETTINGS.sourceLang,
    targetLang: defaults.targetLang ?? BASE_EXTENSION_SETTINGS.targetLang,
    provider: defaults.provider ?? BASE_EXTENSION_SETTINGS.provider,
    strategy: defaults.strategy ?? BASE_EXTENSION_SETTINGS.strategy,
    autoTranslate: defaults.autoTranslate ?? BASE_EXTENSION_SETTINGS.autoTranslate,
  };
}

export function normalizeUserSettings(
  stored: ExtensionSettingsStorageRecord,
  defaults: SettingsDefaults = DEFAULT_PROVIDER_ID,
): NormalizedUserSettings {
  const resolvedDefaults = resolveDefaults(defaults);

  return {
    sourceLang: readNonEmptyString(stored.sourceLang) ?? resolvedDefaults.sourceLang,
    targetLang: readNonEmptyString(stored.targetLang) ?? resolvedDefaults.targetLang,
    provider: normalizeTranslationProviderId(stored.provider, resolvedDefaults.provider),
    strategy: readEnumValue(stored.strategy, STRATEGY_VALUES) ?? resolvedDefaults.strategy,
  };
}

export function normalizeExtensionSettings(
  stored: ExtensionSettingsStorageRecord,
  defaults: SettingsDefaults = DEFAULT_PROVIDER_ID,
): NormalizedExtensionSettings {
  const resolvedDefaults = resolveDefaults(defaults);
  const base = normalizeUserSettings(stored, resolvedDefaults);

  return {
    ...base,
    autoTranslate: readBoolean(stored.autoTranslate) ?? resolvedDefaults.autoTranslate,
  };
}

export function buildExtensionSettingsStorageMutation(
  stored: Partial<ExtensionSettingsStorageRecord>,
  defaults: SettingsDefaults = DEFAULT_PROVIDER_ID,
): ExtensionSettingsStorageMutation {
  const resolvedDefaults = resolveDefaults(defaults);
  const mutation: ExtensionSettingsStorageMutation = {};

  if ('sourceLang' in stored) {
    mutation.sourceLang = readNonEmptyString(stored.sourceLang) ?? resolvedDefaults.sourceLang;
  }

  if ('targetLang' in stored) {
    mutation.targetLang = readNonEmptyString(stored.targetLang) ?? resolvedDefaults.targetLang;
  }

  if ('provider' in stored) {
    mutation.provider = normalizeTranslationProviderId(stored.provider, resolvedDefaults.provider);
  }

  if ('strategy' in stored) {
    mutation.strategy = readEnumValue(stored.strategy, STRATEGY_VALUES) ?? resolvedDefaults.strategy;
  }

  if ('autoTranslate' in stored) {
    mutation.autoTranslate = readBoolean(stored.autoTranslate) ?? resolvedDefaults.autoTranslate;
  }

  return mutation;
}
