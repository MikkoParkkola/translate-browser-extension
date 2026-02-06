/**
 * DeepL Translation Provider
 * Supports Free tier (500K chars/month) and Pro tier
 * https://www.deepl.com/docs-api
 */

import { BaseProvider } from './base-provider';
import { createTranslationError } from '../core/errors';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';

// DeepL API endpoints
const DEEPL_FREE_API = 'https://api-free.deepl.com/v2';
const DEEPL_PRO_API = 'https://api.deepl.com/v2';

// Language mappings (DeepL uses some different codes)
const LANGUAGE_MAP: Record<string, string> = {
  en: 'EN',
  de: 'DE',
  fr: 'FR',
  es: 'ES',
  it: 'IT',
  nl: 'NL',
  pl: 'PL',
  ru: 'RU',
  ja: 'JA',
  zh: 'ZH',
  pt: 'PT',
  cs: 'CS',
  da: 'DA',
  el: 'EL',
  fi: 'FI',
  hu: 'HU',
  id: 'ID',
  ko: 'KO',
  lt: 'LT',
  lv: 'LV',
  nb: 'NB',
  ro: 'RO',
  sk: 'SK',
  sl: 'SL',
  sv: 'SV',
  tr: 'TR',
  uk: 'UK',
  bg: 'BG',
  et: 'ET',
};

// Supported language pairs (DeepL supports most combinations)
const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_MAP);

export type DeepLFormality = 'default' | 'more' | 'less' | 'prefer_more' | 'prefer_less';

export interface DeepLConfig {
  apiKey: string;
  isPro: boolean;
  formality?: DeepLFormality;
}

interface DeepLTranslateResponse {
  translations: Array<{
    detected_source_language: string;
    text: string;
  }>;
}

interface DeepLUsageResponse {
  character_count: number;
  character_limit: number;
}

export class DeepLProvider extends BaseProvider {
  private config: DeepLConfig | null = null;
  private usageCache: { count: number; limit: number; timestamp: number } | null = null;

  constructor() {
    super({
      id: 'deepl',
      name: 'DeepL',
      type: 'cloud',
      qualityTier: 'premium',
      costPerMillion: 20, // $20 per million characters (Pro pricing)
      icon: '',
    });
  }

  /**
   * Get API base URL based on tier
   */
  private get apiBase(): string {
    return this.config?.isPro ? DEEPL_PRO_API : DEEPL_FREE_API;
  }

