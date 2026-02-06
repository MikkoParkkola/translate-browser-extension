/**
 * Google Cloud Translation Provider
 * Uses Cloud Translation API v2 (Basic)
 * https://cloud.google.com/translate/docs/reference/rest/v2/translate
 */

import { BaseProvider } from './base-provider';
import { createTranslationError } from '../core/errors';
import { handleProviderHttpError } from '../core/http-errors';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';

const GOOGLE_TRANSLATE_API = 'https://translation.googleapis.com/language/translate/v2';

// Supported languages for Google Cloud Translation v2
const SUPPORTED_LANGUAGES = [
  'af', 'sq', 'am', 'ar', 'hy', 'az', 'eu', 'be', 'bn', 'bs',
  'bg', 'ca', 'ceb', 'zh', 'co', 'hr', 'cs', 'da', 'nl', 'en',
  'eo', 'et', 'fi', 'fr', 'fy', 'gl', 'ka', 'de', 'el', 'gu',
  'ht', 'ha', 'haw', 'he', 'hi', 'hmn', 'hu', 'is', 'ig', 'id',
  'ga', 'it', 'ja', 'jv', 'kn', 'kk', 'km', 'rw', 'ko', 'ku',
  'ky', 'lo', 'la', 'lv', 'lt', 'lb', 'mk', 'mg', 'ms', 'ml',
  'mt', 'mi', 'mr', 'mn', 'my', 'ne', 'no', 'ny', 'or', 'ps',
  'fa', 'pl', 'pt', 'pa', 'ro', 'ru', 'sm', 'gd', 'sr', 'st',
  'sn', 'sd', 'si', 'sk', 'sl', 'so', 'es', 'su', 'sw', 'sv',
  'tl', 'tg', 'ta', 'tt', 'te', 'th', 'tr', 'tk', 'uk', 'ur',
  'ug', 'uz', 'vi', 'cy', 'xh', 'yi', 'yo', 'zu',
];

export interface GoogleCloudConfig {
  apiKey: string;
}

interface GoogleTranslateResponse {
  data: {
    translations: Array<{
      translatedText: string;
      detectedSourceLanguage?: string;
    }>;
  };
}

interface GoogleDetectResponse {
  data: {
    detections: Array<Array<{
      language: string;
      confidence: number;
    }>>;
  };
}

export class GoogleCloudProvider extends BaseProvider {
  private config: GoogleCloudConfig | null = null;
  private charactersUsed = 0;

  constructor() {
    super({
      id: 'google-cloud',
      name: 'Google Cloud Translation',
      type: 'cloud',
      qualityTier: 'standard',
      costPerMillion: 20, // $20 per million characters
      icon: '',
    });
  }

  /**
   * Initialize the provider by loading API key from storage
   */
  async initialize(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(['google_cloud_api_key', 'google_cloud_chars_used']);
      if (stored.google_cloud_api_key) {
        this.config = {
          apiKey: stored.google_cloud_api_key,
        };
        this.charactersUsed = stored.google_cloud_chars_used ?? 0;
        console.log('[GoogleCloud] Initialized');
      }
    } catch (error) {
      console.error('[GoogleCloud] Failed to load config:', error);
    }
  }

  /**
   * Store API key in chrome.storage
   */
  async setApiKey(apiKey: string): Promise<void> {
    await chrome.storage.local.set({ google_cloud_api_key: apiKey });
    this.config = { apiKey };
  }

  /**
   * Remove API key
   */
  async clearApiKey(): Promise<void> {
    await chrome.storage.local.remove(['google_cloud_api_key', 'google_cloud_chars_used']);
    this.config = null;
    this.charactersUsed = 0;
  }

  /**
   * Translate text using Google Cloud Translation API v2
   */
  async translate(
    text: string | string[],
    sourceLang: string,
    targetLang: string,
    _options?: TranslationOptions
  ): Promise<string | string[]> {
    if (!this.config?.apiKey) {
      throw createTranslationError(new Error('Google Cloud API key not configured'));
    }

    const isArray = Array.isArray(text);
    const texts = isArray ? text : [text];

    // Build request URL with API key
    const url = new URL(GOOGLE_TRANSLATE_API);
    url.searchParams.set('key', this.config.apiKey);

    // Build request body
    const body: Record<string, unknown> = {
      q: texts,
      target: targetLang,
      format: 'text',
    };

    // Add source language if not auto-detect
    if (sourceLang !== 'auto') {
      body.source = sourceLang;
    }

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const httpError = handleProviderHttpError(
          response.status,
          'Google Cloud',
          errorText,
          response.headers.get('Retry-After')
        );
        throw new Error(httpError.message);
      }

      const data: GoogleTranslateResponse = await response.json();

      // Track character usage
      const charsUsed = texts.reduce((sum, t) => sum + t.length, 0);
      this.charactersUsed += charsUsed;
      chrome.storage.local.set({ google_cloud_chars_used: this.charactersUsed }).catch(() => {});

      const results = data.data.translations.map(t => t.translatedText);
      return isArray ? results : results[0];
    } catch (error) {
      console.error('[GoogleCloud] Translation error:', error);
      throw createTranslationError(error);
    }
  }

  /**
   * Detect language using Google Cloud Translation API
   */
  async detectLanguage(text: string): Promise<string> {
    if (!this.config?.apiKey) {
      return 'auto';
    }

    const url = new URL(`${GOOGLE_TRANSLATE_API}/detect`);
    url.searchParams.set('key', this.config.apiKey);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: text.slice(0, 200), // Use small sample
        }),
      });

      if (response.ok) {
        const data: GoogleDetectResponse = await response.json();
        const detected = data.data.detections[0]?.[0]?.language;
        if (detected) {
          return detected;
        }
      }
    } catch (error) {
      console.error('[GoogleCloud] Language detection error:', error);
    }

    return 'auto';
  }

  /**
   * Check if provider is available (has API key)
   */
  async isAvailable(): Promise<boolean> {
    if (!this.config) {
      await this.initialize();
    }
    return !!this.config?.apiKey;
  }

  /**
   * Get usage statistics
   */
  async getUsage(): Promise<{
    requests: number;
    tokens: number;
    cost: number;
    limitReached: boolean;
  }> {
    const cost = (this.charactersUsed / 1000000) * this.costPerMillion;

    return {
      requests: 0,
      tokens: this.charactersUsed,
      cost,
      limitReached: false,
    };
  }

  /**
   * Get supported language pairs
   * Google Cloud supports translation between most language pairs
   */
  getSupportedLanguages(): LanguagePair[] {
    const pairs: LanguagePair[] = [];
    for (const src of SUPPORTED_LANGUAGES) {
      for (const tgt of SUPPORTED_LANGUAGES) {
        if (src !== tgt) {
          pairs.push({ src, tgt });
        }
      }
    }
    return pairs;
  }

  /**
   * Test the provider
   */
  async test(): Promise<boolean> {
    try {
      const result = await this.translate('Hello', 'en', 'fi');
      return typeof result === 'string' && result.length > 0;
    } catch (error) {
      console.error('[GoogleCloud] Test failed:', error);
      return false;
    }
  }

  /**
   * Get provider info
   */
  getInfo(): ProviderConfig & { charactersUsed: number } {
    return {
      ...super.getInfo(),
      charactersUsed: this.charactersUsed,
    };
  }
}

// Singleton instance
export const googleCloudProvider = new GoogleCloudProvider();

export default googleCloudProvider;
