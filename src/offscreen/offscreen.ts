/**
 * Offscreen document for Transformers.js ML inference.
 * Service workers can't use window/document, so we run ML here.
 */

import type { TranslationProviderId, TranslationPipeline } from '../types';
import { extractErrorMessage } from '../core/errors';
import { getTranslationCache } from '../core/translation-cache';
import { CONFIG } from '../config';
import { createLogger } from '../core/logger';
import { profiler } from '../core/profiler';
import { withTimeout } from '../core/async-utils';

// Extracted modules
import {
  getModelId,
  getSupportedLanguagePairs,
  resolveOpusMtTranslationRoute,
} from './model-maps';
import {
  logDownloadedModelTrackingFailure,
  reportModelProgress,
  trackDownloadedModel,
} from './model-download-tracker';
import { getCachedPipeline, cachePipeline, clearCache as clearPipelineCache, castAsPipeline } from './pipeline-cache';
import { buildLanguageDetectionSample, detectLanguage } from './language-detection';
import { translateWithGemma, getTranslateGemmaPipeline, detectWebGPU, detectWebNN } from './translategemma';
import { getChromeTranslator, isChromeTranslatorAvailable } from '../providers/chrome-translator';
import { DEFAULT_PROVIDER_ID } from '../shared/provider-options';
import {
  getOffscreenCloudProviderUsage,
  isOffscreenCloudProviderRuntimeId,
  translateWithOffscreenCloudProvider,
} from './cloud-provider-runtime';
import {
  isOffscreenTargetedMessage,
  routeOffscreenMessage,
  type OffscreenMessageByType,
  type OffscreenMessageHandlers,
  type OffscreenMessageResponseMap,
  type OffscreenRoutedResponse,
} from './message-routing';

// OCR service
import { extractTextFromImage, terminateOCR, type OCRResult } from '../core/ocr-service';

// Network status
import { isOnline, isCloudProvider, initNetworkMonitoring } from '../core/network-status';

const log = createLogger('Offscreen');

/**
 * Returns true if the value is a valid language code string:
 * non-empty, no surrounding whitespace, max 20 characters.
 */
function isValidLangCode(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 20;
}

// Initialize network monitoring in offscreen context
initNetworkMonitoring();

// CRITICAL: Point ONNX Runtime to bundled WASM files (not CDN)
// This avoids CSP violations from dynamic CDN imports
const wasmBasePath = chrome.runtime.getURL('assets/');

log.info(' WASM path configured:', wasmBasePath);

/**
 * Lazy-load Transformers.js and configure env on first use.
 * Defers the ~441KB bundle cost until OPUS-MT translation is first needed.
 */
type TransformersLib = typeof import('@huggingface/transformers');
let _transformers: TransformersLib | null = null;

async function getTransformers(): Promise<TransformersLib> {
  if (_transformers) return _transformers;
  const lib = await import('@huggingface/transformers');
  lib.env.allowRemoteModels = true;
  lib.env.allowLocalModels = false;
  lib.env.useBrowserCache = true;
  /* v8 ignore start */
  if (lib.env.backends?.onnx?.wasm) {
    lib.env.backends.onnx.wasm.wasmPaths = wasmBasePath;
  }
  /* v8 ignore stop */
  _transformers = lib;
  return lib;
}

/**
 * Select optimal dtype for OPUS-MT models.
 *
 * Xenova/Helsinki-NLP OPUS-MT models only ship _quantized (q8) ONNX variants.
 * They do NOT have dedicated fp16 ONNX files. Requesting 'fp16' causes
 * ONNX Runtime to attempt mixed-precision (float16 + float32) which crashes:
 *   "Type parameter (T) of Optype (Mul) bound to different types"
 *
 * Always use 'q8' for OPUS-MT. fp16 dtype is only safe for models that
 * ship explicit fp16 ONNX files (e.g., TranslateGemma).
 */
function selectOpusMtDtype(_webgpu: { supported: boolean; fp16: boolean }): string {
  // Always q8 for OPUS-MT — fp16 causes mixed-precision crash
  return 'q8';
}

function normalizeProgressStatus(value: unknown): 'initiate' | 'download' | 'progress' | 'done' {
  switch (value) {
    case 'initiate':
    case 'download':
    case 'done':
      return value;
    default:
      return 'progress';
  }
}

