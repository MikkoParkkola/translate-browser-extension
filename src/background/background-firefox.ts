/**
 * Firefox Background Script
 *
 * Unlike Chrome's service worker + offscreen document architecture,
 * Firefox uses a persistent background page with full DOM access.
 * This allows running Transformers.js ML inference directly.
 */

import { pipeline, env } from '@huggingface/transformers';
import type {
  BackgroundRequestMessage,
  BackgroundRequestMessageType,
  ExtensionMessage,
  ExtensionMessageResponse,
  ExtensionMessageResponseByType,
  TranslateResponse,
  Strategy,
  TranslationProviderId,
  TranslationPipeline,
  SetProviderMessage,
  PreloadModelMessage,
  TranslateMessage,
  MessageResponse,
} from '../types';
import {
  createTranslationError,
  validateInput,
  withRetry,
  isNetworkError,
  extractErrorMessage,
  type TranslationError,
} from '../core/errors';
import { createLogger } from '../core/logger';
import { safeStorageGet, strictStorageSet } from '../core/storage';
import { getCorrection } from '../core/corrections';
import { withTimeout } from '../core/async-utils';
import { CONFIG } from '../config';
import { browserAPI, getURL } from '../core/browser-api';
import { DEFAULT_PROVIDER_ID, normalizeTranslationProviderId } from '../shared/provider-options';
import {
  assertNever,
  isExtensionMessage,
  isHandledExtensionMessage,
  isAuthorizedExtensionSender,
  routeHandledExtensionMessage,
} from './shared/message-routing';

// Extracted modules from offscreen (now used directly)
import { MODEL_MAP, PIVOT_ROUTES } from '../offscreen/model-maps';
import { getCachedPipeline, cachePipeline, castAsPipeline } from '../offscreen/pipeline-cache';
import { buildLanguageDetectionSample, detectLanguage } from '../offscreen/language-detection';
import { translateWithGemma, getTranslateGemmaPipeline } from '../offscreen/translategemma';
import {
  createTranslationCache,
  type DetailedCacheStats,
  type StorageAdapter,
  type TranslationCache,
  handleClearCloudApiKey,
  handleGetCloudProviderStatus,
  handleSetCloudApiKey,
  handleSetCloudProviderEnabled,
} from './shared';
import { estimateTokens, formatUserError, PROVIDER_LIST } from './shared/provider-management';
import { NETWORK_RETRY_CONFIG } from './shared/translation-core';

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
/* v8 ignore start */
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = wasmBasePath;
}
/* v8 ignore stop */

log.info('WASM path configured:', wasmBasePath);

// ============================================================================
// State Management
// ============================================================================

let currentStrategy: Strategy = 'smart';
let currentProvider: TranslationProviderId = DEFAULT_PROVIDER_ID;

// ============================================================================
// Shared Translation Cache (Persistent LRU)
// ============================================================================

const firefoxStorageAdapter: StorageAdapter = {
  get: (keys) => browserAPI.storage.local.get(keys),
  set: (data) => browserAPI.storage.local.set(data),
  remove: (keys) => browserAPI.storage.local.remove(keys),
};

const translationCache: TranslationCache = createTranslationCache(
  firefoxStorageAdapter,
  () => currentProvider
);

// Load cache on startup
translationCache.load();

// ============================================================================
// ML Pipeline Management (Direct - no offscreen needed)
// ============================================================================

async function detectWebGPU(): Promise<boolean> {
  const { supported } = await detectWebGPUCapabilities();
  return supported;
}

async function detectWebGPUCapabilities(): Promise<{ supported: boolean; fp16: boolean }> {
  if (!navigator.gpu) return { supported: false, fp16: false };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return { supported: false, fp16: false };
    }
    return {
      supported: true,
      fp16: adapter.features.has('shader-f16'),
    };
  } catch {
    return { supported: false, fp16: false };
  }
}

async function detectWebNN(): Promise<boolean> {
  try {
    const ml = (navigator as unknown as {
      ml?: { createContext(opts: object): Promise<unknown> };
    }).ml;
    if (!ml) return false;
    const context = await ml.createContext({ deviceType: 'gpu' });
    return !!context;
  } catch {
    return false;
  }
}

