import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROVIDER_ID,
  ANTHROPIC_MODEL_VALUES,
  CLOUD_PROVIDER_IDS,
  MODEL_SELECTOR_DOWNLOADABLE_MODELS,
  TRANSLATION_PROVIDER_IDS,
  getProviderDefinition,
  isBrowserManagedProviderId,
  isCloudProviderId,
  isDownloadableProviderId,
  isExperimentalProviderId,
  isTranslationProviderId,
  normalizeCloudProviderFormalityValue,
  normalizeCloudProviderModelValue,
  normalizeTranslationProviderId,
} from './provider-options';

describe('provider-options guards', () => {
  it('lists all translation provider ids', () => {
    expect(TRANSLATION_PROVIDER_IDS).toHaveLength(7);
    expect(TRANSLATION_PROVIDER_IDS).toContain('opus-mt');
    expect(TRANSLATION_PROVIDER_IDS).toContain('deepl');
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
    expect(normalizeTranslationProviderId('invalid-provider', 'deepl')).toBe('deepl');
  });

  it('exports the canonical default provider id', () => {
    expect(DEFAULT_PROVIDER_ID).toBe('opus-mt');
  });

  it('normalizes the legacy opus provider alias', () => {
    expect(normalizeTranslationProviderId('opus-mt-local')).toBe('opus-mt');
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
    expect(MODEL_SELECTOR_DOWNLOADABLE_MODELS.map((model) => model.id)).toEqual([
      'opus-mt',
      'translategemma',
    ]);
  });

  it('stores canonical runtime metadata for chrome-builtin', () => {
    const chromeBuiltin = getProviderDefinition('chrome-builtin');
    expect(chromeBuiltin.runtimeKind).toBe('native-browser');
    expect(chromeBuiltin.deliveryKind).toBe('browser-managed');
    expect(chromeBuiltin.preferredWhenAvailable).toBe(true);
  });

  it('normalizes legacy cloud provider model aliases', () => {
    expect(normalizeCloudProviderModelValue('openai', 'gpt-4')).toBe('gpt-4-turbo');
    expect(normalizeCloudProviderModelValue('anthropic', 'claude-3-5-sonnet')).toBe(
      'claude-3-5-sonnet-20241022'
    );
  });

  it('normalizes legacy cloud provider formality aliases', () => {
    expect(normalizeCloudProviderFormalityValue('deepl', 'formal')).toBe('more');
    expect(normalizeCloudProviderFormalityValue('openai', 'default')).toBe('neutral');
  });

  it('exports canonical anthropic model values', () => {
    expect(ANTHROPIC_MODEL_VALUES).toContain('claude-3-5-sonnet-20241022');
  });
});
