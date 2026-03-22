/**
 * DeepL Provider unit tests
 *
 * Tests for DeepL translation provider (Free and Pro tiers).
 * Note: Actual API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepLProvider } from './deepl';

// Mock chrome.storage
const mockStorage: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((keys: string[]) => {
        const result: Record<string, unknown> = {};
        for (const key of keys) {
          if (mockStorage[key] !== undefined) {
            result[key] = mockStorage[key];
          }
        }
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
        return Promise.resolve();
      }),
      remove: vi.fn((keys: string[]) => {
        for (const key of keys) {
          delete mockStorage[key];
        }
        return Promise.resolve();
      }),
    },
  },
});

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock language-map module
vi.mock('../core/language-map', () => ({
  toDeepLCode: (code: string) => {
    const map: Record<string, string> = {
      en: 'EN',
      fi: 'FI',
      de: 'DE',
      fr: 'FR',
      es: 'ES',
    };
    return map[code.toLowerCase()] || code.toUpperCase();
  },
  getDeepLSupportedLanguages: () => ['en', 'fi', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'ru', 'ja', 'zh'],
}));

describe('DeepLProvider', () => {
  let provider: DeepLProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    provider = new DeepLProvider();
  });

  describe('constructor', () => {
    it('sets correct provider info', () => {
      const info = provider.getInfo();
      expect(info.id).toBe('deepl');
      expect(info.name).toBe('DeepL');
      expect(info.type).toBe('cloud');
      expect(info.qualityTier).toBe('premium');
    });

    it('sets cost per million', () => {
      expect(provider.costPerMillion).toBe(20);
    });
  });

  describe('initialize', () => {
    it('loads config from storage when API key exists', async () => {
      mockStorage['deepl_api_key'] = 'test-key:fx';
      mockStorage['deepl_is_pro'] = false;
      mockStorage['deepl_formality'] = 'more';

      await provider.initialize();

      expect(await provider.isAvailable()).toBe(true);
      const info = provider.getInfo();
      expect(info.tier).toBe('Free');
      expect(info.formality).toBe('more');
    });

    it('handles Pro tier', async () => {
      mockStorage['deepl_api_key'] = 'test-pro-key';
      mockStorage['deepl_is_pro'] = true;

      await provider.initialize();

      const info = provider.getInfo();
      expect(info.tier).toBe('Pro');
    });

    it('handles missing API key', async () => {
      await provider.initialize();
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('setApiKey', () => {
    it('stores API key with Free tier', async () => {
      await provider.setApiKey('test-key:fx', false);

      expect(mockStorage['deepl_api_key']).toBe('test-key:fx');
      expect(mockStorage['deepl_is_pro']).toBe(false);
    });

    it('stores API key with Pro tier', async () => {
      await provider.setApiKey('pro-key', true);

      expect(mockStorage['deepl_api_key']).toBe('pro-key');
      expect(mockStorage['deepl_is_pro']).toBe(true);
    });
  });

  describe('setFormality', () => {
    it('stores formality preference', async () => {
      await provider.setApiKey('key', false);
      await provider.setFormality('prefer_more');

      expect(mockStorage['deepl_formality']).toBe('prefer_more');
    });
  });

  describe('clearApiKey', () => {
    it('removes all config from storage', async () => {
      mockStorage['deepl_api_key'] = 'key';
      mockStorage['deepl_is_pro'] = true;
      mockStorage['deepl_formality'] = 'more';

      await provider.setApiKey('key');
      await provider.clearApiKey();

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('API endpoints', () => {
    it('uses Free API for Free tier', async () => {
      await provider.setApiKey('key:fx', false);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ detected_source_language: 'EN', text: 'Hei' }],
          }),
      });

      await provider.translate('Hello', 'en', 'fi');

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('api-free.deepl.com');
    });

    it('uses Pro API for Pro tier', async () => {
      await provider.setApiKey('pro-key', true);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ detected_source_language: 'EN', text: 'Hei' }],
          }),
      });

      await provider.translate('Hello', 'en', 'fi');

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('api.deepl.com');
      expect(url).not.toContain('api-free');
    });
  });

  describe('translate', () => {
    beforeEach(async () => {
      await provider.setApiKey('test-key:fx', false);
    });

    it('throws when API key not configured', async () => {
      const noKeyProvider = new DeepLProvider();
      await expect(noKeyProvider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('sends correct request for single text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ detected_source_language: 'EN', text: 'Hei' }],
          }),
      });

      const result = await provider.translate('Hello', 'en', 'fi');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain('/translate');

      const options = call[1];
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('DeepL-Auth-Key test-key:fx');

      const body = JSON.parse(options.body);
      expect(body.text).toEqual(['Hello']);
      expect(body.target_lang).toBe('FI');
      expect(body.source_lang).toBe('EN');

      expect(result).toBe('Hei');
    });

    it('handles batch translation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [
              { detected_source_language: 'EN', text: 'Hei' },
              { detected_source_language: 'EN', text: 'Maailma' },
            ],
          }),
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });

    it('omits source_lang for auto-detect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ detected_source_language: 'EN', text: 'Hei' }],
          }),
      });

      await provider.translate('Hello', 'auto', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.source_lang).toBeUndefined();
    });

    it('includes formality for supported languages', async () => {
      await provider.setFormality('more');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ detected_source_language: 'EN', text: 'Guten Tag' }],
          }),
      });

      await provider.translate('Hello', 'en', 'de');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.formality).toBe('more');
    });

    it('handles API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
        headers: { get: () => null },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('handles quota exceeded', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 456,
        text: () => Promise.resolve('Quota exceeded'),
        headers: { get: () => null },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });
  });

  describe('detectLanguage', () => {
    it('returns auto without API key', async () => {
      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('detects language by translating sample', async () => {
      await provider.setApiKey('key:fx', false);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ detected_source_language: 'FI', text: 'Hello' }],
          }),
      });

      const result = await provider.detectLanguage('Hei maailma');
      expect(result).toBe('fi');
    });

    it('uses only first 100 chars for detection', async () => {
      await provider.setApiKey('key:fx', false);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ detected_source_language: 'EN', text: 'Test' }],
          }),
      });

      await provider.detectLanguage('x'.repeat(500));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text[0].length).toBe(100);
    });
  });

  describe('getUsage', () => {
    it('returns zero usage without API key', async () => {
      const usage = await provider.getUsage();
      expect(usage.tokens).toBe(0);
      expect(usage.cost).toBe(0);
      expect(usage.limitReached).toBe(false);
    });

    it('fetches usage from DeepL API', async () => {
      await provider.setApiKey('key:fx', false);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            character_count: 100000,
            character_limit: 500000,
          }),
      });

      const usage = await provider.getUsage();

      expect(usage.tokens).toBe(100000);
      expect(usage.cost).toBeCloseTo(2); // 100000 / 1000000 * 20
      expect(usage.limitReached).toBe(false);
    });

    it('detects limit reached', async () => {
      await provider.setApiKey('key:fx', false);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            character_count: 500000,
            character_limit: 500000,
          }),
      });

      const usage = await provider.getUsage();
      expect(usage.limitReached).toBe(true);
    });

    it('caches usage for 5 minutes', async () => {
      await provider.setApiKey('key:fx', false);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            character_count: 100,
            character_limit: 500000,
          }),
      });

      // First call fetches from API
      await provider.getUsage();
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second call uses cache
      await provider.getUsage();
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns all language pair combinations', () => {
      const pairs = provider.getSupportedLanguages();

      expect(pairs.length).toBeGreaterThan(50);

      for (const pair of pairs) {
        expect(pair.src).not.toBe(pair.tgt);
      }

      expect(pairs).toContainEqual({ src: 'en', tgt: 'fi' });
      expect(pairs).toContainEqual({ src: 'fi', tgt: 'en' });
    });
  });

  describe('test', () => {
    it('returns true on successful translation', async () => {
      await provider.setApiKey('key:fx', false);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            translations: [{ detected_source_language: 'EN', text: 'Hei' }],
          }),
      });

      const result = await provider.test();
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      await provider.setApiKey('key:fx', false);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.test();
      expect(result).toBe(false);
    });
  });

  describe('getInfo', () => {
    it('includes tier and formality', async () => {
      await provider.setApiKey('key', true);
      await provider.setFormality('less');

      const info = provider.getInfo();

      expect(info.tier).toBe('Pro');
      expect(info.formality).toBe('less');
      expect(info.id).toBe('deepl');
    });
  });

  describe('detectLanguage network error', () => {
    it('returns auto when fetch throws during detectLanguage', async () => {
      await provider.setApiKey('test-key');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.detectLanguage('Bonjour');
      expect(result).toBe('auto');
    });
  });

  describe('getUsage network error', () => {
    it('returns default usage when fetch throws', async () => {
      await provider.setApiKey('test-key');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.getUsage();
      expect(result).toEqual({ requests: 0, tokens: 0, cost: 0, limitReached: false });
    });
  });

  describe('initialize with missing isPro and formality', () => {
    it('defaults isPro to false when deepl_is_pro is undefined', async () => {
      // Only set the API key, omit isPro and formality
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        deepl_api_key: 'test-key-free',
        // deepl_is_pro is deliberately omitted → ?? false
        // deepl_formality is deliberately omitted → ?? 'default'
      });

      const freshProvider = new DeepLProvider();
      await freshProvider.initialize();

      const info = freshProvider.getInfo();
      expect(info.tier).toBe('Free');
      expect(info.formality).toBe('default');
    });
  });

  describe('setFormality when config is null', () => {
    it('stores formality in storage but does not crash when config is null', async () => {
      const freshProvider = new DeepLProvider();
      // Do NOT initialize — config remains null/undefined

      await freshProvider.setFormality('more');

      // Verify chrome.storage.local.set was called
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ deepl_formality: 'more' });
    });
  });

  describe('translate with formality unsupported for target language', () => {
    it('does not include formality for unsupported target language like Finnish', async () => {
      await provider.setApiKey('test-key');
      await provider.setFormality('more');

      // FI is not in the formalitySupported list
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          translations: [{ text: 'Hei maailma', detected_source_language: 'EN' }],
        }),
      });

      await provider.translate('Hello world', 'en', 'fi');

      const fetchCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(fetchCall[1].body);
      // formality should NOT be in the body for Finnish
      expect(body.formality).toBeUndefined();
    });

    it('includes formality for supported target language like German', async () => {
      await provider.setApiKey('test-key');
      await provider.setFormality('more');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          translations: [{ text: 'Hallo Welt', detected_source_language: 'EN' }],
        }),
      });

      await provider.translate('Hello world', 'en', 'de');

      const fetchCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.formality).toBe('more');
    });
  });

  describe('detectLanguage success path', () => {
    it('returns detected language when response is ok', async () => {
      await provider.setApiKey('test-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          translations: [{ text: 'Hello', detected_source_language: 'FR' }],
        }),
      });

      const result = await provider.detectLanguage('Bonjour le monde');
      expect(result).toBe('fr');
    });
  });

  describe('getUsage success path', () => {
    it('returns usage data when response is ok', async () => {
      await provider.setApiKey('test-key');
      // Clear any cached usage
      (provider as any).usageCache = null;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          character_count: 50000,
          character_limit: 500000,
        }),
      });

      const result = await provider.getUsage();
      expect(result.tokens).toBe(50000);
      expect(result.limitReached).toBe(false);
    });
  });

  describe('translate edge cases (line 208, 260)', () => {
    beforeEach(async () => {
      await provider.setApiKey('test-key');
    });

    it('handles response with no translations array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          translations: undefined,  // Missing translations
        }),
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('handles response with empty translations array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          translations: [],  // Empty array
        }),
      });

      const result = await provider.translate('Hello', 'en', 'fi');
      // When empty, results[0] is undefined
      expect(result).toBeUndefined();
    });

    it('handles API error response gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Unauthorized'),
        headers: { get: () => null },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('handles fetch network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });
  });

  describe('detectLanguage edge cases', () => {
    beforeEach(async () => {
      await provider.setApiKey('test-key');
    });

    it('returns auto when no API key', async () => {
      const noKeyProvider = new DeepLProvider();
      const result = await noKeyProvider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('returns auto when translations is undefined', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          translations: undefined,
        }),
      });

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('returns auto when detected language is missing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          translations: [{ text: 'Hei' }],  // No detected_source_language
        }),
      });

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('handles response.ok=false gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('handles fetch error during detection', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network timeout'));

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });
  });

  describe('setApiKey creates config when null', () => {
    it('initializes config if not already set', async () => {
      const newProvider = new DeepLProvider();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((newProvider as any).config).toBeNull();

      await newProvider.setApiKey('new-key-123');

      expect(await newProvider.isAvailable()).toBe(true);
    });
  });

  describe('translate single vs batch', () => {
    beforeEach(async () => {
      await provider.setApiKey('test-key');
    });

    it('handles single string translation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          translations: [{ text: 'Hei' }],
        }),
      });

      const result = await provider.translate('Hello', 'en', 'fi');
      expect(typeof result).toBe('string');
      expect(result).toBe('Hei');
    });

    it('handles array translation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          translations: [
            { text: 'Hei' },
            { text: 'Maailma' },
          ],
        }),
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);
    });
  });

  describe('test method', () => {
    it('returns true on successful translation', async () => {
      await provider.setApiKey('test-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          translations: [{ text: 'Hei' }],
        }),
      });

      const result = await provider.test();
      expect(result).toBe(true);
    });

    it('returns false on translation error', async () => {
      await provider.setApiKey('test-key');

      mockFetch.mockRejectedValueOnce(new Error('API error'));

      const result = await provider.test();
      expect(result).toBe(false);
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns multiple language pairs', () => {
      const pairs = provider.getSupportedLanguages();

      expect(Array.isArray(pairs)).toBe(true);
      expect(pairs.length).toBeGreaterThan(20);

      // Verify no reflexive pairs
      for (const pair of pairs) {
        expect(pair.src).not.toBe(pair.tgt);
      }
    });

    it('includes common language pairs', () => {
      const pairs = provider.getSupportedLanguages();

      expect(pairs).toContainEqual({ src: 'en', tgt: 'fi' });
      expect(pairs).toContainEqual({ src: 'fi', tgt: 'en' });
      expect(pairs).toContainEqual({ src: 'en', tgt: 'de' });
    });
  });

  describe('initialize and isAvailable', () => {
    it('isAvailable returns true when configured', async () => {
      const freshProvider = new DeepLProvider();
      // Mock storage to have a key
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        deepl_api_key: 'test-key',
      });

      const available = await freshProvider.isAvailable();
      expect(available).toBe(true);
    });

    it('isAvailable returns false when not configured', async () => {
      const freshProvider = new DeepLProvider();
      // Mock storage with no key
      (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({});

      const available = await freshProvider.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('getUsage with different scenarios', () => {
    beforeEach(async () => {
      await provider.setApiKey('test-key');
      // Clear cache
      (provider as any).usageCache = null;
    });

    it('caches usage results', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            character_count: 1000,
            character_limit: 500000,
          }),
        });

      await provider.getUsage();
      const cachedUsage = (provider as any).usageCache;

      expect(cachedUsage).toBeDefined();
      expect(cachedUsage.count).toBe(1000);
      expect(cachedUsage.limit).toBe(500000);
    });

    it('returns cached usage on second call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          character_count: 2000,
          character_limit: 500000,
        }),
      });

      // @ts-expect-error unused side-effect
      const _usage1 = await provider.getUsage();
      // Don't clear cache, call again
      const usage2 = await provider.getUsage();

      // Should only call fetch once due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(usage2.tokens).toBe(2000);
    });

    it('handles limit reached', async () => {
      (provider as any).usageCache = null;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          character_count: 490000,
          character_limit: 500000,
        }),
      });

      const usage = await provider.getUsage();
      expect(usage.limitReached).toBe(false);

      // Update cache to simulate limit reached (need timestamp field)
      (provider as any).usageCache = {
        count: 500000,
        limit: 500000,
        timestamp: Date.now(),
      };

      const usage2 = await provider.getUsage();
      expect(usage2.limitReached).toBe(true);
    });
  });

  describe('getUsage when response is not ok (line 260 false branch)', () => {
    it('returns default usage when usage endpoint returns non-ok response', async () => {
      await provider.setApiKey('test-key');
      (provider as any).usageCache = null;

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.getUsage();
      expect(result).toEqual({ requests: 0, tokens: 0, cost: 0, limitReached: false });
    });
  });

  describe('translate when response.text() rejects (line 166 catch)', () => {
    it('still throws when reading error body fails', async () => {
      await provider.setApiKey('test-key');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('body stream already read')),
        headers: { get: () => null },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });
  });

  describe('initialize error handling (line 78)', () => {
    it('catches and logs error when chrome.storage.local.get throws', async () => {
      const freshProvider = new DeepLProvider();

      // Mock chrome.storage to throw an error
      const mockGetError = new Error('Storage access denied');
      vi.mocked(chrome.storage.local.get as any).mockRejectedValueOnce(mockGetError);

      // Should not throw — safeStorageGet handles the error at the storage layer
      await expect(freshProvider.initialize()).resolves.not.toThrow();
      // Provider remains uninitialised (no API key in empty result)
      expect(await freshProvider.isAvailable()).toBe(false);
    });
  });
});
