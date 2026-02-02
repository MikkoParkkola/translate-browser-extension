/**
 * Base Provider Interface
 * All translation providers must implement this interface
 */

import type {
  ProviderType,
  QualityTier,
  ProviderConfig,
  TranslationProvider,
  TranslationOptions,
  LanguagePair,
} from '../types';

export abstract class BaseProvider implements TranslationProvider {
  readonly id: string;
  readonly name: string;
  readonly type: ProviderType;
  readonly qualityTier: QualityTier;
  readonly costPerMillion: number;
  readonly icon: string;

  constructor(config: Partial<ProviderConfig> = {}) {
    this.id = config.id || 'unknown';
    this.name = config.name || 'Unknown Provider';
    this.type = config.type || 'cloud';
    this.qualityTier = config.qualityTier || 'standard';
    this.costPerMillion = config.costPerMillion || 0;
    this.icon = config.icon || '';
  }

  /**
   * Initialize the provider (override in subclass if needed)
   */
  async initialize(): Promise<void> {
    // Default: no-op
  }

  /**
   * Translate text - must be implemented by subclass
   */
  abstract translate(
    text: string | string[],
    sourceLang: string,
    targetLang: string,
    options?: TranslationOptions
  ): Promise<string | string[]>;

  /**
   * Detect language of text - override in subclass
   */
  async detectLanguage(_text: string): Promise<string> {
    return 'auto';
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Get usage statistics - override in subclass
   */
  async getUsage(): Promise<{
    requests: number;
    tokens: number;
    cost: number;
    limitReached: boolean;
  }> {
    return {
      requests: 0,
      tokens: 0,
      cost: 0,
      limitReached: false,
    };
  }

  /**
   * Validate configuration - override in subclass
   */
  async validateConfig(): Promise<boolean> {
    return true;
  }

  /**
   * Get supported language pairs - override in subclass
   */
  getSupportedLanguages(): LanguagePair[] {
    return [];
  }

  /**
   * Test the provider
   */
  async test(): Promise<boolean> {
    try {
      const result = await this.translate('Hello', 'en', 'fi');
      return result !== null && (typeof result === 'string' ? result.length > 0 : result.length > 0);
    } catch (error) {
      console.error(`${this.name} test failed:`, error);
      return false;
    }
  }

  /**
   * Get provider info for UI
   */
  getInfo(): ProviderConfig {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      qualityTier: this.qualityTier,
      costPerMillion: this.costPerMillion,
      icon: this.icon,
    };
  }
}

export default BaseProvider;
