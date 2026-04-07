import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_ID,
  ANTHROPIC_MODEL_VALUES,
  CLOUD_PROVIDER_IDS,
  MODEL_SELECTOR_DOWNLOADABLE_MODELS,
  TRANSLATION_PROVIDER_IDS,
  canonicalizeLegacyTranslationProviderId,
  LEGACY_OPUS_PROVIDER_ID,
  getProviderDefinition,
  getProviderModelInfo,
  getProviderRuntimeRequirementLabel,
  getProviderUiBadgeLabel,
  getPreferredLocalProvider,
  isBrowserManagedProviderId,
  isCloudProviderId,
  isDownloadableProviderId,
  isExperimentalProviderId,
  resolveProviderFromModelId,
  isTranslationProviderId,
  normalizeCloudProviderFormalityValue,
  normalizeCloudProviderModelValue,
  normalizeTranslationProviderId,
} from './provider-options';

function readReadme(): string {
  return readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
}

function readProviderDocs(): string {
  return readFileSync(resolve(process.cwd(), 'docs/PROVIDERS.md'), 'utf8');
}

function providerDocsLabel(providerId: (typeof TRANSLATION_PROVIDER_IDS)[number]): string {
  switch (providerId) {
    case 'chrome-builtin':
      return 'Chrome Built-in';
    case 'opus-mt':
      return 'OPUS-MT';
    case 'translategemma':
      return 'TranslateGemma';
    case 'deepl':
      return 'DeepL';
    case 'openai':
      return 'OpenAI';
    case 'anthropic':
      return 'Anthropic';
    case 'google-cloud':
      return 'Google Cloud';
  }

  const exhaustiveCheck: never = providerId;
  throw new Error(`Unhandled provider docs label: ${exhaustiveCheck}`);
}

