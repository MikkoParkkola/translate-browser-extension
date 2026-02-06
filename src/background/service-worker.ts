/**
 * Background Service Worker
 * Uses offscreen document for ML inference (service workers can't access DOM)
 *
 * Performance optimizations:
 * - LRU translation cache (max 100 entries)
 * - Lazy model loading (preload on popup open)
 * - Retry with exponential backoff for transient failures
 * - Predictive model pre-translation based on browsing patterns
 */

import type { ExtensionMessage, TranslateResponse, Strategy, TranslationProviderId } from '../types';
import {
  createTranslationError,
  validateInput,
  withRetry,
  isNetworkError,
  type TranslationError,
  type RetryConfig,
} from '../core/errors';
import { createLogger } from '../core/logger';
import { safeStorageGet, safeStorageSet } from '../core/storage';
import { generateCacheKey } from '../core/hash';
import { getPredictionEngine } from '../core/prediction-engine';
import { CONFIG } from '../config';
import { profiler, type AggregateStats } from '../core/profiler';
// Browser API imported but may not be needed in Chrome service worker
// import { browserAPI, getURL } from '../core/browser-api';

const log = createLogger('Background');

// ============================================================================
// Translation Cache (LRU, max 100 entries)
// ============================================================================

interface CacheEntry {
  result: string | string[];
  timestamp: number;
  sourceLang: string;
  targetLang: string;
}

const translationCache = new Map<string, CacheEntry>();

/**
 * Generate cache key from translation parameters.
 * Uses FNV-1a hash to prevent collisions from text truncation.
 */
function getCacheKey(text: string | string[], sourceLang: string, targetLang: string, provider?: string): string {
  const providerKey = provider || currentProvider;
  return generateCacheKey(text, sourceLang, targetLang, providerKey);
}

/**
 * Get cached translation if available.
 */
function getCachedTranslation(key: string): CacheEntry | undefined {
  const entry = translationCache.get(key);
  if (entry) {
    // Move to end for LRU (delete and re-add)
    translationCache.delete(key);
    translationCache.set(key, entry);
    log.info(` Cache HIT: ${key.substring(0, 40)}...`);
  }
  return entry;
}

/**
 * Store translation in cache with LRU eviction.
 */
function setCachedTranslation(
  key: string,
  result: string | string[],
  sourceLang: string,
  targetLang: string
): void {
  // Evict oldest entries if at capacity
  while (translationCache.size >= CONFIG.cache.maxSize) {
    const oldestKey = translationCache.keys().next().value;
    if (oldestKey) {
      translationCache.delete(oldestKey);
      log.info(` Cache evicted oldest entry`);
    }
  }

  translationCache.set(key, {
    result,
    timestamp: Date.now(),
    sourceLang,
    targetLang,
  });
  log.info(` Cached translation (${translationCache.size}/${CONFIG.cache.maxSize})`);
}

/**
 * Get cache statistics for diagnostics.
 */
function getCacheStats(): {
  size: number;
  maxSize: number;
  hitRate: string;
  oldestEntry: number | null;
} {
  let oldestTimestamp: number | null = null;
  for (const entry of translationCache.values()) {
    if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
    }
  }
  return {
    size: translationCache.size,
    maxSize: CONFIG.cache.maxSize,
    hitRate: `${cacheHits}/${cacheHits + cacheMisses} (${cacheHits + cacheMisses > 0 ? Math.round(cacheHits / (cacheHits + cacheMisses) * 100) : 0}%)`,
    oldestEntry: oldestTimestamp,
  };
}

// Cache hit/miss tracking
let cacheHits = 0;
let cacheMisses = 0;

// ============================================================================
// Prediction Engine Integration
// ============================================================================

const predictionEngine = getPredictionEngine();

// Track preloaded models to avoid duplicate preloads
const preloadedModels = new Set<string>();

/**
 * Preload models based on predictions (called on tab navigation)
 */