/**
 * Get or create pipeline for a language pair with LRU caching.
 */
async function getPipeline(sourceLang: string, targetLang: string, sessionId?: string): Promise<TranslationPipeline> {
  const modelId = getModelId(sourceLang, targetLang);

  /* v8 ignore start -- defensive guard for unsupported language pair */
  if (!modelId) {
    throw new Error(`Unsupported language pair: ${sourceLang}-${targetLang}`);
  }
  /* v8 ignore stop */

  // Check LRU cache first
  const cached = getCachedPipeline(modelId);
  if (cached) {
    log.info(` Pipeline cache HIT: ${modelId}`);
    if (sessionId) {
      profiler.recordTiming(sessionId, 'model_load', 0, { cached: true, modelId });
    }
    reportModelProgress(modelId, { status: 'ready', progress: 100 });
    void trackDownloadedModel(modelId).catch((error) => {
      logDownloadedModelTrackingFailure('refresh downloaded model inventory', error);
    });
    return cached;
  }

  log.info(` Loading model: ${modelId}`);
  const loadStart = performance.now();

  // OPUS-MT models MUST use WASM device. WebGPU causes degenerate output
  // (repeated words like "Figure Figure..." or "Switzerland Switzerland...")
  // with q8-quantized Marian models. WebGPU is only viable for models with
  // dedicated fp16 ONNX files (e.g., TranslateGemma).
  const device = 'wasm';
  const dtype = selectOpusMtDtype({ supported: false, fp16: false });
  log.info(` Using device: ${device}, dtype: ${dtype}`);

  // Use optimized timeout for OPUS-MT direct models (~85MB quantized, typically loads in <30s)
  // If WebGPU fails (GPU incompatibility), fall back to WASM+q8 automatically.
  let pipe;
  try {
    reportModelProgress(modelId, { status: 'initiate', progress: 0 });
    pipe = await withTimeout(
      (await getTransformers()).pipeline('translation', modelId, {
        device,
        dtype,
        progress_callback: (progress: Record<string, unknown>) => {
          reportModelProgress(modelId, {
            status: normalizeProgressStatus(progress.status),
            progress: typeof progress.progress === 'number' ? progress.progress : undefined,
            file: typeof progress.file === 'string' ? progress.file : undefined,
            loaded: typeof progress.loaded === 'number' ? progress.loaded : undefined,
            total: typeof progress.total === 'number' ? progress.total : undefined,
          });
        },
      } as Record<string, unknown>),
      CONFIG.timeouts.opusMtDirectMs,
      `Loading model ${modelId}`
    );
  } catch (error) {
    /* v8 ignore start -- defensive rethrow */
    throw error;
    /* v8 ignore stop */
  }

  const loadDuration = performance.now() - loadStart;
  if (sessionId) {
    profiler.recordTiming(sessionId, 'model_load', loadDuration, { cached: false, modelId, device });
  }
  log.info(` Model loaded: ${modelId} in ${loadDuration.toFixed(0)}ms`);

  // Store in LRU cache (may evict old models)
  cachePipeline(modelId, castAsPipeline(pipe));
  reportModelProgress(modelId, { status: 'ready', progress: 100 });
  try {
    await trackDownloadedModel(modelId);
  } catch (error) {
    logDownloadedModelTrackingFailure('persist downloaded model inventory', error);
  }

  return castAsPipeline(pipe);
}

/**
 * Translate text using a single direct model.
 */
