/**
 * Shared provider metadata used across popup, options, onboarding, and tests.
 */

import type { CloudProviderId, QualityTier, TranslationProviderId } from '../types';
import { CLOUD_PROVIDER_CONFIGS, type CloudProviderConfig } from './cloud-provider-configs';

type LocalProviderId = Extract<TranslationProviderId, 'opus-mt' | 'translategemma' | 'chrome-builtin'>;
type BackgroundProviderId = Extract<TranslationProviderId, 'opus-mt' | 'translategemma'>;
type OnboardingProviderId = Extract<TranslationProviderId, 'opus-mt' | 'chrome-builtin' | 'deepl'>;

export interface ModelInfo {
  id: TranslationProviderId;
  name: string;
  tag: string;
  description: string;
  size: string;
  isCloud?: boolean;
  costEstimate?: string;
}

export interface ProviderSelectorOption {
  id: Extract<TranslationProviderId, 'opus-mt' | 'translategemma'>;
  name: string;
  tag: string;
  desc: string;
}

export interface SiteRuleProviderOption {
  id: TranslationProviderId | '';
  name: string;
}

export interface OnboardingModelOption {
  id: TranslationProviderId;
  name: string;
  desc: string;
  size: string;
  speed: string;
  quality: string;
  recommended: boolean;
}

export interface CloudProviderFullConfig extends CloudProviderConfig {
  enabledField: string;
  testEndpoint?: string;
  models?: string[];
  modelField?: string;
}

export interface BackgroundProviderInfo {
  id: BackgroundProviderId;
  name: string;
  type: 'local';
  qualityTier: QualityTier;
  description: string;
  icon: string;
}

interface ProviderDefinition {
  type: 'local' | 'cloud';
  statusName: string;
  siteRuleName: string;
  qualityTier: QualityTier;
  backgroundDescription: string;
  modelSelector: ModelInfo;
  providerSelector?: ProviderSelectorOption;
  onboarding?: OnboardingModelOption;
}

const PROVIDER_DEFINITIONS: Record<TranslationProviderId, ProviderDefinition> = {
  'opus-mt': {
    type: 'local',
    statusName: 'Helsinki-NLP OPUS-MT',
    siteRuleName: 'OPUS-MT (Local)',
    qualityTier: 'standard',
    backgroundDescription: 'Fast, lightweight (~170MB per pair)',
    modelSelector: {
      id: 'opus-mt',
      name: 'OPUS-MT',
      tag: 'Fast',
      description: 'Helsinki-NLP',
      size: '~170MB',
    },
    providerSelector: {
      id: 'opus-mt',
      name: 'OPUS-MT',
      tag: 'Fast',
      desc: '~170MB per pair',
    },
    onboarding: {
      id: 'opus-mt',
      name: 'OPUS-MT',
      desc: 'Fast local translation',
      size: '~170MB per language pair',
      speed: 'Fast',
      quality: 'Good',
      recommended: true,
    },
  },
  translategemma: {
    type: 'local',
    statusName: 'TranslateGemma 4B',
    siteRuleName: 'TranslateGemma (Local)',
    qualityTier: 'premium',
    backgroundDescription: 'High quality, single model (~3.6GB)',
    modelSelector: {
      id: 'translategemma',
      name: 'TranslateGemma',
      tag: 'Quality',
      description: 'Google 4B',
      size: '~3.6GB',
    },
    providerSelector: {
      id: 'translategemma',
      name: 'TranslateGemma',
      tag: 'Quality',
      desc: '~3.6GB one model',
    },
  },
  'chrome-builtin': {
    type: 'local',
    statusName: 'Chrome Built-in',
    siteRuleName: 'Chrome Built-in',
    qualityTier: 'standard',
    backgroundDescription: 'Native browser translation (Chrome 138+)',
    modelSelector: {
      id: 'chrome-builtin',
      name: 'Chrome Built-in',
      tag: 'Native',
      description: 'Chrome 138+',
      size: 'Built-in',
    },
    onboarding: {
      id: 'chrome-builtin',
      name: 'Chrome Built-in',
      desc: "Uses Chrome's translation API",
      size: 'No download',
      speed: 'Instant',
      quality: 'Good',
      recommended: false,
    },
  },
  deepl: {
    type: 'cloud',
    statusName: 'DeepL',
    siteRuleName: 'DeepL',
    qualityTier: 'premium',
    backgroundDescription: 'Premium cloud translation quality',
    modelSelector: {
      id: 'deepl',
      name: 'DeepL',
      tag: 'Premium',
      description: 'Best quality',
      size: 'API',
      isCloud: true,
      costEstimate: '~$20/1M chars',
    },
    onboarding: {
      id: 'deepl',
      name: 'DeepL API',
      desc: 'Highest quality (requires API key)',
      size: 'Cloud-based',
      speed: 'Fast',
      quality: 'Excellent',
      recommended: false,
    },
  },
  openai: {
    type: 'cloud',
    statusName: 'OpenAI',
    siteRuleName: 'OpenAI',
    qualityTier: 'premium',
    backgroundDescription: 'LLM-powered cloud translation',
    modelSelector: {
      id: 'openai',
      name: 'OpenAI',
      tag: 'OpenAI',
      description: 'AI translation',
      size: 'API',
      isCloud: true,
      costEstimate: '~$5/1M tokens',
    },
  },
  anthropic: {
    type: 'cloud',
    statusName: 'Claude',
    siteRuleName: 'Claude',
    qualityTier: 'premium',
    backgroundDescription: 'Claude-powered cloud translation',
    modelSelector: {
      id: 'anthropic',
      name: 'Claude',
      tag: 'AI',
      description: 'Anthropic',
      size: 'API',
      isCloud: true,
      costEstimate: '~$3/1M tokens',
    },
  },
  'google-cloud': {
    type: 'cloud',
    statusName: 'Google Cloud',
    siteRuleName: 'Google Cloud',
    qualityTier: 'standard',
    backgroundDescription: 'Google Cloud Translation API',
    modelSelector: {
      id: 'google-cloud',
      name: 'Google',
      tag: 'Cloud',
      description: 'Google Cloud',
      size: 'API',
      isCloud: true,
      costEstimate: '~$20/1M chars',
    },
  },
};

