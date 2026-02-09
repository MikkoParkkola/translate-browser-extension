/**
 * Core type definitions for the translation extension
 */

// Provider types
export type ProviderType = 'local' | 'cloud' | 'hybrid';
export type QualityTier = 'basic' | 'standard' | 'premium';
export type Strategy = 'smart' | 'fast' | 'quality' | 'cost' | 'balanced';
export type TranslationProviderId = 'opus-mt' | 'translategemma' | 'chrome-builtin' | 'deepl' | 'openai' | 'google-cloud' | 'anthropic';

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

export interface TranslationContext {
  before: string;
  after: string;
}

export interface TranslationOptions {
  strategy?: Strategy;
  maxRetries?: number;
  timeout?: number;
  context?: TranslationContext;
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
  provider?: TranslationProviderId;
  priority?: 'low' | 'high';
}

// Language detection recording message
export interface RecordLanguageDetectionMessage {
  type: 'recordLanguageDetection';
  url: string;
  language: string;
  target?: string;
}

// Get prediction statistics message
export interface GetPredictionStatsMessage {
  type: 'getPredictionStats';
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

// Detailed cache statistics (enhanced translation memory)
export interface DetailedCacheStats extends CacheStats {
  totalHits: number;
  totalMisses: number;
  mostUsed: Array<{ text: string; useCount: number; langs: string }>;
  memoryEstimate: string;
  languagePairs: Record<string, number>;
}

export interface SetProviderMessage {
  type: 'setProvider';
  provider: TranslationProviderId;
  target?: string;
}

// Page translation message
export interface TranslatePageMessage {
  type: 'translatePage';
  sourceLang: string;
  targetLang: string;
  strategy?: Strategy;
  provider?: TranslationProviderId;
  target?: string;
}

// Ping message for checking extension availability
export interface PingMessage {
  type: 'ping';
  target?: string;
}

// Get usage statistics
export interface GetUsageMessage {
  type: 'getUsage';
  target?: string;
}

// Clear translation cache
export interface ClearCacheMessage {
  type: 'clearCache';
  target?: string;
}

// Get supported languages
export interface GetSupportedLanguagesMessage {
  type: 'getSupportedLanguages';
  target?: string;
}

// Cloud provider API key management
export interface GetCloudProviderStatusMessage {
  type: 'getCloudProviderStatus';
  target?: string;
}

export interface SetCloudApiKeyMessage {
  type: 'setCloudApiKey';
  provider: string;
  apiKey: string;
  options?: Record<string, unknown>;
  target?: string;
}

export interface ClearCloudApiKeyMessage {
  type: 'clearCloudApiKey';
  provider: string;
  target?: string;
}

export interface GetCloudProviderUsageMessage {
  type: 'getCloudProviderUsage';
  provider: string;
  target?: string;
}

// Profiling stats
export interface GetProfilingStatsMessage {
  type: 'getProfilingStats';
  target?: string;
}

export interface ClearProfilingStatsMessage {
  type: 'clearProfilingStats';
  target?: string;
}

// Translation history
export interface GetHistoryMessage {
  type: 'getHistory';
  target?: string;
}

export interface ClearHistoryMessage {
  type: 'clearHistory';
  target?: string;
}

// Corrections (learn from user edits)
export interface AddCorrectionMessage {
  type: 'addCorrection';
  original: string;
  machineTranslation: string;
  userCorrection: string;
  sourceLang: string;
  targetLang: string;
  target?: string;
}

export interface GetCorrectionMessage {
  type: 'getCorrection';
  original: string;
  sourceLang: string;
  targetLang: string;
  target?: string;
}

export interface GetAllCorrectionsMessage {
  type: 'getAllCorrections';
  target?: string;
}

export interface GetCorrectionStatsMessage {
  type: 'getCorrectionStats';
  target?: string;
}

export interface ClearCorrectionsMessage {
  type: 'clearCorrections';
  target?: string;
}

export interface DeleteCorrectionMessage {
  type: 'deleteCorrection';
  original: string;
  sourceLang: string;
  targetLang: string;
  target?: string;
}

export interface ExportCorrectionsMessage {
  type: 'exportCorrections';
  target?: string;
}

export interface ImportCorrectionsMessage {
  type: 'importCorrections';
  json: string;
  target?: string;
}

// OCR (image text extraction)
export interface OCRImageMessage {
  type: 'ocrImage';
  imageData: string;
  lang?: string;
  target?: string;
}

export type ExtensionMessage =
  | TranslateMessage
  | TranslatePageMessage
  | PingMessage
  | GetUsageMessage
  | GetSupportedLanguagesMessage
  | ClearCacheMessage
  | { type: 'getProviders'; target?: string }
  | { type: 'getModelStatus'; target?: string }
  | { type: 'getDeviceInfo'; target?: string }
  | { type: 'getCacheStats'; target?: string }
  | { type: 'checkChromeTranslator'; target?: string }
  | PreloadModelMessage
  | ModelProgressMessage
  | ModelStatusMessage
  | BatchProgressMessage
  | SetProviderMessage
  | RecordLanguageDetectionMessage
  | GetPredictionStatsMessage
  | GetCloudProviderStatusMessage
  | SetCloudApiKeyMessage
  | ClearCloudApiKeyMessage
  | GetCloudProviderUsageMessage
  | GetProfilingStatsMessage
  | ClearProfilingStatsMessage
  | GetHistoryMessage
  | ClearHistoryMessage
  | AddCorrectionMessage
  | GetCorrectionMessage
  | GetAllCorrectionsMessage
  | GetCorrectionStatsMessage
  | ClearCorrectionsMessage
  | DeleteCorrectionMessage
  | ExportCorrectionsMessage
  | ImportCorrectionsMessage
  | OCRImageMessage
  | { type: 'getDownloadedModels'; target?: string }
  | { type: 'getSettings'; target?: string };
