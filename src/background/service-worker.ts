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
import { addToHistory, getHistory, clearHistory as clearTranslationHistory } from '../core/history';
import {
  addCorrection,
  getCorrection,
  getAllCorrections,
  clearCorrections,
  deleteCorrection,
  getCorrectionStats,
  exportCorrections,
  importCorrections,
} from '../core/corrections';
// Browser API imported but may not be needed in Chrome service worker
// import { browserAPI, getURL } from '../core/browser-api';

const log = createLogger('Background');

// ============================================================================
// Enhanced Translation Memory (Persistent LRU Cache)
// ============================================================================

/**
 * Persistent cache entry with usage tracking.
 * Stores translation result along with metadata for smart eviction.
 */
interface PersistentCacheEntry {
  result: string | string[];
  timestamp: number;
  sourceLang: string;
  targetLang: string;
  useCount: number;
}

// In-memory cache (fast access, survives service worker restarts via persistence)
const translationCache = new Map<string, PersistentCacheEntry>();

// Cache statistics (persisted alongside cache)
let cacheHits = 0;
let cacheMisses = 0;
let cacheInitialized = false;

// Debounced save timer
let saveCacheTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Load cache from persistent storage on startup.
 * Called once when service worker initializes.
 */
async function loadPersistentCache(): Promise<void> {
  if (cacheInitialized) return;

  try {
    const stored = await chrome.storage.local.get([
      CONFIG.cache.storageKey,
      'cacheStats',
    ]);

    if (stored[CONFIG.cache.storageKey]) {
      const entries = stored[CONFIG.cache.storageKey] as [string, PersistentCacheEntry][];
      entries.forEach(([key, value]) => {
        translationCache.set(key, value);
      });
      log.info(`Loaded ${translationCache.size} cached translations from storage`);
    }

    if (stored.cacheStats) {
      const stats = stored.cacheStats as { hits: number; misses: number };
      cacheHits = stats.hits || 0;
      cacheMisses = stats.misses || 0;
    }

    cacheInitialized = true;
  } catch (error) {
    log.warn('Failed to load persistent cache:', error);
    cacheInitialized = true; // Mark initialized to prevent retry loops
  }
}

/**
 * Schedule cache save to persistent storage (debounced).
 * Prevents excessive writes during rapid translation activity.
 */
function scheduleCacheSave(): void {
  if (saveCacheTimer) return;

  saveCacheTimer = setTimeout(async () => {
    saveCacheTimer = null;
    try {
      const entries = Array.from(translationCache.entries());
      await chrome.storage.local.set({
        [CONFIG.cache.storageKey]: entries,
        cacheStats: { hits: cacheHits, misses: cacheMisses },
      });
      log.debug(`Saved ${entries.length} translations to persistent storage`);
    } catch (error) {
      log.warn('Failed to save cache:', error);
    }
  }, CONFIG.cache.saveDebounceMs);
}

/**
 * Flush pending cache save immediately (for service worker shutdown).
 * Service workers can be killed after 30s of inactivity in MV3.
 */
function flushCacheSave(): void {
  if (!saveCacheTimer) return;
  clearTimeout(saveCacheTimer);
  saveCacheTimer = null;
  // Synchronous-start: chrome.storage.local.set returns a promise but
  // we fire it without awaiting — the browser keeps the SW alive
  // long enough for pending chrome.storage writes to complete.
  const entries = Array.from(translationCache.entries());
  chrome.storage.local.set({
    [CONFIG.cache.storageKey]: entries,
    cacheStats: { hits: cacheHits, misses: cacheMisses },
  }).catch((error) => {
    log.warn('Failed to flush cache on shutdown:', error);
  });
}

/**
 * Generate cache key from translation parameters.
 * Uses FNV-1a hash to prevent collisions from text truncation.
 */
function getCacheKey(text: string | string[], sourceLang: string, targetLang: string, provider?: string): string {
  const providerKey = provider || currentProvider;
  return generateCacheKey(text, sourceLang, targetLang, providerKey);
}

/**
 * Get cached translation with usage tracking.
 * Updates LRU order and increments use count for smart eviction.
 */