async function translateDirect(
  text: string | string[],
  sourceLang: string,
  targetLang: string,
  sessionId?: string
): Promise<string | string[]> {
  const pipe = await getPipeline(sourceLang, targetLang, sessionId);

  const inferenceStart = performance.now();

  if (Array.isArray(text)) {
    // Short-circuit for empty batches
    /* v8 ignore start -- empty array short-circuit */
    if (text.length === 0) return [];
    /* v8 ignore stop */

    const results = await Promise.all(
      text.map(async (t, i) => {
        /* v8 ignore start -- empty string guard */
        if (!t || t.trim().length === 0) return t;
        /* v8 ignore stop */
        try {
          const result = await pipe(t, { max_length: 512 });
          const translated = (result as Array<{ translation_text: string }>)[0].translation_text;
          /* v8 ignore start -- debug logging branch */
          // Debug: log first 3 to verify model output
          if (i < 3) {
            log.debug(`Model #${i}: "${t.substring(0, 40)}" -> "${translated.substring(0, 40)}" (same=${t === translated})`);
          }
          /* v8 ignore stop */
          return translated;
        } catch (error) {
          // Per-item error: return original text instead of crashing entire batch
          log.warn(` Translation failed for item (${t.substring(0, 30)}...):`, error);
          return t;
        }
      })
    );

    const inferenceDuration = performance.now() - inferenceStart;
    if (sessionId) {
      profiler.recordTiming(sessionId, 'model_inference', inferenceDuration, {
        batchSize: text.length,
      /* v8 ignore start -- optional chaining + OR fallback */
        totalChars: text.reduce((sum, t) => sum + (t?.length || 0), 0),
      /* v8 ignore stop */
      });
    }
    return results;
  }

  /* v8 ignore start -- empty string guard */
  if (!text || text.trim().length === 0) return text;
  /* v8 ignore stop */
  const result = await pipe(text, { max_length: 512 });

  const inferenceDuration = performance.now() - inferenceStart;
  if (sessionId) {
    profiler.recordTiming(sessionId, 'model_inference', inferenceDuration, {
      batchSize: 1,
      totalChars: text.length,
    });
  }

  return (result as Array<{ translation_text: string }>)[0].translation_text;
}

/**
 * Translate text (handles auto-detection, pivot routing, and provider selection).
 */
async function translate(
  text: string | string[],
  sourceLang: string,
  targetLang: string,
  provider: TranslationProviderId = DEFAULT_PROVIDER_ID,
  sessionId?: string,
  pageContext?: string
): Promise<string | string[]> {
  // Handle auto-detection
  let actualSourceLang = sourceLang;
  if (sourceLang === 'auto') {
    const detectStart = performance.now();
    const sampleText = buildLanguageDetectionSample(text);
    actualSourceLang = await detectLanguage(sampleText);
    if (sessionId) {
      profiler.recordTiming(sessionId, 'language_detect', performance.now() - detectStart);
    }
    log.info(`Auto-detected source: ${actualSourceLang}`);

    // Don't translate if source equals target
    if (actualSourceLang === targetLang) {
      log.info(' Source equals target, skipping translation');
      return text;
    }
  }

  const cache = getTranslationCache();

  // Handle array of texts
  if (Array.isArray(text)) {
    const results: string[] = [];
    const uncachedItems: Array<{ index: number; text: string }> = [];

    // Check cache for each text
    for (let i = 0; i < text.length; i++) {
      const t = text[i];
      if (!t || t.trim().length === 0) {
        results[i] = t;
        continue;
      }

      const cached = await cache.get(t, actualSourceLang, targetLang, provider);
      if (cached !== null) {
        // Identity translations (cached === original) are valid: OPUS-MT legitimately
        // returns the original text for proper nouns, brand names, loanwords, etc.
        // Serve them from cache to avoid repeated expensive model inference.
        /* v8 ignore start -- debug logging branch */
        if (i < 3) {
          log.debug(`Cache #${i}: "${t.substring(0, 30)}" -> "${cached.substring(0, 30)}"${cached === t ? ' (identity)' : ''}`);
        }
        /* v8 ignore stop */
        results[i] = cached;
      } else {
        uncachedItems.push({ index: i, text: t });
      }
    }

    // Translate uncached items
    if (uncachedItems.length > 0) {
      log.info(`Translating ${uncachedItems.length} uncached items`);
      const uncachedTexts = uncachedItems.map((item) => item.text);
      const translations = await translateWithProvider(
        uncachedTexts,
        actualSourceLang,
        targetLang,
        provider,
        sessionId,
        pageContext
      );

      // Store results and cache them.
      // Results are always returned to the user even if caching fails.
      /* v8 ignore start -- ternary: Array.isArray */
      const translationArray = Array.isArray(translations) ? translations : [translations];
      /* v8 ignore stop */
      let cacheFails = 0;
      for (let i = 0; i < uncachedItems.length; i++) {
        const { index, text: originalText } = uncachedItems[i];
        const translation = translationArray[i];
        results[index] = translation;

        // Cache all translations including identity translations (output === input).
        // OPUS-MT legitimately returns original text for proper nouns, brand names,
        // loanwords, and short words. Caching these prevents repeated model inference.
        try {
          await cache.set(originalText, actualSourceLang, targetLang, provider, translation);
        } catch (error) {
          cacheFails++;
          if (cacheFails <= 2) {
            log.warn(`Failed to cache translation (${cacheFails}):`, error);
          }
        }
        if (translation === originalText) {
          log.debug(`Identity translation cached for "${originalText.substring(0, 30)}"`);
        }
      }
      if (cacheFails > 2) {
        log.warn(`Cache write failed for ${cacheFails}/${uncachedItems.length} items`);
      }
    }

    return results;
  }

  // Handle single text
  if (!text || text.trim().length === 0) {
    return text;
  }

  // Check cache first
  const cached = await cache.get(text, actualSourceLang, targetLang, provider);
  if (cached !== null) {
    log.info(' Cache hit');
    return cached;
  }

  // Translate and cache
  const result = await translateWithProvider(text, actualSourceLang, targetLang, provider, sessionId, pageContext);

  // Cache the translation (best-effort, don't block response)
  /* v8 ignore start -- ternary: Array.isArray */
  const resultText = Array.isArray(result) ? result[0] : result;
  /* v8 ignore stop */
  try {
    await cache.set(text, actualSourceLang, targetLang, provider, resultText);
  } catch (error) {
    log.warn('Failed to cache translation:', error);
  }

  return result;
}