async function getPipeline(sourceLang: string, targetLang: string): Promise<TranslationPipeline> {
  const key = `${sourceLang}-${targetLang}`;
  const modelId = MODEL_MAP[key];

  /* v8 ignore start */
  if (!modelId) {
    // getPipeline is only called from translateDirect, which is only called after
    // MODEL_MAP[key] has already been verified to exist in translateWithProvider.
    throw new Error(`Unsupported language pair: ${key}`);
  }
  /* v8 ignore stop */

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

  cachePipeline(modelId, castAsPipeline(pipe));
  log.info(`Model loaded: ${modelId}`);

  return castAsPipeline(pipe);
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
        /* v8 ignore start */
        if (!t || t.trim().length === 0) return t;
        const result = await pipe(t, { max_length: 512 });
        return (result as Array<{ translation_text: string }>)[0].translation_text;
        /* v8 ignore stop */
      })
    );
    return results;
  }

  /* v8 ignore start */
  if (!text || text.trim().length === 0) return text;
  /* v8 ignore stop */
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
  provider: TranslationProviderId = DEFAULT_PROVIDER_ID
): Promise<string | string[]> {
  // Handle auto-detection
  let actualSourceLang = sourceLang;
  if (sourceLang === 'auto') {
    const sampleText = buildLanguageDetectionSample(text);
    actualSourceLang = await detectLanguage(sampleText);
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
      /* v8 ignore start */
      if (!t || t.trim().length === 0) {
      /* v8 ignore stop */
        results[i] = t;
        continue;
      }

      // Skip cache for now - use in-memory cache above
      uncachedItems.push({ index: i, text: t });
    }

    /* v8 ignore start */
    if (uncachedItems.length > 0) {
    /* v8 ignore stop */
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
  /* v8 ignore start */
  if (!text || text.trim().length === 0) {
    return text;
  }
  /* v8 ignore stop */

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
// Rate limiting
// ============================================================================

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

// ============================================================================
// Retry Configuration
// ============================================================================

// ============================================================================
// Message Handlers
// ============================================================================

const FIREFOX_MESSAGE_TYPES = [
  'ping',
  'translate',
  'getUsage',
  'getProviders',
  'preloadModel',
  'setProvider',
  'getCacheStats',
  'clearCache',
  'checkChromeTranslator',
  'checkWebGPU',
  'checkWebNN',
  'getCloudProviderStatus',
  'setCloudApiKey',
  'clearCloudApiKey',
  'setCloudProviderEnabled',
] as const satisfies readonly BackgroundRequestMessageType[];

type FirefoxHandledMessage = Extract<
  BackgroundRequestMessage,
  { type: (typeof FIREFOX_MESSAGE_TYPES)[number] }
>;

type FirefoxHandledResponse = ExtensionMessageResponse<FirefoxHandledMessage>;

function isFirefoxHandledMessage(message: ExtensionMessage): message is FirefoxHandledMessage {
  return isHandledExtensionMessage(message, FIREFOX_MESSAGE_TYPES);
}

async function handleMessage(message: FirefoxHandledMessage): Promise<FirefoxHandledResponse> {
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
      return handlePreloadModel(message);
    case 'setProvider':
      return handleSetProvider(message);
    case 'getCacheStats':
      return handleGetCacheStats();
    case 'clearCache':
      return handleClearCache();
    case 'checkChromeTranslator':
      return handleCheckChromeTranslator();
    case 'checkWebGPU':
      return handleCheckWebGPU();
    case 'checkWebNN':
      return handleCheckWebNN();
    case 'getCloudProviderStatus':
      return handleGetCloudProviderStatus();
    case 'setCloudApiKey':
      return handleSetCloudApiKey(message);
    case 'clearCloudApiKey':
      return handleClearCloudApiKey(message);
    case 'setCloudProviderEnabled':
      return handleSetCloudProviderEnabled(message);
    default:
      return assertNever(message);
  }
}

async function handleSetProvider(message: SetProviderMessage): Promise<MessageResponse<{ provider: TranslationProviderId }>> {
  currentProvider = message.provider;
  log.info(`Provider set to: ${currentProvider}`);
  await strictStorageSet({ provider: currentProvider });
  return { success: true, provider: currentProvider };
}

async function handlePreloadModel(message: PreloadModelMessage): Promise<MessageResponse<{ preloaded: boolean }>> {
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
      error: extractErrorMessage(error),
    };
  }
}

async function handleGetCacheStats(): Promise<MessageResponse<{ cache: DetailedCacheStats }>> {
  await translationCache.load();
  return {
    success: true,
    cache: translationCache.getStats(),
  };
}

async function handleClearCache(): Promise<{ success: true; clearedEntries: number }> {
  const previousSize = translationCache.size;
  await translationCache.clear();
  return {
    success: true,
    clearedEntries: previousSize,
  };
}

