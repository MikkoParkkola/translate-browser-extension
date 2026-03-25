/**
 * Google Cloud Translation Provider
 * Uses Cloud Translation API v2 (Basic)
 * https://cloud.google.com/translate/docs/reference/rest/v2/translate
 */

import { CloudProvider } from './cloud-provider';
import { createTranslationError } from '../core/errors';
import { CONFIG } from '../config';
import { fetchProviderJson, generateAllLanguagePairs } from './provider-utils';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';
import type { CloudProviderStorageRecord } from '../background/shared/provider-config-types';
import { validateGoogleCloudStoredConfig } from '../background/shared/config-validation';

const GOOGLE_TRANSLATE_API = 'https://translation.googleapis.com/language/translate/v2';
const GOOGLE_STORAGE_KEYS = ['google_cloud_api_key', 'google_cloud_chars_used'] as const;

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

function createGoogleCloudConfig(apiKey: string): GoogleCloudConfig {
  return { apiKey };
}

export class GoogleCloudProvider extends CloudProvider<GoogleCloudConfig> {
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

  protected getStorageKeys(): string[] {
    return [...GOOGLE_STORAGE_KEYS];
  }

  protected applyStoredConfig(stored: CloudProviderStorageRecord): void {
    const config = validateGoogleCloudStoredConfig(stored);
    if (!config) {
      this.resetConfig();
      return;
    }

    this.config = { apiKey: config.apiKey };
    this.charactersUsed = config.charactersUsed;
    this.log.info('Initialized');
  }

  protected hasConfig(): boolean {
    return !!this.config?.apiKey;
  }

  protected resetConfig(): void {
    this.config = null;
    this.charactersUsed = 0;
  }

  protected getConfigState(): GoogleCloudConfig | null {
    return this.config;
  }

  protected setConfigState(config: GoogleCloudConfig | null): void {
    this.config = config;
  }

  /** Store API key in storage */
  async setApiKey(apiKey: string): Promise<void> {
    await this.persistAndUpdateConfig(
      { google_cloud_api_key: apiKey },
      () => createGoogleCloudConfig(apiKey)
    );
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

    // Build request URL — API key in query param per Google Cloud v2 API convention
    const url = new URL(GOOGLE_TRANSLATE_API);
    url.searchParams.set('key', this.config.apiKey);

    const body: Record<string, unknown> = {
      q: texts,
      target: targetLang,
      format: 'text',
    };

    if (sourceLang !== 'auto') {
      body.source = sourceLang;
    }

    try {
      const data = await fetchProviderJson<GoogleTranslateResponse>('Google Cloud', url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      // Track character usage
      const charsUsed = texts.reduce((sum, t) => sum + t.length, 0);
      this.charactersUsed += charsUsed;
      this.persistBestEffort(
        { google_cloud_chars_used: this.charactersUsed },
        'Failed to persist char usage:'
      );

      const results = data.data.translations.map(t => t.translatedText);
      return isArray ? results : results[0];
    } catch (error) {
      this.log.error('Translation error:', error);
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
          q: text.slice(0, 200),
        }),
        signal: AbortSignal.timeout(CONFIG.timeouts.cloudApiMs),
      });

      if (response.ok) {
        const data: GoogleDetectResponse = await response.json();
        const detected = data.data.detections[0]?.[0]?.language;
        if (detected) {
          return detected;
        }
      }
    } catch (error) {
      this.log.error('Language detection error:', error);
    }

    return 'auto';
  }

  async getUsage(): Promise<{
    requests: number;
    tokens: number;
    cost: number;
    limitReached: boolean;
  }> {
    return {
      requests: 0,
      tokens: this.charactersUsed,
      cost: (this.charactersUsed / 1000000) * this.costPerMillion,
      limitReached: false,
    };
  }

  getSupportedLanguages(): LanguagePair[] {
    return generateAllLanguagePairs();
  }

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
