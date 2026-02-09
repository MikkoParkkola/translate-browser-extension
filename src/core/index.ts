/**
 * Core module exports
 */

// Error handling
export {
  type ErrorCategory,
  type TranslationError,
  createTranslationError,
  type RetryConfig,
  DEFAULT_RETRY_CONFIG,
  calculateRetryDelay,
  withRetry,
  type InputValidationResult,
  MAX_TEXT_LENGTH,
  MAX_BATCH_SIZE,
  validateInput,
  isNetworkError,
  isMemoryError,
  isModelError,
  isRetryableError,
} from './errors';

// HTTP error handling
export { type HttpErrorResult, handleProviderHttpError } from './http-errors';

// Rate limiting
export { Throttle, throttle } from './throttle';

// Translation cache
export {
  type CacheEntry,
  type TranslationCacheStats,
  TranslationCache,
  getTranslationCache,
  resetTranslationCache,
} from './translation-cache';

// Site rules
export { siteRules, type SiteRules, type SiteRulesStore } from './site-rules';

// Glossary
export { glossary, type GlossaryTerm, type GlossaryStore } from './glossary';

// Language utilities
export {
  getLanguageName,
  toDeepLCode,
  getDeepLSupportedLanguages,
  getAllLanguageCodes,
} from './language-map';

// Logging
export { createLogger } from './logger';

// Storage utilities
export { safeStorageGet, safeStorageSet } from './storage';

// Hash utilities
export { fnv1aHash, generateCacheKey } from './hash';

// WebGPU detection
export { webgpuDetector } from './webgpu-detector';

// Language detection
export { detectLanguage, samplePageText } from './language-detector';

// Translation router
export { TranslationRouter, translationRouter } from './translation-router';