/**
 * Execute translation with a specific provider (no fallback).
 */
async function executeProvider(
  text: string | string[],
  sourceLang: string,
  targetLang: string,
  provider: TranslationProviderId,
  sessionId?: string,
  pageContext?: string
): Promise<string | string[]> {
  // Fast-fail: reject cloud providers immediately when offline
  if (isCloudProvider(provider) && !isOnline()) {
    throw new Error(`${provider} unavailable: no network connection. Use a local model instead.`);
  }

  // Chrome Built-in Translator (Chrome 138+)
  if (provider === 'chrome-builtin') {
    const chromeTranslator = getChromeTranslator();
    if (!(await chromeTranslator.isAvailable())) {
      throw new Error('Chrome Translator API not available (requires Chrome 138+)');
    }
    return chromeTranslator.translate(text, sourceLang, targetLang);
  }

  // TranslateGemma: supports any-to-any translation with a single model
  // Requires WebNN (NPU) or WebGPU -- the 3.6GB model cannot fit in the 4GB WASM heap.
  if (provider === 'translategemma') {
    const [gpu, webnn] = await Promise.all([detectWebGPU(), detectWebNN()]);
    if (!gpu.supported && !webnn) {
      throw new Error('TranslateGemma requires WebNN or WebGPU (GPU/NPU acceleration). This browser does not support either. Please use OPUS-MT instead.');
    }
    return translateWithGemma(text, sourceLang, targetLang, pageContext);
  }

  if (isOffscreenCloudProviderRuntimeId(provider)) {
    return translateWithOffscreenCloudProvider(provider, text, sourceLang, targetLang);
  }

  // OPUS-MT: check for direct model or pivot route
  const route = resolveOpusMtTranslationRoute(sourceLang, targetLang);

  if (route?.kind === 'direct') {
    return translateDirect(text, sourceLang, targetLang, sessionId);
  }

  if (route?.kind === 'pivot') {
    const [firstHop, secondHop] = route.route;
    const [firstSrc, firstTgt] = firstHop.split('-');
    const [secondSrc, secondTgt] = secondHop.split('-');

    log.info(`Pivot translation: ${sourceLang} -> ${firstTgt} -> ${targetLang}`);
    const intermediateResult = await translateDirect(text, firstSrc, firstTgt, sessionId);
    return translateDirect(intermediateResult, secondSrc, secondTgt, sessionId);
  }

  throw new Error(`Unsupported language pair: ${sourceLang}-${targetLang}`);
}

/**
 * Determine fallback providers when the primary provider fails.
 * Returns available fallback providers in priority order.
 */
