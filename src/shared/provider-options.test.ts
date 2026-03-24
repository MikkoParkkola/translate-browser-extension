import { describe, expect, it } from 'vitest';
import {
  ANTHROPIC_MODEL_VALUES,
  CLOUD_PROVIDER_IDS,
  TRANSLATION_PROVIDER_IDS,
  isCloudProviderId,
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

  it('normalizes the legacy opus provider alias', () => {
    expect(normalizeTranslationProviderId('opus-mt-local')).toBe('opus-mt');
  });

  it('accepts cloud provider ids only for cloud guard', () => {
    expect(isCloudProviderId('deepl')).toBe(true);
    expect(isCloudProviderId('chrome-builtin')).toBe(false);
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