async function preloadPredictedModels(url: string): Promise<void> {
  try {
    // Check if user has recent activity
    const hasActivity = await predictionEngine.hasRecentActivity();
    if (!hasActivity) {
      log.debug('No recent activity, skipping predictive preload');
      return;
    }

    // Get predictions for this URL
    const predictions = await predictionEngine.predict(url);
    if (predictions.length === 0) {
      return;
    }

    log.info(`Predictive preload: ${predictions.length} candidates for ${url}`);

    // Preload top predictions (up to 3 models max)
    for (const prediction of predictions) {
      const key = `${prediction.sourceLang}-${prediction.targetLang}`;

      // Skip if already preloaded
      if (preloadedModels.has(key)) {
        log.debug(`Model ${key} already preloaded`);
        continue;
      }

      // Skip low confidence predictions
      if (prediction.confidence < 0.3) {
        log.debug(`Skipping low confidence prediction: ${key} (${prediction.confidence.toFixed(2)})`);
        continue;
      }

      log.info(`Preloading predicted model: ${key} (confidence: ${prediction.confidence.toFixed(2)})`);

      // Send preload message to offscreen (fire and forget)
      sendToOffscreen<{ success: boolean; preloaded?: boolean }>({
        type: 'preloadModel',
        sourceLang: prediction.sourceLang,
        targetLang: prediction.targetLang,
        provider: currentProvider,
        priority: 'low', // Background preload
      })
        .then((response) => {
          if (response.preloaded) {
            preloadedModels.add(key);
            log.info(`Predictive preload complete: ${key}`);
          }
        })
        .catch((error) => {
          log.warn(`Predictive preload failed for ${key}:`, error);
        });
    }
  } catch (error) {
    log.warn('Predictive preload error:', error);
  }
}

/**
 * Record language detection for prediction engine
 */
async function recordLanguageDetection(url: string, language: string): Promise<void> {
  try {
    await predictionEngine.recordDetection(url, language);
  } catch (error) {
    log.warn('Failed to record language detection:', error);
  }
}

/**
 * Record translation for prediction engine (updates activity and preferred target)
 */
async function recordTranslation(targetLang: string): Promise<void> {
  try {
    await predictionEngine.recordTranslation(targetLang);
  } catch (error) {
    log.warn('Failed to record translation:', error);
  }
}

// ============================================================================
// Offscreen Document Management
// ============================================================================

let creatingOffscreen: Promise<void> | null = null;
let offscreenFailureCount = 0;

// Retry configuration for different scenarios (from centralized config)
const NETWORK_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: CONFIG.retry.network.maxRetries,
  baseDelayMs: CONFIG.retry.network.baseDelayMs,
  maxDelayMs: CONFIG.retry.network.maxDelayMs,
};

const OFFSCREEN_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: CONFIG.retry.offscreen.maxRetries,
  baseDelayMs: CONFIG.retry.offscreen.baseDelayMs,
  maxDelayMs: CONFIG.retry.offscreen.maxDelayMs,
};

/**
 * Create or verify offscreen document exists
 *
 * P0 FIX: Race condition guard moved BEFORE async getContexts() call
 * to prevent TOCTOU window where multiple calls could pass the contexts
 * check before the first creation starts.
 */
