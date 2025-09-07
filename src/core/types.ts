/**
 * @fileoverview Core type definitions for Qwen Translator Extension
 * TypeScript interfaces and types with full type safety
 */

/// <reference path="../../types/chrome-extension.d.ts" />

/**
 * Translation request configuration
 */
export interface TranslationRequest {
  /** Text to translate */
  text: string;
  /** Source language code (e.g., 'en', 'zh', 'auto') */
  sourceLanguage: string;
  /** Target language code (e.g., 'en', 'zh') */
  targetLanguage: string;
  /** Translation provider ID (defaults to 'qwen') */
  provider?: string;
  /** Model to use for translation */
  model?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Whether to use streaming translation */
  stream?: boolean;
  /** Additional request metadata */
  metadata?: Record<string, any>;
}

/**
 * Translation response result
 */
export interface TranslationResult {
  /** The translated text */
  translatedText: string;
  /** Detected or specified source language */
  sourceLanguage: string;
  /** Target language used */
  targetLanguage: string;
  /** Provider that handled the translation */
  provider: string;
  /** Model used for translation */
  model: string;
  /** Number of tokens consumed */
  tokensUsed: number;
  /** Translation duration in milliseconds */
  duration: number;
  /** Translation confidence score (0-1) */
  confidence: number;
  /** Whether result came from cache */
  cached: boolean;
  /** Provider-specific metadata */
  metadata?: Record<string, any>;
}

/**
 * Translation provider configuration
 */
export interface ProviderConfig {
  /** Unique provider identifier */
  id: string;
  /** Human-readable provider name */
  name: string;
  /** Encrypted API key */
  apiKey: string;
  /** API endpoint URL */
  apiEndpoint: string;
  /** Default model to use */
  model: string;
  /** Available models for this provider */
  models: string[];
  /** Requests per minute limit */
  requestLimit: number;
  /** Tokens per minute limit */
  tokenLimit: number;
  /** Characters per request limit */
  charLimit: number;
  /** Provider weight for load balancing (0-1) */
  weight: number;
  /** Translation strategy */
  strategy: 'fast' | 'balanced' | 'quality';
  /** Cost per input token */
  costPerInputToken: number;
  /** Cost per output token */
  costPerOutputToken: number;
  /** Whether provider is enabled */
  enabled: boolean;
  /** Provider-specific throttling config */
  throttle?: ThrottleConfig;
}

/**
 * Cache entry structure
 */
export interface CacheEntry {
  /** Cache key (source:target:text hash) */
  key: string;
  /** Cached translation result */
  translatedText: string;
  /** Source language of cached entry */
  sourceLanguage: string;
  /** Target language of cached entry */
  targetLanguage: string;
  /** Provider that generated this translation */
  provider: string;
  /** Entry creation timestamp */
  timestamp: number;
  /** Time to live in milliseconds */
  ttl: number;
  /** Number of times entry was accessed */
  accessCount: number;
  /** Last access timestamp */
  lastAccessed: number;
}

/**
 * Throttling configuration
 */
export interface ThrottleConfig {
  /** Maximum requests per window */
  requestLimit: number;
  /** Maximum tokens per window */
  tokenLimit: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Context-specific configs */
  contexts?: Record<string, ThrottleConfig>;
}

/**
 * Storage operation result
 */
export interface StorageResult<T = any> {
  /** Whether operation succeeded */
  success: boolean;
  /** Retrieved data (for read operations) */
  data?: T;
  /** Error that occurred (if any) */
  error?: Error;
  /** Operation duration in milliseconds */
  duration: number;
}

/**
 * Extension configuration schema
 */
export interface ExtensionConfig {
  /** Primary API key (legacy, use providers instead) */
  apiKey: string;
  /** Language detection API key */
  detectApiKey: string;
  /** Primary API endpoint */
  apiEndpoint: string;
  /** Default model to use */
  model: string;
  /** Source language code */
  sourceLanguage: string;
  /** Target language code */
  targetLanguage: string;
  /** Whether to use streaming translation */
  streaming: boolean;
  /** Request timeout in milliseconds */
  timeout: number;
  /** UI theme selection */
  theme: 'modern' | 'cyberpunk' | 'apple';
  /** Whether translation is enabled */
  enabled: boolean;
  /** Whether to show usage statistics */
  showUsage: boolean;
  /** Provider configurations */
  providers: Record<string, ProviderConfig>;
  /** Active provider ID */
  activeProvider: string;
  /** Fallback provider IDs in order of preference */
  fallbackProviders: string[];
  /** Global throttling configuration */
  throttle: ThrottleConfig;
  /** Cache configuration */
  cache: CacheConfig;
  /** UI preferences */
  ui: UiConfig;
  /** Feature flags */
  features: FeatureFlags;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** Whether caching is enabled */
  enabled: boolean;
  /** Maximum cache entries */
  maxEntries: number;
  /** Default TTL for cache entries (ms) */
  defaultTtl: number;
  /** Cache cleanup interval (ms) */
  cleanupInterval: number;
  /** Strategy for cache eviction */
  evictionStrategy: 'lru' | 'lfu' | 'ttl';
  /** Storage backend to use */
  storageBackend: 'memory' | 'local' | 'session';
}