async function handleCheckChromeTranslator(): Promise<{ success: true; available: boolean }> {
  return { success: true, available: false };
}

async function handleCheckWebGPU(): Promise<{ success: true; supported: boolean; fp16: boolean }> {
  const gpu = await detectWebGPUCapabilities();
  return { success: true, supported: gpu.supported, fp16: gpu.fp16 };
}

async function handleCheckWebNN(): Promise<{ success: true; supported: boolean }> {
  return { success: true, supported: await detectWebNN() };
}

async function handleTranslate(message: TranslateMessage): Promise<TranslateResponse> {
  const startTime = Date.now();

  try {
    await translationCache.load();

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
    const cacheKey = translationCache.getKey(
      text,
      message.sourceLang,
      message.targetLang,
      provider
    );
    if (message.sourceLang !== 'auto') {
      const cached = translationCache.get(cacheKey);
      if (cached) {
        const duration = Date.now() - startTime;
        return {
          success: true,
          result: cached.result,
          duration,
        } as TranslateResponse & { cached: boolean };
      }

      if (typeof text === 'string') {
        const userCorrection = await getCorrection(text, message.sourceLang, message.targetLang);
        if (userCorrection) {
          const duration = Date.now() - startTime;
          log.info(`Using user correction, returning in ${duration}ms`);
          translationCache.set(cacheKey, userCorrection, message.sourceLang, message.targetLang);
          return {
            success: true,
            result: userCorrection,
            duration,
            fromCorrection: true,
          };
        }
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
      translationCache.set(cacheKey, result, message.sourceLang, message.targetLang);
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

function handleGetUsage(): ExtensionMessageResponseByType<'getUsage'> {
  return {
    throttle: {
      requests: rateLimit.requests,
      tokens: rateLimit.tokens,
      requestLimit: CONFIG.rateLimits.requestsPerMinute,
      tokenLimit: CONFIG.rateLimits.tokensPerMinute,
      totalRequests: rateLimit.requests,
      totalTokens: rateLimit.tokens,
      queue: 0,
    },
    cache: translationCache.getStats(),
    providers: {},
  };
}

function handleGetProviders(): { providers: typeof PROVIDER_LIST; activeProvider: TranslationProviderId; strategy: Strategy; supportedLanguages: Array<{ src: string; tgt: string; pivot?: boolean }> } {
  return {
    providers: PROVIDER_LIST,
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
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: TranslateResponse | unknown) => void
  ) => {
    if (!isExtensionMessage(message)) return;

    // Ignore messages meant for offscreen (Chrome compatibility)
    if ('target' in message && (message as { target?: string }).target === 'offscreen') return false;

    // Validate sender for sensitive operations — only allow from extension pages (popup/options),
    // not content scripts running on arbitrary web pages.
    if (!isAuthorizedExtensionSender(message, sender.url, 'moz-extension://')) {
      sendResponse({ success: false, error: 'Unauthorized sender' });
      return true;
    }

    return routeHandledExtensionMessage({
      message,
      sendResponse,
      isHandledMessage: isFirefoxHandledMessage,
      dispatch: handleMessage,
      logUnknownMessage: (type) => log.warn(`Unknown message type: ${type}`),
      createErrorResponse: (error) => {
        const translationError = createTranslationError(error);
        log.error('Error:', translationError.technicalDetails);
        return {
          success: false,
          error: formatUserError(translationError),
        };
      },
    });
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
    void strictStorageSet({
      sourceLang: 'auto',
      targetLang: browserLang || 'en',
      strategy: 'smart',
      provider: 'opus-mt',
    }).catch((error) => {
      log.error('Failed to persist install defaults:', error);
    });
  } else if (details.reason === 'update') {
    log.info('Extension updated from', details.previousVersion);
  }
});

// ============================================================================
// Startup
// ============================================================================

/* v8 ignore start — module-level IIFE runs at import time, before test mocks are configured */
(async () => {
  const result = await safeStorageGet<{ provider?: unknown }>(['provider']);
  if (result.provider !== undefined) {
    const restoredProvider = normalizeTranslationProviderId(result.provider);
    if (result.provider === 'opus-mt-local') {
      log.info('Migrated legacy stored provider alias to opus-mt');
    } else if (restoredProvider !== result.provider) {
      log.warn('Ignoring invalid stored provider:', result.provider);
    }
    currentProvider = restoredProvider;
    log.info('Restored provider:', currentProvider);
  } else {
    log.info('No stored provider found, using default opus-mt');
  }
})();
/* v8 ignore stop */

log.info('Firefox background page initialized v2.2 with TranslateGemma + caching');
