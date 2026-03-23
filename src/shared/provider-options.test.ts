import { describe, expect, it } from 'vitest';
import {
  CLOUD_PROVIDER_IDS,
  TRANSLATION_PROVIDER_IDS,
  isCloudProviderId,
  isTranslationProviderId,
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

  it('accepts cloud provider ids only for cloud guard', () => {
    expect(isCloudProviderId('deepl')).toBe(true);
    expect(isCloudProviderId('chrome-builtin')).toBe(false);
  });
});
