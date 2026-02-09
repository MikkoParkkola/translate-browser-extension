/**
 * Firefox Background Script
 *
 * Unlike Chrome's service worker + offscreen document architecture,
 * Firefox uses a persistent background page with full DOM access.
 * This allows running Transformers.js ML inference directly.
 */

import { pipeline, env } from '@huggingface/transformers';
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
import { CONFIG } from '../config';
import { browserAPI, getURL } from '../core/browser-api';

// Extracted modules from offscreen (now used directly)
import { MODEL_MAP, PIVOT_ROUTES } from '../offscreen/model-maps';
import { getCachedPipeline, cachePipeline } from '../offscreen/pipeline-cache';
import { detectLanguage } from '../offscreen/language-detection';
import { translateWithGemma, getTranslateGemmaPipeline } from '../offscreen/translategemma';

const log = createLogger('Background-FF');

// ============================================================================
// Transformers.js Configuration
// ============================================================================

// Configure Transformers.js for Firefox extension environment
env.allowRemoteModels = true;  // Models from HuggingFace Hub
env.allowLocalModels = false;  // No local filesystem
env.useBrowserCache = true;    // Cache models in IndexedDB

// Point ONNX Runtime to bundled WASM files
const wasmBasePath = getURL('assets/');
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = wasmBasePath;
}

log.info('WASM path configured:', wasmBasePath);

// ============================================================================
// Enhanced Translation Memory (Persistent LRU Cache)
// ============================================================================

/**
 * Persistent cache entry with usage tracking.
 */
interface PersistentCacheEntry {
  result: string | string[];
  timestamp: number;
  sourceLang: string;
  targetLang: string;
  useCount: number;
}

const translationCache = new Map<string, PersistentCacheEntry>();
let cacheHits = 0;
let cacheMisses = 0;
let cacheInitialized = false;
let saveCacheTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Load cache from persistent storage on startup.
 */