async function ensureOffscreenDocument(): Promise<void> {
  // P0 FIX: Check creation lock FIRST to avoid TOCTOU race condition
  // If another call is already creating the document, just wait for it
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  const offscreenUrl = chrome.runtime.getURL('src/offscreen/offscreen.html');

  try {
    // Check if already exists
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [offscreenUrl],
    });

    if (existingContexts.length > 0) {
      offscreenFailureCount = 0;
      return;
    }

    // Double-check: another call might have created it while we were checking
    if (creatingOffscreen) {
      await creatingOffscreen;
      return;
    }

    console.log('[Background] Creating offscreen document...');

    creatingOffscreen = chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run Transformers.js ML inference in document context',
    });

    await creatingOffscreen;
    creatingOffscreen = null;
    offscreenFailureCount = 0;
    console.log('[Background] Offscreen document created successfully');
  } catch (error) {
    creatingOffscreen = null;
    offscreenFailureCount++;

    const errMsg = error instanceof Error ? error.message : String(error);
    log.error(' Failed to create offscreen document:', errMsg);

    // If we've failed too many times, give a clearer error
    if (offscreenFailureCount >= CONFIG.retry.maxOffscreenFailures) {
      throw new Error(
        'Translation engine failed to start. Please reload the extension or restart Chrome.'
      );
    }

    throw new Error(`Failed to initialize translation engine: ${errMsg}`);
  }
}

/**
 * Close and recreate offscreen document (for recovery from errors)
 */
async function resetOffscreenDocument(): Promise<void> {
  try {
    const offscreenUrl = chrome.runtime.getURL('src/offscreen/offscreen.html');
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [offscreenUrl],
    });

    if (contexts.length > 0) {
      await chrome.offscreen.closeDocument();
      console.log('[Background] Closed existing offscreen document');
    }
  } catch (error) {
    log.warn(' Error closing offscreen document:', error);
  }

  creatingOffscreen = null;

  // Wait a bit before recreating
  await new Promise(resolve => setTimeout(resolve, 500));
  await ensureOffscreenDocument();
}

/**
 * Send message to offscreen document with timeout and retry
 * Timeout increased to 5 minutes because:
 * - First-time model download can be 50-170MB per model
 * - Pivot translations load TWO models (e.g., nl-en + en-fi)
 * - WebGPU initialization adds overhead
 */
async function sendToOffscreen<T>(
  message: Record<string, unknown>,
  timeoutMs = CONFIG.timeouts.offscreenMs
): Promise<T> {
  return withRetry(
    async () => {
      await ensureOffscreenDocument();

      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Offscreen communication timeout'));
        }, timeoutMs);

        try {
          chrome.runtime.sendMessage(
            { ...message, target: 'offscreen' },
            (response) => {
              clearTimeout(timeout);

              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }

              if (response === undefined) {
                reject(new Error('No response from translation engine'));
                return;
              }

              resolve(response as T);
            }
          );
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
    },
    OFFSCREEN_RETRY_CONFIG,
    (error: TranslationError) => {
      // Don't retry if it's a non-retryable error
      if (!error.retryable) return false;

      // For offscreen errors, try resetting the document
      if (error.technicalDetails.includes('offscreen')) {
        console.log('[Background] Attempting offscreen document reset...');
        resetOffscreenDocument().catch(console.error);
      }

      return true;
    }
  );
}

// Strategy and provider state
let currentStrategy: Strategy = 'smart';
let currentProvider: TranslationProviderId = 'opus-mt';

// Rate limiting state
interface RateLimitState {
  requests: number;
  tokens: number;
  windowStart: number;
}

const rateLimit: RateLimitState = {
  requests: 0,
  tokens: 0,
  windowStart: Date.now(),
};

function checkRateLimit(tokenEstimate: number): boolean {
  const now = Date.now();
  if (now - rateLimit.windowStart > CONFIG.rateLimits.windowMs) {
    rateLimit.requests = 0;
    rateLimit.tokens = 0;
    rateLimit.windowStart = now;
  }

  if (rateLimit.requests >= CONFIG.rateLimits.requestsPerMinute) return false;
  if (rateLimit.tokens + tokenEstimate > CONFIG.rateLimits.tokensPerMinute) return false;

  return true;
}

function recordUsage(tokens: number): void {
  rateLimit.requests++;
  rateLimit.tokens += tokens;
}

function estimateTokens(text: string | string[]): number {
  const str = Array.isArray(text) ? text.join(' ') : text;
  return Math.max(1, Math.ceil(str.length / 4));
}