/**
 * UI configuration
 */
export interface UiConfig {
  /** Theme selection */
  theme: 'modern' | 'cyberpunk' | 'apple';
  /** Show translation overlay */
  showOverlay: boolean;
  /** Overlay position */
  overlayPosition: 'top' | 'bottom' | 'left' | 'right';
  /** Animation preferences */
  animations: boolean;
  /** Font size multiplier */
  fontScale: number;
  /** High contrast mode */
  highContrast: boolean;
  /** Reduce motion for accessibility */
  reduceMotion: boolean;
}

/**
 * Feature flags configuration
 */
export interface FeatureFlags {
  /** Enable experimental features */
  experimental: boolean;
  /** Enable PDF translation */
  pdfTranslation: boolean;
  /** Enable context menu translation */
  contextMenu: boolean;
  /** Enable keyboard shortcuts */
  shortcuts: boolean;
  /** Enable batch translation */
  batchTranslation: boolean;
  /** Enable auto-detection of language */
  autoDetection: boolean;
  /** Enable translation history */
  history: boolean;
  /** Enable translation glossary */
  glossary: boolean;
}

/**
 * Logger configuration
 */
export interface LogConfig {
  /** Logging level */
  level: 'debug' | 'info' | 'warn' | 'error';
  /** Enable console output */
  console: boolean;
  /** Enable storage of logs */
  storage: boolean;
  /** Maximum stored log entries */
  maxEntries: number;
  /** Log entry TTL (ms) */
  ttl: number;
  /** Include stack traces in error logs */
  includeStackTrace: boolean;
}

/**
 * WASM module configuration
 */
export interface WasmModuleConfig {
  /** Module name */
  name: string;
  /** Path to WASM file */
  wasmPath: string;
  /** Path to JS wrapper */
  jsPath: string;
  /** Module size in bytes */
  size: number;
  /** Whether to preload this module */
  preload: boolean;
  /** Dependencies to load first */
  dependencies: string[];
}

/**
 * PDF engine configuration
 */
export interface PdfEngineConfig {
  /** Engine name */
  name: string;
  /** Required WASM modules */
  wasmDeps: string[];
  /** Required JS dependencies */
  jsDeps: string[];
  /** Load priority (lower = higher priority) */
  priority: number;
  /** Features this engine supports */
  supportedFeatures: ('render' | 'text-extract' | 'annotations' | 'forms')[];
}

/**
 * Loader state for modules
 */
export interface LoaderState<T = any> {
  /** Current status */
  status: 'idle' | 'loading' | 'loaded' | 'error';
  /** Loaded module instance */
  module: T | null;
  /** Loading promise */
  promise?: Promise<T>;
  /** Load error if any */
  error?: Error;
  /** Time taken to load (ms) */
  loadTime?: number;
  /** Load start time */
  startTime?: number;
}

/**
 * Translation context for content scripts
 */
export interface TranslationContext {
  /** URL of the page being translated */
  url: string;
  /** Page title */
  title: string;
  /** Detected page language */
  pageLanguage: string;
  /** User's preferred target language */
  targetLanguage: string;
  /** DOM elements to translate */
  elements: HTMLElement[];
  /** Translation mode */
  mode: 'page' | 'selection' | 'auto';
}

/**
 * Extension messaging types
 */
export interface MessageRequest<T = any> {
  /** Message type identifier */
  type: string;
  /** Message payload */
  data: T;
  /** Request ID for correlation */
  id?: string;
  /** Sender context */
  sender?: 'popup' | 'content' | 'background';
}

export interface MessageResponse<T = any> {
  /** Whether request was successful */
  success: boolean;
  /** Response data */
  data?: T;
  /** Error message if request failed */
  error?: string;
  /** Request ID for correlation */
  id?: string;
}

/**
 * Statistics and metrics
 */
export interface UsageStats {
  /** Total translations performed */
  totalTranslations: number;
  /** Total tokens used */
  totalTokens: number;
  /** Total API cost */
  totalCost: number;
  /** Translations per provider */
  byProvider: Record<string, {
    count: number;
    tokens: number;
    cost: number;
    avgDuration: number;
  }>;
  /** Cache hit rate */
  cacheHitRate: number;
  /** Error rate */
  errorRate: number;
  /** Last reset timestamp */
  lastReset: number;
}

/**
 * Type guards and utility types
 */
export type TranslationMode = 'page' | 'selection' | 'auto';
export type ThemeType = 'modern' | 'cyberpunk' | 'apple';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type CacheStrategy = 'lru' | 'lfu' | 'ttl';
export type StorageBackend = 'memory' | 'local' | 'session';

/**
 * Utility type for async operations
 */
export type AsyncResult<T> = Promise<{ success: true; data: T } | { success: false; error: Error }>;

/**
 * Configuration validation result
 */
export interface ValidationResult {
  /** Whether configuration is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
}

// Export all types for use in other modules
export * from './wasm-loader';
export * from './pdf-loader';

// Global type declarations for extension context
declare global {
  interface Window {
    qwenTypes: typeof import('./types');
  }
}

// UMD compatibility for legacy code
if (typeof window !== 'undefined') {
  window.qwenTypes = {
    // Re-export all interfaces as objects for runtime access
  };
}