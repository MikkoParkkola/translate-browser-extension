/**
 * Core type definitions for the translation extension
 */

// ML translation pipeline (Transformers.js OPUS-MT / TranslateGemma)
export interface TranslationPipeline {
  (text: string, options?: { max_length?: number }): Promise<
    Array<{ translation_text: string }>
  >;
  dispose?(): Promise<void>;
}

// Provider types
export type ProviderType = 'local' | 'cloud' | 'hybrid';
export type QualityTier = 'basic' | 'standard' | 'premium';
export type Strategy = 'smart' | 'fast' | 'quality' | 'cost' | 'balanced';
export type TranslationProviderId = 'opus-mt' | 'translategemma' | 'chrome-builtin' | 'deepl' | 'openai' | 'google-cloud' | 'anthropic';
export type CloudProviderId = Exclude<TranslationProviderId, 'opus-mt' | 'translategemma' | 'chrome-builtin'>;
export type CloudProviderConfiguredStatus = Record<CloudProviderId, boolean>;
export type CloudProviderUsageSummary = Partial<Record<CloudProviderId, never>>;

/**
 * Standard discriminated-union response type for background message handlers.
 * T is the shape of extra fields present on the success branch.
 *
 * @example
 *   Promise<MessageResponse<{ available: boolean }>>
 *   // resolves to  { success: true; available: boolean }
 *              // | { success: false; error: string }
 */
export type MessageResponse<T extends Record<string, unknown> = Record<string, unknown>> =
  | ({ success: true } & T)
  | { success: false; error: string };

export type MessageResponseWithFallback<
  T extends Record<string, unknown> = Record<string, unknown>,
> =
  | ({ success: true } & T)
  | ({ success: false; error: string } & T);

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
  provider: TranslationProviderId;
  cached: boolean;
  duration: number;
}

export interface TranslationContext {
  before: string;
  after: string;
  pageContext?: string;  // Page structure context for better disambiguation
}

export interface TranslationOptions {
  strategy?: Strategy;
  maxRetries?: number;
  timeout?: number;
  context?: TranslationContext;
}

// Language detection
export interface LanguageDetectionResult {
  lang: string;
  confidence: number;
}

// Language types
export interface LanguagePair {
  src: string;
  tgt: string;
}

export interface SupportedLanguageInfo extends LanguagePair {
  pivot?: boolean;
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
  provider?: TranslationProviderId;
  duration?: number;
  cached?: boolean;
  fromCorrection?: boolean;
  profilingReport?: object;
}

export interface CloudProviderUsage {
  tokens: number;
  cost: number;
  limitReached: boolean;
}

export interface DownloadedModelRecord {
  id: string;
  name?: string;
  size: number;
  lastUsed?: number;
}

export interface PredictionStats {
  domainCount: number;
  totalTranslations: number;
  recentTranslations: number;
  preferredTarget: string;
  topDomains: Array<{ domain: string; detections: number }>;
}