/**
 * Format error for user display
 */
function formatUserError(error: TranslationError): string {
  let message = error.message;
  if (error.suggestion) {
    message += `. ${error.suggestion}`;
  }
  return message;
}

// Message handler
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: TranslateResponse | unknown) => void
  ) => {
    // Ignore messages from offscreen document (they have target property)
    if ('target' in message && message.target === 'offscreen') return false;

    handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        const translationError = createTranslationError(error);
        log.error(' Error:', translationError.technicalDetails);

        sendResponse({
          success: false,
          error: formatUserError(translationError),
        });
      });

    return true; // Async response
  }
);

async function handleMessage(message: ExtensionMessage): Promise<unknown> {
  switch (message.type) {
    case 'ping':
      return { success: true, status: 'ready', provider: currentProvider };
    case 'translate':
      return handleTranslate(message);
    case 'getUsage':
      return handleGetUsage();
    case 'getProviders':
      return handleGetProviders();
    case 'preloadModel':
      return handlePreloadModel(message as { type: 'preloadModel'; sourceLang: string; targetLang: string; provider?: TranslationProviderId });
    case 'setProvider':
      return handleSetProvider(message as { type: 'setProvider'; provider: TranslationProviderId });
    case 'getCacheStats':
      return handleGetCacheStats();
    case 'clearCache':
      return handleClearCache();
    case 'checkChromeTranslator':
      return handleCheckChromeTranslator();
    case 'getPredictionStats':
      return handleGetPredictionStats();
    case 'recordLanguageDetection':
      return handleRecordLanguageDetection(message as { type: 'recordLanguageDetection'; url: string; language: string });
    case 'getCloudProviderStatus':
      return handleGetCloudProviderStatus();
    case 'setCloudApiKey':
      return handleSetCloudApiKey(message as { type: 'setCloudApiKey'; provider: string; apiKey: string; options?: Record<string, unknown> });
    case 'clearCloudApiKey':
      return handleClearCloudApiKey(message as { type: 'clearCloudApiKey'; provider: string });
    case 'getCloudProviderUsage':
      return handleGetCloudProviderUsage(message as { type: 'getCloudProviderUsage'; provider: string });
    case 'getProfilingStats':
      return handleGetProfilingStats();
    case 'clearProfilingStats':
      return handleClearProfilingStats();
    default:
      throw new Error(`Unknown message type: ${(message as { type: string }).type}`);
  }
}

/**
 * Set the active translation provider
 */
async function handleSetProvider(message: {
  type: 'setProvider';
  provider: TranslationProviderId;
}): Promise<unknown> {
  currentProvider = message.provider;
  log.info(` Provider set to: ${currentProvider}`);

  await safeStorageSet({ provider: currentProvider });

  return { success: true, provider: currentProvider };
}

/**
 * Preload model for a language pair (anticipate usage when popup opens)
 */
