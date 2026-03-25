/**
 * Anthropic Claude Translation Provider
 * Uses Claude API for high-quality translation with context understanding
 * https://docs.anthropic.com/en/api/messages
 */

import { CloudProvider } from './cloud-provider';
import { createTranslationError } from '../core/errors';
import { getLanguageName } from '../core/language-map';
import { CONFIG } from '../config';
import { fetchProviderJson, estimateMaxTokens, generateAllLanguagePairs, parseBatchResponse } from './provider-utils';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';
import type { CloudProviderStorageRecord } from '../background/shared/provider-config-types';
import { validateAnthropicStoredConfig } from '../background/shared/config-validation';
import { ANTHROPIC_MODEL_VALUES } from '../shared/cloud-provider-configs';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_STORAGE_KEYS = [
  'anthropic_api_key',
  'anthropic_model',
  'anthropic_formality',
  'anthropic_tokens_used',
] as const;

export type ClaudeFormality = 'formal' | 'informal' | 'neutral';
export type ClaudeModel = (typeof ANTHROPIC_MODEL_VALUES)[number];

export interface AnthropicConfig {
  apiKey: string;
  model: ClaudeModel;
  formality: ClaudeFormality;
}

interface AnthropicMessageResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

const DEFAULT_ANTHROPIC_MODEL: ClaudeModel = 'claude-3-5-haiku-20241022';
const DEFAULT_ANTHROPIC_FORMALITY: ClaudeFormality = 'neutral';

function createAnthropicConfig(apiKey: string): AnthropicConfig {
  return {
    apiKey,
    model: DEFAULT_ANTHROPIC_MODEL,
    formality: DEFAULT_ANTHROPIC_FORMALITY,
  };
}

export class AnthropicProvider extends CloudProvider<AnthropicConfig> {
  private config: AnthropicConfig | null = null;
  private totalTokensUsed = 0;

  constructor() {
    super({
      id: 'anthropic',
      name: 'Claude',
      type: 'cloud',
      qualityTier: 'premium',
      costPerMillion: 3000, // $3 per 1M input tokens for Claude 3.5 Sonnet
      icon: '',
    });
  }

  protected getStorageKeys(): string[] {
    return [...ANTHROPIC_STORAGE_KEYS];
  }

  protected applyStoredConfig(stored: CloudProviderStorageRecord): void {
    const config = validateAnthropicStoredConfig(stored);
    if (!config) {
      this.resetConfig();
      return;
    }

    this.config = {
      apiKey: config.apiKey,
      model: config.model,
      formality: config.formality,
    };
    this.totalTokensUsed = config.tokensUsed;
    this.log.info('Initialized with model:', this.config.model);
  }

  protected hasConfig(): boolean {
    return !!this.config?.apiKey;
  }

  protected resetConfig(): void {
    this.config = null;
    this.totalTokensUsed = 0;
  }

  protected getConfigState(): AnthropicConfig | null {
    return this.config;
  }

  protected setConfigState(config: AnthropicConfig | null): void {
    this.config = config;
  }

  /** Store API key in storage */
  async setApiKey(apiKey: string): Promise<void> {
    await this.persistAndUpdateConfig(
      { anthropic_api_key: apiKey },
      (config) => (config ? { ...config, apiKey } : createAnthropicConfig(apiKey))
    );
  }

  /** Set model preference */
  async setModel(model: ClaudeModel): Promise<void> {
    await this.persistAndUpdateLoadedConfig(
      { anthropic_model: model },
      (config) => ({ ...config, model })
    );
  }

  /** Set formality preference */
  async setFormality(formality: ClaudeFormality): Promise<void> {
    await this.persistAndUpdateLoadedConfig(
      { anthropic_formality: formality },
      (config) => ({ ...config, formality })
    );
  }

  private buildSystemPrompt(targetLang: string, formality: ClaudeFormality): string {
    const langName = getLanguageName(targetLang);
    let formalityInst = '';

    switch (formality) {
      case 'formal':
        formalityInst = ' Use formal register and polite forms where appropriate.';
        break;
      case 'informal':
        formalityInst = ' Use casual, conversational language.';
        break;
    }

    return `You are an expert translator. Translate the provided text to ${langName}.${formalityInst}

Rules:
- Output ONLY the translation, no explanations or notes
- Preserve formatting (line breaks, punctuation)
- Maintain the tone and style of the original
- For ambiguous terms, choose the most natural translation`;
  }

