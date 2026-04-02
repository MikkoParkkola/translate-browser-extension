/**
 * DeepL Translation Provider
 * Supports Free tier (500K chars/month) and Pro tier
 * https://www.deepl.com/docs-api
 */

import { CloudProvider, createCloudProviderConfig } from './cloud-provider';
import { createTranslationError } from '../core/errors';
import {
  detectProviderLanguageCode,
  fetchProviderJson,
  finalizeProviderTranslations,
  generateLanguagePairs,
} from './provider-utils';
import { toDeepLCode, getDeepLSupportedLanguages } from '../core/language-map';
import { CONFIG } from '../config';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';
import type { CloudProviderStorageRecord } from '../background/shared/provider-config-types';
import { extractDeepLStoredRuntimeState } from '../background/shared/config-validation';
import { DEFAULT_DEEPL_FORMALITY } from '../shared/cloud-provider-configs';

// DeepL API endpoints
const DEEPL_FREE_API = 'https://api-free.deepl.com/v2';
const DEEPL_PRO_API = 'https://api.deepl.com/v2';
const DEEPL_STORAGE_KEYS = ['deepl_api_key', 'deepl_is_pro', 'deepl_formality'] as const;

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

export class DeepLProvider extends CloudProvider<DeepLConfig> {
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

  private get apiBase(): string {
    return this.config?.isPro ? DEEPL_PRO_API : DEEPL_FREE_API;
  }

  protected getStorageKeys(): string[] {
    return [...DEEPL_STORAGE_KEYS];
  }

  protected applyStoredConfig(stored: CloudProviderStorageRecord): void {
    const runtimeState = extractDeepLStoredRuntimeState(stored);
    if (!runtimeState) {
      this.resetConfig();
      return;
    }

    this.config = runtimeState.config;
    this.log.info('Initialized with', this.config.isPro ? 'Pro' : 'Free', 'tier');
  }

  protected resetConfig(): void {
    this.config = null;
  }

  protected getConfigState(): DeepLConfig | null {
    return this.config;
  }

  protected setConfigState(config: DeepLConfig | null): void {
    this.config = config;
  }

  /** Store API key in storage */
  async setApiKey(apiKey: string, isPro: boolean = false): Promise<void> {
    await this.persistAndUpdateConfig(
      { deepl_api_key: apiKey, deepl_is_pro: isPro },
      (config) =>
        createCloudProviderConfig(apiKey, {
          isPro,
          formality: config?.formality ?? DEFAULT_DEEPL_FORMALITY,
        })
    );
  }

  /** Set formality preference */
  async setFormality(formality: DeepLFormality): Promise<void> {
    await this.persistAndUpdateLoadedConfig(
      { deepl_formality: formality },
      (config) => ({ ...config, formality })
    );
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
    const config = this.requireConfiguredConfig('DeepL');

    const texts = Array.isArray(text) ? text : [text];
    const targetLangCode = toDeepLCode(targetLang);

    // Build request body
    const body: Record<string, unknown> = {
      text: texts,
      target_lang: targetLangCode,
    };

    // Add source language if not auto-detect
    if (sourceLang !== 'auto') {
      body.source_lang = toDeepLCode(sourceLang);
    }

    // Add formality if supported for target language
    if (config.formality && config.formality !== 'default') {
      const formalitySupported = ['DE', 'FR', 'IT', 'ES', 'NL', 'PL', 'PT', 'RU', 'JA'];
      if (formalitySupported.includes(targetLangCode)) {
        body.formality = config.formality;
      }
    }

    try {
      const data = await fetchProviderJson<DeepLTranslateResponse>('DeepL', `${this.apiBase}/translate`, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      return finalizeProviderTranslations(
        'DeepL',
        text,
        data.translations?.map(t => t.text),
      );
    } catch (error) {
      this.log.error('Translation error:', error);
      throw createTranslationError(error);
    }
  }

  /**
   * Detect language using DeepL (by translating a small sample)
   */
  async detectLanguage(text: string): Promise<string> {
    const config = this.getConfiguredConfig();
    if (!config) {
      return 'auto';
    }

    return detectProviderLanguageCode<DeepLTranslateResponse>(
      'DeepL',
      `${this.apiBase}/translate`,
      {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [text.slice(0, 100)], // Use small sample
          target_lang: 'EN',
        }),
      },
      (data) => data.translations?.[0]?.detected_source_language,
      (message, error) => this.log.error(message, error),
    );
  }

  async getUsage(): Promise<{
    requests: number;
    tokens: number;
    cost: number;
    limitReached: boolean;
  }> {
    const config = this.getConfiguredConfig();
    if (!config) {
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
          'Authorization': `DeepL-Auth-Key ${config.apiKey}`,
        },
        signal: AbortSignal.timeout(CONFIG.timeouts.cloudApiMs),
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
      this.log.error('Usage check error:', error);
    }

    return { requests: 0, tokens: 0, cost: 0, limitReached: false };
  }

  getSupportedLanguages(): LanguagePair[] {
    return generateLanguagePairs(getDeepLSupportedLanguages());
  }

  getInfo(): ProviderConfig & { tier: string; formality: string } {
    return {
      ...super.getInfo(),
      tier: this.config?.isPro ? 'Pro' : 'Free',
      formality: this.config?.formality ?? DEFAULT_DEEPL_FORMALITY,
    };
  }
}

// Singleton instance
export const deeplProvider = new DeepLProvider();

export default deeplProvider;
