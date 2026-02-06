/**
 * Core type definitions for the translation extension
 */

// Provider types
export type ProviderType = 'local' | 'cloud' | 'hybrid';
export type QualityTier = 'basic' | 'standard' | 'premium';
export type Strategy = 'smart' | 'fast' | 'quality' | 'cost' | 'balanced';
export type TranslationProviderId = 'opus-mt' | 'translategemma';

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
  provider?: TranslationProviderId;
}

export interface TranslateResponse {
  success: boolean;
  result?: string | string[];
  error?: string;
  provider?: string;
  duration?: number;
}

// Model progress types
export interface ModelProgressMessage {
  type: 'modelProgress';
  target?: string;
  status: 'initiate' | 'download' | 'progress' | 'done' | 'ready' | 'error';
  modelId: string;
  progress?: number; // 0-100
  loaded?: number;   // bytes loaded
  total?: number;    // bytes total
  file?: string;     // current file being downloaded
  error?: string;
}

export interface ModelStatusMessage {
  type: 'modelStatus';
  target?: string;
  status: 'loading' | 'cached' | 'error';
  modelId: string;
  progress?: number;
}

// Preload message for lazy model loading
export interface PreloadModelMessage {
  type: 'preloadModel';
  sourceLang: string;
  targetLang: string;
  target?: string;
}

// Batch progress message
export interface BatchProgressMessage {
  type: 'batchProgress';
  completed: number;
  total: number;
  batchIndex: number;
  totalBatches: number;
}

// Cache statistics
export interface CacheStats {
  size: number;
  maxSize: number;
  hitRate: string;
  oldestEntry: number | null;
}

export interface SetProviderMessage {
  type: 'setProvider';
  provider: TranslationProviderId;
  target?: string;
}

export type ExtensionMessage =
  | (TranslateMessage & { target?: string })
  | { type: 'getUsage'; target?: string }
  | { type: 'getProviders'; target?: string }
  | { type: 'getSupportedLanguages'; target?: string }
  | { type: 'getModelStatus'; target?: string }
  | { type: 'getDeviceInfo'; target?: string }
  | { type: 'getCacheStats'; target?: string }
  | { type: 'clearCache'; target?: string }
  | { type: 'ping'; target?: string }
  | PreloadModelMessage
  | ModelProgressMessage
  | ModelStatusMessage
  | BatchProgressMessage
  | SetProviderMessage;
