/**
 * Firefox Background Script
 *
 * Unlike Chrome's service worker + offscreen document architecture,
 * Firefox uses a persistent background page with full DOM access.
 * This allows running Transformers.js ML inference directly.
 */

import { pipeline, env } from '@huggingface/transformers';
import type {
  TranslateResponse,
  Strategy,
  TranslationProviderId,
  TranslationPipeline,
  TranslateMessage,
} from '../types';
import { createLogger } from '../core/logger';
import { safeStorageGet, strictStorageSet } from '../core/storage';
import { withTimeout } from '../core/async-utils';
import { CONFIG } from '../config';
import { browserAPI, getURL } from '../core/browser-api';
import { DEFAULT_PROVIDER_ID } from '../shared/provider-options';
import {
  collectBatchTranslationInputs,
  mergeBatchTranslationResults,
  translateArrayItems,
} from '../offscreen/batch-translation';
// Extracted modules from offscreen (now used directly)
import {
  getModelId,
  getSupportedLanguagePairs,
  resolveOpusMtTranslationRoute,
} from '../offscreen/model-maps';
import { getOpusMtPipelineConfig, preloadOpusMtModel } from '../offscreen/opus-runtime';
import { getCachedPipeline, cachePipeline, castAsPipeline } from '../offscreen/pipeline-cache';
import { buildLanguageDetectionSample, detectLanguage } from '../offscreen/language-detection';
import { translateWithGemma, getTranslateGemmaPipeline } from '../offscreen/translategemma';
import {
  createTranslationCache,
  type StorageAdapter,
  type TranslationCache,
  getProvider,
  setProvider,
  getStrategy,
  handleClearCache,
  handleTranslateCore,
  PROVIDER_LIST,
  createInstallationHandler,
  restorePersistedProvider,
  COMMON_BACKGROUND_MESSAGE_TYPES,
  type CommonBackgroundMessage,
  type CommonBackgroundResponse,
  createBackgroundMessageGuard,
  createBackgroundMessageListener,
  createCommonBackgroundMessageDispatcher,
  createPreloadModelHandler,
} from './shared';

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
// Shared Translation Cache (Persistent LRU)
// ============================================================================

const firefoxStorageAdapter: StorageAdapter = {
  get: (keys) => browserAPI.storage.local.get(keys),
  set: (data) => browserAPI.storage.local.set(data),
  remove: (keys) => browserAPI.storage.local.remove(keys),
};

const translationCache: TranslationCache = createTranslationCache(
  firefoxStorageAdapter,
  getProvider,
);

// Load cache on startup
translationCache.load();

// Firefox keeps cache ownership in the background layer, but still benefits from
// per-item batch reuse so partially overlapping arrays avoid repeated inference.
function getCachedBatchItemTranslation(
  text: string,
  sourceLang: string,
  targetLang: string,
  provider: TranslationProviderId,
): string | null {
  const cacheKey = translationCache.getKey(text, sourceLang, targetLang, provider);
  const cachedResult = translationCache.get(cacheKey)?.result;
  return typeof cachedResult === 'string' ? cachedResult : null;
}

function storeCachedBatchItemTranslation(
  text: string,
  translation: string,
  sourceLang: string,
  targetLang: string,
  provider: TranslationProviderId,
): void {
  const cacheKey = translationCache.getKey(text, sourceLang, targetLang, provider);
  translationCache.set(cacheKey, translation, sourceLang, targetLang);
}

