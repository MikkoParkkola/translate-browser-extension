/**
 * Google Cloud Provider unit tests
 *
 * Tests for Google Cloud Translation API v2 provider.
 * Note: Actual API calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  installCloudProviderTestHarness,
  okJsonResponse,
} from '../__contract__/cloud-provider-test-harness';
import { GoogleCloudProvider } from './google-cloud';

const {
  mockStorage,
  resetStorage,
  mockFetch,
  queueJsonResponse,
  queueRejectedFetch,
  queueHttpError,
} = installCloudProviderTestHarness();

describe('GoogleCloudProvider', () => {
  let provider: GoogleCloudProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    resetStorage();
    provider = new GoogleCloudProvider();
  });

  describe('translate', () => {
    beforeEach(async () => {
      await provider.setApiKey('AIza-test-key');
    });

    it('throws when API key not configured', async () => {
      const noKeyProvider = new GoogleCloudProvider();
      await expect(
        noKeyProvider.translate('Hello', 'en', 'fi'),
      ).rejects.toThrow();
    });

    it('sends correct request for single text', async () => {
      queueJsonResponse({
        data: {
          translations: [
            { translatedText: 'Hei', detectedSourceLanguage: 'en' },
          ],
        },
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
      queueJsonResponse({
        data: {
          translations: [
            { translatedText: 'Hei' },
            { translatedText: 'Maailma' },
          ],
        },
      });

      const result = await provider.translate(['Hello', 'World'], 'en', 'fi');

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual(['Hei', 'Maailma']);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.q).toEqual(['Hello', 'World']);
    });

    it('omits source for auto-detect', async () => {
      queueJsonResponse({
        data: {
          translations: [
            { translatedText: 'Hei', detectedSourceLanguage: 'en' },
          ],
        },
      });

      await provider.translate('Hello', 'auto', 'fi');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.source).toBeUndefined();
    });

    it('handles API errors', async () => {
      queueHttpError(403, 'API key invalid');

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('tracks character usage', async () => {
      queueJsonResponse({
        data: {
          translations: [{ translatedText: 'Hei' }],
        },
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

      queueJsonResponse({
        data: {
          detections: [[{ language: 'fi', confidence: 0.98 }]],
        },
      });

      const result = await provider.detectLanguage('Hei maailma');
      expect(result).toBe('fi');
    });

    it('uses correct detection endpoint', async () => {
      await provider.setApiKey('AIza-key');

      queueJsonResponse({
        data: {
          detections: [[{ language: 'en', confidence: 0.99 }]],
        },
      });

      await provider.detectLanguage('Hello');

      const url = mockFetch.mock.calls[0][0];
      expect(url).toContain('/detect');
    });

    it('uses only first 200 chars for detection', async () => {
      await provider.setApiKey('AIza-key');

      queueJsonResponse({
        data: {
          detections: [[{ language: 'en', confidence: 0.9 }]],
        },
      });

      await provider.detectLanguage('x'.repeat(500));

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.q.length).toBe(200);
    });

    it('returns auto on API error', async () => {
      await provider.setApiKey('AIza-key');

      queueHttpError(500);

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

      mockFetch.mockResolvedValue(
        okJsonResponse({
          data: { translations: [{ translatedText: 'Test' }] },
        }),
      );

      await provider.translate('Hello', 'en', 'fi');
      await provider.translate('World', 'en', 'fi');

      const usage = await provider.getUsage();
      expect(usage.tokens).toBe(10);
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns extensive language pair combinations', () => {
      const pairs = provider.getSupportedLanguages();

      // Uses centralized language map (~35 languages = ~1190 pairs)
      expect(pairs.length).toBeGreaterThan(500);

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

      queueJsonResponse({
        data: { translations: [{ translatedText: 'Hei' }] },
      });

      const result = await provider.test();
      expect(result).toBe(true);
    });

    it('returns false on error', async () => {
      await provider.setApiKey('AIza-key');

      queueRejectedFetch(new Error('Network error'));

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

  describe('initialize error', () => {
    it('does not crash when chrome.storage.local.get throws', async () => {
      const originalGet = chrome.storage.local.get;
      (
        chrome.storage.local.get as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error('Storage error'));

      await expect(provider.initialize()).resolves.not.toThrow();

      // Restore so subsequent tests work
      chrome.storage.local.get = originalGet;
    });
  });

  describe('detectLanguage network error', () => {
    it('returns auto when fetch throws during detectLanguage', async () => {
      await provider.setApiKey('test-key');

      queueRejectedFetch(new Error('Network error'));

      const result = await provider.detectLanguage('Bonjour');
      expect(result).toBe('auto');
    });
  });

  describe('initialize with missing chars_used', () => {
    it('defaults charactersUsed to 0 when google_cloud_chars_used is undefined', async () => {
      // Only set api key, omit chars_used to exercise nullish coalescing
      (
        chrome.storage.local.get as ReturnType<typeof vi.fn>
      ).mockResolvedValueOnce({
        google_cloud_api_key: 'test-key',
        // google_cloud_chars_used is deliberately omitted → ?? 0
      });

      const freshProvider = new GoogleCloudProvider();
      await freshProvider.initialize();

      const info = freshProvider.getInfo();
      expect(info.charactersUsed).toBe(0);
    });
  });

  describe('detectLanguage with falsy detection result', () => {
    it('returns auto when API returns empty detection', async () => {
      await provider.setApiKey('test-key');

      // Simulate response.ok=true but detection is empty/null
      queueJsonResponse({
        data: { detections: [[{ language: '' }]] },
      });

      const result = await provider.detectLanguage('Some text here');
      expect(result).toBe('auto');
    });

    it('returns auto when API returns null detection', async () => {
      await provider.setApiKey('test-key');

      queueJsonResponse({
        data: { detections: [[{ language: null }]] },
      });

      const result = await provider.detectLanguage('Some text here');
      expect(result).toBe('auto');
    });
  });

  describe('setTemperature and setApiKey edge cases', () => {
    it('setApiKey creates config when config is null', async () => {
      const newProvider = new GoogleCloudProvider();
      // Ensure config is null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (newProvider as any).config = null;

      await newProvider.setApiKey('new-key-123');

      expect(await newProvider.isAvailable()).toBe(true);
      const info = newProvider.getInfo();
      expect(info.id).toBe('google-cloud');
    });

    it('persistChar usage failure does not crash translate', async () => {
      await provider.setApiKey('AIza-test-key');
      // @ts-expect-error unused side-effect
      const _consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Make storage.set fail
      (
        chrome.storage.local.set as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error('Storage failed'));

      queueJsonResponse({
        data: {
          translations: [{ translatedText: 'Hei' }],
        },
      });

      // Should still succeed despite storage error
      const result = await provider.translate('Hello', 'en', 'fi');
      expect(result).toBe('Hei');
    });
  });

  describe('error handling in translate', () => {
    it('handles malformed response json gracefully', async () => {
      await provider.setApiKey('key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });

    it('handles response.text() error when response is not ok', async () => {
      await provider.setApiKey('key');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.reject(new Error('Cannot read text')),
        headers: { get: () => null },
      });

      await expect(provider.translate('Hello', 'en', 'fi')).rejects.toThrow();
    });
  });

  describe('detectLanguage edge cases', () => {
    it('handles missing language in detection response', async () => {
      await provider.setApiKey('key');

      queueJsonResponse({
        data: {
          detections: [[]], // Empty detection array
        },
      });

      const result = await provider.detectLanguage('text');
      expect(result).toBe('auto');
    });

    it('handles response.ok=false during detectLanguage silently', async () => {
      await provider.setApiKey('key');

      queueHttpError(429);

      const result = await provider.detectLanguage('text');
      expect(result).toBe('auto');
    });
  });

  describe('initialize and isAvailable interaction', () => {
    it('isAvailable calls initialize when config is null', async () => {
      const freshProvider = new GoogleCloudProvider();
      mockStorage['google_cloud_api_key'] = 'fresh-key';

      const result = await freshProvider.isAvailable();
      // Should return true because initialize loads it from storage
      expect(result).toBe(true);
    });

    it('clearApiKey fully resets provider state', async () => {
      mockStorage['google_cloud_api_key'] = 'key';
      mockStorage['google_cloud_chars_used'] = 5000;

      await provider.setApiKey('key');
      await provider.clearApiKey();

      const info = provider.getInfo();
      expect(info.charactersUsed).toBe(0);
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('getSupportedLanguages coverage', () => {
    it('returns non-reflexive pairs only', () => {
      const pairs = provider.getSupportedLanguages();

      // Verify no src === tgt
      for (const pair of pairs) {
        expect(pair.src).not.toBe(pair.tgt);
      }
    });

    it('supports translation from each language to many others', () => {
      const pairs = provider.getSupportedLanguages();
      const pairsFromEn = pairs.filter((p) => p.src === 'en');

      // English should support translations to multiple targets
      expect(pairsFromEn.length).toBeGreaterThan(5);
    });
  });
});
