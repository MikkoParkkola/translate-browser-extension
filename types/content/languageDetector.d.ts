/**
 * TypeScript definitions for AdvancedLanguageDetector module
 */

export interface LanguageDetectorOptions {
  enableDOMAnalysis?: boolean;
  enableContextualHints?: boolean;
  confidence?: {
    word: number;
    context: number;
  };
}

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  method: 'pattern' | 'heuristic' | 'api';
  script: string;
}

export interface LanguageContext {
  attributes: {
    lang?: string;
    xmlLang?: string;
  };
  meta: {
    documentLang?: string;
    contentLanguage?: string;
  };
}

export declare class AdvancedLanguageDetector {
  constructor(options?: LanguageDetectorOptions);

  detectLanguage(text: string, context?: Record<string, any>): Promise<LanguageDetectionResult | null>;

  private detectLatinLanguage(text: string, context: Record<string, any>): LanguageDetectionResult | null;
  private getScriptName(languageCode: string): string;
  private analyzeContext(element: Element): LanguageContext;
}