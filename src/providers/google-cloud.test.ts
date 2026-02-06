/**
 * Google Cloud Provider unit tests
 *
 * Tests for Google Cloud Translation API v2 provider.
 * Note: Actual API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleCloudProvider } from './google-cloud';

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

describe('GoogleCloudProvider', () => {
  let provider: GoogleCloudProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    provider = new GoogleCloudProvider();
  });

  describe('constructor', () => {
    it('sets correct provider info', () => {
      const info = provider.getInfo();
      expect(info.id).toBe('google-cloud');
      expect(info.name).toBe('Google Cloud Translation');
      expect(info.type).toBe('cloud');
      expect(info.qualityTier).toBe('standard');
    });

    it('sets cost per million', () => {
      expect(provider.costPerMillion).toBe(20);
    });
  });

  describe('initialize', () => {
    it('loads config from storage when API key exists', async () => {
      mockStorage['google_cloud_api_key'] = 'AIza-test-key';
      mockStorage['google_cloud_chars_used'] = 5000;

      await provider.initialize();

      expect(await provider.isAvailable()).toBe(true);
      const info = provider.getInfo();
      expect(info.charactersUsed).toBe(5000);
    });

    it('handles missing API key', async () => {
      await provider.initialize();
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('setApiKey', () => {
    it('stores API key in storage', async () => {
      await provider.setApiKey('AIza-new-key');

      expect(mockStorage['google_cloud_api_key']).toBe('AIza-new-key');
      expect(await provider.isAvailable()).toBe(true);
    });
  });

  describe('clearApiKey', () => {
    it('removes all config from storage', async () => {
      mockStorage['google_cloud_api_key'] = 'key';
      mockStorage['google_cloud_chars_used'] = 1000;

      await provider.setApiKey('key');
      await provider.clearApiKey();

      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('translate', () => {
    beforeEach(async () => {
      await provider.setApiKey('AIza-test-key');
    });

    it('throws when API key not configured', async () => {
      const noKeyProvider = new GoogleCloudProvider();
      await expect(noKeyProvider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('sends correct request for single text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              translations: [{ translatedText: 'Hei', detectedSourceLanguage: 'en' }],
            },
          }),
      });

      const result = await provider.translate('Hello', 'en', 'fi');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const call = mockFetch.mock.calls[0];
      const url = new URL(call[0]);

      expect(url.origin).toBe('https://translation.googleapis.com');
      expect(url.pathname).toBe('/language/translate/v2');
      expect(url.searchParams.get('key')).toBe('AIza-test-key');

      const options = call[1];
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.q).toEqual(['Hello']);
      expect(body.target).toBe('fi');
      expect(body.source).toBe('en');
      expect(body.format).toBe('text');

      expect(result).toBe('Hei');
    });

    it('handles batch translation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              translations: [
                { translatedText: 'Hei' },
                { translatedText: 'Maailma' },
              ],
            },
          }),
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.q).toEqual(['Hello', 'World']);
    });

    it('omits source for auto-detect', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              translations: [{ translatedText: 'Hei', detectedSourceLanguage: 'en' }],
            },
          }),
      });

      await provider.translate('Hello', 'auto', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.source).toBeUndefined();
    });

    it('handles API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('API key invalid'),
        headers: { get: () => null },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('tracks character usage', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              translations: [{ translatedText: 'Hei' }],
            },
          }),
      });

      await provider.translate('Hello', 'en', 'fi');

      // Character count should be tracked
      const info = provider.getInfo();
      expect(info.charactersUsed).toBe(5); // 'Hello'.length
    });

    it('accumulates character usage across translations', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { translations: [{ translatedText: 'Hei' }] },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { translations: [{ translatedText: 'Maailma' }] },
            }),
        });

      await provider.translate('Hello', 'en', 'fi');
      await provider.translate('World', 'en', 'fi');

      const info = provider.getInfo();
      expect(info.charactersUsed).toBe(10); // 'Hello'.length + 'World'.length
    });
  });

  describe('detectLanguage', () => {
    it('returns auto without API key', async () => {
      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });

    it('detects language using detection endpoint', async () => {
      await provider.setApiKey('AIza-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              detections: [[{ language: 'fi', confidence: 0.98 }]],
            },
          }),
      });

      const result = await provider.detectLanguage('Hei maailma');
      expect(result).toBe('fi');
    });

    it('uses correct detection endpoint', async () => {
      await provider.setApiKey('AIza-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              detections: [[{ language: 'en', confidence: 0.99 }]],
            },
          }),
      });

      await provider.detectLanguage('Hello');

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('/detect');
    });

    it('uses only first 200 chars for detection', async () => {
      await provider.setApiKey('AIza-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              detections: [[{ language: 'en', confidence: 0.9 }]],
            },
          }),
      });

      await provider.detectLanguage('x'.repeat(500));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.q.length).toBe(200);
    });

    it('returns auto on API error', async () => {
      await provider.setApiKey('AIza-key');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const result = await provider.detectLanguage('Hello');
      expect(result).toBe('auto');
    });
  });

  describe('getUsage', () => {
    it('returns zero usage initially', async () => {
      const usage = await provider.getUsage();
      expect(usage.tokens).toBe(0);
      expect(usage.cost).toBe(0);
      expect(usage.limitReached).toBe(false);
    });

    it('calculates cost based on character usage', async () => {
      mockStorage['google_cloud_api_key'] = 'key';
      mockStorage['google_cloud_chars_used'] = 1000000;

      await provider.initialize();
      const usage = await provider.getUsage();

      // $20 per million characters
      expect(usage.tokens).toBe(1000000);
      expect(usage.cost).toBeCloseTo(20);
    });

    it('tracks accumulated usage', async () => {
      await provider.setApiKey('key');

      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { translations: [{ translatedText: 'Test' }] },
          }),
      });

      await provider.translate('Hello', 'en', 'fi');
      await provider.translate('World', 'en', 'fi');

      const usage = await provider.getUsage();
      expect(usage.tokens).toBe(10);
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns extensive language pair combinations', () => {
      const pairs = provider.getSupportedLanguages();

      // Google supports 100+ languages, so many pairs
      expect(pairs.length).toBeGreaterThan(5000);

      for (const pair of pairs) {
        expect(pair.src).not.toBe(pair.tgt);
      }
    });

    it('includes common language pairs', () => {
      const pairs = provider.getSupportedLanguages();

      expect(pairs).toContainEqual({ src: 'en', tgt: 'fi' });
      expect(pairs).toContainEqual({ src: 'fi', tgt: 'en' });
      expect(pairs).toContainEqual({ src: 'en', tgt: 'de' });
      expect(pairs).toContainEqual({ src: 'zh', tgt: 'ja' });
    });
  });

  describe('test', () => {
    it('returns true on successful translation', async () => {
      await provider.setApiKey('AIza-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: { translations: [{ translatedText: 'Hei' }] },
          }),
      });

      const result = await provider.test();
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      await provider.setApiKey('AIza-key');

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.test();
      expect(result).toBe(false);
    });
  });

  describe('getInfo', () => {
    it('includes characters used', async () => {
      mockStorage['google_cloud_api_key'] = 'key';
      mockStorage['google_cloud_chars_used'] = 12345;

      await provider.initialize();

      const info = provider.getInfo();
      expect(info.charactersUsed).toBe(12345);
      expect(info.id).toBe('google-cloud');
    });
  });
});
