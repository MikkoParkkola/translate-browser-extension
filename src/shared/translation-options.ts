import type { Strategy } from '../types';

interface LanguageDefinition {
  name: string;
  onboardingFlag?: string;
}

const LANGUAGE_DEFINITIONS = {
  auto: { name: 'Auto Detect' },
  en: { name: 'English', onboardingFlag: 'GB' },
  fi: { name: 'Finnish', onboardingFlag: 'FI' },
  de: { name: 'German', onboardingFlag: 'DE' },
  fr: { name: 'French', onboardingFlag: 'FR' },
  es: { name: 'Spanish', onboardingFlag: 'ES' },
  sv: { name: 'Swedish', onboardingFlag: 'SE' },
  ru: { name: 'Russian', onboardingFlag: 'RU' },
  zh: { name: 'Chinese', onboardingFlag: 'CN' },
  ja: { name: 'Japanese', onboardingFlag: 'JP' },
  nl: { name: 'Dutch', onboardingFlag: 'NL' },
  cs: { name: 'Czech' },
  pt: { name: 'Portuguese', onboardingFlag: 'PT' },
  it: { name: 'Italian', onboardingFlag: 'IT' },
  pl: { name: 'Polish', onboardingFlag: 'PL' },
  ko: { name: 'Korean', onboardingFlag: 'KR' },
  ar: { name: 'Arabic', onboardingFlag: 'SA' },
  hi: { name: 'Hindi', onboardingFlag: 'IN' },
  tr: { name: 'Turkish', onboardingFlag: 'TR' },
  uk: { name: 'Ukrainian', onboardingFlag: 'UA' },
} as const satisfies Record<string, LanguageDefinition>;

type SharedLanguageCode = keyof typeof LANGUAGE_DEFINITIONS;

interface StrategyDefinition {
  name: string;
  description: string;
  popupLabel: string;
  popupTitle: string;
}

const STRATEGY_DEFINITIONS = {
  smart: {
    name: 'Smart',
    description: 'Auto-select best provider based on content',
    popupLabel: 'Smart',
    popupTitle: 'Intelligent provider selection',
  },
  fast: {
    name: 'Fast',
    description: 'Prioritize speed over quality',
    popupLabel: 'Fast',
    popupTitle: 'Optimize for speed',
  },
  quality: {
    name: 'Quality',
    description: 'Prioritize accuracy over speed',
    popupLabel: 'Quality',
    popupTitle: 'Optimize for quality',
  },
  cost: {
    name: 'Cost',
    description: 'Prioritize free/local providers',
    popupLabel: 'Cost',
    popupTitle: 'Optimize for cost',
  },
  balanced: {
    name: 'Balanced',
    description: 'Balance between speed, quality, and cost',
    popupLabel: 'Balanced',
    popupTitle: 'Balance speed, quality, and cost',
  },
} as const satisfies Record<Strategy, StrategyDefinition>;

export interface LanguageOption {
  code: string;
  name: string;
}

export interface FlaggedLanguageOption extends LanguageOption {
  flag: string;
}

export interface DescribedStrategyOption {
  id: Strategy;
  name: string;
  description: string;
}

export interface PopupStrategyOption {
  id: Strategy;
  label: string;
  title: string;
}

export interface DefaultableStrategyOption {
  id: Strategy | '';
  name: string;
}

function buildLanguageOptions(codes: readonly SharedLanguageCode[]): LanguageOption[] {
  return codes.map((code) => ({
    code,
    name: LANGUAGE_DEFINITIONS[code].name,
  }));
}

function buildFlaggedLanguageOptions(codes: readonly SharedLanguageCode[], flag: 'blank' | 'onboarding'): FlaggedLanguageOption[] {
  return codes.map((code) => {
    const definition: LanguageDefinition = LANGUAGE_DEFINITIONS[code];
    return {
      code,
      name: definition.name,
      flag: flag === 'onboarding' ? definition.onboardingFlag ?? '' : '',
    };
  });
}

function excludeLanguageCode<T extends LanguageOption>(options: readonly T[], codeToExclude: string): T[] {
  return options.filter((option) => option.code !== codeToExclude);
}

