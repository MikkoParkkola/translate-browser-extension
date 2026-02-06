/**
 * Base Provider unit tests
 */

import { describe, it, expect } from 'vitest';
import { BaseProvider } from './base-provider';
import type { TranslationOptions, LanguagePair } from '../types';

// Concrete implementation for testing
class TestProvider extends BaseProvider {
  private shouldFail = false;

  constructor(shouldFail = false) {
    super({
      id: 'test-provider',
      name: 'Test Provider',
      type: 'local',
      qualityTier: 'standard',
      costPerMillion: 0,
      icon: '',
    });
    this.shouldFail = shouldFail;
  }

  async translate(
    text: string | string[],
    _sourceLang: string,
    _targetLang: string,
    _options?: TranslationOptions
  ): Promise<string | string[]> {
    if (this.shouldFail) {
      throw new Error('Translation failed');
    }
    if (Array.isArray(text)) {
      return text.map(t => `translated: ${t}`);
    }
    return `translated: ${text}`;
  }

  getSupportedLanguages(): LanguagePair[] {
    return [
      { src: 'en', tgt: 'fi' },
      { src: 'fi', tgt: 'en' },
    ];
  }
}

describe('BaseProvider', () => {
  describe('constructor', () => {
    it('sets default values', () => {
      const provider = new TestProvider();

      expect(provider.id).toBe('test-provider');
      expect(provider.name).toBe('Test Provider');
      expect(provider.type).toBe('local');
      expect(provider.qualityTier).toBe('standard');
      expect(provider.costPerMillion).toBe(0);
    });
  });

  describe('getInfo', () => {
    it('returns provider configuration', () => {
      const provider = new TestProvider();
      const info = provider.getInfo();

      expect(info.id).toBe('test-provider');
      expect(info.name).toBe('Test Provider');
      expect(info.type).toBe('local');
      expect(info.qualityTier).toBe('standard');
      expect(info.costPerMillion).toBe(0);
    });
  });

  describe('initialize', () => {
    it('resolves without error by default', async () => {
      const provider = new TestProvider();

      await expect(provider.initialize()).resolves.toBeUndefined();
    });
  });

  describe('isAvailable', () => {
    it('returns true by default', async () => {
      const provider = new TestProvider();

      await expect(provider.isAvailable()).resolves.toBe(true);
    });
  });

  describe('detectLanguage', () => {
    it('returns auto by default', async () => {
      const provider = new TestProvider();

      await expect(provider.detectLanguage('test')).resolves.toBe('auto');
    });
  });

  describe('getUsage', () => {
    it('returns zero usage by default', async () => {
      const provider = new TestProvider();
      const usage = await provider.getUsage();

      expect(usage.requests).toBe(0);
      expect(usage.tokens).toBe(0);
      expect(usage.cost).toBe(0);
      expect(usage.limitReached).toBe(false);
    });
  });

  describe('validateConfig', () => {
    it('returns true by default', async () => {
      const provider = new TestProvider();

      await expect(provider.validateConfig()).resolves.toBe(true);
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns language pairs', () => {
      const provider = new TestProvider();
      const languages = provider.getSupportedLanguages();

      expect(languages).toContainEqual({ src: 'en', tgt: 'fi' });
      expect(languages).toContainEqual({ src: 'fi', tgt: 'en' });
    });
  });

  describe('test', () => {
    it('returns true when translation succeeds', async () => {
      const provider = new TestProvider(false);

      await expect(provider.test()).resolves.toBe(true);
    });

    it('returns false when translation fails', async () => {
      const provider = new TestProvider(true);

      await expect(provider.test()).resolves.toBe(false);
    });
  });

  describe('translate', () => {
    it('translates single string', async () => {
      const provider = new TestProvider();
      const result = await provider.translate('hello', 'en', 'fi');

      expect(result).toBe('translated: hello');
    });

    it('translates array of strings', async () => {
      const provider = new TestProvider();
      const result = await provider.translate(['hello', 'world'], 'en', 'fi');

      expect(result).toEqual(['translated: hello', 'translated: world']);
    });
  });
});
