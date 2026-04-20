/**
 * Chrome Translator Provider Tests
 *
 * Tests the Chrome 138+ built-in Translator API integration.
 * Mocks the global Translator and LanguageDetector APIs (on globalThis/self).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ChromeTranslatorProvider,
  getChromeTranslator,
  isChromeTranslatorAvailable,
} from './chrome-translator';

// Mock Translator API
const mockTranslate = vi.fn();
const mockTranslateStreaming = vi.fn();
const mockDestroy = vi.fn();
const mockDetect = vi.fn();

const mockTranslatorInstance = {
  translate: mockTranslate,
  translateStreaming: undefined as
    | undefined
    | ((text: string) => {
        getReader: () => {
          read: () => Promise<{ done: boolean; value?: string }>;
          releaseLock: () => void;
        };
      }),
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
    mockTranslateStreaming.mockReset();
    mockTranslatorInstance.translateStreaming = undefined;
    mockDetect.mockResolvedValue([
      { detectedLanguage: 'en', confidence: 0.95 },
    ]);
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
      mockTranslatorAPI.availability.mockResolvedValueOnce({
        available: 'readily',
      }); // Initial check
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

      const result = await provider.translate(
        ['Hello', '', 'World'],
        'en',
        'de',
      );

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
      mockDetect.mockResolvedValue([
        { detectedLanguage: 'fr', confidence: 0.9 },
      ]);

      await provider.translate('Bonjour', 'auto', 'en');

      expect(mockDetect).toHaveBeenCalledWith('Bonjour');
      expect(mockTranslatorAPI.create).toHaveBeenCalledWith({
        sourceLanguage: 'fr',
        targetLanguage: 'en',
      });
    });

    it('throws when API not available', async () => {
      vi.unstubAllGlobals(); // Remove Translator global
      const unavailableProvider = new ChromeTranslatorProvider();

      await expect(
        unavailableProvider.translate('Hello', 'en', 'de'),
      ).rejects.toThrow('Chrome Translator API not available');
    });

    it('throws when language pair not supported', async () => {
      mockTranslatorAPI.availability
        .mockResolvedValueOnce({ available: 'readily' }) // Initial check
        .mockResolvedValueOnce({ available: 'no' }); // Pair check

      await expect(provider.translate('Hello', 'xx', 'yy')).rejects.toThrow(
        'Language pair not supported: xx-yy',
      );
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
      mockDetect.mockResolvedValue([
        { detectedLanguage: 'es', confidence: 0.85 },
      ]);

      const result = await provider.detectLanguage('Hola mundo');

      expect(result).toBe('es');
    });

    it('returns "en" when confidence is low', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      vi.stubGlobal('LanguageDetector', mockDetectorAPI);
      mockDetect.mockResolvedValue([
        { detectedLanguage: 'es', confidence: 0.5 },
      ]);

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
      mockTranslatorAPI.availability.mockResolvedValue({
        available: 'readily',
      });

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

      const status = await unavailableProvider.getAvailabilityStatus(
        'en',
        'de',
      );

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

      expect(mockTranslatorAPI.availability).toHaveBeenCalledWith({
        sourceLanguage: 'en',
        targetLanguage: 'de',
      });
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

// ============================================================================
// Additional coverage tests
// ============================================================================

describe('ChromeTranslatorProvider additional coverage', () => {
  let provider: ChromeTranslatorProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTranslate.mockResolvedValue('translated text');
    mockTranslateStreaming.mockReset();
    mockTranslatorInstance.translateStreaming = undefined;
    mockDetect.mockResolvedValue([
      { detectedLanguage: 'en', confidence: 0.95 },
    ]);
    mockTranslatorAPI.availability.mockResolvedValue({ available: 'readily' });
    mockTranslatorAPI.create.mockResolvedValue(mockTranslatorInstance);
    mockDetectorAPI.availability.mockResolvedValue({ available: 'readily' });
    mockDetectorAPI.create.mockResolvedValue(mockDetectorInstance);
    provider = new ChromeTranslatorProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    provider.destroy();
  });

  describe('isAvailable', () => {
    it('returns false when availability throws', async () => {
      mockTranslatorAPI.availability.mockRejectedValue(new Error('API error'));
      vi.stubGlobal('Translator', mockTranslatorAPI);

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getSupportedLanguages', () => {
    it('returns an array of language pairs', () => {
      const pairs = provider.getSupportedLanguages();
      expect(Array.isArray(pairs)).toBe(true);
      expect(pairs.length).toBeGreaterThan(0);
      expect(pairs[0]).toHaveProperty('src');
      expect(pairs[0]).toHaveProperty('tgt');
    });

    it('does not include pairs where src equals tgt', () => {
      const pairs = provider.getSupportedLanguages();
      const selfPairs = pairs.filter((p) => p.src === p.tgt);
      expect(selfPairs.length).toBe(0);
    });
  });

  describe('getSupportedLanguagesAsync', () => {
    it('returns empty array when API unavailable', async () => {
      // No Translator global
      const result = await provider.getSupportedLanguagesAsync();
      expect(result).toEqual([]);
    });

    it('returns supported languages when API available', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      // availability: 'readily' for all pairs (default mock)

      const result = await provider.getSupportedLanguagesAsync();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      // 'en' is always included
      expect(result).toContain('en');
    });

    it('handles availability errors silently during language probe', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);

      // First call (isAvailable check) succeeds
      // Subsequent calls for probing each language throw
      mockTranslatorAPI.availability
        .mockResolvedValueOnce({ available: 'readily' }) // isAvailable check
        .mockRejectedValue(new Error('probe error')); // all probe calls throw

      const result = await provider.getSupportedLanguagesAsync();

      // Should still return 'en' (which is hardcoded as supported)
      expect(result).toContain('en');
      // Other languages are silently skipped when they throw
    });
  });

  describe('isPairSupported', () => {
    it('returns false when isAvailable is false', async () => {
      // No Translator global
      const result = await provider.isPairSupported('en', 'de');
      expect(result).toBe(false);
    });

    it('returns cached result on second call', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);

      await provider.isPairSupported('en', 'fr');
      const callsBefore = mockTranslatorAPI.availability.mock.calls.length;

      await provider.isPairSupported('en', 'fr');
      // No additional calls for the pair (cached)
      expect(mockTranslatorAPI.availability.mock.calls.length).toBe(
        callsBefore,
      );
    });

    it('handles availability API throwing for pair check', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);

      // First call for isAvailable succeeds
      mockTranslatorAPI.availability
        .mockResolvedValueOnce({ available: 'readily' }) // initial isAvailable
        .mockRejectedValueOnce(new Error('pair check failed')); // pair check

      const result = await provider.isPairSupported('en', 'zh');

      expect(result).toBe(false);
    });
  });

  describe('getAvailabilityStatus', () => {
    it('returns cached status on second call for same pair', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);

      await provider.getAvailabilityStatus('en', 'fr');
      const callsBefore = mockTranslatorAPI.availability.mock.calls.length;

      await provider.getAvailabilityStatus('en', 'fr');
      // No new calls — cached
      expect(mockTranslatorAPI.availability.mock.calls.length).toBe(
        callsBefore,
      );
    });

    it('returns "no" when availability API throws for pair check', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);

      mockTranslatorAPI.availability
        .mockResolvedValueOnce({ available: 'readily' }) // initial isAvailable
        .mockRejectedValueOnce(new Error('error')); // pair check

      const status = await provider.getAvailabilityStatus('xx', 'yy');

      expect(status).toBe('no');
    });
  });

  describe('detectLanguage', () => {
    it('reuses existing detector instance', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      vi.stubGlobal('LanguageDetector', mockDetectorAPI);

      await provider.detectLanguage('hello');
      await provider.detectLanguage('world');

      // create should only be called once (reuses detector)
      expect(mockDetectorAPI.create).toHaveBeenCalledTimes(1);
    });

    it('returns "en" when detection result is empty', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      vi.stubGlobal('LanguageDetector', mockDetectorAPI);
      mockDetect.mockResolvedValue([]); // empty results

      const result = await provider.detectLanguage('hello');

      expect(result).toBe('en');
    });

    it('returns "en" when detector.detect throws', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      vi.stubGlobal('LanguageDetector', mockDetectorAPI);
      mockDetect.mockRejectedValue(new Error('detection failed'));

      const result = await provider.detectLanguage('hello');

      expect(result).toBe('en');
    });
  });

  describe('translate', () => {
    it('handles whitespace-only text in array by preserving it', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);

      const result = await provider.translate(
        ['hello', '   ', 'world'],
        'en',
        'de',
      );

      expect(result).toHaveLength(3);
      expect((result as string[])[1]).toBe('   '); // whitespace preserved
    });

    it('uses streaming translation for long text and releases the reader lock', async () => {
      vi.stubGlobal('Translator', mockTranslatorAPI);

      const releaseLock = vi.fn();
      const read = vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: 'Hallo ' })
        .mockResolvedValueOnce({ done: false, value: 'Welt' })
        .mockResolvedValueOnce({ done: true, value: undefined });
      mockTranslatorInstance.translateStreaming =
        mockTranslateStreaming.mockReturnValue({
          getReader: () => ({ read, releaseLock }),
        });

      const result = await provider.translate('x'.repeat(250), 'en', 'de');

      expect(result).toBe('Hallo Welt');
      expect(mockTranslateStreaming).toHaveBeenCalledTimes(1);
      expect(mockTranslate).not.toHaveBeenCalled();
      expect(releaseLock).toHaveBeenCalledTimes(1);
    });
  });

  describe('translateStreaming', () => {
    beforeEach(() => {
      vi.stubGlobal('Translator', mockTranslatorAPI);
      vi.stubGlobal('LanguageDetector', mockDetectorAPI);
    });

    it('throws when the Chrome Translator API is unavailable', async () => {
      vi.unstubAllGlobals();
      const unavailableProvider = new ChromeTranslatorProvider();

      await expect(
        unavailableProvider.translateStreaming('Hello', 'en', 'de', vi.fn()),
      ).rejects.toThrow('Chrome Translator API not available');
    });

    it('falls back to regular translation when streaming is unavailable', async () => {
      mockDetect.mockResolvedValue([
        { detectedLanguage: 'fr', confidence: 0.91 },
      ]);
      mockTranslate.mockResolvedValue('Hello from fallback');
      const onChunk = vi.fn();

      const result = await provider.translateStreaming(
        'Bonjour',
        'auto',
        'en',
        onChunk,
      );

      expect(result).toBe('Hello from fallback');
      expect(mockDetect).toHaveBeenCalledWith('Bonjour');
      expect(mockTranslatorAPI.create).toHaveBeenCalledWith({
        sourceLanguage: 'fr',
        targetLanguage: 'en',
      });
      expect(onChunk).toHaveBeenCalledWith('Hello from fallback');
    });

    it('streams partial results and releases the reader lock', async () => {
      const onChunk = vi.fn();
      const releaseLock = vi.fn();
      const read = vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: 'Hal' })
        .mockResolvedValueOnce({ done: false, value: 'lo' })
        .mockResolvedValueOnce({ done: true, value: undefined });
      mockTranslatorInstance.translateStreaming =
        mockTranslateStreaming.mockReturnValue({
          getReader: () => ({ read, releaseLock }),
        });

      const result = await provider.translateStreaming(
        'Hello',
        'en',
        'de',
        onChunk,
      );

      expect(result).toBe('Hallo');
      expect(onChunk.mock.calls).toEqual([['Hal'], ['Hallo']]);
      expect(releaseLock).toHaveBeenCalledTimes(1);
    });
  });
});
