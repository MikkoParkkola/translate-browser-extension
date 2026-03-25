import type { CloudProviderId } from '../types';
import { deeplProvider } from '../providers/deepl';
import { openaiProvider } from '../providers/openai';
import { anthropicProvider } from '../providers/anthropic';
import { googleCloudProvider } from '../providers/google-cloud';

interface OffscreenCloudProviderRuntimeUsage {
  tokens: number;
  cost: number;
  limitReached: boolean;
}

interface OffscreenCloudProviderRuntime {
  initialize(): Promise<void>;
  isAvailable(): Promise<boolean>;
  translate(
    text: string | string[],
    sourceLang: string,
    targetLang: string
  ): Promise<string | string[]>;
  getUsage(): Promise<OffscreenCloudProviderRuntimeUsage>;
  unavailableMessage: string;
}

const EMPTY_CLOUD_PROVIDER_USAGE = Object.freeze({
  tokens: 0,
  cost: 0,
  limitReached: false,
}) satisfies OffscreenCloudProviderRuntimeUsage;

const OFFSCREEN_CLOUD_PROVIDER_RUNTIMES = {
  deepl: {
    initialize: () => deeplProvider.initialize(),
    isAvailable: () => deeplProvider.isAvailable(),
    translate: (text, sourceLang, targetLang) => deeplProvider.translate(text, sourceLang, targetLang),
    getUsage: () => deeplProvider.getUsage(),
    unavailableMessage: 'DeepL API key not configured. Please configure in Settings.',
  },
  openai: {
    initialize: () => openaiProvider.initialize(),
    isAvailable: () => openaiProvider.isAvailable(),
    translate: (text, sourceLang, targetLang) => openaiProvider.translate(text, sourceLang, targetLang),
    getUsage: () => openaiProvider.getUsage(),
    unavailableMessage: 'OpenAI API key not configured. Please configure in Settings.',
  },
  anthropic: {
    initialize: () => anthropicProvider.initialize(),
    isAvailable: () => anthropicProvider.isAvailable(),
    translate: (text, sourceLang, targetLang) => anthropicProvider.translate(text, sourceLang, targetLang),
    getUsage: () => anthropicProvider.getUsage(),
    unavailableMessage: 'Anthropic API key not configured. Please configure in Settings.',
  },
  'google-cloud': {
    initialize: () => googleCloudProvider.initialize(),
    isAvailable: () => googleCloudProvider.isAvailable(),
    translate: (text, sourceLang, targetLang) => googleCloudProvider.translate(text, sourceLang, targetLang),
    getUsage: () => googleCloudProvider.getUsage(),
    unavailableMessage: 'Google Cloud API key not configured. Please configure in Settings.',
  },
} as const satisfies Record<CloudProviderId, OffscreenCloudProviderRuntime>;

export function getOffscreenCloudProviderRuntime(
  provider: string
): OffscreenCloudProviderRuntime | undefined {
  return (OFFSCREEN_CLOUD_PROVIDER_RUNTIMES as Record<string, OffscreenCloudProviderRuntime | undefined>)[provider];
}

export function isOffscreenCloudProviderRuntimeId(provider: string): provider is CloudProviderId {
  return getOffscreenCloudProviderRuntime(provider) !== undefined;
}

export async function translateWithOffscreenCloudProvider(
  provider: CloudProviderId,
  text: string | string[],
  sourceLang: string,
  targetLang: string
): Promise<string | string[]> {
  const runtime = OFFSCREEN_CLOUD_PROVIDER_RUNTIMES[provider];
  await runtime.initialize();
  if (!(await runtime.isAvailable())) {
    throw new Error(runtime.unavailableMessage);
  }
  return runtime.translate(text, sourceLang, targetLang);
}

export async function getOffscreenCloudProviderUsage(
  provider: string
): Promise<OffscreenCloudProviderRuntimeUsage> {
  const runtime = getOffscreenCloudProviderRuntime(provider);
  if (!runtime) {
    return { ...EMPTY_CLOUD_PROVIDER_USAGE };
  }

  await runtime.initialize();
  return runtime.getUsage();
}
