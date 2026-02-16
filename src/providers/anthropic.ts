/**
 * Anthropic Claude Translation Provider
 * Uses Claude API for high-quality translation with context understanding
 * https://docs.anthropic.com/en/api/messages
 */

import { BaseProvider } from './base-provider';
import { createTranslationError } from '../core/errors';
import { handleProviderHttpError } from '../core/http-errors';
import { getLanguageName, getAllLanguageCodes } from '../core/language-map';
import { CONFIG } from '../config';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

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

export class AnthropicProvider extends BaseProvider {
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

  /**
   * Initialize the provider by loading API key from storage
   */
  async initialize(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get([
        'anthropic_api_key',
        'anthropic_model',
        'anthropic_formality',
        'anthropic_tokens_used',
      ]);
      if (stored.anthropic_api_key) {
        this.config = {
          apiKey: stored.anthropic_api_key,
          model: stored.anthropic_model ?? 'claude-3-5-haiku-20241022',
          formality: stored.anthropic_formality ?? 'neutral',
        };
        this.totalTokensUsed = stored.anthropic_tokens_used ?? 0;
        console.log('[Anthropic] Initialized with model:', this.config.model);
      }
    } catch (error) {
      console.error('[Anthropic] Failed to load config:', error);
    }
  }

  /**
   * Store API key in chrome.storage
   */
  async setApiKey(apiKey: string): Promise<void> {
    await chrome.storage.local.set({ anthropic_api_key: apiKey });
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

  /**
   * Set model preference
   */
  async setModel(model: ClaudeModel): Promise<void> {
    await chrome.storage.local.set({ anthropic_model: model });
    if (this.config) {
      this.config.model = model;
    }
  }

  /**
   * Set formality preference
   */
  async setFormality(formality: ClaudeFormality): Promise<void> {
    await chrome.storage.local.set({ anthropic_formality: formality });
    if (this.config) {
      this.config.formality = formality;
    }
  }

  /**
   * Remove API key
   */
  async clearApiKey(): Promise<void> {
    await chrome.storage.local.remove([
      'anthropic_api_key',
      'anthropic_model',
      'anthropic_formality',
      'anthropic_tokens_used',
    ]);
    this.config = null;
  }

  /**
   * Get language name for prompts
   */
  private getLangName(code: string): string {
    return getLanguageName(code);
  }

  /**
   * Build translation system prompt with formality
   */
  private buildSystemPrompt(targetLang: string, formality: ClaudeFormality): string {
    const langName = this.getLangName(targetLang);
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

    // For batch translations, use XML tags for clear separation
    let userContent: string;
    if (texts.length === 1) {
      userContent = texts[0];
    } else {
      userContent = texts.map((t, i) => `<text id="${i}">${t}</text>`).join('\n');
      userContent += '\n\nTranslate each <text> element and respond with the same XML structure.';
    }

    // Add source language hint if known
    if (sourceLang !== 'auto') {
      userContent = `[Source language: ${this.getLangName(sourceLang)}]\n\n${userContent}`;
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
          max_tokens: Math.min(4096, texts.join('').length * 2 + 500),
          system: systemPrompt,
          messages: [
            { role: 'user', content: userContent },
          ],
        }),
        signal: AbortSignal.timeout(CONFIG.timeouts.cloudApiMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch((e) => { console.warn('[Anthropic] Failed to read error body:', e); return ''; });
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
        chrome.storage.local.set({ anthropic_tokens_used: this.totalTokensUsed }).catch((e) => console.warn('[Anthropic] Failed to persist token usage:', e));
      }

      const translated = data.content[0]?.text?.trim() || '';

      // Parse XML response for batch
      if (isArray && texts.length > 1) {
        const results: string[] = [];
        const regex = /<text id="(\d+)">([\s\S]*?)<\/text>/g;
        let match;

        while ((match = regex.exec(translated)) !== null) {
          const idx = parseInt(match[1], 10);
          results[idx] = match[2].trim();
        }

        // Fill any missing results
        for (let i = 0; i < texts.length; i++) {
          if (!results[i]) {
            results[i] = '';
          }
        }

        return results;
      }

      return isArray ? [translated] : translated;
    } catch (error) {
      console.error('[Anthropic] Translation error:', error);
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
      console.error('[Anthropic] Language detection error:', error);
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
    // Estimate cost based on model
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

  /**
   * Get supported language pairs
   * Claude supports translation between most languages
   */
  getSupportedLanguages(): LanguagePair[] {
    const languages = getAllLanguageCodes();
    const pairs: LanguagePair[] = [];
    for (const src of languages) {
      for (const tgt of languages) {
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
      console.error('[Anthropic] Test failed:', error);
      return false;
    }
  }

  /**
   * Get provider info with model information
   */
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
