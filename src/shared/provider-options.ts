/**
 * Canonical shipped provider/runtime metadata used across popup, options,
 * onboarding, background helpers, and tests.
 */

import type { CloudProviderId, QualityTier, TranslationProviderId } from '../types';
import {
  CLOUD_PROVIDER_CONFIGS,
  type CloudProviderConfig,
} from './cloud-provider-configs';
export {
  ANTHROPIC_FORMALITY_VALUES,
  ANTHROPIC_MODEL_VALUES,
  DEEPL_FORMALITY_VALUES,
  OPENAI_FORMALITY_VALUES,
  OPENAI_MODEL_VALUES,
} from './cloud-provider-configs';

export type LocalProviderId = Extract<TranslationProviderId, 'opus-mt' | 'translategemma' | 'chrome-builtin'>;
type DownloadableProviderId = Extract<TranslationProviderId, 'opus-mt' | 'translategemma'>;
type BackgroundProviderId = Extract<TranslationProviderId, 'opus-mt' | 'translategemma'>;
type OnboardingProviderId = Extract<TranslationProviderId, 'opus-mt' | 'chrome-builtin' | 'deepl'>;

export type ProviderRuntimeKind = 'wasm' | 'webgpu' | 'native-browser' | 'cloud-api';
export type ProviderDeliveryKind = 'downloaded-model' | 'browser-managed' | 'cloud-api';
export type ProviderStability = 'stable' | 'experimental';
export type ProviderUiBadge = 'recommended' | 'preferred-native' | 'api-key' | 'experimental';
export type ProviderRuntimeRequirement = 'webgpu-or-webnn' | 'chrome-138';

export const DEFAULT_PROVIDER_ID: LocalProviderId = 'opus-mt';

export interface ModelInfo {
  id: TranslationProviderId;
  name: string;
  tag: string;
  description: string;
  size: string;
  isCloud?: boolean;
  costEstimate?: string;
  runtimeKind?: ProviderRuntimeKind;
  deliveryKind?: ProviderDeliveryKind;
  stability?: ProviderStability;
  availabilityNote?: string;
  requiresDownload?: boolean;
  preferredWhenAvailable?: boolean;
  badges?: readonly ProviderUiBadge[];
  runtimeRequirement?: ProviderRuntimeRequirement;
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
  availabilityNote?: string;
  stability?: ProviderStability;
  badges?: readonly ProviderUiBadge[];
  runtimeRequirement?: ProviderRuntimeRequirement;
}

export interface BackgroundProviderInfo {
  id: BackgroundProviderId;
  name: string;
  type: 'local';
  qualityTier: QualityTier;
  description: string;
  icon: string;
  runtimeKind: ProviderRuntimeKind;
  stability: ProviderStability;
}

