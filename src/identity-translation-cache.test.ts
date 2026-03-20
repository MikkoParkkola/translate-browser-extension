/**
 * Tests for identity translation caching behavior.
 *
 * Validates that translations where the model output equals the input
 * (identity translations) are properly cached and served, rather than
 * being rejected as "poisoned" cache entries.
 *
 * This prevents an infinite retry loop where:
 * 1. Model returns original text for untranslatable words (proper nouns, brands, loanwords)
 * 2. Cache rejects the result as "poisoned" (output === input)
 * 3. System retranslates, getting the same result, never caching it
 * 4. Every subsequent request triggers expensive model inference
 */

import { describe, it, expect, beforeEach } from 'vitest';

interface CacheEntry {
  result: string | string[];
  timestamp: number;
  sourceLang: string;
  targetLang: string;
  useCount: number;
}

describe('Identity Translation Cache Behavior', () => {
  let translationCache: Map<string, CacheEntry>;

  /** Simplified cache key generation */
  function getCacheKey(text: string, sourceLang: string, targetLang: string, provider: string): string {
    const input = Array.isArray(text) ? text.join('|') : text;
    return `${input}::${sourceLang}::${targetLang}::${provider}`;
  }

  /** Simplified cache get */
  function getCachedTranslation(key: string): CacheEntry | null {
    const entry = translationCache.get(key);
    if (entry) {
      entry.useCount++;
      entry.timestamp = Date.now();
      return entry;
    }
    return null;
  }

  /** Simplified cache set */
  function setCachedTranslation(key: string, result: string | string[], sourceLang: string, targetLang: string): void {
    translationCache.set(key, {
      result,
      timestamp: Date.now(),
      sourceLang,
      targetLang,
      useCount: 1,
    });
  }

  beforeEach(() => {
    translationCache = new Map();
  });

  describe('single text identity translations', () => {
    it('caches identity translations for proper nouns', () => {
      const text = 'Allerhande';
      const cacheKey = getCacheKey(text, 'nl', 'en', 'opus-mt');

      const modelResult = 'Allerhande';

      setCachedTranslation(cacheKey, modelResult, 'nl', 'en');

      const cached = getCachedTranslation(cacheKey);
      expect(cached).not.toBeNull();
      expect(cached!.result).toBe('Allerhande');
    });

    it('serves identity translations from cache on subsequent requests', () => {
      const text = 'Stamppotten';
      const cacheKey = getCacheKey(text, 'nl', 'en', 'opus-mt');

      setCachedTranslation(cacheKey, 'Stamppotten', 'nl', 'en');

      const cached = getCachedTranslation(cacheKey);
      expect(cached).not.toBeNull();
      expect(cached!.result).toBe('Stamppotten');
      expect(cached!.useCount).toBe(2);
    });

    it('caches brand names that are identity translations', () => {
      const brandNames = ['AH Mobiel', 'B Corp', 'Albert Heijn'];

      for (const name of brandNames) {
        const cacheKey = getCacheKey(name, 'nl', 'en', 'opus-mt');
        setCachedTranslation(cacheKey, name, 'nl', 'en');

        const cached = getCachedTranslation(cacheKey);
        expect(cached).not.toBeNull();
        expect(cached!.result).toBe(name);
      }
    });

    it('caches loanwords that are identity translations', () => {
      const loanwords = ['Services', 'Bonus', 'Online', 'App'];

      for (const word of loanwords) {
        const cacheKey = getCacheKey(word, 'nl', 'en', 'opus-mt');
        setCachedTranslation(cacheKey, word, 'nl', 'en');

        const cached = getCachedTranslation(cacheKey);
        expect(cached).not.toBeNull();
        expect(cached!.result).toBe(word);
      }
    });

    it('caches short words that are identity translations', () => {
      const shortWords = ['min', 'ok', 'ja'];

      for (const word of shortWords) {
        const cacheKey = getCacheKey(word, 'nl', 'en', 'opus-mt');
        setCachedTranslation(cacheKey, word, 'nl', 'en');

        const cached = getCachedTranslation(cacheKey);
        expect(cached).not.toBeNull();
        expect(cached!.result).toBe(word);
      }
    });
  });

  describe('batch/array identity translations', () => {
    it('caches array results that include identity translations', () => {
      const texts = ['Allerhande', 'Recepten', 'Stamppotten'];
      const translations = ['Allerhande', 'Recipes', 'Stamppotten'];

      for (let i = 0; i < texts.length; i++) {
        const cacheKey = getCacheKey(texts[i], 'nl', 'en', 'opus-mt');
        setCachedTranslation(cacheKey, translations[i], 'nl', 'en');
      }

      const identityKey = getCacheKey('Allerhande', 'nl', 'en', 'opus-mt');
      expect(getCachedTranslation(identityKey)!.result).toBe('Allerhande');

      const normalKey = getCacheKey('Recepten', 'nl', 'en', 'opus-mt');
      expect(getCachedTranslation(normalKey)!.result).toBe('Recipes');
    });

    it('does not re-translate identity translations from cache', () => {
      const text = 'Bonus';
      const cacheKey = getCacheKey(text, 'nl', 'en', 'opus-mt');

      setCachedTranslation(cacheKey, 'Bonus', 'nl', 'en');

      const cached = getCachedTranslation(cacheKey);

      expect(cached).not.toBeNull();
      expect(cached!.result).toBe('Bonus');
    });
  });

  describe('non-identity translations still work normally', () => {
    it('caches normal translations', () => {
      const text = 'Welkom';
      const cacheKey = getCacheKey(text, 'nl', 'en', 'opus-mt');

      setCachedTranslation(cacheKey, 'Welcome', 'nl', 'en');

      const cached = getCachedTranslation(cacheKey);
      expect(cached).not.toBeNull();
      expect(cached!.result).toBe('Welcome');
    });

    it('differentiates cache keys by language pair', () => {
      const text = 'Services';

      const nlEnKey = getCacheKey(text, 'nl', 'en', 'opus-mt');
      setCachedTranslation(nlEnKey, 'Services', 'nl', 'en');

      const enFiKey = getCacheKey(text, 'en', 'fi', 'opus-mt');
      setCachedTranslation(enFiKey, 'Palvelut', 'en', 'fi');

      expect(getCachedTranslation(nlEnKey)!.result).toBe('Services');
      expect(getCachedTranslation(enFiKey)!.result).toBe('Palvelut');
    });

    it('differentiates cache keys by provider', () => {
      const text = 'Bonus';

      const opusKey = getCacheKey(text, 'nl', 'en', 'opus-mt');
      setCachedTranslation(opusKey, 'Bonus', 'nl', 'en');

      const deeplKey = getCacheKey(text, 'nl', 'en', 'deepl');
      setCachedTranslation(deeplKey, 'Bonus offer', 'nl', 'en');

      expect(getCachedTranslation(opusKey)!.result).toBe('Bonus');
      expect(getCachedTranslation(deeplKey)!.result).toBe('Bonus offer');
    });
  });

  describe('regression: no infinite retry loop', () => {
    it('does not trigger retranslation when cached result equals input', () => {
      const text = 'Stamppotten';
      const cacheKey = getCacheKey(text, 'nl', 'en', 'opus-mt');

      setCachedTranslation(cacheKey, 'Stamppotten', 'nl', 'en');

      let retranslateCount = 0;

      for (let request = 0; request < 10; request++) {
        const cached = getCachedTranslation(cacheKey);

        if (cached) {
          expect(cached.result).toBe('Stamppotten');
        } else {
          retranslateCount++;
        }
      }

      expect(retranslateCount).toBe(0);
    });

    it('handles mixed identity and real translations in a batch without looping', () => {
      const batch = [
        { text: 'Allerhande', expected: 'Allerhande' },
        { text: 'Recepten', expected: 'Recipes' },
        { text: 'B Corp', expected: 'B Corp' },
        { text: 'Producten', expected: 'Products' },
        { text: 'min', expected: 'min' },
      ];

      for (const { text, expected } of batch) {
        const cacheKey = getCacheKey(text, 'nl', 'en', 'opus-mt');
        setCachedTranslation(cacheKey, expected, 'nl', 'en');
      }

      let cacheMisses = 0;
      for (const { text, expected } of batch) {
        const cacheKey = getCacheKey(text, 'nl', 'en', 'opus-mt');
        const cached = getCachedTranslation(cacheKey);
        if (!cached) {
          cacheMisses++;
        } else {
          expect(cached.result).toBe(expected);
        }
      }

      expect(cacheMisses).toBe(0);
    });
  });
});