  /**
   * Translate text using Anthropic Messages API
   */
  async translate(
    text: string | string[],
    sourceLang: string,
    targetLang: string,
    _options?: TranslationOptions
  ): Promise<string | string[]> {
    if (!this.config?.apiKey) {
      throw createTranslationError(new Error('Anthropic API key not configured'));
    }

    const isArray = Array.isArray(text);
    const texts = isArray ? text : [text];

    // For batch translations, use numbered XML tags for unambiguous separation
    let userContent: string;
    if (texts.length === 1) {
      userContent = texts[0];
    } else {
      userContent = texts.map((t, i) => `<t${i}>${t}</t${i}>`).join('\n');
      userContent += '\n\nTranslate each numbered element and respond using the same tags: <t0>translation</t0>, <t1>translation</t1>, etc.';
    }

    // Add source language hint if known
    if (sourceLang !== 'auto') {
      userContent = `[Source language: ${getLanguageName(sourceLang)}]\n\n${userContent}`;
    }

    const systemPrompt = this.buildSystemPrompt(targetLang, this.config.formality);

    try {
      const data = await fetchProviderJson<AnthropicMessageResponse>('Anthropic', ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: estimateMaxTokens(texts),
          system: systemPrompt,
          messages: [
            { role: 'user', content: userContent },
          ],
        }),
      });

      // Track token usage
      if (data.usage) {
        this.totalTokensUsed += data.usage.input_tokens + data.usage.output_tokens;
        this.persistBestEffort(
          { anthropic_tokens_used: this.totalTokensUsed },
          'Failed to persist token usage:'
        );
      }

      const translated = data.content[0]?.text?.trim() || '';

      // Parse XML response for batch
      if (isArray && texts.length > 1) {
        const results = parseBatchResponse(translated, texts.length, {
          legacyXmlFallback: true,
          newlineFallback: true,
          allowExtras: true,
        });
        if (results.every(r => !r) && translated.length > 0) {
          this.log.warn('XML tag parsing produced no results, fell back to newline splitting');
        }
        return results;
      }

      return isArray ? [translated] : translated;
    } catch (error) {
      this.log.error('Translation error:', error);
      throw createTranslationError(error);
    }
  }

  /**
   * Detect language using Claude
   */
  async detectLanguage(text: string): Promise<string> {
    if (!this.config?.apiKey) {
      return 'auto';
    }

    try {
      const response = await fetch(ANTHROPIC_API, {
        method: 'POST',
        headers: {
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: DEFAULT_ANTHROPIC_MODEL, // Use cheaper model for detection
          max_tokens: 10,
          system: 'Identify the language of the text. Respond with ONLY the ISO 639-1 code (2 lowercase letters).',
          messages: [
            { role: 'user', content: text.slice(0, 200) },
          ],
        }),
        signal: AbortSignal.timeout(CONFIG.timeouts.cloudApiMs),
      });

      if (response.ok) {
        const data: AnthropicMessageResponse = await response.json();
        const detected = data.content[0]?.text?.trim().toLowerCase();
        if (detected && detected.length === 2) {
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
    const costPer1K: Record<ClaudeModel, number> = {
      'claude-sonnet-4-20250514': 0.003,
      'claude-3-5-haiku-20241022': 0.00025,
      'claude-3-5-sonnet-20241022': 0.003,
    };

    const rate = costPer1K[this.config?.model ?? DEFAULT_ANTHROPIC_MODEL];
    const cost = (this.totalTokensUsed / 1000) * rate;

    return {
      requests: 0,
      tokens: this.totalTokensUsed,
      cost,
      limitReached: false,
    };
  }

  getSupportedLanguages(): LanguagePair[] {
    return generateAllLanguagePairs();
  }

  getInfo(): ProviderConfig & { model: string; formality: string } {
    return {
      ...super.getInfo(),
      model: this.config?.model ?? DEFAULT_ANTHROPIC_MODEL,
      formality: this.config?.formality ?? DEFAULT_ANTHROPIC_FORMALITY,
    };
  }
}

// Singleton instance
export const anthropicProvider = new AnthropicProvider();

export default anthropicProvider;