function getCachedTranslation(key: string): PersistentCacheEntry | undefined {
  const entry = translationCache.get(key);
  if (entry) {
    // Update usage count and move to end for LRU
    entry.useCount++;
    translationCache.delete(key);
    translationCache.set(key, entry);
    cacheHits++;
    scheduleCacheSave();
    log.debug(`Cache HIT: ${key.substring(0, 40)}... (used ${entry.useCount}x)`);
  } else {
    cacheMisses++;
  }
  return entry;
}

/**
 * Store translation in cache with smart eviction.
 * Uses hybrid LRU/LFU eviction: evicts least-used among oldest entries.
 */
function setCachedTranslation(
  key: string,
  result: string | string[],
  sourceLang: string,
  targetLang: string
): void {
  // Evict entries if at capacity using smart eviction
  while (translationCache.size >= CONFIG.cache.maxSize) {
    // Find entry with lowest use count among oldest 10%
    const entries = Array.from(translationCache.entries());
    const oldestCount = Math.max(10, Math.floor(entries.length * 0.1));
    const oldestEntries = entries.slice(0, oldestCount);

    const leastUsed = oldestEntries.reduce((min, curr) =>
      curr[1].useCount < min[1].useCount ? curr : min
    );

    translationCache.delete(leastUsed[0]);
    log.debug(`Cache evicted: ${leastUsed[0].substring(0, 40)}... (used ${leastUsed[1].useCount}x)`);
  }

  translationCache.set(key, {
    result,
    timestamp: Date.now(),
    sourceLang,
    targetLang,
    useCount: 1,
  });

  scheduleCacheSave();
  log.debug(`Cached translation (${translationCache.size}/${CONFIG.cache.maxSize})`);
}

/**
 * Detailed cache statistics for diagnostics and UI display.
 */
interface DetailedCacheStats {
  size: number;
  maxSize: number;
  hitRate: string;
  totalHits: number;
  totalMisses: number;
  oldestEntry: number | null;
  mostUsed: Array<{ text: string; useCount: number; langs: string }>;
  memoryEstimate: string;
  languagePairs: Record<string, number>;
}

/**
 * Get detailed cache statistics for diagnostics.
 */
function getCacheStats(): DetailedCacheStats {
  const entries = Array.from(translationCache.entries());

  // Find oldest entry
  let oldestTimestamp: number | null = null;
  for (const [, entry] of entries) {
    if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
    }
  }

  // Top 5 most used translations
  const mostUsed = entries
    .sort((a, b) => b[1].useCount - a[1].useCount)
    .slice(0, 5)
    .map(([key, value]) => ({
      text: key.substring(0, 50) + (key.length > 50 ? '...' : ''),
      useCount: value.useCount,
      langs: `${value.sourceLang} -> ${value.targetLang}`,
    }));

  // Language pair distribution
  const languagePairs: Record<string, number> = {};
  for (const [, entry] of entries) {
    const pair = `${entry.sourceLang}-${entry.targetLang}`;
    languagePairs[pair] = (languagePairs[pair] || 0) + 1;
  }

  // Rough memory estimate (characters in keys + results)
  const totalChars = entries.reduce((sum, [key, value]) => {
    const resultLen = Array.isArray(value.result)
      ? value.result.join('').length
      : value.result.length;
    return sum + key.length + resultLen;
  }, 0);

  const totalTranslations = cacheHits + cacheMisses;
  const hitRatePercent = totalTranslations > 0
    ? Math.round((cacheHits / totalTranslations) * 100)
    : 0;

  return {
    size: translationCache.size,
    maxSize: CONFIG.cache.maxSize,
    hitRate: `${cacheHits}/${totalTranslations} (${hitRatePercent}%)`,
    totalHits: cacheHits,
    totalMisses: cacheMisses,
    oldestEntry: oldestTimestamp,
    mostUsed,
    memoryEstimate: `~${Math.round(totalChars / 1024)}KB`,
    languagePairs,
  };
}

/**
 * Clear translation cache and reset statistics.
 */
async function clearTranslationCache(): Promise<void> {
  translationCache.clear();
  cacheHits = 0;
  cacheMisses = 0;

  try {
    await chrome.storage.local.remove([CONFIG.cache.storageKey, 'cacheStats']);
    log.info('Translation cache cleared');
  } catch (error) {
    log.warn('Failed to clear persistent cache:', error);
  }
}