async function handlePreloadModel(message: {
  type: 'preloadModel';
  sourceLang: string;
  targetLang: string;
  provider?: TranslationProviderId;
}): Promise<unknown> {
  const provider = message.provider || currentProvider;
  log.info(` Preloading ${provider} model: ${message.sourceLang} -> ${message.targetLang}`);
  try {
    const response = await sendToOffscreen<{ success: boolean; preloaded?: boolean; error?: string }>({
      type: 'preloadModel',
      sourceLang: message.sourceLang,
      targetLang: message.targetLang,
      provider,
    });
    return response;
  } catch (error) {
    log.warn(' Preload failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get cache statistics for diagnostics
 */
function handleGetCacheStats(): unknown {
  const stats = getCacheStats();
  return {
    success: true,
    cache: stats,
  };
}

/**
 * Clear the translation cache
 */
function handleClearCache(): unknown {
  const previousSize = translationCache.size;
  translationCache.clear();
  cacheHits = 0;
  cacheMisses = 0;
  log.info(` Cache cleared (was ${previousSize} entries)`);
  return {
    success: true,
    clearedEntries: previousSize,
  };
}

/**
 * Check if Chrome Translator API is available (Chrome 138+)
 */
async function handleCheckChromeTranslator(): Promise<unknown> {
  try {
    const result = await sendToOffscreen<{ success: boolean; available?: boolean }>({
      type: 'checkChromeTranslator',
    });
    return {
      success: true,
      available: result?.available ?? false,
    };
  } catch (error) {
    log.warn(' Chrome Translator check failed:', error);
    return {
      success: true,
      available: false,
    };
  }
}

/**
 * Get prediction engine statistics
 */
async function handleGetPredictionStats(): Promise<unknown> {
  try {
    const stats = await predictionEngine.getStats();
    return {
      success: true,
      prediction: stats,
    };
  } catch (error) {
    log.warn('Failed to get prediction stats:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Handle language detection recording from content script
 */
async function handleRecordLanguageDetection(message: {
  type: 'recordLanguageDetection';
  url: string;
  language: string;
}): Promise<unknown> {
  await recordLanguageDetection(message.url, message.language);
  return { success: true };
}

// Cloud provider API key storage keys
const CLOUD_PROVIDER_KEYS: Record<string, string> = {
  'deepl': 'deepl_api_key',
  'openai': 'openai_api_key',
  'anthropic': 'anthropic_api_key',
  'google-cloud': 'google_cloud_api_key',
};

/**
 * Get cloud provider configuration status (which providers have API keys)
 */
async function handleGetCloudProviderStatus(): Promise<unknown> {
  try {
    const keys = Object.values(CLOUD_PROVIDER_KEYS);
    const stored = await safeStorageGet<Record<string, string>>(keys);

    const status: Record<string, boolean> = {};
    for (const [provider, storageKey] of Object.entries(CLOUD_PROVIDER_KEYS)) {
      status[provider] = !!stored[storageKey];
    }

    return {
      success: true,
      status,
    };
  } catch (error) {
    log.warn('Failed to get cloud provider status:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      status: {},
    };
  }
}

/**
 * Set API key for a cloud provider
 */
async function handleSetCloudApiKey(message: {
  type: 'setCloudApiKey';
  provider: string;
  apiKey: string;
  options?: Record<string, unknown>;
}): Promise<unknown> {
  const storageKey = CLOUD_PROVIDER_KEYS[message.provider];
  if (!storageKey) {
    return {
      success: false,
      error: `Unknown provider: ${message.provider}`,
    };
  }

  try {
    const dataToStore: Record<string, unknown> = {
      [storageKey]: message.apiKey,
    };

    // Handle provider-specific options
    if (message.provider === 'deepl' && message.options) {
      if (message.options.isPro !== undefined) {
        dataToStore['deepl_is_pro'] = message.options.isPro;
      }
      if (message.options.formality !== undefined) {
        dataToStore['deepl_formality'] = message.options.formality;
      }
    } else if (message.provider === 'openai' && message.options) {
      if (message.options.model !== undefined) {
        dataToStore['openai_model'] = message.options.model;
      }
      if (message.options.formality !== undefined) {
        dataToStore['openai_formality'] = message.options.formality;
      }
    } else if (message.provider === 'anthropic' && message.options) {
      if (message.options.model !== undefined) {
        dataToStore['anthropic_model'] = message.options.model;
      }
      if (message.options.formality !== undefined) {
        dataToStore['anthropic_formality'] = message.options.formality;
      }
    }

    await safeStorageSet(dataToStore);
    log.info(` API key set for ${message.provider}`);

    return {
      success: true,
      provider: message.provider,
    };
  } catch (error) {
    log.error(' Failed to set API key:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Clear API key for a cloud provider
 */
async function handleClearCloudApiKey(message: {
  type: 'clearCloudApiKey';
  provider: string;
}): Promise<unknown> {
  const storageKey = CLOUD_PROVIDER_KEYS[message.provider];
  if (!storageKey) {
    return {
      success: false,
      error: `Unknown provider: ${message.provider}`,
    };
  }

  try {
    // Clear all related keys for the provider
    const keysToRemove = [storageKey];
    if (message.provider === 'deepl') {
      keysToRemove.push('deepl_is_pro', 'deepl_formality');
    } else if (message.provider === 'openai') {
      keysToRemove.push('openai_model', 'openai_formality', 'openai_temperature', 'openai_tokens_used');
    } else if (message.provider === 'anthropic') {
      keysToRemove.push('anthropic_model', 'anthropic_formality', 'anthropic_tokens_used');
    } else if (message.provider === 'google-cloud') {
      keysToRemove.push('google_cloud_chars_used');
    }

    await chrome.storage.local.remove(keysToRemove);
    log.info(` API key cleared for ${message.provider}`);

    return {
      success: true,
      provider: message.provider,
    };
  } catch (error) {
    log.error(' Failed to clear API key:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get usage statistics for a cloud provider
 */
async function handleGetCloudProviderUsage(message: {
  type: 'getCloudProviderUsage';
  provider: string;
}): Promise<unknown> {
  try {
    // Forward to offscreen document to use provider instances
    const result = await sendToOffscreen<{
      success: boolean;
      usage?: { tokens: number; cost: number; limitReached: boolean };
      error?: string;
    }>({
      type: 'getCloudProviderUsage',
      provider: message.provider,
    });

    return result;
  } catch (error) {
    log.warn(' Failed to get cloud provider usage:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleTranslate(message: {
  text: string | string[];
  sourceLang: string;
  targetLang: string;
  options?: { strategy?: Strategy };
  provider?: TranslationProviderId;
  enableProfiling?: boolean;
}): Promise<TranslateResponse> {
  const startTime = Date.now();

  // Start profiling session if requested
  const sessionId = message.enableProfiling ? profiler.startSession() : undefined;
  if (sessionId) {
    profiler.startTiming(sessionId, 'total');
    profiler.startTiming(sessionId, 'validation');
  }

  try {
    // Validate input first
    const validation = validateInput(
      message.text,
      message.sourceLang,
      message.targetLang
    );

    if (sessionId) {
      profiler.endTiming(sessionId, 'validation');
    }

    if (!validation.valid) {
      return {
        success: false,
        error: formatUserError(validation.error!),
        duration: Date.now() - startTime,
      };
    }

    // Use sanitized text
    const text = validation.sanitizedText!;

    if (message.options?.strategy) {
      currentStrategy = message.options.strategy;
    }

    const provider = message.provider || currentProvider;

    // Check cache first (skip for 'auto' source since detected language may vary)
    if (sessionId) {
      profiler.startTiming(sessionId, 'cache_lookup');
    }
    const cacheKey = getCacheKey(text, message.sourceLang, message.targetLang, provider);
    if (message.sourceLang !== 'auto') {
      const cached = getCachedTranslation(cacheKey);
      if (sessionId) {
        profiler.endTiming(sessionId, 'cache_lookup');
      }
      if (cached) {
        cacheHits++;
        const duration = Date.now() - startTime;
        log.info(` Cache hit, returning in ${duration}ms`);
        if (sessionId) {
          profiler.endTiming(sessionId, 'total');
        }
        return {
          success: true,
          result: cached.result,
          duration,
          cached: true,
        } as TranslateResponse & { cached: boolean };
      }
    } else if (sessionId) {
      profiler.endTiming(sessionId, 'cache_lookup');
    }
    cacheMisses++;

    const tokenEstimate = estimateTokens(text);

    if (!checkRateLimit(tokenEstimate)) {
      return {
        success: false,
        error: 'Too many requests. Please wait a moment and try again.',
        duration: Date.now() - startTime,
      };
    }

    console.log('[Background] Translating:', message.sourceLang, '->', message.targetLang);

    // Start IPC timing
    if (sessionId) {
      profiler.startTiming(sessionId, 'ipc_background_to_offscreen');
    }

    // Use retry for network-related failures
    const response = await withRetry(
      async () => {
        const result = await sendToOffscreen<{
          success: boolean;
          result?: string | string[];
          error?: unknown;
          profilingData?: object;
        }>({
          type: 'translate',
          text,
          sourceLang: message.sourceLang,
          targetLang: message.targetLang,
          provider,
          sessionId, // Pass session ID for offscreen profiling
        });

        if (!result) {
          throw new Error('No response from translation engine');
        }

        if (!result.success) {
          // Forward the error from offscreen
          const errorMsg = typeof result.error === 'string'
            ? result.error
            : result.error instanceof Error
              ? result.error.message
              : JSON.stringify(result.error) || 'Translation failed';
          throw new Error(errorMsg);
        }

        return result;
      },
      NETWORK_RETRY_CONFIG,
      (error: TranslationError) => {
        // Only retry network errors automatically
        return isNetworkError(error.technicalDetails);
      }
    );

    if (sessionId) {
      profiler.endTiming(sessionId, 'ipc_background_to_offscreen');

      // Import profiling data from offscreen document
      if (response.profilingData) {
        profiler.importSessionData(response.profilingData);
      }
    }

    console.log('[Background] Translation complete');
    recordUsage(tokenEstimate);

    // Cache the result (use actual source lang if auto-detected)
    if (sessionId) {
      profiler.startTiming(sessionId, 'cache_store');
    }
    const actualSourceLang = message.sourceLang === 'auto' ? 'auto' : message.sourceLang;
    if (response.result && actualSourceLang !== 'auto') {
      setCachedTranslation(cacheKey, response.result, actualSourceLang, message.targetLang);
    }
    if (sessionId) {
      profiler.endTiming(sessionId, 'cache_store');
      profiler.endTiming(sessionId, 'total');
    }

    // Record translation for prediction engine (fire and forget)
    recordTranslation(message.targetLang).catch(() => {
      // Ignore errors - prediction tracking is non-critical
    });

    // Include profiling report if enabled
    let profilingReport: object | undefined;
    if (sessionId) {
      const report = profiler.getReport(sessionId);
      if (report) {
        profilingReport = report;
        console.log(profiler.formatReport(sessionId));
      }
    }

    return {
      success: true,
      result: response.result,
      duration: Date.now() - startTime,
      profilingReport,
    } as TranslateResponse & { profilingReport?: object };
  } catch (error) {
    if (sessionId) {
      profiler.endTiming(sessionId, 'total');
    }
    const translationError = createTranslationError(error);
    log.error(' Translation error:', translationError.technicalDetails);

    return {
      success: false,
      error: formatUserError(translationError),
      duration: Date.now() - startTime,
    };
  }
}

function handleGetUsage(): unknown {
  return {
    throttle: {
      requests: rateLimit.requests,
      tokens: rateLimit.tokens,
      requestLimit: CONFIG.rateLimits.requestsPerMinute,
      tokenLimit: CONFIG.rateLimits.tokensPerMinute,
      queue: 0,
    },
    cache: getCacheStats(),
    providers: {},
  };
}

/**
 * Get aggregate profiling statistics
 */
async function handleGetProfilingStats(): Promise<unknown> {
  try {
    // Get local background profiling stats
    const localStats = profiler.getAllAggregates();

    // Also get stats from offscreen document
    let offscreenStats: Record<string, AggregateStats> = {};
    try {
      const offscreenResult = await sendToOffscreen<{
        success: boolean;
        aggregates?: Record<string, AggregateStats>;
        formatted?: string;
      }>({
        type: 'getProfilingStats',
      });
      if (offscreenResult?.success && offscreenResult.aggregates) {
        offscreenStats = offscreenResult.aggregates;
      }
    } catch {
      // Offscreen may not be available
    }

    // Merge stats
    const mergedStats = { ...localStats, ...offscreenStats };

    return {
      success: true,
      aggregates: mergedStats,
      formatted: profiler.formatAggregates(),
    };
  } catch (error) {
    log.warn('Failed to get profiling stats:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Clear all profiling statistics
 */
function handleClearProfilingStats(): unknown {
  profiler.clear();
  log.info('Profiling stats cleared');
  return { success: true };
}

async function handleGetProviders(): Promise<unknown> {
  try {
    const response = await sendToOffscreen<{
      success: boolean;
      languages?: Array<{ src: string; tgt: string }>;
    }>({
      type: 'getSupportedLanguages',
    });

    return {
      providers: [
        {
          id: 'opus-mt',
          name: 'Helsinki-NLP OPUS-MT',
          type: 'local',
          qualityTier: 'standard',
          description: 'Fast, lightweight (~170MB per pair)',
          icon: '',
        },
        {
          id: 'translategemma',
          name: 'TranslateGemma 4B',
          type: 'local',
          qualityTier: 'premium',
          description: 'High quality, single model (~3.6GB)',
          icon: '',
        },
      ],
      activeProvider: currentProvider,
      strategy: currentStrategy,
      supportedLanguages: response.success ? response.languages : [],
    };
  } catch (error) {
    log.warn(' Error getting providers:', error);

    return {
      providers: [
        {
          id: 'opus-mt',
          name: 'Helsinki-NLP OPUS-MT',
          type: 'local',
          qualityTier: 'standard',
          description: 'Fast, lightweight (~170MB per pair)',
          icon: '',
        },
        {
          id: 'translategemma',
          name: 'TranslateGemma 4B',
          type: 'local',
          qualityTier: 'premium',
          description: 'High quality, single model (~3.6GB)',
          icon: '',
        },
      ],
      activeProvider: currentProvider,
      strategy: currentStrategy,
      supportedLanguages: [],
      error: 'Could not load language list. Translation may still work.',
    };
  }
}

// Extension icon click handler
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    console.log('[Background] Extension icon clicked for tab:', tab.id);
  }
});

// Tab update listener for predictive model preloading
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  // Only trigger on complete page load with valid URL
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome://')) {
    log.debug(`Tab updated: ${tab.url}`);

    // Trigger predictive preload (fire and forget)
    preloadPredictedModels(tab.url).catch((error) => {
      log.warn('Predictive preload trigger failed:', error);
    });
  }
});

// Installation handler
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Background] Extension installed');
    // Detect browser's preferred language for target
    const browserLang = chrome.i18n.getUILanguage().split('-')[0]; // e.g., 'en-US' -> 'en'
    console.log('[Background] Browser language detected:', browserLang);
    safeStorageSet({
      sourceLang: 'auto',
      targetLang: browserLang || 'en', // Use browser language, fallback to English
      strategy: 'smart',
      provider: 'opus-mt',
    });
  } else if (details.reason === 'update') {
    console.log('[Background] Extension updated from', details.previousVersion);
  }
});

// Load saved provider on startup
(async () => {
  const result = await safeStorageGet<{ provider?: TranslationProviderId }>(['provider']);
  if (result.provider) {
    currentProvider = result.provider;
    console.log('[Background] Restored provider:', currentProvider);
  }
})();

// Handle extension startup - pre-warm the offscreen document
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension startup, pre-warming offscreen document...');
  ensureOffscreenDocument().catch((error) => {
    log.warn(' Pre-warm failed (will retry on first use):', error);
  });
});

// Initialize prediction engine on startup
(async () => {
  try {
    await predictionEngine.load();
    console.log('[Background] Prediction engine initialized');
  } catch (error) {
    log.warn('Failed to initialize prediction engine:', error);
  }
})();

console.log('[Background] Service worker initialized v2.3 with predictive model preloading');
