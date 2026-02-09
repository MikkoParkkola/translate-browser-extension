/**
 * Chrome Translator Provider Tests
 *
 * Tests the Chrome 138+ built-in Translator API integration.
 * Mocks the global Translator and LanguageDetector APIs (on globalThis/self).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ChromeTranslatorProvider, getChromeTranslator, isChromeTranslatorAvailable } from './chrome-translator';

// Mock Translator API
const mockTranslate = vi.fn();
const mockDestroy = vi.fn();
const mockDetect = vi.fn();

const mockTranslatorInstance = {
  translate: mockTranslate,
  destroy: mockDestroy,
};

const mockDetectorInstance = {
  detect: mockDetect,
  destroy: mockDestroy,
};

const mockTranslatorAPI = {
  availability: vi.fn(),
  create: vi.fn(),
};

const mockDetectorAPI = {
  availability: vi.fn(),
  create: vi.fn(),
};

describe('ChromeTranslatorProvider', () => {
  let provider: ChromeTranslatorProvider;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockTranslate.mockResolvedValue('translated text');
    mockDetect.mockResolvedValue([{ detectedLanguage: 'en', confidence: 0.95 }]);
    mockTranslatorAPI.availability.mockResolvedValue({ available: 'readily' });
    mockTranslatorAPI.create.mockResolvedValue(mockTranslatorInstance);
    mockDetectorAPI.availability.mockResolvedValue({ available: 'readily' });
    mockDetectorAPI.create.mockResolvedValue(mockDetectorInstance);

    // Create provider (fresh instance each test)
    provider = new ChromeTranslatorProvider();
  });

  afterEach(() => {
    // Clean up globals
    vi.unstubAllGlobals();
    provider.destroy();
  });

  describe('isAvailable', () => {
    it('returns false when Translator API is not present', async () => {
      // No Translator global = API not available
      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });

    it('returns true when Translator API is available', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);

      const result = await provider.isAvailable();

      expect(result).toBe(true);
      expect(mockTranslatorAPI.availability).toHaveBeenCalledWith({
        sourceLanguage: 'en',
        targetLanguage: 'es',
      });
    });

    it('returns false when availability check returns "no"', async () => {
      mockTranslatorAPI.availability.mockResolvedValue({ available: 'no' });
      vi.stubGlobal('Translator', mockTranslatorAPI);

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });

    it('caches availability result', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);

      await provider.isAvailable();
      await provider.isAvailable();

      // Should only call availability once (cached)
      expect(mockTranslatorAPI.availability).toHaveBeenCalledTimes(1);
    });
  });

  describe('isPairSupported', () => {
    beforeEach(() => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
    });

    it('returns true for supported language pair', async () => {
      const result = await provider.isPairSupported('en', 'de');

      expect(result).toBe(true);
      expect(mockTranslatorAPI.availability).toHaveBeenCalledWith({
        sourceLanguage: 'en',
        targetLanguage: 'de',
      });
    });

    it('returns false for unsupported language pair', async () => {
      mockTranslatorAPI.availability.mockResolvedValueOnce({ available: 'readily' }); // Initial check
      mockTranslatorAPI.availability.mockResolvedValueOnce({ available: 'no' }); // Pair check

      const result = await provider.isPairSupported('xx', 'yy');

      expect(result).toBe(false);
    });

    it('caches pair availability results', async () => {
      await provider.isPairSupported('en', 'fr');
      await provider.isPairSupported('en', 'fr');

      // availability called for: initial check + pair check = 2 total
      // But pair check should be cached on second call
      expect(mockTranslatorAPI.availability).toHaveBeenCalledTimes(2);
    });
  });

  describe('translate', () => {
    beforeEach(() => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      vi.stubGlobal('LanguageDetector', mockDetectorAPI);
    });

    it('translates single text', async () => {
      mockTranslate.mockResolvedValue('Hallo Welt');

      const result = await provider.translate('Hello World', 'en', 'de');

      expect(result).toBe('Hallo Welt');
    });

    it('translates array of texts', async () => {
      mockTranslate
        .mockResolvedValueOnce('Hallo')
        .mockResolvedValueOnce('Welt');

      const result = await provider.translate(['Hello', 'World'], 'en', 'de');

      expect(result).toEqual(['Hallo', 'Welt']);
      expect(mockTranslate).toHaveBeenCalledTimes(2);
    });

    it('preserves empty strings in array', async () => {
      mockTranslate.mockResolvedValue('Hallo');

      const result = await provider.translate(['Hello', '', 'World'], 'en', 'de');

      expect(result).toEqual(['Hallo', '', 'Hallo']);
    });

    it('reuses translator for same language pair', async () => {
      await provider.translate('Hello', 'en', 'de');
      await provider.translate('World', 'en', 'de');

      // create should only be called once
      expect(mockTranslatorAPI.create).toHaveBeenCalledTimes(1);
    });

    it('creates new translator for different language pair', async () => {
      await provider.translate('Hello', 'en', 'de');
      await provider.translate('Bonjour', 'fr', 'en');

      expect(mockTranslatorAPI.create).toHaveBeenCalledTimes(2);
      expect(mockDestroy).toHaveBeenCalledTimes(1); // Old translator destroyed
    });

    it('handles auto language detection', async () => {
      mockDetect.mockResolvedValue([{ detectedLanguage: 'fr', confidence: 0.9 }]);

      await provider.translate('Bonjour', 'auto', 'en');

      expect(mockDetect).toHaveBeenCalled();
      expect(mockTranslatorAPI.create).toHaveBeenCalledWith({
        sourceLanguage: 'fr',
        targetLanguage: 'en',
      });
    });

    it('throws when API not available', async () => {
      vi.unstubAllGlobals(); // Remove Translator global
      const unavailableProvider = new ChromeTranslatorProvider();

      await expect(
        unavailableProvider.translate('Hello', 'en', 'de')
      ).rejects.toThrow('Chrome Translator API not available');
    });

    it('throws when language pair not supported', async () => {
      mockTranslatorAPI.availability
        .mockResolvedValueOnce({ available: 'readily' }) // Initial check
        .mockResolvedValueOnce({ available: 'no' }); // Pair check

      await expect(
        provider.translate('Hello', 'xx', 'yy')
      ).rejects.toThrow('Language pair not supported: xx-yy');
    });

    it('returns original text on translation error', async () => {
      mockTranslate.mockRejectedValueOnce(new Error('Network error'));
      mockTranslate.mockResolvedValueOnce('Welt');

      const result = await provider.translate(['Hello', 'World'], 'en', 'de');

      // First translation failed, second succeeded
      expect(result).toEqual(['Hello', 'Welt']);
    });
  });

  describe('detectLanguage', () => {
    it('detects language using LanguageDetector API', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      vi.stubGlobal('LanguageDetector', mockDetectorAPI);
      mockDetect.mockResolvedValue([{ detectedLanguage: 'es', confidence: 0.85 }]);

      const result = await provider.detectLanguage('Hola mundo');

      expect(result).toBe('es');
    });

    it('returns "en" when confidence is low', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      vi.stubGlobal('LanguageDetector', mockDetectorAPI);
      mockDetect.mockResolvedValue([{ detectedLanguage: 'es', confidence: 0.5 }]);

      const result = await provider.detectLanguage('Hola');

      expect(result).toBe('en'); // Default fallback
    });

    it('returns "en" when LanguageDetector not available', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      // No LanguageDetector global

      const result = await provider.detectLanguage('Hola mundo');

      expect(result).toBe('en');
    });
  });

  describe('getAvailabilityStatus', () => {
    beforeEach(() => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
    });

    it('returns "readily" for immediately available pairs', async () => {
      mockTranslatorAPI.availability.mockResolvedValue({ available: 'readily' });

      const status = await provider.getAvailabilityStatus('en', 'es');

      expect(status).toBe('readily');
    });

    it('returns "after-download" for downloadable pairs', async () => {
      mockTranslatorAPI.availability
        .mockResolvedValueOnce({ available: 'readily' }) // Initial check
        .mockResolvedValueOnce({ available: 'after-download' }); // Pair check

      const status = await provider.getAvailabilityStatus('en', 'zh');

      expect(status).toBe('after-download');
    });

    it('returns "no" for unsupported pairs', async () => {
      mockTranslatorAPI.availability
        .mockResolvedValueOnce({ available: 'readily' }) // Initial check
        .mockResolvedValueOnce({ available: 'no' }); // Pair check

      const status = await provider.getAvailabilityStatus('xx', 'yy');

      expect(status).toBe('no');
    });

    it('returns "unavailable" when API not present', async () => {
      vi.unstubAllGlobals(); // Remove Translator global
      const unavailableProvider = new ChromeTranslatorProvider();

      const status = await unavailableProvider.getAvailabilityStatus('en', 'de');

      expect(status).toBe('unavailable');
    });
  });

  describe('destroy', () => {
    beforeEach(() => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      vi.stubGlobal('LanguageDetector', mockDetectorAPI);
    });

    it('destroys translator and detector', async () => {
      // Create translator and detector by using them
      await provider.translate('Hello', 'en', 'de');
      await provider.detectLanguage('Hello');

      provider.destroy();

      // Both should be destroyed
      expect(mockDestroy).toHaveBeenCalledTimes(2);
    });

    it('clears availability cache', async () => {
      await provider.isPairSupported('en', 'de');
      provider.destroy();

      // After destroy, cache should be cleared
      // Next call should hit the API again
      mockTranslatorAPI.availability.mockClear();
      await provider.isPairSupported('en', 'de');

      expect(mockTranslatorAPI.availability).toHaveBeenCalled();
    });
  });
});

describe('Helper functions', () => {
  describe('getChromeTranslator', () => {
    it('returns singleton instance', () => {
      const instance1 = getChromeTranslator();
      const instance2 = getChromeTranslator();

      expect(instance1).toBe(instance2);
    });
  });

  describe('isChromeTranslatorAvailable', () => {
    it('returns availability status', async () => {
      // No Translator global = not available
      const result = await isChromeTranslatorAvailable();

      expect(typeof result).toBe('boolean');
    });
  });
});
