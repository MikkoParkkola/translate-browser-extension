/**
 * OpenAI Translation Provider
 * Uses chat completions API with translation prompts
 * https://platform.openai.com/docs/api-reference/chat
 */

import { CloudProvider } from './cloud-provider';
import { createTranslationError } from '../core/errors';
import { getLanguageName } from '../core/language-map';
import { CONFIG } from '../config';
import { fetchProviderJson, estimateMaxTokens, generateAllLanguagePairs, parseBatchResponse } from './provider-utils';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const OPENAI_STORAGE_KEYS = [
  'openai_api_key',
  'openai_model',
  'openai_formality',
  'openai_temperature',
  'openai_tokens_used',
] as const;

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

export class OpenAIProvider extends CloudProvider {
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

  protected getStorageKeys(): string[] {
    return [...OPENAI_STORAGE_KEYS];
  }

  protected applyStoredConfig(stored: Record<string, unknown>): void {
    if (stored.openai_api_key) {
      this.config = {
        apiKey: stored.openai_api_key as string,
        model: (stored.openai_model as OpenAIModel) ?? 'gpt-4o-mini',
        formality: (stored.openai_formality as OpenAIFormality) ?? 'neutral',
        temperature: (stored.openai_temperature as number) ?? 0.3,
      };
      this.totalTokensUsed = (stored.openai_tokens_used as number) ?? 0;
      this.log.info('Initialized with model:', this.config.model);
    }
  }

  protected hasConfig(): boolean {
    return !!this.config?.apiKey;
  }

  protected resetConfig(): void {
    this.config = null;
  }

  /**
   * Store API key and settings in storage
   */
  async setApiKey(apiKey: string): Promise<void> {
    await this.persist({ openai_api_key: apiKey });
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

  /** Set model preference */
  async setModel(model: OpenAIModel): Promise<void> {
    await this.persist({ openai_model: model });
    if (this.config) {
      this.config.model = model;
    }
  }

  /** Set formality preference */
  async setFormality(formality: OpenAIFormality): Promise<void> {
    await this.persist({ openai_formality: formality });
    if (this.config) {
      this.config.formality = formality;
    }
  }

  private buildPrompt(targetLang: string, formality: OpenAIFormality): string {
    const langName = getLanguageName(targetLang);
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

    // For batch translations, use XML-like tags for unambiguous separation
    let inputText: string;
    if (isArray && texts.length > 1) {
      inputText = texts.map((t, i) => `<t${i}>${t}</t${i}>`).join('\n');
    } else {
      inputText = texts[0];
    }

    const systemPrompt = this.buildPrompt(targetLang, this.config.formality);
    let userPrompt = inputText;

    // Add source language hint if known
    if (sourceLang !== 'auto') {
      userPrompt = `[Source: ${getLanguageName(sourceLang)}]\n${inputText}`;
    }

    // For batch, add instruction
    if (isArray && texts.length > 1) {
      userPrompt += '\n\nReturn each translation in the same numbered XML tags: <t0>translated text</t0>, <t1>translated text</t1>, etc.';
    }

    try {
      const data = await fetchProviderJson<OpenAIChatResponse>('OpenAI', OPENAI_API, {
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
          max_tokens: estimateMaxTokens(texts),
        }),
        signal: AbortSignal.timeout(CONFIG.timeouts.cloudApiMs),
      });

      // Track token usage
      if (data.usage) {
        this.totalTokensUsed += data.usage.total_tokens;
        /* v8 ignore start -- fire-and-forget persist */
        this.persist({ openai_tokens_used: this.totalTokensUsed }).catch((e) => this.log.warn('Failed to persist token usage:', e));
        /* v8 ignore stop */
      }

      const translated = data.choices[0]?.message?.content?.trim() || '';

      // Split back if batch
      if (isArray && texts.length > 1) {
        return parseBatchResponse(translated, texts.length, { separatorFallback: true });
      }

      return isArray ? [translated] : translated;
    } catch (error) {
      this.log.error('Translation error:', error);
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
        signal: AbortSignal.timeout(CONFIG.timeouts.cloudApiMs),
      });

      if (response.ok) {
        const data: OpenAIChatResponse = await response.json();
        const detected = data.choices[0]?.message?.content?.trim().toLowerCase();
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

  getSupportedLanguages(): LanguagePair[] {
    return generateAllLanguagePairs();
  }

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