describe('provider-options guards', () => {
  it('lists all translation provider ids', () => {
    expect(TRANSLATION_PROVIDER_IDS).toHaveLength(7);
    expect(TRANSLATION_PROVIDER_IDS).toContain('opus-mt');
    expect(TRANSLATION_PROVIDER_IDS).toContain('deepl');
  });

  it('documents the shipped provider surface without overstating language coverage', () => {
    const readme = readReadme();

    expect(readme).toContain(
      `**${TRANSLATION_PROVIDER_IDS.length} shipping translation providers**`,
    );
    expect(readme).toContain(
      '**Source language auto-detection** -- browser-native detectors first, with offline trigram/script fallback when needed.',
    );
    expect(readme).not.toContain('**100+ languages**');
  });

  it('avoids pinning exact test-count claims in the readme', () => {
    const readme = readReadme();

    expect(readme).not.toMatch(
      /!\[Tests]\(https:\/\/img\.shields\.io\/badge\/tests-[0-9][0-9%2C]*%20passed-brightgreen\)/,
    );
    expect(readme).not.toMatch(/npm test\s+# Run [0-9][0-9,]* unit tests/);
    expect(readme).not.toMatch(/\| Contract tests\s+\|\s+[0-9][0-9,]* \(/);
  });

  it('documents only the shipped cloud and local providers in the readme', () => {
    const readme = readReadme();

    expect(readme).toContain('Chrome Built-in, OPUS-MT, and TranslateGemma');
    expect(readme).toContain('OpenAI');
    expect(readme).toContain('Claude (Anthropic)');
    expect(readme).toContain('DeepL');
    expect(readme).toContain('Google Cloud');
    expect(readme).not.toContain('Add Local Provider');
    expect(readme).not.toContain('DashScope (Qwen)');
    expect(readme).not.toContain('Gemini');
    expect(readme).not.toContain('Mistral');
    expect(readme).not.toContain('OpenRouter');
    expect(readme).not.toContain('Ollama');
    expect(readme).not.toContain('macOS translator');
  });

  it('documents provider shipping stability in docs/PROVIDERS.md', () => {
    const providerDocs = readProviderDocs();
    const stableProviders = TRANSLATION_PROVIDER_IDS.filter(
      (providerId) => !isExperimentalProviderId(providerId),
    );
    const experimentalProviders = TRANSLATION_PROVIDER_IDS.filter((providerId) =>
      isExperimentalProviderId(providerId),
    );

    expect(providerDocs).toContain('## Shipping status and stability');
    expect(providerDocs).toContain('### Stable shipped providers');
    expect(providerDocs).toContain('### Experimental shipped providers');
    expect(providerDocs).not.toContain(
      '**DeepL / OpenAI / Anthropic / Google Cloud**',
    );

    for (const providerId of stableProviders) {
      expect(providerDocs).toContain(`- **${providerDocsLabel(providerId)}**`);
    }
    for (const providerId of experimentalProviders) {
      expect(providerDocs).toContain(`- **${providerDocsLabel(providerId)}**`);
    }
  });

  it('lists all cloud provider ids', () => {
    expect(CLOUD_PROVIDER_IDS).toHaveLength(4);
    expect(CLOUD_PROVIDER_IDS).toContain('openai');
    expect(CLOUD_PROVIDER_IDS).not.toContain('chrome-builtin');
  });

  it('accepts valid translation provider ids', () => {
    expect(isTranslationProviderId('chrome-builtin')).toBe(true);
    expect(isTranslationProviderId('anthropic')).toBe(true);
  });

  it('rejects invalid translation provider ids', () => {
    expect(isTranslationProviderId('invalid-provider')).toBe(false);
    expect(isTranslationProviderId(42)).toBe(false);
  });

  it('normalizes invalid provider ids to the fallback', () => {
    expect(normalizeTranslationProviderId('invalid-provider')).toBe('opus-mt');
    expect(normalizeTranslationProviderId('invalid-provider', 'deepl')).toBe(
      'deepl',
    );
  });

  it('exports the canonical default provider id', () => {
    expect(DEFAULT_PROVIDER_ID).toBe('opus-mt');
  });

  it('normalizes the legacy opus provider alias', () => {
    expect(normalizeTranslationProviderId('opus-mt-local')).toBe('opus-mt');
  });

  it('canonicalizes only the legacy provider alias without forcing validation', () => {
    expect(
      canonicalizeLegacyTranslationProviderId(LEGACY_OPUS_PROVIDER_ID),
    ).toBe('opus-mt');
    expect(canonicalizeLegacyTranslationProviderId('deepl')).toBe('deepl');
    expect(canonicalizeLegacyTranslationProviderId('invalid-provider')).toBe(
      'invalid-provider',
    );
  });

  it('accepts cloud provider ids only for cloud guard', () => {
    expect(isCloudProviderId('deepl')).toBe(true);
    expect(isCloudProviderId('chrome-builtin')).toBe(false);
  });

  it('identifies downloadable local providers', () => {
    expect(isDownloadableProviderId('opus-mt')).toBe(true);
    expect(isDownloadableProviderId('translategemma')).toBe(true);
    expect(isDownloadableProviderId('chrome-builtin')).toBe(false);
  });

  it('identifies browser-managed providers', () => {
    expect(isBrowserManagedProviderId('chrome-builtin')).toBe(true);
    expect(isBrowserManagedProviderId('opus-mt')).toBe(false);
  });

  it('identifies experimental providers', () => {
    expect(isExperimentalProviderId('translategemma')).toBe(true);
    expect(isExperimentalProviderId('opus-mt')).toBe(false);
  });

  it('exports downloadable models separately from browser-managed ones', () => {
    expect(MODEL_SELECTOR_DOWNLOADABLE_MODELS.map((model) => model.id)).toEqual(
      ['opus-mt', 'translategemma'],
    );
  });

  it('stores canonical runtime metadata for chrome-builtin', () => {
    const chromeBuiltin = getProviderDefinition('chrome-builtin');
    expect(chromeBuiltin.runtimeKind).toBe('native-browser');
    expect(chromeBuiltin.deliveryKind).toBe('browser-managed');
    expect(chromeBuiltin.preferredWhenAvailable).toBe(true);
  });

  it('stores canonical recommendation badges for onboarding models', () => {
    const opus = getProviderDefinition('opus-mt').onboarding;
    const chromeBuiltin = getProviderDefinition('chrome-builtin').onboarding;
    const deepl = getProviderDefinition('deepl').onboarding;

    expect(opus?.badges).toEqual(['recommended']);
    expect(chromeBuiltin?.badges).toEqual(['preferred-native']);
    expect(deepl?.badges).toEqual(['api-key']);
    expect(getProviderUiBadgeLabel('recommended')).toBe('Recommended');
    expect(getProviderUiBadgeLabel('preferred-native')).toBe(
      'Preferred native',
    );
    expect(getProviderUiBadgeLabel('api-key')).toBe('API key');
  });

  it('stores canonical runtime requirements for gated local providers', () => {
    const translateGemma = getProviderModelInfo('translategemma');
    const chromeBuiltin = getProviderModelInfo('chrome-builtin');

    expect(translateGemma.runtimeRequirement).toBe('webgpu-or-webnn');
    expect(chromeBuiltin.runtimeRequirement).toBe('chrome-138');
    expect(getProviderRuntimeRequirementLabel('webgpu-or-webnn')).toBe(
      'Requires WebGPU or WebNN',
    );
    expect(getProviderRuntimeRequirementLabel('chrome-138')).toBe(
      'Chrome 138+ required',
    );
  });

  it('normalizes legacy cloud provider model aliases', () => {
    expect(normalizeCloudProviderModelValue('openai', 'gpt-4')).toBe(
      'gpt-4-turbo',
    );
    expect(
      normalizeCloudProviderModelValue('anthropic', 'claude-3-5-sonnet'),
    ).toBe('claude-3-5-sonnet-20241022');
  });

  it('normalizes legacy cloud provider formality aliases', () => {
    expect(normalizeCloudProviderFormalityValue('deepl', 'formal')).toBe(
      'more',
    );
    expect(normalizeCloudProviderFormalityValue('openai', 'default')).toBe(
      'neutral',
    );
  });

  it('prefers browser native translation when available', () => {
    expect(getPreferredLocalProvider({ browserNativeAvailable: true })).toBe(
      'chrome-builtin',
    );
    expect(getPreferredLocalProvider({ browserNativeAvailable: false })).toBe(
      'opus-mt',
    );
    expect(getPreferredLocalProvider()).toBe('opus-mt');
  });

  it('resolves provider ids from model aliases and rejects unknown ids', () => {
    expect(resolveProviderFromModelId(undefined)).toBeNull();
    expect(resolveProviderFromModelId('deepl')).toBe('deepl');
    expect(resolveProviderFromModelId('my-opus-mt-model')).toBe('opus-mt');
    expect(resolveProviderFromModelId('gemma-4b')).toBe('translategemma');
    expect(resolveProviderFromModelId('chrome-builtin-translator')).toBe(
      'chrome-builtin',
    );
    expect(resolveProviderFromModelId('mystery-model')).toBeNull();
  });

  it('exports canonical anthropic model values', () => {
    expect(ANTHROPIC_MODEL_VALUES).toContain('claude-3-5-sonnet-20241022');
  });
});
