/**
 * Anthropic Claude Translation Provider
 * Uses Claude API for high-quality translation with context understanding
 * https://docs.anthropic.com/en/api/messages
 */

import { CloudProvider } from './cloud-provider';
import { createTranslationError } from '../core/errors';
import { handleProviderHttpError } from '../core/http-errors';
import { getLanguageName } from '../core/language-map';
import { CONFIG } from '../config';
import { readErrorBody, estimateMaxTokens, generateAllLanguagePairs, parseBatchResponse } from './provider-utils';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_STORAGE_KEYS = [
  'anthropic_api_key',
  'anthropic_model',
  'anthropic_formality',
  'anthropic_tokens_used',
] as const;

export type ClaudeFormality = 'formal' | 'informal' | 'neutral';
export type ClaudeModel = 'claude-sonnet-4-20250514' | 'claude-3-5-haiku-20241022' | 'claude-3-5-sonnet-20241022';

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

export class AnthropicProvider extends CloudProvider {
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

  protected applyStoredConfig(stored: Record<string, unknown>): void {
    if (stored.anthropic_api_key) {
      this.config = {
        apiKey: stored.anthropic_api_key as string,
        model: (stored.anthropic_model as ClaudeModel) ?? 'claude-3-5-haiku-20241022',
        formality: (stored.anthropic_formality as ClaudeFormality) ?? 'neutral',
      };
      this.totalTokensUsed = (stored.anthropic_tokens_used as number) ?? 0;
      this.log.info('Initialized with model:', this.config.model);
    }
  }

  protected hasConfig(): boolean {
    return !!this.config?.apiKey;
  }

  protected resetConfig(): void {
    this.config = null;
  }

  /** Store API key in storage */
  async setApiKey(apiKey: string): Promise<void> {
    await this.persist({ anthropic_api_key: apiKey });
    if (this.config) {
      this.config.apiKey = apiKey;
    } else {
      this.config = {
        apiKey,
        model: 'claude-3-5-haiku-20241022',
        formality: 'neutral',
      };
    }
  }

  /** Set model preference */
  async setModel(model: ClaudeModel): Promise<void> {
    await this.persist({ anthropic_model: model });
    if (this.config) {
      this.config.model = model;
    }
  }

  /** Set formality preference */
  async setFormality(formality: ClaudeFormality): Promise<void> {
    await this.persist({ anthropic_formality: formality });
    if (this.config) {
      this.config.formality = formality;
    }
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
      const response = await fetch(ANTHROPIC_API, {
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
        signal: AbortSignal.timeout(CONFIG.timeouts.cloudApiMs),
      });

      if (!response.ok) {
        const errorText = await readErrorBody(response);
        const httpError = handleProviderHttpError(
          response.status,
          'Anthropic',
          errorText,
          response.headers.get('Retry-After')
        );
        throw new Error(httpError.message);
      }

      const data: AnthropicMessageResponse = await response.json();

      // Track token usage
      if (data.usage) {
        this.totalTokensUsed += data.usage.input_tokens + data.usage.output_tokens;
        /* v8 ignore start -- fire-and-forget persist */
        this.persist({ anthropic_tokens_used: this.totalTokensUsed }).catch((e) => this.log.warn('Failed to persist token usage:', e));
        /* v8 ignore stop */
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
          model: 'claude-3-5-haiku-20241022', // Use cheaper model for detection
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

    const rate = costPer1K[this.config?.model ?? 'claude-3-5-haiku-20241022'];
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
      model: this.config?.model ?? 'claude-3-5-haiku-20241022',
      formality: this.config?.formality ?? 'neutral',
    };
  }
}

// Singleton instance
export const anthropicProvider = new AnthropicProvider();

export default anthropicProvider;

