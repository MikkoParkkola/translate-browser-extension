/**
 * Chrome Built-in Translator API Provider
 *
 * Uses Chrome 138+ built-in translation via Translator and LanguageDetector APIs.
 * Falls back gracefully when API is unavailable (older Chrome, Firefox, etc.)
 *
 * Benefits:
 * - No model download required (Chrome pre-loads)
 * - Zero cold start for available languages
 * - Privacy-preserving (on-device, no cloud)
 * - Maintained by Google (quality updates)
 *
 * Limitations:
 * - Chrome 138+ only (shipping ~May 2025)
 * - Limited language pairs initially
 * - No custom glossary support
 * - Sequential processing (no batch optimization)
 *
 * @see https://developer.chrome.com/docs/ai/translator-api
 */

import { BaseProvider } from './base-provider';
import type { TranslationProviderId, ProviderConfig, LanguagePair } from '../types';
import { createLogger } from '../core/logger';

const log = createLogger('ChromeTranslator');

/**
 * Chrome AI Translator API types (Chrome 138+)
 * These are not yet in TypeScript lib definitions
 */
interface TranslatorOptions {
  sourceLanguage: string;
  targetLanguage: string;
}

interface TranslatorAvailability {
  available: 'no' | 'after-download' | 'readily';
}

interface ChromeTranslator {
  translate(text: string): Promise<string>;
  translateStreaming?(text: string): ReadableStream<string>;
  destroy(): void;
}

interface TranslatorAPI {
  availability(options: TranslatorOptions): Promise<TranslatorAvailability>;
  create(options: TranslatorOptions): Promise<ChromeTranslator>;
}

interface LanguageDetectorResult {
  detectedLanguage: string;
  confidence: number;
}

interface LanguageDetector {
  detect(text: string): Promise<LanguageDetectorResult[]>;
  destroy(): void;
}

interface LanguageDetectorAPI {
  availability(): Promise<TranslatorAvailability>;
  create(): Promise<LanguageDetector>;
}

// Extend global window type for Chrome AI APIs
declare global {
  interface Window {
    Translator?: TranslatorAPI;
    LanguageDetector?: LanguageDetectorAPI;
  }
}

/**
 * Chrome Built-in Translator Provider
 *
 * Strategic positioning: Become the orchestration layer on top of Chrome's
 * built-in translation rather than competing with it.
 *
 * Our advantages over raw Chrome API:
 * - Batch processing (Chrome API is sequential)
 * - Streaming UI (Chrome API doesn't expose streaming to extensions)
 * - Offline guarantee (we provide full offline, Chrome is "mostly offline")
 * - Custom glossary support
 * - Works in iframes, workers, etc. where Chrome API doesn't
 */
export class ChromeTranslatorProvider extends BaseProvider {
  readonly id: TranslationProviderId = 'chrome-builtin';
  readonly name = 'Chrome Built-in';
  readonly isLocal = true;
  readonly cost = 0; // Free, on-device

  private translator: ChromeTranslator | null = null;
  private detector: LanguageDetector | null = null;
  private currentPair: { source: string; target: string } | null = null;

  // Cache availability check results (API won't change during session)
  private availabilityCache = new Map<string, TranslatorAvailability>();
  private apiAvailable: boolean | null = null;

  constructor(config: Partial<ProviderConfig> = {}) {
    super(config);
  }

  /**
   * Check if Chrome Translator API is available in this browser.
   */
  async isAvailable(): Promise<boolean> {
    if (this.apiAvailable !== null) {
      return this.apiAvailable;
    }

    // Check for Chrome AI APIs
    if (typeof window === 'undefined') {
      // Running in service worker - check via chrome.* APIs
      this.apiAvailable = false;
      return false;
    }

    // Check for Translator API (Chrome 138+)
    if (!window.Translator) {
      log.info('Chrome Translator API not available (Chrome 138+ required)');
      this.apiAvailable = false;
      return false;
    }

    // API exists - check if it's actually usable
    try {
      const testAvail = await window.Translator.availability({
        sourceLanguage: 'en',
        targetLanguage: 'es',
      });
      this.apiAvailable = testAvail.available !== 'no';
      log.info(`Chrome Translator API: ${testAvail.available}`);
      return this.apiAvailable;
    } catch (error) {
      log.warn('Chrome Translator API check failed:', error);
      this.apiAvailable = false;
      return false;
    }
  }

  /**
   * Check if a specific language pair is supported.
   */
  async isPairSupported(sourceLang: string, targetLang: string): Promise<boolean> {
    if (!(await this.isAvailable())) {
      return false;
    }

    const cacheKey = `${sourceLang}-${targetLang}`;
    if (this.availabilityCache.has(cacheKey)) {
      return this.availabilityCache.get(cacheKey)!.available !== 'no';
    }

    try {
      const availability = await window.Translator!.availability({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
      });
      this.availabilityCache.set(cacheKey, availability);
      return availability.available !== 'no';
    } catch {
      return false;
    }
  }

  /**
   * Get supported languages.
   * Note: Chrome API doesn't expose a static list, so we return common pairs.
   * Use isPairSupported() or getSupportedLanguagesAsync() for runtime checks.
   */
  getSupportedLanguages(): LanguagePair[] {
    // Return common pairs that Chrome typically supports
    // Actual availability is checked via isPairSupported()
    const commonLangs = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'zh', 'ja', 'ko'];
    const pairs: LanguagePair[] = [];