  /**
   * Initialize the provider by loading API key from storage
   */
  async initialize(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(['deepl_api_key', 'deepl_is_pro', 'deepl_formality']);
      if (stored.deepl_api_key) {
        this.config = {
          apiKey: stored.deepl_api_key,
          isPro: stored.deepl_is_pro ?? false,
          formality: stored.deepl_formality ?? 'default',
        };
        console.log('[DeepL] Initialized with', this.config.isPro ? 'Pro' : 'Free', 'tier');
      }
    } catch (error) {
      console.error('[DeepL] Failed to load config:', error);
    }
  }

  /**
   * Store API key in chrome.storage
   */
  async setApiKey(apiKey: string, isPro: boolean = false): Promise<void> {
    await chrome.storage.local.set({
      deepl_api_key: apiKey,
      deepl_is_pro: isPro,
    });
    this.config = { apiKey, isPro, formality: this.config?.formality ?? 'default' };
  }

  /**
   * Set formality preference
   */
  async setFormality(formality: DeepLFormality): Promise<void> {
    await chrome.storage.local.set({ deepl_formality: formality });
    if (this.config) {
      this.config.formality = formality;
    }
  }

  /**
   * Remove API key
   */
  async clearApiKey(): Promise<void> {
    await chrome.storage.local.remove(['deepl_api_key', 'deepl_is_pro', 'deepl_formality']);
    this.config = null;
  }

  /**
   * Convert language code to DeepL format
   */
  private toDeepLLang(lang: string): string {
    return LANGUAGE_MAP[lang.toLowerCase()] || lang.toUpperCase();
  }

  /**
   * Translate text using DeepL API
   */
  async translate(
    text: string | string[],
    sourceLang: string,
    targetLang: string,
    _options?: TranslationOptions
  ): Promise<string | string[]> {
    if (!this.config?.apiKey) {
      throw createTranslationError(new Error('DeepL API key not configured'));
    }

    const texts = Array.isArray(text) ? text : [text];
    const targetLangCode = this.toDeepLLang(targetLang);

    // Build request body
    const body: Record<string, unknown> = {
      text: texts,
      target_lang: targetLangCode,
    };

    // Add source language if not auto-detect
    if (sourceLang !== 'auto') {
      body.source_lang = this.toDeepLLang(sourceLang);
    }

    // Add formality if supported for target language
    // (only some languages support formality)
    if (this.config.formality && this.config.formality !== 'default') {
      const formalitySupported = ['DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'PT', 'RU', 'JA'];
      if (formalitySupported.includes(targetLangCode)) {
        body.formality = this.config.formality;
      }
    }

    try {
      const response = await fetch(`${this.apiBase}/translate`, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 403) {
          throw new Error('Invalid DeepL API key');
        } else if (response.status === 456) {
          throw new Error('DeepL quota exceeded');
        }
        throw new Error(`DeepL API error: ${response.status} - ${errorText}`);
      }

      const data: DeepLTranslateResponse = await response.json();
      const results = data.translations.map(t => t.text);

      return Array.isArray(text) ? results : results[0];
    } catch (error) {
      console.error('[DeepL] Translation error:', error);
      throw createTranslationError(error);
    }
  }

  /**
   * Detect language using DeepL (by translating a small sample)
   */
  async detectLanguage(text: string): Promise<string> {
    if (!this.config?.apiKey) {
      return 'auto';
    }

    try {
      const response = await fetch(`${this.apiBase}/translate`, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [text.slice(0, 100)], // Use small sample
          target_lang: 'EN',
        }),
      });

      if (response.ok) {
        const data: DeepLTranslateResponse = await response.json();
        return data.translations[0].detected_source_language.toLowerCase();
      }
    } catch (error) {
      console.error('[DeepL] Language detection error:', error);
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
   * Get usage statistics from DeepL
   */
  async getUsage(): Promise<{
    requests: number;
    tokens: number;
    cost: number;
    limitReached: boolean;
  }> {
    if (!this.config?.apiKey) {
      return { requests: 0, tokens: 0, cost: 0, limitReached: false };
    }

    // Use cached value if recent (within 5 minutes)
    if (this.usageCache && Date.now() - this.usageCache.timestamp < 5 * 60 * 1000) {
      return {
        requests: 0,
        tokens: this.usageCache.count,
        cost: (this.usageCache.count / 1000000) * this.costPerMillion,
        limitReached: this.usageCache.count >= this.usageCache.limit,
      };
    }

    try {
      const response = await fetch(`${this.apiBase}/usage`, {
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.config.apiKey}`,
        },
      });

      if (response.ok) {
        const data: DeepLUsageResponse = await response.json();
        this.usageCache = {
          count: data.character_count,
          limit: data.character_limit,
          timestamp: Date.now(),
        };

        return {
          requests: 0,
          tokens: data.character_count,
          cost: (data.character_count / 1000000) * this.costPerMillion,
          limitReached: data.character_count >= data.character_limit,
        };
      }
    } catch (error) {
      console.error('[DeepL] Usage check error:', error);
    }

    return { requests: 0, tokens: 0, cost: 0, limitReached: false };
  }

  /**
   * Get supported language pairs
   * DeepL supports translation between most language pairs
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
      console.error('[DeepL] Test failed:', error);
      return false;
    }
  }

  /**
   * Get provider info with tier information
   */
  getInfo(): ProviderConfig & { tier: string; formality: string } {
    return {
      ...super.getInfo(),
      tier: this.config?.isPro ? 'Pro' : 'Free',
      formality: this.config?.formality ?? 'default',
    };
  }
}

// Singleton instance
export const deeplProvider = new DeepLProvider();

export default deeplProvider;