export interface OCRBlock {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface ExtensionSettingsData {
  sourceLanguage: string;
  targetLanguage: string;
  provider: TranslationProviderId;
  strategy: string;
}

export interface ProvidersMessagePayload {
  providers: unknown[];
  activeProvider: TranslationProviderId;
  strategy: Strategy;
  supportedLanguages: SupportedLanguageInfo[];
  error?: string;
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

export interface OffscreenModelProgressMessage {
  type: 'offscreenModelProgress';
  target: 'background';
  status: ModelProgressMessage['status'];
  modelId: string;
  progress?: number;
  loaded?: number;
  total?: number;
  file?: string;
  error?: string;
}

export interface OffscreenDownloadedModelUpdateMessage {
  type: 'offscreenDownloadedModelUpdate';
  target: 'background';
  modelId: string;
  name?: string;
  size?: number;
  lastUsed?: number;
}

export type OffscreenModelMessage =
  | OffscreenModelProgressMessage
  | OffscreenDownloadedModelUpdateMessage;

// Preload message for lazy model loading
export interface PreloadModelMessage {
  type: 'preloadModel';
  sourceLang: string;
  targetLang: string;
  target?: string;
  provider?: TranslationProviderId;
  priority?: 'low' | 'high';
}

export interface PreloadModelResponsePayload extends Record<string, unknown> {
  preloaded: boolean;
  partial?: boolean;
  available?: boolean;
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

export interface GetUsageResponsePayload {
  throttle: ThrottleUsage;
  cache: DetailedCacheStats;
  providers: CloudProviderUsageSummary;
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
  provider: CloudProviderId;
  apiKey: string;
  options?: Record<string, unknown>;
  target?: string;
}

export interface ClearCloudApiKeyMessage {
  type: 'clearCloudApiKey';
  provider: CloudProviderId;
  target?: string;
}

export interface SetCloudProviderEnabledMessage {
  type: 'setCloudProviderEnabled';
  provider: CloudProviderId;
  enabled: boolean;
  target?: string;
}

export interface GetCloudProviderUsageMessage {
  type: 'getCloudProviderUsage';
  provider: CloudProviderId;
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

// PDF translation
export interface TranslatePdfMessage {
  type: 'translatePdf';
  targetLang: string;
  target?: string;
}

// OCR (image text extraction)
export interface OCRImageMessage {
  type: 'ocrImage';
  imageData: string;
  lang?: string;
  target?: string;
}

// Screenshot capture (for OCR translation of screen regions)
export interface CaptureScreenshotMessage {
  type: 'captureScreenshot';
  rect?: { x: number; y: number; width: number; height: number };
  devicePixelRatio?: number;
  target?: string;
}

// Model management
export interface DeleteModelMessage {
  type: 'deleteModel';
  modelId: string;
  target?: string;
}

export interface ClearAllModelsMessage {
  type: 'clearAllModels';
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
  | OffscreenModelMessage
  | BatchProgressMessage
  | SetProviderMessage
  | RecordLanguageDetectionMessage
  | GetPredictionStatsMessage
  | GetCloudProviderStatusMessage
  | SetCloudApiKeyMessage
  | ClearCloudApiKeyMessage
  | SetCloudProviderEnabledMessage
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
  | TranslatePdfMessage
  | OCRImageMessage
  | CaptureScreenshotMessage
  | OffscreenModelMessage
  | { type: 'getDownloadedModels'; target?: string }
  | { type: 'checkWebGPU'; target?: string }
  | { type: 'checkWebNN'; target?: string }
  | DeleteModelMessage
  | ClearAllModelsMessage
  | { type: 'getSettings'; target?: string };

export interface ExtensionMessageResponseMap {
  ping: { success: true; status: 'ready'; provider: TranslationProviderId };
  translate: TranslateResponse;
  getUsage: GetUsageResponsePayload;
  getProviders: ProvidersMessagePayload;
  preloadModel: MessageResponse<PreloadModelResponsePayload>;
  offscreenModelProgress: MessageResponse;
  offscreenDownloadedModelUpdate: MessageResponse;
  setProvider: MessageResponse<{ provider: TranslationProviderId }>;
  getCacheStats: MessageResponse<{ cache: DetailedCacheStats }>;
  clearCache: { success: boolean; clearedEntries: number };
  checkChromeTranslator: { success: true; available: boolean };
  checkWebGPU: { success: true; supported: boolean; fp16: boolean };
  checkWebNN: { success: true; supported: boolean };
  getPredictionStats: MessageResponse<{ prediction: PredictionStats }>;
  recordLanguageDetection: MessageResponse;
  getCloudProviderStatus: MessageResponseWithFallback<{ status: CloudProviderConfiguredStatus }>;
  setCloudApiKey: MessageResponse<{ provider: CloudProviderId }>;
  clearCloudApiKey: MessageResponse<{ provider: CloudProviderId }>;
  setCloudProviderEnabled: MessageResponse<{ provider: CloudProviderId; enabled: boolean }>;
  getCloudProviderUsage: MessageResponse<{ usage?: CloudProviderUsage }>;
  getProfilingStats: MessageResponse<{ aggregates: Record<string, unknown>; formatted: string }>;
  clearProfilingStats: MessageResponse;
  getHistory: { success: boolean; history: unknown[]; error?: string };
  clearHistory: MessageResponse;
  addCorrection: MessageResponse;
  getCorrection: MessageResponse<{ correction: string | null; hasCorrection: boolean }>;
  getAllCorrections: { success: boolean; corrections: unknown[]; error?: string };
  getCorrectionStats: {
    success: boolean;
    stats: { total: number; totalUses: number; topCorrections: unknown[] };
    error?: string;
  };
  clearCorrections: MessageResponse;
  deleteCorrection: MessageResponse<{ deleted: boolean }>;
  exportCorrections: { success: boolean; json?: string; error?: string };
  importCorrections: MessageResponse<{ importedCount: number }>;
  ocrImage: MessageResponse<{ text?: string; confidence?: number; blocks?: OCRBlock[] }>;
  captureScreenshot: MessageResponse<{ imageData: string }>;
  getDownloadedModels: MessageResponse<{ models: DownloadedModelRecord[] }>;
  deleteModel: MessageResponse;
  clearAllModels: MessageResponse;
  getSettings: MessageResponse<{ data: ExtensionSettingsData }>;
}

export type BackgroundRequestMessage = Extract<
  ExtensionMessage,
  { type: keyof ExtensionMessageResponseMap }
>;

export type BackgroundRequestMessageType = BackgroundRequestMessage['type'];

export type ExtensionMessageResponse<TMessage extends BackgroundRequestMessage> =
  ExtensionMessageResponseMap[TMessage['type']];

export type ExtensionMessageResponseByType<
  TType extends keyof ExtensionMessageResponseMap,
> = ExtensionMessageResponseMap[TType];

/**
 * Commands sent FROM the background service worker TO the content script.
 * These are distinct from ExtensionMessage (content → background direction).
 * Subset of ContentMessage (defined in content/content-types.ts) covering only
 * the commands that the background initiates.
 */
export type ContentCommand =
  | { type: 'translatePage'; sourceLang: string; targetLang: string; strategy: Strategy; provider?: TranslationProviderId }
  | { type: 'translateSelection'; sourceLang: string; targetLang: string; strategy: Strategy; provider?: TranslationProviderId }
  | { type: 'translateImage'; imageUrl?: string; sourceLang: string; targetLang: string; strategy: Strategy; provider?: TranslationProviderId }
  | { type: 'undoTranslation' }
  | { type: 'toggleWidget' }
  | { type: 'enterScreenshotMode' };