// Load cache on startup
loadPersistentCache();

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
    case 'getHistory':
      return handleGetHistory();
    case 'clearHistory':
      return handleClearHistory();
    case 'addCorrection':
      return handleAddCorrection(message as {
        type: 'addCorrection';
        original: string;
        machineTranslation: string;
        userCorrection: string;
        sourceLang: string;
        targetLang: string;
      });
    case 'getCorrection':
      return handleGetCorrection(message as {
        type: 'getCorrection';
        original: string;
        sourceLang: string;
        targetLang: string;
      });
    case 'getAllCorrections':
      return handleGetAllCorrections();
    case 'getCorrectionStats':
      return handleGetCorrectionStats();
    case 'clearCorrections':
      return handleClearCorrections();
    case 'deleteCorrection':
      return handleDeleteCorrection(message as {
        type: 'deleteCorrection';
        original: string;
        sourceLang: string;
        targetLang: string;
      });
    case 'exportCorrections':
      return handleExportCorrections();
    case 'importCorrections':
      return handleImportCorrections(message as {
        type: 'importCorrections';
        json: string;
      });
    case 'ocrImage':
      return handleOCRImage(message as {
        type: 'ocrImage';
        imageData: string;
        lang?: string;
      });
    case 'getDownloadedModels':
      // Return cached model info from storage
      try {
        const stored = await chrome.storage.local.get(['downloadedModels']);
        return { success: true, models: stored.downloadedModels || [] };
      } catch {
        return { success: true, models: [] };
      }
    case 'getSettings':
      // Settings request from legacy content script
      try {
        const settings = await chrome.storage.local.get(['sourceLanguage', 'targetLanguage', 'provider', 'strategy']);
        return {
          success: true,
          data: {
            sourceLanguage: settings.sourceLanguage || 'auto',
            targetLanguage: settings.targetLanguage || 'en',
            provider: settings.provider || 'opus-mt',
            strategy: settings.strategy || 'smart',
          },
        };
      } catch {
        return { success: false, error: 'Failed to get settings' };
      }
    default:
      console.warn(`[Background] Unknown message type: ${(message as { type: string }).type}`);
      return { success: false, error: `Unknown message type: ${(message as { type: string }).type}` };
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
async function handleGetCacheStats(): Promise<unknown> {
  // Ensure cache is loaded before getting stats
  await loadPersistentCache();
  const stats = getCacheStats();
  return {
    success: true,
    cache: stats,
  };
}

/**
 * Clear the translation cache
 */