export interface ProviderDefinition {
  type: 'local' | 'cloud';
  runtimeKind: ProviderRuntimeKind;
  deliveryKind: ProviderDeliveryKind;
  stability: ProviderStability;
  requiresDownload: boolean;
  preferredWhenAvailable?: boolean;
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
    runtimeKind: 'wasm',
    deliveryKind: 'downloaded-model',
    stability: 'stable',
    requiresDownload: true,
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
      runtimeKind: 'wasm',
      deliveryKind: 'downloaded-model',
      stability: 'stable',
      availabilityNote: 'Downloads one model per language pair on first use.',
      requiresDownload: true,
      badges: ['recommended'],
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
      availabilityNote: 'Downloads one model per language pair the first time you use it.',
      stability: 'stable',
      badges: ['recommended'],
    },
  },
  translategemma: {
    type: 'local',
    runtimeKind: 'webgpu',
    deliveryKind: 'downloaded-model',
    stability: 'experimental',
    requiresDownload: true,
    statusName: 'TranslateGemma 4B',
    siteRuleName: 'TranslateGemma (Local)',
    qualityTier: 'premium',
    backgroundDescription: 'Experimental quality path (~3.6GB, WebGPU/WebNN)',
    modelSelector: {
      id: 'translategemma',
      name: 'TranslateGemma',
      tag: 'Quality',
      description: 'Experimental Google 4B',
      size: '~3.6GB',
      runtimeKind: 'webgpu',
      deliveryKind: 'downloaded-model',
      stability: 'experimental',
      availabilityNote: 'Experimental. Requires WebGPU or WebNN acceleration.',
      requiresDownload: true,
      badges: ['experimental'],
      runtimeRequirement: 'webgpu-or-webnn',
    },
    providerSelector: {
      id: 'translategemma',
      name: 'TranslateGemma',
      tag: 'Quality',
      desc: 'Experimental · ~3.6GB · WebGPU/WebNN',
    },
  },
  'chrome-builtin': {
    type: 'local',
    runtimeKind: 'native-browser',
    deliveryKind: 'browser-managed',
    stability: 'stable',
    requiresDownload: false,
    preferredWhenAvailable: true,
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
      runtimeKind: 'native-browser',
      deliveryKind: 'browser-managed',
      stability: 'stable',
      availabilityNote: 'Preferred when available. Managed by Chrome, not by the extension.',
      requiresDownload: false,
      preferredWhenAvailable: true,
      badges: ['preferred-native'],
      runtimeRequirement: 'chrome-138',
    },
    onboarding: {
      id: 'chrome-builtin',
      name: 'Chrome Built-in',
      desc: 'Uses Chrome native translation when available',
      size: 'No download',
      speed: 'Instant',
      quality: 'Good',
      availabilityNote: 'Chrome 138+ only. Managed by Chrome rather than the extension.',
      stability: 'stable',
      badges: ['preferred-native'],
      runtimeRequirement: 'chrome-138',
    },
  },
  deepl: {
    type: 'cloud',
    runtimeKind: 'cloud-api',
    deliveryKind: 'cloud-api',
    stability: 'stable',
    requiresDownload: false,
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
      runtimeKind: 'cloud-api',
      deliveryKind: 'cloud-api',
      stability: 'stable',
      availabilityNote: 'Requires an API key and an internet connection.',
      requiresDownload: false,
    },
    onboarding: {
      id: 'deepl',
      name: 'DeepL API',
      desc: 'Highest quality (requires API key)',
      size: 'Cloud-based',
      speed: 'Fast',
      quality: 'Excellent',
      availabilityNote: 'Requires a DeepL API key and an internet connection.',
      stability: 'stable',
      badges: ['api-key'],
    },
  },
  openai: {
    type: 'cloud',
    runtimeKind: 'cloud-api',
    deliveryKind: 'cloud-api',
    stability: 'stable',
    requiresDownload: false,
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
      runtimeKind: 'cloud-api',
      deliveryKind: 'cloud-api',
      stability: 'stable',
      availabilityNote: 'Requires an API key and an internet connection.',
      requiresDownload: false,
    },
  },
  anthropic: {
    type: 'cloud',
    runtimeKind: 'cloud-api',
    deliveryKind: 'cloud-api',
    stability: 'stable',
    requiresDownload: false,
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
      runtimeKind: 'cloud-api',
      deliveryKind: 'cloud-api',
      stability: 'stable',
      availabilityNote: 'Requires an API key and an internet connection.',
      requiresDownload: false,
    },
  },
  'google-cloud': {
    type: 'cloud',
    runtimeKind: 'cloud-api',
    deliveryKind: 'cloud-api',
    stability: 'stable',
    requiresDownload: false,
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
      runtimeKind: 'cloud-api',
      deliveryKind: 'cloud-api',
      stability: 'stable',
      availabilityNote: 'Requires an API key and an internet connection.',
      requiresDownload: false,
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

export const TRANSLATION_PROVIDER_IDS: TranslationProviderId[] = [...MODEL_SELECTOR_ORDER];
export const CLOUD_PROVIDER_IDS: CloudProviderId[] = MODEL_SELECTOR_ORDER.filter(
  (id): id is CloudProviderId => PROVIDER_DEFINITIONS[id].type === 'cloud'
);

const OFFLINE_PROVIDER_IDS: LocalProviderId[] = MODEL_SELECTOR_ORDER.filter(
  (id): id is LocalProviderId => PROVIDER_DEFINITIONS[id].type === 'local'
);
const DOWNLOADABLE_PROVIDER_IDS: DownloadableProviderId[] = OFFLINE_PROVIDER_IDS.filter(
  (id): id is DownloadableProviderId => PROVIDER_DEFINITIONS[id].requiresDownload
);
const PROVIDER_SELECTOR_IDS: ProviderSelectorOption['id'][] = OFFLINE_PROVIDER_IDS.filter(
  (id): id is ProviderSelectorOption['id'] => PROVIDER_DEFINITIONS[id].providerSelector !== undefined
);
const ONBOARDING_MODEL_IDS: OnboardingProviderId[] = MODEL_SELECTOR_ORDER.filter(
  (id): id is OnboardingProviderId => PROVIDER_DEFINITIONS[id].onboarding !== undefined
);
const BACKGROUND_PROVIDER_IDS: BackgroundProviderId[] = [...PROVIDER_SELECTOR_IDS];

const TRANSLATION_PROVIDER_ID_SET = new Set<string>(TRANSLATION_PROVIDER_IDS);
const CLOUD_PROVIDER_ID_SET = new Set<string>(CLOUD_PROVIDER_IDS);

const CLOUD_PROVIDER_MODEL_ALIASES: Readonly<Record<CloudProviderId, Readonly<Record<string, string>>>> = {
  deepl: {},
  openai: {
    'gpt-4': 'gpt-4-turbo',
  },
  'google-cloud': {},
  anthropic: {
    'claude-3-5-haiku-latest': 'claude-3-5-haiku-20241022',
    'claude-3-5-sonnet': 'claude-3-5-sonnet-20241022',
    'claude-3-haiku-20240307': 'claude-3-5-haiku-20241022',
  },
};

const CLOUD_PROVIDER_FORMALITY_ALIASES: Readonly<Record<CloudProviderId, Readonly<Record<string, string>>>> = {
  deepl: {
    formal: 'more',
    informal: 'less',
  },
  openai: {
    default: 'neutral',
  },
  'google-cloud': {},
  anthropic: {
    default: 'neutral',
  },
};

const PROVIDER_RUNTIME_LABELS: Record<ProviderRuntimeKind, string> = {
  wasm: 'WebAssembly runtime',
  webgpu: 'WebGPU/WebNN runtime',
  'native-browser': 'Browser-native runtime',
  'cloud-api': 'Cloud API runtime',
};

const PROVIDER_DELIVERY_LABELS: Record<ProviderDeliveryKind, string> = {
  'downloaded-model': 'Extension-managed download',
  'browser-managed': 'Browser-managed delivery',
  'cloud-api': 'Network API delivery',
};

const PROVIDER_STABILITY_LABELS: Record<ProviderStability, string> = {
  stable: 'Stable',
  experimental: 'Experimental',
};

const PROVIDER_UI_BADGE_LABELS: Record<ProviderUiBadge, string> = {
  recommended: 'Recommended',
  'preferred-native': 'Preferred native',
  'api-key': 'API key',
  experimental: 'Experimental',
};

const PROVIDER_RUNTIME_REQUIREMENT_LABELS: Record<ProviderRuntimeRequirement, string> = {
  'webgpu-or-webnn': 'Requires WebGPU or WebNN',
  'chrome-138': 'Chrome 138+ required',
};

function normalizeAliasedCloudProviderValue(
  providerId: CloudProviderId,
  value: unknown,
  aliases: Readonly<Record<CloudProviderId, Readonly<Record<string, string>>>>
): string | undefined {
  const rawValue = typeof value === 'string' && value.length > 0 ? value : undefined;
  if (!rawValue) {
    return undefined;
  }

  return aliases[providerId][rawValue] ?? rawValue;
}

export function normalizeCloudProviderModelValue(
  providerId: CloudProviderId,
  value: unknown
): string | undefined {
  return normalizeAliasedCloudProviderValue(providerId, value, CLOUD_PROVIDER_MODEL_ALIASES);
}

export function normalizeCloudProviderFormalityValue(
  providerId: CloudProviderId,
  value: unknown
): string | undefined {
  return normalizeAliasedCloudProviderValue(providerId, value, CLOUD_PROVIDER_FORMALITY_ALIASES);
}

export function getProviderModelInfo(providerId: TranslationProviderId): Readonly<ModelInfo> {
  return PROVIDER_DEFINITIONS[providerId].modelSelector;
}

export function getProviderRuntimeLabel(runtimeKind: ProviderRuntimeKind): string {
  return PROVIDER_RUNTIME_LABELS[runtimeKind];
}

export function getProviderDeliveryLabel(deliveryKind: ProviderDeliveryKind): string {
  return PROVIDER_DELIVERY_LABELS[deliveryKind];
}

export function getProviderStabilityLabel(stability: ProviderStability): string {
  return PROVIDER_STABILITY_LABELS[stability];
}

export function getProviderUiBadgeLabel(badge: ProviderUiBadge): string {
  return PROVIDER_UI_BADGE_LABELS[badge];
}

export function getProviderRuntimeRequirementLabel(
  requirement: ProviderRuntimeRequirement
): string {
  return PROVIDER_RUNTIME_REQUIREMENT_LABELS[requirement];
}

export function getPreferredLocalProvider(options: { browserNativeAvailable?: boolean } = {}): LocalProviderId {
  return options.browserNativeAvailable ? 'chrome-builtin' : DEFAULT_PROVIDER_ID;
}

export function resolveProviderFromModelId(
  modelId: string | null | undefined
): TranslationProviderId | null {
  if (!modelId) {
    return null;
  }

  if (isTranslationProviderId(modelId)) {
    return modelId;
  }

  const normalized = modelId.toLowerCase();
  if (normalized.includes('opus-mt')) {
    return 'opus-mt';
  }
  if (normalized.includes('gemma')) {
    return 'translategemma';
  }
  if (normalized.includes('chrome') && normalized.includes('builtin')) {
    return 'chrome-builtin';
  }

  return null;
}

export const MODEL_SELECTOR_OFFLINE_MODELS: ModelInfo[] = OFFLINE_PROVIDER_IDS.map(
  (id) => PROVIDER_DEFINITIONS[id].modelSelector
);
export const MODEL_SELECTOR_LOCAL_MODELS: ModelInfo[] = MODEL_SELECTOR_OFFLINE_MODELS;
export const MODEL_SELECTOR_DOWNLOADABLE_MODELS: ModelInfo[] = DOWNLOADABLE_PROVIDER_IDS.map(
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
  ...TRANSLATION_PROVIDER_IDS.map((id) => ({
    id,
    name: PROVIDER_DEFINITIONS[id].siteRuleName,
  })),
];

export const ONBOARDING_MODELS: OnboardingModelOption[] = ONBOARDING_MODEL_IDS.map(
  (id) => PROVIDER_DEFINITIONS[id].onboarding!
);

export const OPTIONS_CLOUD_PROVIDERS: CloudProviderConfig[] = CLOUD_PROVIDER_CONFIGS;

export const PROVIDER_STATUS_NAMES = Object.freeze(
  Object.fromEntries(
    MODEL_SELECTOR_ORDER.map((id) => [id, PROVIDER_DEFINITIONS[id].statusName] as const)
  )
) as Record<TranslationProviderId, string>;

export function isTranslationProviderId(value: unknown): value is TranslationProviderId {
  return typeof value === 'string' && TRANSLATION_PROVIDER_ID_SET.has(value);
}

export function normalizeTranslationProviderId(
  value: unknown,
  fallback: TranslationProviderId = DEFAULT_PROVIDER_ID
): TranslationProviderId {
  // Legacy compatibility: older router/site-rule data persisted the internal
  // OPUS implementation id instead of the canonical provider contract id.
  if (value === 'opus-mt-local') {
    return 'opus-mt';
  }
  return isTranslationProviderId(value) ? value : fallback;
}

export function isCloudProviderId(value: unknown): value is CloudProviderId {
  return typeof value === 'string' && CLOUD_PROVIDER_ID_SET.has(value);
}

export function isDownloadableProviderId(value: unknown): value is DownloadableProviderId {
  return typeof value === 'string' && DOWNLOADABLE_PROVIDER_IDS.includes(value as DownloadableProviderId);
}

export function isExperimentalProviderId(value: unknown): boolean {
  return isTranslationProviderId(value) && PROVIDER_DEFINITIONS[value].stability === 'experimental';
}

export function isBrowserManagedProviderId(value: unknown): boolean {
  return isTranslationProviderId(value)
    && PROVIDER_DEFINITIONS[value].deliveryKind === 'browser-managed';
}

export function getProviderDefinition(providerId: TranslationProviderId): Readonly<ProviderDefinition> {
  return PROVIDER_DEFINITIONS[providerId];
}

export const BACKGROUND_PROVIDER_LIST: BackgroundProviderInfo[] = BACKGROUND_PROVIDER_IDS.map(
  (id) => ({
    id,
    name: PROVIDER_DEFINITIONS[id].statusName,
    type: 'local',
    qualityTier: PROVIDER_DEFINITIONS[id].qualityTier,
    description: PROVIDER_DEFINITIONS[id].backgroundDescription,
    icon: '',
    runtimeKind: PROVIDER_DEFINITIONS[id].runtimeKind,
    stability: PROVIDER_DEFINITIONS[id].stability,
  })
);
