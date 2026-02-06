/**
 * Background Service Worker
 * Uses offscreen document for ML inference (service workers can't access DOM)
 *
 * Performance optimizations:
 * - LRU translation cache (max 100 entries)
 * - Lazy model loading (preload on popup open)
 * - Retry with exponential backoff for transient failures
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

// ============================================================================
// Translation Cache (LRU, max 100 entries)
// ============================================================================

interface CacheEntry {
  result: string | string[];
  timestamp: number;
  sourceLang: string;
  targetLang: string;
}

const CACHE_MAX_SIZE = 100;
const translationCache = new Map<string, CacheEntry>();

/**
 * Generate cache key from translation parameters.
 * Uses first 100 chars of text to balance uniqueness vs memory.
 */
function getCacheKey(text: string | string[], sourceLang: string, targetLang: string, provider?: string): string {
  const textKey = Array.isArray(text)
    ? text.map(t => t.substring(0, 50)).join('|').substring(0, 200)
    : text.substring(0, 100);
  const providerKey = provider || currentProvider;
  return `${providerKey}:${sourceLang}-${targetLang}-${textKey}`;
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
    console.log(`[Background] Cache HIT: ${key.substring(0, 40)}...`);
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
  while (translationCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = translationCache.keys().next().value;
    if (oldestKey) {
      translationCache.delete(oldestKey);
      console.log(`[Background] Cache evicted oldest entry`);
    }
  }

  translationCache.set(key, {
    result,
    timestamp: Date.now(),
    sourceLang,
    targetLang,
  });
  console.log(`[Background] Cached translation (${translationCache.size}/${CACHE_MAX_SIZE})`);
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
    maxSize: CACHE_MAX_SIZE,
    hitRate: `${cacheHits}/${cacheHits + cacheMisses} (${cacheHits + cacheMisses > 0 ? Math.round(cacheHits / (cacheHits + cacheMisses) * 100) : 0}%)`,
    oldestEntry: oldestTimestamp,
  };
}

// Cache hit/miss tracking
let cacheHits = 0;
let cacheMisses = 0;

// ============================================================================
// Offscreen Document Management
// ============================================================================

let creatingOffscreen: Promise<void> | null = null;
let offscreenFailureCount = 0;
const MAX_OFFSCREEN_FAILURES = 3;

// Retry configuration for different scenarios
const NETWORK_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
};

const OFFSCREEN_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 3000,
};

/**
 * Create or verify offscreen document exists
 */
async function ensureOffscreenDocument(): Promise<void> {
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

    // Avoid race condition
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
    console.error('[Background] Failed to create offscreen document:', errMsg);

    // If we've failed too many times, give a clearer error
    if (offscreenFailureCount >= MAX_OFFSCREEN_FAILURES) {
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
    console.warn('[Background] Error closing offscreen document:', error);
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
  timeoutMs = 5 * 60 * 1000 // 5 minutes
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

const RATE_LIMIT = {
  requestsPerMinute: 60,
  tokensPerMinute: 100000,
  windowMs: 60000,
};

function checkRateLimit(tokenEstimate: number): boolean {
  const now = Date.now();
  if (now - rateLimit.windowStart > RATE_LIMIT.windowMs) {
    rateLimit.requests = 0;
    rateLimit.tokens = 0;
    rateLimit.windowStart = now;
  }

  if (rateLimit.requests >= RATE_LIMIT.requestsPerMinute) return false;
  if (rateLimit.tokens + tokenEstimate > RATE_LIMIT.tokensPerMinute) return false;

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
        console.error('[Background] Error:', translationError.technicalDetails);

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
  console.log(`[Background] Provider set to: ${currentProvider}`);

  try {
    await chrome.storage.local.set({ provider: currentProvider });
  } catch {
    // Storage may not be available
  }

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
  console.log(`[Background] Preloading ${provider} model: ${message.sourceLang} -> ${message.targetLang}`);
  try {
    const response = await sendToOffscreen<{ success: boolean; preloaded?: boolean; error?: string }>({
      type: 'preloadModel',
      sourceLang: message.sourceLang,
      targetLang: message.targetLang,
      provider,
    });
    return response;
  } catch (error) {
    console.warn('[Background] Preload failed:', error);
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
  console.log(`[Background] Cache cleared (was ${previousSize} entries)`);
  return {
    success: true,
    clearedEntries: previousSize,
  };
}

async function handleTranslate(message: {
  text: string | string[];
  sourceLang: string;
  targetLang: string;
  options?: { strategy?: Strategy };
  provider?: TranslationProviderId;
}): Promise<TranslateResponse> {
  const startTime = Date.now();

  try {
    // Validate input first
    const validation = validateInput(
      message.text,
      message.sourceLang,
      message.targetLang
    );

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
    const cacheKey = getCacheKey(text, message.sourceLang, message.targetLang, provider);
    if (message.sourceLang !== 'auto') {
      const cached = getCachedTranslation(cacheKey);
      if (cached) {
        cacheHits++;
        const duration = Date.now() - startTime;
        console.log(`[Background] Cache hit, returning in ${duration}ms`);
        return {
          success: true,
          result: cached.result,
          duration,
          cached: true,
        } as TranslateResponse & { cached: boolean };
      }
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

    // Use retry for network-related failures
    const response = await withRetry(
      async () => {
        const result = await sendToOffscreen<{
          success: boolean;
          result?: string | string[];
          error?: unknown;
        }>({
          type: 'translate',
          text,
          sourceLang: message.sourceLang,
          targetLang: message.targetLang,
          provider,
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

    console.log('[Background] Translation complete');
    recordUsage(tokenEstimate);

    // Cache the result (use actual source lang if auto-detected)
    const actualSourceLang = message.sourceLang === 'auto' ? 'auto' : message.sourceLang;
    if (response.result && actualSourceLang !== 'auto') {
      setCachedTranslation(cacheKey, response.result, actualSourceLang, message.targetLang);
    }

    return {
      success: true,
      result: response.result,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const translationError = createTranslationError(error);
    console.error('[Background] Translation error:', translationError.technicalDetails);

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
      requestLimit: RATE_LIMIT.requestsPerMinute,
      tokenLimit: RATE_LIMIT.tokensPerMinute,
      queue: 0,
    },
    cache: getCacheStats(),
    providers: {},
  };
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
    console.warn('[Background] Error getting providers:', error);

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

// Installation handler
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Background] Extension installed');
    // Detect browser's preferred language for target
    const browserLang = chrome.i18n.getUILanguage().split('-')[0]; // e.g., 'en-US' -> 'en'
    console.log('[Background] Browser language detected:', browserLang);
    chrome.storage.local.set({
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
chrome.storage.local.get(['provider'], (result) => {
  if (result.provider) {
    currentProvider = result.provider as TranslationProviderId;
    console.log('[Background] Restored provider:', currentProvider);
  }
});

// Handle extension startup - pre-warm the offscreen document
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension startup, pre-warming offscreen document...');
  ensureOffscreenDocument().catch((error) => {
    console.warn('[Background] Pre-warm failed (will retry on first use):', error);
  });
});

console.log('[Background] Service worker initialized v2.2 with TranslateGemma + caching + preload');