async function getFallbackProviders(
  primary: TranslationProviderId
): Promise<TranslationProviderId[]> {
  const fallbacks: TranslationProviderId[] = [];

  // Local models as fallbacks (free, no API key needed)
  if (primary !== 'opus-mt') fallbacks.push('opus-mt');

  // NOTE: chrome-builtin is NOT included as a fallback. It throws DOMException
  // in the offscreen document context (no user gesture for language pack download,
  // wrong execution context). Only use when explicitly selected by the user.

  // NOTE: Cloud providers (DeepL, OpenAI, Anthropic, Google Cloud) are NOT included
  // as automatic fallbacks. They require API keys and their initialize() calls
  // fail with chrome.storage.local errors in certain offscreen document lifecycle
  // states. Only use when explicitly configured by the user.

  return fallbacks;
}

/**
 * Internal translation function that routes to the appropriate provider.
 * On failure, attempts fallback providers before giving up.
 */
async function translateWithProvider(
  text: string | string[],
  sourceLang: string,
  targetLang: string,
  provider: TranslationProviderId,
  _sessionId?: string,
  pageContext?: string
): Promise<string | string[]> {
  log.info(`${provider} translation: ${sourceLang} -> ${targetLang}`);

  try {
    return await executeProvider(text, sourceLang, targetLang, provider, _sessionId, pageContext);
  } catch (primaryError) {
    /* v8 ignore start -- instanceof ternary */
    const errorMsg = extractErrorMessage(primaryError);
    /* v8 ignore stop */

    // Don't fallback for configuration errors (user needs to fix settings)
    if (errorMsg.includes('not configured') || errorMsg.includes('API key')) {
      throw primaryError;
    }

    log.warn(`Primary provider ${provider} failed: ${errorMsg}. Trying fallbacks...`);

    const fallbacks = await getFallbackProviders(provider);
    if (fallbacks.length === 0) {
      throw primaryError; // No fallbacks available
    }

    for (const fallback of fallbacks) {
      try {
        log.info(`Fallback attempt: ${fallback}`);
        const result = await executeProvider(text, sourceLang, targetLang, fallback, _sessionId, pageContext);
        log.info(`Fallback ${fallback} succeeded`);
        return result;
      } catch (fallbackError) {
        /* v8 ignore start -- instanceof ternary */
        log.warn(`Fallback ${fallback} also failed: ${extractErrorMessage(fallbackError)}`);
        /* v8 ignore stop */
      }
    }

    // All fallbacks exhausted — throw original error with context
    throw new Error(`Translation failed (${provider} + ${fallbacks.length} fallbacks): ${errorMsg}`);
  }
}

/**
 * Get supported language pairs (direct + pivot).
 */
function getSupportedLanguages(): Array<{ src: string; tgt: string; pivot?: boolean }> {
  return getSupportedLanguagePairs();
}

function validateTranslateMessage(message: OffscreenMessageByType<'translate'>): string | undefined {
  if (message.text === undefined || message.text === null) {
    return 'Missing required field: text';
  }
  if (!message.sourceLang || !message.targetLang) {
    return 'Missing required field: sourceLang or targetLang';
  }
  if (!isValidLangCode(message.sourceLang)) {
    return 'Invalid sourceLang: must be non-empty string, max 20 characters';
  }
  if (!isValidLangCode(message.targetLang)) {
    return 'Invalid targetLang: must be non-empty string, max 20 characters';
  }

  return undefined;
}

async function handleOffscreenTranslate(
  message: OffscreenMessageByType<'translate'>
): Promise<OffscreenMessageResponseMap['translate']> {
  const validationError = validateTranslateMessage(message);
  if (validationError) {
    return { success: false, error: validationError };
  }

  const sessionId = message.sessionId;
  if (sessionId) {
    profiler.startTiming(sessionId, 'offscreen_processing');
  }

  const pageContext = typeof message.pageContext === 'string' ? message.pageContext : undefined;

  const result = await translate(
    message.text,
    message.sourceLang,
    message.targetLang,
    message.provider ?? 'opus-mt',
    sessionId,
    pageContext
  );

  let profilingData = undefined;
  if (sessionId) {
    profiler.endTiming(sessionId, 'offscreen_processing');
    profilingData = profiler.getSessionData(sessionId);
  }

  return { success: true, result, profilingData };
}

