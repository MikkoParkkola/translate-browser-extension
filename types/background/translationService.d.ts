/**
 * TypeScript definitions for BackgroundTranslationService module
 */

export interface ProviderConfig {
  endpoint: string;
  model: string;
  maxTokens: number;
  temperature: number;
  cost: {
    inputPer1k: number;
    outputPer1k: number;
  };
}

export interface TranslationOptions {
  provider?: string;
  strategy?: 'smart' | 'fast' | 'quality';
}

export interface UsageStats {
  throttle: {
    requestsUsed: number;
    tokensUsed: number;
    requestLimit: number;
    tokenLimit: number;
    windowMs: number;
  };
  cache: {
    size: number;
    hitRate: number;
  };
  providers: string[];
}

export interface TestProviderResult {
  success: boolean;
  provider: string;
  result?: string;
  error?: string;
}

export declare class TranslationService {
  constructor();

  translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    options?: TranslationOptions
  ): Promise<string>;

  testProvider(providerName: string): Promise<TestProviderResult>;
  getUsageStats(): UsageStats;
  clearCache(): void;

  private initializeProviders(): void;
  private performTranslation(
    text: string,
    sourceLanguage: string,
    targetLanguage: string,
    config: ProviderConfig
  ): Promise<string>;
  private buildSystemPrompt(sourceLanguage: string, targetLanguage: string): string;
  private selectOptimalProvider(text: string, options: TranslationOptions): string;
  private estimateTokens(text: string): number;
  private getCacheKey(text: string, sourceLanguage: string, targetLanguage: string): string;
  private simpleHash(str: string): string;
  private cleanCache(): void;
  private getApiKey(): Promise<string | null>;
}