async function loadPersistentCache(): Promise<void> {
  if (cacheInitialized) return;

  try {
    const stored = await browserAPI.storage.local.get([
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
    cacheInitialized = true;
  }
}

/**
 * Schedule cache save to persistent storage (debounced).
 */
function scheduleCacheSave(): void {
  if (saveCacheTimer) return;

  saveCacheTimer = setTimeout(async () => {
    saveCacheTimer = null;
    try {
      const entries = Array.from(translationCache.entries());
      await browserAPI.storage.local.set({
        [CONFIG.cache.storageKey]: entries,
        cacheStats: { hits: cacheHits, misses: cacheMisses },
      });
      log.debug(`Saved ${entries.length} translations to persistent storage`);
    } catch (error) {
      log.warn('Failed to save cache:', error);
    }
  }, CONFIG.cache.saveDebounceMs);
}

function getCacheKey(text: string | string[], sourceLang: string, targetLang: string, provider?: string): string {
  const providerKey = provider || currentProvider;
  return generateCacheKey(text, sourceLang, targetLang, providerKey);
}

function getCachedTranslation(key: string): PersistentCacheEntry | undefined {
  const entry = translationCache.get(key);
  if (entry) {
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

function setCachedTranslation(
  key: string,
  result: string | string[],
  sourceLang: string,
  targetLang: string
): void {
  while (translationCache.size >= CONFIG.cache.maxSize) {
    const entries = Array.from(translationCache.entries());
    const oldestCount = Math.max(10, Math.floor(entries.length * 0.1));
    const oldestEntries = entries.slice(0, oldestCount);
    const leastUsed = oldestEntries.reduce((min, curr) =>
      curr[1].useCount < min[1].useCount ? curr : min
    );
    translationCache.delete(leastUsed[0]);
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
 * Detailed cache statistics for diagnostics.
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

function getCacheStats(): DetailedCacheStats {
  const entries = Array.from(translationCache.entries());

  let oldestTimestamp: number | null = null;
  for (const [, entry] of entries) {
    if (oldestTimestamp === null || entry.timestamp < oldestTimestamp) {
      oldestTimestamp = entry.timestamp;
    }
  }

  const mostUsed = entries
    .sort((a, b) => b[1].useCount - a[1].useCount)
    .slice(0, 5)
    .map(([key, value]) => ({
      text: key.substring(0, 50) + (key.length > 50 ? '...' : ''),
      useCount: value.useCount,
      langs: `${value.sourceLang} -> ${value.targetLang}`,
    }));

  const languagePairs: Record<string, number> = {};
  for (const [, entry] of entries) {
    const pair = `${entry.sourceLang}-${entry.targetLang}`;
    languagePairs[pair] = (languagePairs[pair] || 0) + 1;
  }

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
    await browserAPI.storage.local.remove([CONFIG.cache.storageKey, 'cacheStats']);
    log.info('Translation cache cleared');
  } catch (error) {
    log.warn('Failed to clear persistent cache:', error);
  }
}

// Load cache on startup
loadPersistentCache();

// ============================================================================
// ML Pipeline Management (Direct - no offscreen needed)
// ============================================================================

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${message} (${ms / 1000}s)`)), ms)
    ),
  ]);
}

async function detectWebGPU(): Promise<boolean> {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPipeline(sourceLang: string, targetLang: string): Promise<any> {
  const key = `${sourceLang}-${targetLang}`;
  const modelId = MODEL_MAP[key];

  if (!modelId) {
    throw new Error(`Unsupported language pair: ${key}`);
  }

  const cached = getCachedPipeline(modelId);
  if (cached) {
    log.info(`Pipeline cache HIT: ${modelId}`);
    return cached;
  }

  log.info(`Loading model: ${modelId}`);

  const webgpu = await detectWebGPU();
  const device = webgpu ? 'webgpu' : 'wasm';
  log.info(`Using device: ${device}`);

  const pipe = await withTimeout(
    pipeline('translation', modelId, { device }),
    CONFIG.timeouts.opusMtDirectMs,
    `Loading model ${modelId}`
  );

  cachePipeline(modelId, pipe);
  log.info(`Model loaded: ${modelId}`);

  return pipe;
}

async function translateDirect(
  text: string | string[],
  sourceLang: string,
  targetLang: string
): Promise<string | string[]> {
  const pipe = await getPipeline(sourceLang, targetLang);

  if (Array.isArray(text)) {
    const results = await Promise.all(
      text.map(async (t) => {
        if (!t || t.trim().length === 0) return t;
        const result = await pipe(t, { max_length: 512 });
        return (result as Array<{ translation_text: string }>)[0].translation_text;
      })
    );
    return results;
  }

  if (!text || text.trim().length === 0) return text;
  const result = await pipe(text, { max_length: 512 });
  return (result as Array<{ translation_text: string }>)[0].translation_text;
}

async function translateWithProvider(
  text: string | string[],
  sourceLang: string,
  targetLang: string,
  provider: TranslationProviderId
): Promise<string | string[]> {
  // TranslateGemma
  if (provider === 'translategemma') {
    log.info(`TranslateGemma translation: ${sourceLang} -> ${targetLang}`);
    return translateWithGemma(text, sourceLang, targetLang);
  }

  // OPUS-MT: check for direct model or pivot route
  const key = `${sourceLang}-${targetLang}`;

  if (MODEL_MAP[key]) {
    log.info(`Direct translation: ${key}`);
    return translateDirect(text, sourceLang, targetLang);
  }

  const pivotRoute = PIVOT_ROUTES[key];
  if (pivotRoute) {
    const [firstHop, secondHop] = pivotRoute;
    const [firstSrc, firstTgt] = firstHop.split('-');
    const [secondSrc, secondTgt] = secondHop.split('-');

    log.info(`Pivot translation: ${sourceLang} -> ${firstTgt} -> ${targetLang}`);

    const intermediateResult = await translateDirect(text, firstSrc, firstTgt);
    const finalResult = await translateDirect(intermediateResult, secondSrc, secondTgt);

    return finalResult;
  }

  throw new Error(`Unsupported language pair: ${key}`);
}

async function translate(
  text: string | string[],
  sourceLang: string,
  targetLang: string,
  provider: TranslationProviderId = 'opus-mt'
): Promise<string | string[]> {
  // Handle auto-detection
  let actualSourceLang = sourceLang;
  if (sourceLang === 'auto') {
    const sampleText = Array.isArray(text) ? text.slice(0, 3).join(' ') : text;
    actualSourceLang = detectLanguage(sampleText);
    log.info(`Auto-detected source: ${actualSourceLang}`);

    if (actualSourceLang === targetLang) {
      log.info('Source equals target, skipping translation');
      return text;
    }
  }

  // Handle array of texts
  if (Array.isArray(text)) {
    const results: string[] = [];
    const uncachedItems: Array<{ index: number; text: string }> = [];

    for (let i = 0; i < text.length; i++) {
      const t = text[i];
      if (!t || t.trim().length === 0) {
        results[i] = t;
        continue;
      }

      // Skip cache for now - use in-memory cache above
      uncachedItems.push({ index: i, text: t });
    }

    if (uncachedItems.length > 0) {
      const uncachedTexts = uncachedItems.map((item) => item.text);
      const translations = await translateWithProvider(
        uncachedTexts,
        actualSourceLang,
        targetLang,
        provider
      );

      const translationArray = Array.isArray(translations) ? translations : [translations];
      for (let i = 0; i < uncachedItems.length; i++) {
        results[uncachedItems[i].index] = translationArray[i];
      }
    }

    return results;
  }

  // Handle single text
  if (!text || text.trim().length === 0) {
    return text;
  }

  return translateWithProvider(text, actualSourceLang, targetLang, provider);
}

function getSupportedLanguages(): Array<{ src: string; tgt: string; pivot?: boolean }> {
  const direct = Object.keys(MODEL_MAP).map((key) => {
    const [src, tgt] = key.split('-');
    return { src, tgt };
  });

  const pivot = Object.keys(PIVOT_ROUTES).map((key) => {
    const [src, tgt] = key.split('-');
    return { src, tgt, pivot: true };
  });

  return [...direct, ...pivot];
}

// ============================================================================
// State Management
// ============================================================================

let currentStrategy: Strategy = 'smart';
let currentProvider: TranslationProviderId = 'opus-mt';

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

// ============================================================================
// Retry Configuration
// ============================================================================

const NETWORK_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: CONFIG.retry.network.maxRetries,
  baseDelayMs: CONFIG.retry.network.baseDelayMs,
  maxDelayMs: CONFIG.retry.network.maxDelayMs,
};

// ============================================================================
// Error Formatting
// ============================================================================

function formatUserError(error: TranslationError): string {
  let message = error.message;
  if (error.suggestion) {
    message += `. ${error.suggestion}`;
  }
  return message;
}

// ============================================================================
// Message Handlers
// ============================================================================

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

async function handleSetProvider(message: {
  type: 'setProvider';
  provider: TranslationProviderId;
}): Promise<unknown> {
  currentProvider = message.provider;
  log.info(`Provider set to: ${currentProvider}`);
  await safeStorageSet({ provider: currentProvider });
  return { success: true, provider: currentProvider };
}

async function handlePreloadModel(message: {
  type: 'preloadModel';
  sourceLang: string;
  targetLang: string;
  provider?: TranslationProviderId;
}): Promise<unknown> {
  const provider = message.provider || currentProvider;
  log.info(`Preloading ${provider} model: ${message.sourceLang} -> ${message.targetLang}`);

  try {
    if (provider === 'translategemma') {
      await getTranslateGemmaPipeline();
      return { success: true, preloaded: true };
    } else {
      const pair = `${message.sourceLang}-${message.targetLang}`;
      if (MODEL_MAP[pair]) {
        await getPipeline(message.sourceLang, message.targetLang);
        return { success: true, preloaded: true };
      }
      return { success: true, preloaded: false };
    }
  } catch (error) {
    log.warn('Preload failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function handleGetCacheStats(): Promise<unknown> {
  await loadPersistentCache();
  return {
    success: true,
    cache: getCacheStats(),
  };
}

async function handleClearCache(): Promise<unknown> {
  const previousSize = translationCache.size;
  await clearTranslationCache();
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

    const text = validation.sanitizedText!;

    if (message.options?.strategy) {
      currentStrategy = message.options.strategy;
    }

    const provider = message.provider || currentProvider;

    // Check cache first
    const cacheKey = getCacheKey(text, message.sourceLang, message.targetLang, provider);
    if (message.sourceLang !== 'auto') {
      const cached = getCachedTranslation(cacheKey);
      if (cached) {
        cacheHits++;
        const duration = Date.now() - startTime;
        return {
          success: true,
          result: cached.result,
          duration,
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

    log.info(`Translating: ${message.sourceLang} -> ${message.targetLang}`);

    const result = await withRetry(
      async () => {
        return translate(text, message.sourceLang, message.targetLang, provider);
      },
      NETWORK_RETRY_CONFIG,
      (error: TranslationError) => {
        return isNetworkError(error.technicalDetails);
      }
    );

    log.info('Translation complete');
    recordUsage(tokenEstimate);

    // Cache the result
    if (result && message.sourceLang !== 'auto') {
      setCachedTranslation(cacheKey, result, message.sourceLang, message.targetLang);
    }

    return {
      success: true,
      result,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    const translationError = createTranslationError(error);
    log.error('Translation error:', translationError.technicalDetails);

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

async function handleGetProviders(): Promise<unknown> {
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
    supportedLanguages: getSupportedLanguages(),
  };
}

// ============================================================================
// Message Listener
// ============================================================================

browserAPI.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: TranslateResponse | unknown) => void
  ) => {
    // Ignore messages meant for offscreen (Chrome compatibility)
    if ('target' in message && (message as { target?: string }).target === 'offscreen') return false;

    handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        const translationError = createTranslationError(error);
        log.error('Error:', translationError.technicalDetails);

        sendResponse({
          success: false,
          error: formatUserError(translationError),
        });
      });

    return true; // Async response
  }
);

// ============================================================================
// Browser Action (Firefox uses browserAction, not action)
// ============================================================================

if (browserAPI.browserAction?.onClicked) {
  browserAPI.browserAction.onClicked.addListener(async (tab) => {
    if (tab.id) {
      log.info('Extension icon clicked for tab:', tab.id);
    }
  });
}

// ============================================================================
// Keyboard Shortcuts
// ============================================================================

if (browserAPI.commands?.onCommand) {
  browserAPI.commands.onCommand.addListener(async (command: string) => {
    log.info('Command received:', command);

    // Get active tab
    const tabs = await browserAPI.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];

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
        case 'translate-selection':
          await browserAPI.tabs.sendMessage(tab.id, {
            type: 'translateSelection',
            sourceLang,
            targetLang,
            strategy,
            provider,
          });
          break;

        case 'toggle-widget':
          await browserAPI.tabs.sendMessage(tab.id, {
            type: 'toggleWidget',
          });
          break;
      }
    } catch (error) {
      log.warn('Keyboard shortcut action failed:', error);
    }
  });
}

// ============================================================================
// Installation Handler
// ============================================================================

browserAPI.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    log.info('Extension installed');
    const browserLang = browserAPI.i18n.getUILanguage().split('-')[0];
    log.info('Browser language detected:', browserLang);
    safeStorageSet({
      sourceLang: 'auto',
      targetLang: browserLang || 'en',
      strategy: 'smart',
      provider: 'opus-mt',
    });
  } else if (details.reason === 'update') {
    log.info('Extension updated from', details.previousVersion);
  }
});

// ============================================================================
// Startup
// ============================================================================

(async () => {
  const result = await safeStorageGet<{ provider?: TranslationProviderId }>(['provider']);
  if (result.provider) {
    currentProvider = result.provider;
    log.info('Restored provider:', currentProvider);
  }
})();

log.info('Firefox background page initialized v2.2 with TranslateGemma + caching');