async function handleOffscreenPreloadModel(
  message: OffscreenMessageByType<'preloadModel'>
): Promise<OffscreenMessageResponseMap['preloadModel']> {
  const isLowPriority = message.priority === 'low';
  if (isLowPriority) {
    log.debug(`Low-priority preload: ${message.sourceLang}->${message.targetLang}`);
  }

  if (message.provider === 'translategemma') {
    const [gpu, webnn] = await Promise.all([detectWebGPU(), detectWebNN()]);
    if (!gpu.supported && !webnn) {
      return {
        success: false,
        error: 'TranslateGemma requires WebNN or WebGPU. Neither is available.',
      };
    }
    await getTranslateGemmaPipeline();
    return { success: true, preloaded: true };
  }

  if (message.provider === 'chrome-builtin') {
    const available = await isChromeTranslatorAvailable();
    return { success: true, preloaded: available, available };
  }

  const route = resolveOpusMtTranslationRoute(message.sourceLang, message.targetLang);
  if (route?.kind === 'direct') {
    await getPipeline(message.sourceLang, message.targetLang);
    return { success: true, preloaded: true };
  }
  if (route?.kind === 'pivot') {
    const [firstHop] = route.route;
    const [firstSrc, firstTgt] = firstHop.split('-');
    await getPipeline(firstSrc, firstTgt);
    return { success: true, preloaded: true, partial: true };
  }

  return { success: true, preloaded: false };
}

async function handleOffscreenCropImage(
  message: OffscreenMessageByType<'cropImage'>
): Promise<OffscreenMessageResponseMap['cropImage']> {
  const { imageData: cropSrc, rect, devicePixelRatio = 1 } = message;
  const img = new Image();
  img.src = cropSrc;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image for cropping'));
  });

  const canvas = document.createElement('canvas');
  const dpr = devicePixelRatio;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(
    img,
    rect.x * dpr,
    rect.y * dpr,
    rect.width * dpr,
    rect.height * dpr,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return { success: true, imageData: canvas.toDataURL('image/png') };
}

const offscreenMessageHandlers: OffscreenMessageHandlers = {
  translate: handleOffscreenTranslate,
  getProfilingStats: async () => ({
    success: true,
    aggregates: profiler.getAllAggregates(),
    formatted: profiler.formatAggregates(),
  }),
  preloadModel: handleOffscreenPreloadModel,
  getSupportedLanguages: async () => ({
    success: true,
    languages: getSupportedLanguages(),
  }),
  ping: async () => ({ success: true, status: 'ready' }),
  checkWebGPU: async () => {
    const gpu = await detectWebGPU();
    return { success: true, ...gpu };
  },
  checkWebNN: async () => ({
    success: true,
    supported: await detectWebNN(),
  }),
  getCacheStats: async () => ({
    success: true,
    stats: await getTranslationCache().getStats(),
  }),
  clearCache: async () => {
    await getTranslationCache().clear();
    return { success: true, cleared: true };
  },
  clearPipelineCache: async () => {
    await clearPipelineCache();
    return { success: true, cleared: true };
  },
  getCloudProviderUsage: async (message) => ({
    success: true,
    usage: await getOffscreenCloudProviderUsage(message.provider),
  }),
  ocrImage: async (message) => {
    log.info('Processing OCR request...');
    const ocrResult: OCRResult = await extractTextFromImage(message.imageData, message.lang);
    return {
      success: true,
      text: ocrResult.text,
      confidence: ocrResult.confidence,
      blocks: ocrResult.blocks,
    };
  },
  terminateOCR: async () => {
    await terminateOCR();
    return { success: true };
  },
  cropImage: handleOffscreenCropImage,
};

// Message handler
chrome.runtime.onMessage.addListener((message, _sender, sendResponse: (response: OffscreenRoutedResponse) => void) => {
  if (!isOffscreenTargetedMessage(message)) return false;

  (async () => {
    try {
      sendResponse(await routeOffscreenMessage(message, offscreenMessageHandlers));
    } catch (error) {
      log.error(' Error:', error);
      sendResponse({
        success: false,
        /* v8 ignore start -- instanceof ternary */
        error: extractErrorMessage(error)
        /* v8 ignore stop */
      });
    }
  })().catch((error) => {
    log.error('Unhandled offscreen listener error:', error);
    try {
      sendResponse({
        success: false,
        error: extractErrorMessage(error),
      });
    } catch (responseError) {
      log.error('Failed to send offscreen fallback error response:', responseError);
    }
  });

  return true; // Keep channel open for async response
});

log.info(' Document ready - v2.4 with predictive preloading support');