async function handleClearCache(): Promise<unknown> {
  const previousSize = translationCache.size;
  await clearTranslationCache();
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
  options?: { strategy?: Strategy; context?: { before: string; after: string } };
  provider?: TranslationProviderId;
  enableProfiling?: boolean;
}): Promise<TranslateResponse> {
  const startTime = Date.now();

  // Log context if provided (for debugging translation quality)
  if (message.options?.context) {
    const { before, after } = message.options.context;
    log.debug('Translation context:', {
      before: before?.substring(0, 50),
      after: after?.substring(0, 50),
    });
  }

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
        // Note: cacheHits already incremented inside getCachedTranslation()
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
    // Note: cacheMisses already incremented inside getCachedTranslation() when entry not found

    // Check for user corrections (only for single strings, not arrays)
    // Corrections take precedence over machine translation
    if (typeof text === 'string' && message.sourceLang !== 'auto') {
      const userCorrection = await getCorrection(text, message.sourceLang, message.targetLang);
      if (userCorrection) {
        const duration = Date.now() - startTime;
        log.info(`Using user correction, returning in ${duration}ms`);
        if (sessionId) {
          profiler.endTiming(sessionId, 'total');
        }
        // Cache the correction for faster future lookups
        setCachedTranslation(cacheKey, userCorrection, message.sourceLang, message.targetLang);
        return {
          success: true,
          result: userCorrection,
          duration,
          fromCorrection: true,
        } as TranslateResponse & { fromCorrection: boolean };
      }
    }

    const tokenEstimate = estimateTokens(text);

    if (!checkRateLimit(tokenEstimate)) {
      return {
        success: false,
        error: 'Too many requests. Please wait a moment and try again.',
        duration: Date.now() - startTime,
      };
    }

    console.log('[Background] Translating:', message.sourceLang, '->', message.targetLang);

    // Chrome Built-in Translator: runs in tab's main world (not offscreen)
    // because the Translator API is only available in page contexts.
    if (provider === 'chrome-builtin') {
      if (sessionId) profiler.startTiming(sessionId, 'chrome_builtin_translate');
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tabId = tabs[0]?.id;
        if (!tabId) throw new Error('No active tab for Chrome Translator');

        const texts = Array.isArray(text) ? text : [text];
        // The func runs in the page's main world where Chrome AI APIs exist
        // on globalThis. TypeScript doesn't know about them here, so we use
        // (self as any) to access Translator which Chrome 138+ injects.
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN' as chrome.scripting.ExecutionWorld,
          func: async (textsToTranslate: string[], srcLang: string, tgtLang: string) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const TranslatorAPI = (self as any).Translator;
            if (!TranslatorAPI) {
              throw new Error('Chrome Translator API not available (requires Chrome 138+)');
            }
            const avail = await TranslatorAPI.availability({ sourceLanguage: srcLang, targetLanguage: tgtLang });
            if (avail.available === 'no') {
              throw new Error(`Language pair not supported: ${srcLang}-${tgtLang}`);
            }
            const t = await TranslatorAPI.create({ sourceLanguage: srcLang, targetLanguage: tgtLang });
            const translated: string[] = [];
            for (const txt of textsToTranslate) {
              translated.push(txt.trim() ? await t.translate(txt) : txt);
            }
            t.destroy();
            return translated;
          },
          args: [texts, message.sourceLang, message.targetLang],
        });

        if (sessionId) profiler.endTiming(sessionId, 'chrome_builtin_translate');
        const translated = results[0]?.result as string[] | undefined;
        if (!translated) throw new Error('Chrome Translator returned no result');

        const result = Array.isArray(text) ? translated : translated[0];
        const duration = Date.now() - startTime;
        setCachedTranslation(cacheKey, result, message.sourceLang, message.targetLang);
        if (sessionId) profiler.endTiming(sessionId, 'total');
        return { success: true, result, duration, provider: 'chrome-builtin' };
      } catch (error) {
        if (sessionId) profiler.endTiming(sessionId, 'total');
        const errMsg = error instanceof Error ? error.message : String(error);
        log.error('Chrome Built-in translation failed:', errMsg);
        return { success: false, error: errMsg, duration: Date.now() - startTime };
      }
    }

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

    // Record to history (fire and forget) - only for single text translations
    if (response.result && typeof text === 'string' && typeof response.result === 'string') {
      addToHistory(text, response.result, message.sourceLang, message.targetLang).catch(() => {
        // Ignore errors - history tracking is non-critical
      });
    }

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

/**
 * Get translation history
 */
async function handleGetHistory(): Promise<unknown> {
  try {
    const historyEntries = await getHistory();
    return {
      success: true,
      history: historyEntries,
    };
  } catch (error) {
    log.warn('Failed to get history:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      history: [],
    };
  }
}

/**
 * Clear translation history
 */