// ============================================================================
// ML Pipeline Management (Direct - no offscreen needed)
// ============================================================================

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
  const modelId = getModelId(sourceLang, targetLang);

  /* v8 ignore start */
  if (!modelId) {
    // getPipeline is only called from translateDirect, which is only called after
    // a direct route has already been verified to exist in translateWithProvider.
    throw new Error(`Unsupported language pair: ${sourceLang}-${targetLang}`);
  }
  /* v8 ignore stop */

  const cached = getCachedPipeline(modelId);
  if (cached) {
    log.info(`Pipeline cache HIT: ${modelId}`);
    return cached;
  }

  log.info(`Loading model: ${modelId}`);

  const { device, dtype } = getOpusMtPipelineConfig(await detectWebGPUCapabilities());
  log.info(`Using device: ${device}, dtype: ${dtype}`);

  const pipe = await withTimeout(
    pipeline('translation', modelId, { device, dtype }),
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
    return translateArrayItems(
      text,
      async (value) => {
        const result = await pipe(value, { max_length: 512 });
        return (result as Array<{ translation_text: string }>)[0].translation_text;
      },
      {
        onItemError: ({ text: originalText, error }) => {
          log.warn(` Translation failed for item (${originalText.substring(0, 30)}...):`, error);
        },
      }
    );
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
  const route = resolveOpusMtTranslationRoute(sourceLang, targetLang);

  if (route?.kind === 'direct') {
    log.info(`Direct translation: ${sourceLang}-${targetLang}`);
    return translateDirect(text, sourceLang, targetLang);
  }

  if (route?.kind === 'pivot') {
    const [firstHop, secondHop] = route.route;
    const [firstSrc, firstTgt] = firstHop.split('-');
    const [secondSrc, secondTgt] = secondHop.split('-');

    log.info(`Pivot translation: ${sourceLang} -> ${firstTgt} -> ${targetLang}`);

    const intermediateResult = await translateDirect(text, firstSrc, firstTgt);
    const finalResult = await translateDirect(intermediateResult, secondSrc, secondTgt);

    return finalResult;
  }

  throw new Error(`Unsupported language pair: ${sourceLang}-${targetLang}`);
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
  }

  if (actualSourceLang === targetLang) {
    log.info('Source equals target, skipping translation');
    return text;
  }

  // Handle array of texts
  if (Array.isArray(text)) {
    const { results, uncachedItems } = await collectBatchTranslationInputs(text, {
      getCached: (value) => getCachedBatchItemTranslation(
        value,
        actualSourceLang,
        targetLang,
        provider,
      ),
      onCacheHit: ({ index, text: originalText, cached }) => {
        /* v8 ignore start -- debug logging branch */
        if (index < 3) {
          log.debug(`Cache #${index}: "${originalText.substring(0, 30)}" -> "${cached.substring(0, 30)}"${cached === originalText ? ' (identity)' : ''}`);
        }
        /* v8 ignore stop */
      },
    });

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

      const { results: mergedResults, cacheFailures } = await mergeBatchTranslationResults(
        results,
        uncachedItems,
        translations,
        {
          storeCached: (originalText, translation) => {
            storeCachedBatchItemTranslation(
              originalText,
              translation,
              actualSourceLang,
              targetLang,
              provider,
            );
          },
          onCacheStoreFailure: ({ failureCount, error }) => {
            if (failureCount <= 2) {
              log.warn(`Failed to cache translation (${failureCount}):`, error);
            }
          },
          onIdentityTranslation: ({ text: originalText }) => {
            log.debug(`Identity translation cached for "${originalText.substring(0, 30)}"`);
          },
        },
      );
      if (cacheFailures > 2) {
        log.warn(`Cache write failed for ${cacheFailures}/${uncachedItems.length} items`);
      }
      return mergedResults;
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
  return getSupportedLanguagePairs();
}

// ============================================================================
// Message Handlers
// ============================================================================

const FIREFOX_MESSAGE_TYPES = COMMON_BACKGROUND_MESSAGE_TYPES;

type FirefoxHandledMessage = CommonBackgroundMessage;

type FirefoxHandledResponse = CommonBackgroundResponse;

const isFirefoxHandledMessage = createBackgroundMessageGuard(FIREFOX_MESSAGE_TYPES);

const handlePreloadModel = createPreloadModelHandler({
  log,
  getProvider,
  preloadModel: async (message, provider) => {
    if (provider === 'translategemma') {
      await getTranslateGemmaPipeline();
      return { success: true, preloaded: true, available: true };
    }

    if (provider === 'chrome-builtin') {
      return { success: true, preloaded: false, available: false };
    }

    return {
      success: true,
      ...(await preloadOpusMtModel(message.sourceLang, message.targetLang, getPipeline)),
    };
  },
});

const dispatchCommonMessage = createCommonBackgroundMessageDispatcher({
  translationCache,
  getProvider,
  handleTranslate,
  handleGetProviders,
  handlePreloadModel,
  handleClearCache: () => handleClearCache(translationCache),
  handleCheckChromeTranslator,
  handleCheckWebGPU,
  handleCheckWebNN,
});

async function handleMessage(message: FirefoxHandledMessage): Promise<FirefoxHandledResponse> {
  return dispatchCommonMessage(message);
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
  await translationCache.load();
  return handleTranslateCore(
    message,
    translationCache,
    async (text, sourceLang, targetLang, provider) => ({
      result: await translate(text, sourceLang, targetLang, provider),
    }),
  );
}

function handleGetProviders(): { providers: typeof PROVIDER_LIST; activeProvider: TranslationProviderId; strategy: Strategy; supportedLanguages: Array<{ src: string; tgt: string; pivot?: boolean }> } {
  return {
    providers: [...PROVIDER_LIST],
    activeProvider: getProvider(),
    strategy: getStrategy(),
    supportedLanguages: getSupportedLanguages(),
  };
}

// ============================================================================
// Message Listener
// ============================================================================

browserAPI.runtime.onMessage.addListener(createBackgroundMessageListener({
  extensionUrlPrefix: 'moz-extension://',
  isHandledMessage: isFirefoxHandledMessage,
  dispatch: handleMessage,
  log,
}));

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
    const provider = settings.provider || getProvider();

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

browserAPI.runtime.onInstalled.addListener(createInstallationHandler({
  log,
  getUiLanguage: () => browserAPI.i18n.getUILanguage(),
  persistInstallDefaults: async (browserLang) => {
    await strictStorageSet({
      sourceLang: 'auto',
      targetLang: browserLang || 'en',
      strategy: 'smart',
      provider: DEFAULT_PROVIDER_ID,
    });
  },
}));

// ============================================================================
// Startup
// ============================================================================

/* v8 ignore start — module-level IIFE runs at import time, before test mocks are configured */
(async () => {
  await restorePersistedProvider({
    log,
    defaultProvider: DEFAULT_PROVIDER_ID,
    readStoredProvider: async () => {
      const result = await safeStorageGet<{ provider?: unknown }>(['provider']);
      return result.provider;
    },
    setProvider,
    getProvider,
  });
})();
/* v8 ignore stop */

log.info('Firefox background page initialized v2.2 with TranslateGemma + caching');
