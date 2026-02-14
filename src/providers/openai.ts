/**
 * OpenAI Translation Provider
 * Uses chat completions API with translation prompts
 * https://platform.openai.com/docs/api-reference/chat
 */

import { BaseProvider } from './base-provider';
import { createTranslationError } from '../core/errors';
import { handleProviderHttpError } from '../core/http-errors';
import { getLanguageName, getAllLanguageCodes } from '../core/language-map';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

export type OpenAIFormality = 'formal' | 'informal' | 'neutral';
export type OpenAIModel = 'gpt-4o' | 'gpt-4o-mini' | 'gpt-4-turbo' | 'gpt-3.5-turbo';

export interface OpenAIConfig {
  apiKey: string;
  model: OpenAIModel;
  formality: OpenAIFormality;
  temperature: number;
}

interface OpenAIChatResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider extends BaseProvider {
  private config: OpenAIConfig | null = null;
  private totalTokensUsed = 0;

  constructor() {
    super({
      id: 'openai',
      name: 'OpenAI',
      type: 'cloud',
      qualityTier: 'premium',
      costPerMillion: 5000, // $5 per 1M input tokens for GPT-4o (simplified)
      icon: '',
    });
  }

  /**
   * Initialize the provider by loading API key from storage
   */
  async initialize(): Promise<void> {
    try {
      const stored = await chrome.storage.local.get([
        'openai_api_key',
        'openai_model',
        'openai_formality',
        'openai_temperature',
        'openai_tokens_used',
      ]);
      if (stored.openai_api_key) {
        this.config = {
          apiKey: stored.openai_api_key,
          model: stored.openai_model ?? 'gpt-4o-mini',
          formality: stored.openai_formality ?? 'neutral',
          temperature: stored.openai_temperature ?? 0.3,
        };
        this.totalTokensUsed = stored.openai_tokens_used ?? 0;
        console.log('[OpenAI] Initialized with model:', this.config.model);
      }
    } catch (error) {
      console.error('[OpenAI] Failed to load config:', error);
    }
  }

  /**
   * Store API key and settings in chrome.storage
   */
  async setApiKey(apiKey: string): Promise<void> {
    await chrome.storage.local.set({ openai_api_key: apiKey });
    if (this.config) {
      this.config.apiKey = apiKey;
    } else {
      this.config = {
        apiKey,
        model: 'gpt-4o-mini',
        formality: 'neutral',
        temperature: 0.3,
      };
    }
  }

  /**
   * Set model preference
   */
  async setModel(model: OpenAIModel): Promise<void> {
    await chrome.storage.local.set({ openai_model: model });
    if (this.config) {
      this.config.model = model;
    }
  }

  /**
   * Set formality preference
   */
  async setFormality(formality: OpenAIFormality): Promise<void> {
    await chrome.storage.local.set({ openai_formality: formality });
    if (this.config) {
      this.config.formality = formality;
    }
  }

  /**
   * Remove API key
   */
  async clearApiKey(): Promise<void> {
    await chrome.storage.local.remove([
      'openai_api_key',
      'openai_model',
      'openai_formality',
      'openai_temperature',
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
   * Build translation prompt with formality
   */
  private buildPrompt(targetLang: string, formality: OpenAIFormality): string {
    const langName = this.getLangName(targetLang);
    let formalityInst = '';

    switch (formality) {
      case 'formal':
        formalityInst = ' Use formal language and polite forms.';
        break;
      case 'informal':
        formalityInst = ' Use casual, informal language.';
        break;
    }

    return `You are a professional translator. Translate the following text to ${langName}.${formalityInst} Provide only the translation, no explanations.`;
  }

  /**
   * Translate text using OpenAI Chat API
   */
  async translate(
    text: string | string[],
    sourceLang: string,
    targetLang: string,
    _options?: TranslationOptions
  ): Promise<string | string[]> {
    if (!this.config?.apiKey) {
      throw createTranslationError(new Error('OpenAI API key not configured'));
    }

    const isArray = Array.isArray(text);
    const texts = isArray ? text : [text];

    // For batch translations, join with markers
    const batchMarker = '\n---TRANSLATE_SEPARATOR---\n';
    const inputText = texts.join(batchMarker);

    const systemPrompt = this.buildPrompt(targetLang, this.config.formality);
    let userPrompt = inputText;

    // Add source language hint if known
    if (sourceLang !== 'auto') {
      userPrompt = `[Source: ${this.getLangName(sourceLang)}]\n${inputText}`;
    }

    // For batch, add instruction
    if (isArray && texts.length > 1) {
      userPrompt += `\n\n[Note: Translate each section separated by "---TRANSLATE_SEPARATOR---" and keep the separators in your response]`;
    }

    try {
      const response = await fetch(OPENAI_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: this.config.temperature,
          max_tokens: Math.min(4096, texts.join('').length * 2 + 500),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        const httpError = handleProviderHttpError(
          response.status,
          'OpenAI',
          errorText,
          response.headers.get('Retry-After')
        );
        throw new Error(httpError.message);
      }

      const data: OpenAIChatResponse = await response.json();

      // Track token usage
      if (data.usage) {
        this.totalTokensUsed += data.usage.total_tokens;
        chrome.storage.local.set({ openai_tokens_used: this.totalTokensUsed }).catch(() => {});
      }

      const translated = data.choices[0]?.message?.content?.trim() || '';

      // Split back if batch
      if (isArray && texts.length > 1) {
        const results = translated.split(/---TRANSLATE_SEPARATOR---/i).map(s => s.trim());
        // Ensure we have the right number of results
        while (results.length < texts.length) {
          results.push('');
        }
        return results.slice(0, texts.length);
      }

      return isArray ? [translated] : translated;
    } catch (error) {
      console.error('[OpenAI] Translation error:', error);
      throw createTranslationError(error);
    }
  }

  /**
   * Detect language using OpenAI
   */
  async detectLanguage(text: string): Promise<string> {
    if (!this.config?.apiKey) {
      return 'auto';
    }

    try {
      const response = await fetch(OPENAI_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini', // Use cheaper model for detection
          messages: [
            {
              role: 'system',
              content: 'Detect the language of the text. Respond with only the ISO 639-1 code (2 letters, lowercase).',
            },
            { role: 'user', content: text.slice(0, 200) },
          ],
          temperature: 0,
          max_tokens: 10,
        }),
      });

      if (response.ok) {
        const data: OpenAIChatResponse = await response.json();
        const detected = data.choices[0]?.message?.content?.trim().toLowerCase();
        if (detected && detected.length === 2) {
          return detected;
        }
      }
    } catch (error) {
      console.error('[OpenAI] Language detection error:', error);
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
    // Estimate cost based on model (simplified)
    const costPer1K: Record<OpenAIModel, number> = {
      'gpt-4o': 0.005,
      'gpt-4o-mini': 0.00015,
      'gpt-4-turbo': 0.01,
      'gpt-3.5-turbo': 0.0005,
    };

    const rate = costPer1K[this.config?.model ?? 'gpt-4o-mini'];
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
   * OpenAI supports translation between most languages
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
      console.error('[OpenAI] Test failed:', error);
      return false;
    }
  }

  /**
   * Get provider info with model information
   */
  getInfo(): ProviderConfig & { model: string; formality: string } {
    return {
      ...super.getInfo(),
      model: this.config?.model ?? 'gpt-4o-mini',
      formality: this.config?.formality ?? 'neutral',
    };
  }
}

// Singleton instance
export const openaiProvider = new OpenAIProvider();

export default openaiProvider;
