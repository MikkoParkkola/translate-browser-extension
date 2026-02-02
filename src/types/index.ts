/**
 * Core type definitions for the translation extension
 */

// Provider types
export type ProviderType = 'local' | 'cloud' | 'hybrid';
export type QualityTier = 'basic' | 'standard' | 'premium';
export type Strategy = 'smart' | 'fast' | 'quality' | 'cost' | 'balanced';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  qualityTier: QualityTier;
  costPerMillion: number;
  icon: string;
}

export interface TranslationResult {
  text: string;
  provider: string;
  cached: boolean;
  duration: number;
}

export interface TranslationOptions {
  strategy?: Strategy;
  maxRetries?: number;
  timeout?: number;
}

// Language types
export interface LanguagePair {
  src: string;
  tgt: string;
}

// Throttle types
export interface ThrottleConfig {
  requestLimit: number;
  tokenLimit: number;
  windowMs: number;
}

export interface ThrottleUsage {
  requests: number;
  tokens: number;
  requestLimit: number;
  tokenLimit: number;
  totalRequests: number;
  totalTokens: number;
  queue: number;
}

// Usage tracking
export interface UsageStats {
  today: {
    requests: number;
    characters: number;
    cost: number;
  };
  budget: {
    monthly: number;
    used: number;
  };
}

// Provider interface
export interface TranslationProvider {
  id: string;
  name: string;
  type: ProviderType;
  qualityTier: QualityTier;
  costPerMillion: number;
  icon: string;

  initialize(): Promise<void>;
  translate(text: string | string[], sourceLang: string, targetLang: string, options?: TranslationOptions): Promise<string | string[]>;
  detectLanguage(text: string): Promise<string>;
  isAvailable(): Promise<boolean>;
  getSupportedLanguages(): LanguagePair[];
  test(): Promise<boolean>;
  getInfo(): ProviderConfig;
}

// WebGPU types
export interface WebGPUInfo {
  supported: boolean;
  initialized: boolean;
  provider: 'webgpu' | 'wasm';
  device: string;
}

// Router preferences
export interface RouterPreferences {
  prioritize: Strategy;
  preferLocal: boolean;
  enabledProviders: string[];
  primaryProvider: string;
}

// Message types for extension communication
export interface TranslateMessage {
  type: 'translate';
  text: string | string[];
  sourceLang: string;
  targetLang: string;
  options?: TranslationOptions;
}

export interface TranslateResponse {
  success: boolean;
  result?: string | string[];
  error?: string;
  provider?: string;
  duration?: number;
}

export type ExtensionMessage =
  | (TranslateMessage & { target?: string })
  | { type: 'getUsage'; target?: string }
  | { type: 'getProviders'; target?: string }
  | { type: 'getSupportedLanguages'; target?: string }
  | { type: 'ping'; target?: string };