async function handleClearHistory(): Promise<unknown> {
  try {
    await clearTranslationHistory();
    return { success: true };
  } catch (error) {
    log.warn('Failed to clear history:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Corrections Handlers (Learn from user corrections)
// ============================================================================

/**
 * Add a user correction for a translation
 */
async function handleAddCorrection(message: {
  type: 'addCorrection';
  original: string;
  machineTranslation: string;
  userCorrection: string;
  sourceLang: string;
  targetLang: string;
}): Promise<unknown> {
  try {
    await addCorrection(
      message.original,
      message.machineTranslation,
      message.userCorrection,
      message.sourceLang,
      message.targetLang
    );
    return { success: true };
  } catch (error) {
    log.warn('Failed to add correction:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Get correction for a specific text
 */
async function handleGetCorrection(message: {
  type: 'getCorrection';
  original: string;
  sourceLang: string;
  targetLang: string;
}): Promise<unknown> {
  try {
    const correction = await getCorrection(
      message.original,
      message.sourceLang,
      message.targetLang
    );
    return {
      success: true,
      correction,
      hasCorrection: correction !== null,
    };
  } catch (error) {
    log.warn('Failed to get correction:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      correction: null,
      hasCorrection: false,
    };
  }
}

/**
 * Get all corrections
 */
async function handleGetAllCorrections(): Promise<unknown> {
  try {
    const corrections = await getAllCorrections();
    return {
      success: true,
      corrections,
    };
  } catch (error) {
    log.warn('Failed to get corrections:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      corrections: [],
    };
  }
}

/**
 * Get correction statistics
 */
async function handleGetCorrectionStats(): Promise<unknown> {
  try {
    const stats = await getCorrectionStats();
    return {
      success: true,
      stats,
    };
  } catch (error) {
    log.warn('Failed to get correction stats:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stats: { total: 0, totalUses: 0, topCorrections: [] },
    };
  }
}

/**
 * Clear all corrections
 */
async function handleClearCorrections(): Promise<unknown> {
  try {
    await clearCorrections();
    return { success: true };
  } catch (error) {
    log.warn('Failed to clear corrections:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Delete a specific correction
 */
async function handleDeleteCorrection(message: {
  type: 'deleteCorrection';
  original: string;
  sourceLang: string;
  targetLang: string;
}): Promise<unknown> {
  try {
    const deleted = await deleteCorrection(
      message.original,
      message.sourceLang,
      message.targetLang
    );
    return {
      success: true,
      deleted,
    };
  } catch (error) {
    log.warn('Failed to delete correction:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      deleted: false,
    };
  }
}

/**
 * Export corrections as JSON
 */
async function handleExportCorrections(): Promise<unknown> {
  try {
    const json = await exportCorrections();
    return {
      success: true,
      json,
    };
  } catch (error) {
    log.warn('Failed to export corrections:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Import corrections from JSON
 */
async function handleImportCorrections(message: {
  type: 'importCorrections';
  json: string;
}): Promise<unknown> {
  try {
    const count = await importCorrections(message.json);
    return {
      success: true,
      importedCount: count,
    };
  } catch (error) {
    log.warn('Failed to import corrections:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      importedCount: 0,
    };
  }
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

// ============================================================================
// OCR (Optical Character Recognition)
// ============================================================================

/**
 * Handle OCR image request - extract text from image using Tesseract.js
 */
async function handleOCRImage(message: {
  type: 'ocrImage';
  imageData: string;
  lang?: string;
}): Promise<unknown> {
  try {
    log.info('Processing OCR request...');

    const result = await sendToOffscreen<{
      success: boolean;
      text?: string;
      confidence?: number;
      blocks?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
      error?: string;
    }>({
      type: 'ocrImage',
      imageData: message.imageData,
      lang: message.lang,
    });

    if (result.success) {
      log.info(`OCR completed: ${result.blocks?.length || 0} blocks, ${result.confidence?.toFixed(1)}% confidence`);
    }

    return result;
  } catch (error) {
    log.error('OCR failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ============================================================================
// Context Menus
// ============================================================================

/**
 * Create context menu items
 */
function setupContextMenus(): void {
  // Remove existing menus first
  chrome.contextMenus.removeAll(() => {
    // Translate selection
    chrome.contextMenus.create({
      id: 'translate-selection',
      title: 'Translate Selection',
      contexts: ['selection'],
    });

    // Translate page
    chrome.contextMenus.create({
      id: 'translate-page',
      title: 'Translate Page',
      contexts: ['page'],
    });

    // Separator
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['page', 'selection'],
    });

    // Undo translation
    chrome.contextMenus.create({
      id: 'undo-translation',
      title: 'Undo Translation',
      contexts: ['page'],
    });

    // Translate image text (OCR)
    chrome.contextMenus.create({
      id: 'translate-image',
      title: 'Translate Image Text',
      contexts: ['image'],
    });

    log.info('Context menus created');
  });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const settings = await safeStorageGet<{
    sourceLang?: string;
    targetLang?: string;
    strategy?: Strategy;
    provider?: TranslationProviderId;
  }>(['sourceLang', 'targetLang', 'strategy', 'provider']);

  const sourceLang = settings.sourceLang || 'auto';
  const targetLang = settings.targetLang || 'en';
  const strategy = settings.strategy || 'smart';
  const provider = settings.provider || 'opus-mt';

  try {
    switch (info.menuItemId) {
      case 'translate-selection':
        await chrome.tabs.sendMessage(tab.id, {
          type: 'translateSelection',
          sourceLang,
          targetLang,
          strategy,
          provider,
        });
        break;

      case 'translate-page':
        await chrome.tabs.sendMessage(tab.id, {
          type: 'translatePage',
          sourceLang,
          targetLang,
          strategy,
          provider,
        });
        break;

      case 'undo-translation':
        await chrome.tabs.sendMessage(tab.id, {
          type: 'undoTranslation',
        });
        break;

      case 'translate-image':
        // Send the image URL to content script for OCR translation
        await chrome.tabs.sendMessage(tab.id, {
          type: 'translateImage',
          imageUrl: info.srcUrl,
          sourceLang,
          targetLang,
          provider,
        });
        break;
    }
  } catch (error) {
    log.warn('Context menu action failed:', error);
  }
});

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

chrome.commands.onCommand.addListener(async (command, tab) => {
  console.log('[Background] Command received:', command);

  if (!tab?.id) return;

  const settings = await safeStorageGet<{
    sourceLang?: string;
    targetLang?: string;
    strategy?: Strategy;
    provider?: TranslationProviderId;
  }>(['sourceLang', 'targetLang', 'strategy', 'provider']);

  const sourceLang = settings.sourceLang || 'auto';
  const targetLang = settings.targetLang || 'en';
  const strategy = settings.strategy || 'smart';
  const provider = settings.provider || currentProvider;

  try {
    switch (command) {
      case 'translate-page':
        await chrome.tabs.sendMessage(tab.id, {
          type: 'translatePage',
          sourceLang,
          targetLang,
          strategy,
          provider,
        });
        break;

      case 'translate-selection':
        await chrome.tabs.sendMessage(tab.id, {
          type: 'translateSelection',
          sourceLang,
          targetLang,
          strategy,
          provider,
        });
        break;

      case 'undo-translation':
        await chrome.tabs.sendMessage(tab.id, {
          type: 'undoTranslation',
        });
        break;

      case 'toggle-widget':
        await chrome.tabs.sendMessage(tab.id, {
          type: 'toggleWidget',
        });
        break;
    }
  } catch (error) {
    log.warn('Keyboard shortcut action failed:', error);
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
chrome.runtime.onInstalled.addListener(async (details) => {
  // Setup context menus on install/update
  setupContextMenus();

  if (details.reason === 'install') {
    console.log('[Background] Extension installed');

    // Check if onboarding was already completed (shouldn't happen on fresh install)
    const { onboardingComplete } = await chrome.storage.local.get('onboardingComplete');
    if (!onboardingComplete) {
      // Open onboarding page in a new tab
      console.log('[Background] Opening onboarding page');
      chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/index.html') });
    }

    // Set default settings (will be overwritten by onboarding if user completes it)
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

// Load saved provider on startup, auto-detect Chrome Built-in availability
(async () => {
  const result = await safeStorageGet<{ provider?: TranslationProviderId }>(['provider']);
  if (result.provider) {
    currentProvider = result.provider;
    console.log('[Background] Restored provider:', currentProvider);
  }

  // Auto-detect Chrome Built-in Translator on startup
  // If user hasn't explicitly chosen a provider, and Chrome Built-in is available,
  // prefer it as the fastest option (no model download, native performance).
  try {
    if (currentProvider === 'opus-mt') {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (tabId) {
        const detection = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN' as chrome.scripting.ExecutionWorld,
          func: () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return typeof (self as any).Translator !== 'undefined';
          },
        });
        const chromeBuiltinAvailable = detection[0]?.result === true;
        if (chromeBuiltinAvailable) {
          currentProvider = 'chrome-builtin';
          await safeStorageSet({ provider: 'chrome-builtin' });
          console.log('[Background] Auto-detected Chrome Built-in Translator, setting as default');
        }
      }
    }
  } catch (error) {
    // Silently ignore — detection may fail on restricted pages
    log.debug('Chrome Built-in auto-detection skipped:', error);
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

// Flush pending cache writes when service worker is about to shut down.
// In MV3 service workers, onSuspend fires before the worker is terminated.
// In MV2 (Firefox), chrome.runtime.onSuspend also applies.
if (chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(() => {
    console.log('[Background] Service worker suspending, flushing cache...');
    flushCacheSave();
  });
}

console.log('[Background] Service worker initialized v2.3 with predictive model preloading');