function buildDescribedStrategyOptions(ids: readonly Strategy[]): DescribedStrategyOption[] {
  return ids.map((id) => ({
    id,
    name: STRATEGY_DEFINITIONS[id].name,
    description: STRATEGY_DEFINITIONS[id].description,
  }));
}

function buildPopupStrategyOptions(ids: readonly Strategy[]): PopupStrategyOption[] {
  return ids.map((id) => ({
    id,
    label: STRATEGY_DEFINITIONS[id].popupLabel,
    title: STRATEGY_DEFINITIONS[id].popupTitle,
  }));
}

function buildDefaultableStrategyOptions(ids: readonly Strategy[]): DefaultableStrategyOption[] {
  return ids.map((id) => ({
    id,
    name: STRATEGY_DEFINITIONS[id].name,
  }));
}

const GENERAL_SETTINGS_LANGUAGE_CODES = [
  'auto', 'en', 'fi', 'de', 'fr', 'es', 'sv', 'ru', 'zh', 'ja', 'nl', 'cs', 'pt', 'it', 'pl', 'ko',
] as const satisfies readonly SharedLanguageCode[];

const POPUP_LANGUAGE_CODES = [
  'auto', 'en', 'fi', 'de', 'fr', 'es', 'sv', 'ru', 'zh', 'ja', 'nl', 'cs',
] as const satisfies readonly SharedLanguageCode[];

const SITE_RULE_LANGUAGE_CODES = [
  'auto', 'en', 'fi', 'de', 'fr', 'es', 'sv',
] as const satisfies readonly SharedLanguageCode[];

const GLOSSARY_LANGUAGE_CODES = [
  'en', 'fi', 'de', 'fr', 'es', 'sv',
] as const satisfies readonly SharedLanguageCode[];

const ONBOARDING_LANGUAGE_CODES = [
  'en', 'fi', 'sv', 'de', 'fr', 'es', 'nl', 'it', 'pt', 'pl', 'ru', 'ja', 'zh', 'ko', 'ar', 'hi', 'tr', 'uk',
] as const satisfies readonly SharedLanguageCode[];

const FULL_STRATEGY_ORDER = ['smart', 'fast', 'quality', 'cost', 'balanced'] as const satisfies readonly Strategy[];
const POPUP_STRATEGY_ORDER = ['smart', 'fast', 'quality'] as const satisfies readonly Strategy[];

export const GENERAL_SETTINGS_LANGUAGES = buildLanguageOptions(GENERAL_SETTINGS_LANGUAGE_CODES);
export const GENERAL_SETTINGS_TARGET_LANGUAGES = excludeLanguageCode(GENERAL_SETTINGS_LANGUAGES, 'auto');
export const GENERAL_SETTINGS_STRATEGIES = buildDescribedStrategyOptions(FULL_STRATEGY_ORDER);

export const POPUP_SOURCE_LANGUAGES = buildFlaggedLanguageOptions(POPUP_LANGUAGE_CODES, 'blank');
export const POPUP_TARGET_LANGUAGES = excludeLanguageCode(POPUP_SOURCE_LANGUAGES, 'auto');
export const POPUP_STRATEGIES = buildPopupStrategyOptions(POPUP_STRATEGY_ORDER);

export const GLOSSARY_LANGUAGES: LanguageOption[] = [
  { code: 'all', name: 'All Languages' },
  ...buildLanguageOptions(GLOSSARY_LANGUAGE_CODES),
];

export const SITE_RULE_LANGUAGES: LanguageOption[] = [
  { code: '', name: 'Use default' },
  ...buildLanguageOptions(SITE_RULE_LANGUAGE_CODES),
];
export const SITE_RULE_TARGET_LANGUAGES = excludeLanguageCode(SITE_RULE_LANGUAGES, 'auto');
export const SITE_RULE_STRATEGIES: DefaultableStrategyOption[] = [
  { id: '', name: 'Use default' },
  ...buildDefaultableStrategyOptions(FULL_STRATEGY_ORDER),
];

export const ONBOARDING_LANGUAGES = buildFlaggedLanguageOptions(ONBOARDING_LANGUAGE_CODES, 'onboarding');