    for (const src of commonLangs) {
      for (const tgt of commonLangs) {
        if (src !== tgt) {
          pairs.push({ src, tgt });
        }
      }
    }

    return pairs;
  }

  /**
   * Async version to probe actual Chrome API availability.
   */
  async getSupportedLanguagesAsync(): Promise<string[]> {
    if (!(await this.isAvailable())) {
      return [];
    }

    // Common languages to probe
    const probeLangs = [
      'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'zh', 'ja', 'ko',
      'ar', 'hi', 'vi', 'th', 'id', 'pl', 'tr', 'uk', 'cs', 'ro', 'hu',
    ];

    const supported: string[] = [];

    // Check which languages can translate to English (common test)
    for (const lang of probeLangs) {
      if (lang === 'en') {
        supported.push(lang);
        continue;
      }
      try {
        const avail = await window.Translator!.availability({
          sourceLanguage: lang,
          targetLanguage: 'en',
        });
        if (avail.available !== 'no') {
          supported.push(lang);
        }
      } catch {
        // Silently skip unavailable
      }
    }

    return supported;
  }

  /**
   * Translate text using Chrome's built-in Translator API.
   */
  async translate(
    text: string | string[],
    sourceLang: string,
    targetLang: string
  ): Promise<string | string[]> {
    if (!(await this.isAvailable())) {
      throw new Error('Chrome Translator API not available');
    }

    // Handle auto-detection
    let actualSourceLang = sourceLang;
    if (sourceLang === 'auto') {
      actualSourceLang = await this.detectLanguage(
        Array.isArray(text) ? text[0] : text
      );
    }

    // Check pair support
    if (!(await this.isPairSupported(actualSourceLang, targetLang))) {
      throw new Error(
        `Language pair not supported: ${actualSourceLang}-${targetLang}`
      );
    }

    // Create or reuse translator
    if (
      !this.translator ||
      this.currentPair?.source !== actualSourceLang ||
      this.currentPair?.target !== targetLang
    ) {
      // Destroy old translator
      if (this.translator) {
        this.translator.destroy();
      }

      log.info(`Creating translator: ${actualSourceLang} -> ${targetLang}`);
      this.translator = await window.Translator!.create({
        sourceLanguage: actualSourceLang,
        targetLanguage: targetLang,
      });
      this.currentPair = { source: actualSourceLang, target: targetLang };
    }

    // Translate (Chrome API is sequential, so we process one at a time)
    const texts = Array.isArray(text) ? text : [text];
    const results: string[] = [];

    for (const t of texts) {
      if (!t || t.trim().length === 0) {
        results.push(t);
        continue;
      }

      try {
        const translated = await this.translator.translate(t);
        results.push(translated);
      } catch (error) {
        log.error(`Translation failed for text: ${t.substring(0, 50)}...`, error);
        results.push(t); // Return original on error
      }
    }

    return Array.isArray(text) ? results : results[0];
  }

  /**
   * Detect language using Chrome's LanguageDetector API.
   */
  async detectLanguage(text: string): Promise<string> {
    if (!window.LanguageDetector) {
      // Fallback to simple heuristics
      return 'en';
    }

    try {
      if (!this.detector) {
        this.detector = await window.LanguageDetector.create();
      }

      const results = await this.detector.detect(text.substring(0, 500));
      if (results.length > 0 && results[0].confidence > 0.7) {
        return results[0].detectedLanguage;
      }
    } catch (error) {
      log.warn('Language detection failed:', error);
    }

    return 'en'; // Default fallback
  }

  /**
   * Check availability status for a language pair.
   * Returns detailed status (readily, after-download, no).
   */
  async getAvailabilityStatus(
    sourceLang: string,
    targetLang: string
  ): Promise<'readily' | 'after-download' | 'no' | 'unavailable'> {
    if (!(await this.isAvailable())) {
      return 'unavailable';
    }

    const cacheKey = `${sourceLang}-${targetLang}`;
    if (this.availabilityCache.has(cacheKey)) {
      return this.availabilityCache.get(cacheKey)!.available;
    }

    try {
      const availability = await window.Translator!.availability({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
      });
      this.availabilityCache.set(cacheKey, availability);
      return availability.available;
    } catch {
      return 'no';
    }
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    if (this.translator) {
      this.translator.destroy();
      this.translator = null;
    }
    if (this.detector) {
      this.detector.destroy();
      this.detector = null;
    }
    this.currentPair = null;
    this.availabilityCache.clear();
  }
}

// Singleton instance
let chromeTranslatorInstance: ChromeTranslatorProvider | null = null;

/**
 * Get or create the Chrome Translator provider instance.
 */
export function getChromeTranslator(): ChromeTranslatorProvider {
  if (!chromeTranslatorInstance) {
    chromeTranslatorInstance = new ChromeTranslatorProvider();
  }
  return chromeTranslatorInstance;
}

/**
 * Feature detection helper for use in routing logic.
 */
export async function isChromeTranslatorAvailable(): Promise<boolean> {
  return getChromeTranslator().isAvailable();
}