const MODEL_SELECTOR_ORDER: TranslationProviderId[] = [
  'opus-mt',
  'translategemma',
  'chrome-builtin',
  'deepl',
  'openai',
  'anthropic',
  'google-cloud',
];

const LOCAL_MODEL_IDS: LocalProviderId[] = ['opus-mt', 'translategemma', 'chrome-builtin'];
const PROVIDER_SELECTOR_IDS: ProviderSelectorOption['id'][] = ['opus-mt', 'translategemma'];
const SITE_RULE_PROVIDER_IDS: TranslationProviderId[] = [
  'opus-mt',
  'translategemma',
  'chrome-builtin',
  'deepl',
  'openai',
  'google-cloud',
  'anthropic',
];
const ONBOARDING_MODEL_IDS: OnboardingProviderId[] = ['opus-mt', 'chrome-builtin', 'deepl'];
const BACKGROUND_PROVIDER_IDS: BackgroundProviderId[] = ['opus-mt', 'translategemma'];

interface CloudProviderOptionMetadata {
  enabledField: string;
  testEndpoint?: string;
  models?: string[];
  modelField?: string;
}

const CLOUD_PROVIDER_OPTION_METADATA: Record<CloudProviderId, CloudProviderOptionMetadata> = {
  deepl: {
    enabledField: 'deepl_enabled',
    testEndpoint: 'https://api-free.deepl.com/v2/usage',
  },
  openai: {
    enabledField: 'openai_enabled',
    modelField: 'openai_model',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  'google-cloud': {
    enabledField: 'google_cloud_enabled',
  },
  anthropic: {
    enabledField: 'anthropic_enabled',
    modelField: 'anthropic_model',
    models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-latest'],
  },
};

export const MODEL_SELECTOR_LOCAL_MODELS: ModelInfo[] = LOCAL_MODEL_IDS.map(
  (id) => PROVIDER_DEFINITIONS[id].modelSelector
);

export const MODEL_SELECTOR_CLOUD_PROVIDERS: ModelInfo[] = MODEL_SELECTOR_ORDER
  .filter((id) => PROVIDER_DEFINITIONS[id].type === 'cloud')
  .map((id) => PROVIDER_DEFINITIONS[id].modelSelector);

export const MODEL_SELECTOR_MODELS: ModelInfo[] = MODEL_SELECTOR_ORDER.map(
  (id) => PROVIDER_DEFINITIONS[id].modelSelector
);

export const PROVIDER_SELECTOR_OPTIONS: ProviderSelectorOption[] = PROVIDER_SELECTOR_IDS.map(
  (id) => PROVIDER_DEFINITIONS[id].providerSelector!
);

export const SITE_RULE_PROVIDER_OPTIONS: SiteRuleProviderOption[] = [
  { id: '', name: 'Use default' },
  ...SITE_RULE_PROVIDER_IDS.map((id) => ({
    id,
    name: PROVIDER_DEFINITIONS[id].siteRuleName,
  })),
];

export const ONBOARDING_MODELS: OnboardingModelOption[] = ONBOARDING_MODEL_IDS.map(
  (id) => PROVIDER_DEFINITIONS[id].onboarding!
);

export const OPTIONS_CLOUD_PROVIDERS: CloudProviderFullConfig[] = CLOUD_PROVIDER_CONFIGS.map(
  (config) => ({
    ...config,
    ...CLOUD_PROVIDER_OPTION_METADATA[config.id],
  })
);

export const PROVIDER_STATUS_NAMES = Object.freeze(
  Object.fromEntries(
    MODEL_SELECTOR_ORDER.map((id) => [id, PROVIDER_DEFINITIONS[id].statusName] as const)
  )
) as Record<TranslationProviderId, string>;

export const BACKGROUND_PROVIDER_LIST: BackgroundProviderInfo[] = BACKGROUND_PROVIDER_IDS.map(
  (id) => ({
    id,
    name: PROVIDER_DEFINITIONS[id].statusName,
    type: 'local',
    qualityTier: PROVIDER_DEFINITIONS[id].qualityTier,
    description: PROVIDER_DEFINITIONS[id].backgroundDescription,
    icon: '',
  })
);
