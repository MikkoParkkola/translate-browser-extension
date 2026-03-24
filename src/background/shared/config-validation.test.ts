import { describe, expect, it } from 'vitest';

import {
  buildValidatedCloudProviderMutation,
  normalizeUserSettings,
  validateAnthropicStoredConfig,
  validateDeepLStoredConfig,
  validateGoogleCloudStoredConfig,
  validateOpenAIStoredConfig,
} from './config-validation';

describe('normalizeUserSettings', () => {
  it('fills defaults and normalizes invalid provider values', () => {
    expect(
      normalizeUserSettings(
        {
          provider: 'not-a-provider',
          strategy: 'bogus',
        },
        'chrome-builtin'
      )
    ).toEqual({
      sourceLang: 'auto',
      targetLang: 'en',
      provider: 'chrome-builtin',
      strategy: 'smart',
    });
  });

  it('uses valid stored settings', () => {
    expect(
      normalizeUserSettings(
        {
          sourceLang: 'fi',
          targetLang: 'de',
          provider: 'deepl',
          strategy: 'quality',
        },
        'opus-mt'
      )
    ).toEqual({
      sourceLang: 'fi',
      targetLang: 'de',
      provider: 'deepl',
      strategy: 'quality',
    });
  });
});

describe('provider config validators', () => {
  it('falls back to defaults for invalid DeepL option values', () => {
    expect(
      validateDeepLStoredConfig({
        deepl_api_key: 'key',
        deepl_is_pro: 'yes',
        deepl_formality: 'bogus',
      })
    ).toEqual({
      apiKey: 'key',
      isPro: false,
      formality: 'default',
    });
  });

  it('maps legacy DeepL formality aliases to provider values', () => {
    expect(
      validateDeepLStoredConfig({
        deepl_api_key: 'key',
        deepl_formality: 'formal',
      })
    ).toEqual({
      apiKey: 'key',
      isPro: false,
      formality: 'more',
    });
  });

  it('falls back to defaults for invalid OpenAI option values', () => {
    expect(
      validateOpenAIStoredConfig({
        openai_api_key: 'key',
        openai_model: 'bogus',
        openai_formality: 'bogus',
        openai_temperature: 'bad',
        openai_tokens_used: 'bad',
      })
    ).toEqual({
      apiKey: 'key',
      model: 'gpt-4o-mini',
      formality: 'neutral',
      temperature: 0.3,
      tokensUsed: 0,
    });
  });

  it('falls back to defaults for invalid Anthropic option values', () => {
    expect(
      validateAnthropicStoredConfig({
        anthropic_api_key: 'key',
        anthropic_model: 'bogus',
        anthropic_formality: 'bogus',
        anthropic_tokens_used: 'bad',
      })
    ).toEqual({
      apiKey: 'key',
      model: 'claude-3-5-haiku-20241022',
      formality: 'neutral',
      tokensUsed: 0,
    });
  });

  it('maps stored Anthropic model aliases to supported runtime models', () => {
    expect(
      validateAnthropicStoredConfig({
        anthropic_api_key: 'key',
        anthropic_model: 'claude-3-5-haiku-latest',
      })
    ).toEqual({
      apiKey: 'key',
      model: 'claude-3-5-haiku-20241022',
      formality: 'neutral',
      tokensUsed: 0,
    });
  });

  it('defaults Google Cloud usage when stored value is invalid', () => {
    expect(
      validateGoogleCloudStoredConfig({
        google_cloud_api_key: 'key',
        google_cloud_chars_used: 'bad',
      })
    ).toEqual({
      apiKey: 'key',
      charactersUsed: 0,
    });
  });
});

describe('buildValidatedCloudProviderMutation', () => {
  it('stores only valid DeepL options and canonicalizes aliases', () => {
    expect(
      buildValidatedCloudProviderMutation(
        'deepl',
        { isPro: true, formality: 'formal', ignored: 'value' },
        { isPro: 'deepl_is_pro', formality: 'deepl_formality' }
      )
    ).toEqual({
      deepl_is_pro: true,
      deepl_formality: 'more',
    });
  });

  it('canonicalizes legacy OpenAI aliases while filtering invalid primitive types', () => {
    expect(
      buildValidatedCloudProviderMutation(
        'openai',
        { model: 'gpt-4', formality: 'default', temperature: 'hot' },
        { model: 'openai_model', formality: 'openai_formality' }
      )
    ).toEqual({
      openai_model: 'gpt-4-turbo',
      openai_formality: 'neutral',
    });
  });

  it('drops unsupported OpenAI model values', () => {
    expect(
      buildValidatedCloudProviderMutation(
        'openai',
        { model: 'not-real', formality: 'formal' },
        { model: 'openai_model', formality: 'openai_formality' }
      )
    ).toEqual({
      openai_formality: 'formal',
    });
  });
});
