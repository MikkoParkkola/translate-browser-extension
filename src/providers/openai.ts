/**
 * OpenAI Translation Provider
 * Uses chat completions API with translation prompts
 * https://platform.openai.com/docs/api-reference/chat
 */

import { CloudProvider, updateCloudProviderApiKey } from './cloud-provider';
import { createTranslationError } from '../core/errors';
import { getLanguageName } from '../core/language-map';
import { CONFIG } from '../config';
import { fetchProviderJson, estimateMaxTokens, generateAllLanguagePairs, parseBatchResponse } from './provider-utils';
import type { TranslationOptions, LanguagePair, ProviderConfig } from '../types';
import type { CloudProviderStorageRecord } from '../background/shared/provider-config-types';
import { extractOpenAIStoredRuntimeState } from '../background/shared/config-validation';
import {
  DEFAULT_OPENAI_FORMALITY,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TEMPERATURE,
  OPENAI_MODEL_VALUES,
} from '../shared/cloud-provider-configs';

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';
const OPENAI_STORAGE_KEYS = [
  'openai_api_key',
  'openai_model',
  'openai_formality',
  'openai_temperature',
  'openai_tokens_used',
] as const;

export type OpenAIFormality = 'formal' | 'informal' | 'neutral';
export type OpenAIModel = (typeof OPENAI_MODEL_VALUES)[number];

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

const OPENAI_DEFAULT_CONFIG: Omit<OpenAIConfig, 'apiKey'> = {
  model: DEFAULT_OPENAI_MODEL,
  formality: DEFAULT_OPENAI_FORMALITY,
  temperature: DEFAULT_OPENAI_TEMPERATURE,
};

export class OpenAIProvider extends CloudProvider<OpenAIConfig> {
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

  protected applyStoredConfig(stored: CloudProviderStorageRecord): void {
    const runtimeState = extractOpenAIStoredRuntimeState(stored);
    if (!runtimeState) {
      this.resetConfig();
      return;
    }

    this.config = runtimeState.config;
    this.totalTokensUsed = runtimeState.tokensUsed;
    this.log.info('Initialized with model:', this.config.model);
  }

  protected resetConfig(): void {
    this.config = null;
    this.totalTokensUsed = 0;
  }

  protected getConfigState(): OpenAIConfig | null {
    return this.config;
  }

  protected setConfigState(config: OpenAIConfig | null): void {
    this.config = config;
  }

  /**
   * Store API key and settings in storage
   */
  async setApiKey(apiKey: string): Promise<void> {
    await this.persistAndUpdateConfig(
      { openai_api_key: apiKey },
      (config) => updateCloudProviderApiKey(config, apiKey, OPENAI_DEFAULT_CONFIG)
    );
  }

  /** Set model preference */
  async setModel(model: OpenAIModel): Promise<void> {
    await this.persistAndUpdateLoadedConfig(
      { openai_model: model },
      (config) => ({ ...config, model })
    );
  }

  /** Set formality preference */
  async setFormality(formality: OpenAIFormality): Promise<void> {
    await this.persistAndUpdateLoadedConfig(
      { openai_formality: formality },
      (config) => ({ ...config, formality })
    );
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
    const config = this.requireConfiguredConfig('OpenAI');

    const isArray = Array.isArray(text);
    const texts = isArray ? text : [text];

    // For batch translations, use XML-like tags for unambiguous separation
    let inputText: string;
    if (isArray && texts.length > 1) {
      inputText = texts.map((t, i) => `<t${i}>${t}</t${i}>`).join('\n');
    } else {
      inputText = texts[0];
    }

    const systemPrompt = this.buildPrompt(targetLang, config.formality);
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
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: config.temperature,
          max_tokens: estimateMaxTokens(texts),
        }),
      });

      // Track token usage
      if (data.usage) {
        this.totalTokensUsed += data.usage.total_tokens;
        this.persistBestEffort(
          { openai_tokens_used: this.totalTokensUsed },
          'Failed to persist token usage:'
        );
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
    const config = this.getConfiguredConfig();
    if (!config) {
      return 'auto';
    }

    try {
      const response = await fetch(OPENAI_API, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: DEFAULT_OPENAI_MODEL, // Use cheaper model for detection
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

    const rate = costPer1K[this.config?.model ?? DEFAULT_OPENAI_MODEL];
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
      model: this.config?.model ?? DEFAULT_OPENAI_MODEL,
      formality: this.config?.formality ?? DEFAULT_OPENAI_FORMALITY,
    };
  }
}

// Singleton instance
export const openaiProvider = new OpenAIProvider();

export default openaiProvider;
