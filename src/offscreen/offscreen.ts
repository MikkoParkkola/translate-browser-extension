/**
 * Offscreen document for Transformers.js ML inference.
 * Service workers can't use window/document, so we run ML here.
 */

import { pipeline, env } from '@huggingface/transformers';
import type { TranslationProviderId } from '../types';
import { getTranslationCache, type TranslationCacheStats } from '../core/translation-cache';
import { CONFIG } from '../config';
import { createLogger } from '../core/logger';
import { profiler } from '../core/profiler';

// Extracted modules
import { MODEL_MAP, PIVOT_ROUTES } from './model-maps';
import { getCachedPipeline, cachePipeline, clearCache as clearPipelineCache } from './pipeline-cache';
import { detectLanguage } from './language-detection';
import { translateWithGemma, getTranslateGemmaPipeline } from './translategemma';
import { getChromeTranslator, isChromeTranslatorAvailable } from '../providers/chrome-translator';

// Cloud providers
import { deeplProvider } from '../providers/deepl';
import { openaiProvider } from '../providers/openai';
import { anthropicProvider } from '../providers/anthropic';
import { googleCloudProvider } from '../providers/google-cloud';

// OCR service
import { extractTextFromImage, terminateOCR, type OCRResult } from '../core/ocr-service';

// Network status
import { isOnline, isCloudProvider, initNetworkMonitoring } from '../core/network-status';

const log = createLogger('Offscreen');

// Initialize network monitoring in offscreen context
initNetworkMonitoring();

// Configure Transformers.js for Chrome extension environment
env.allowRemoteModels = true;  // Models from HuggingFace Hub
env.allowLocalModels = false;  // No local filesystem
env.useBrowserCache = true;    // Cache models in IndexedDB

// CRITICAL: Point ONNX Runtime to bundled WASM files (not CDN)
// This avoids CSP violations from dynamic CDN imports
const wasmBasePath = chrome.runtime.getURL('assets/');
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = wasmBasePath;
}

log.info(' WASM path configured:', wasmBasePath);

/**
 * Wrap a promise with a timeout.
 * Properly clears the timer when the promise resolves/rejects to prevent timer leaks.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout: ${message} (${ms / 1000}s)`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Check WebGPU support and shader-f16 capability.
 */
async function detectWebGPU(): Promise<{ supported: boolean; fp16: boolean }> {
  if (!navigator.gpu) return { supported: false, fp16: false };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { supported: false, fp16: false };
    const fp16 = adapter.features.has('shader-f16');
    return { supported: true, fp16 };
  } catch {
    return { supported: false, fp16: false };
  }
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

/**
 * Get or create pipeline for a language pair with LRU caching.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPipeline(sourceLang: string, targetLang: string, sessionId?: string): Promise<any> {
  const key = `${sourceLang}-${targetLang}`;
  const modelId = MODEL_MAP[key];

  if (!modelId) {
    throw new Error(`Unsupported language pair: ${key}`);
  }

  // Check LRU cache first
  const cached = getCachedPipeline(modelId);
  if (cached) {
    log.info(` Pipeline cache HIT: ${modelId}`);
    if (sessionId) {
      profiler.recordTiming(sessionId, 'model_load', 0, { cached: true, modelId });
    }
    return cached;
  }

  log.info(` Loading model: ${modelId}`);
  const loadStart = performance.now();

  const webgpu = await detectWebGPU();
  const device = webgpu.supported ? 'webgpu' : 'wasm';
  // Auto-detect optimal dtype: fp16 (WebGPU+shader-f16), q8 (WebGPU or WASM)
  // Xenova ONNX models ship with _quantized (q8) and _fp16 variants (~85MB vs ~170MB fp32).
  const dtype = selectOpusMtDtype(webgpu);
  log.info(` Using device: ${device}, dtype: ${dtype}`);

  // Use optimized timeout for OPUS-MT direct models (~85MB quantized, typically loads in <30s)
  // If WebGPU fails (GPU incompatibility), fall back to WASM+q8 automatically.
  let pipe;
  try {
    pipe = await withTimeout(
      pipeline('translation', modelId, { device, dtype } as Record<string, unknown>),
      CONFIG.timeouts.opusMtDirectMs,
      `Loading model ${modelId}`
    );
  } catch (err) {
    if (device === 'webgpu') {
      log.warn(` WebGPU failed, falling back to WASM+q8: ${err instanceof Error ? err.message : err}`);
      pipe = await withTimeout(
        pipeline('translation', modelId, { device: 'wasm', dtype: 'q8' } as Record<string, unknown>),
        CONFIG.timeouts.opusMtDirectMs,
        `Loading model ${modelId} (WASM fallback)`
      );
    } else {
      throw err;
    }
  }

  const loadDuration = performance.now() - loadStart;
  if (sessionId) {
    profiler.recordTiming(sessionId, 'model_load', loadDuration, { cached: false, modelId, device });
  }
  log.info(` Model loaded: ${modelId} in ${loadDuration.toFixed(0)}ms`);

  // Store in LRU cache (may evict old models)
  cachePipeline(modelId, pipe);

  return pipe;
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
    if (text.length === 0) return [];

    const results = await Promise.all(
      text.map(async (t, i) => {
        if (!t || t.trim().length === 0) return t;
        try {
          const result = await pipe(t, { max_length: 512 });
          const translated = (result as Array<{ translation_text: string }>)[0].translation_text;
          // Debug: log first 3 to verify model output
          if (i < 3) {
            console.log(`[Offscreen] Model #${i}: "${t.substring(0, 40)}" -> "${translated.substring(0, 40)}" (same=${t === translated})`);
          }
          return translated;
        } catch (err) {
          // Per-item error: return original text instead of crashing entire batch
          log.warn(` Translation failed for item (${t.substring(0, 30)}...):`, err);
          return t;
        }
      })
    );

    const inferenceDuration = performance.now() - inferenceStart;
    if (sessionId) {
      profiler.recordTiming(sessionId, 'model_inference', inferenceDuration, {
        batchSize: text.length,
        totalChars: text.reduce((sum, t) => sum + (t?.length || 0), 0),
      });
    }
    return results;
  }

  if (!text || text.trim().length === 0) return text;
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
  provider: TranslationProviderId = 'opus-mt',
  sessionId?: string,
  pageContext?: string
): Promise<string | string[]> {
  // Handle auto-detection
  let actualSourceLang = sourceLang;
  if (sourceLang === 'auto') {
    const detectStart = performance.now();
    const sampleText = Array.isArray(text) ? text.slice(0, 3).join(' ') : text;
    actualSourceLang = detectLanguage(sampleText);
    if (sessionId) {
      profiler.recordTiming(sessionId, 'language_detect', performance.now() - detectStart);
    }
    console.log(`[Offscreen] Auto-detected source: ${actualSourceLang}`);

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
        if (i < 3) {
          console.log(`[Offscreen] Cache #${i}: "${t.substring(0, 30)}" -> "${cached.substring(0, 30)}"${cached === t ? ' (identity)' : ''}`);
        }
        results[i] = cached;
      } else {
        uncachedItems.push({ index: i, text: t });
      }
    }

    // Translate uncached items
    if (uncachedItems.length > 0) {
      console.log(`[Offscreen] Translating ${uncachedItems.length} uncached items`);
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
      const translationArray = Array.isArray(translations) ? translations : [translations];
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
        } catch (err) {
          cacheFails++;
          if (cacheFails <= 2) {
            log.warn(`Failed to cache translation (${cacheFails}):`, err);
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
  const resultText = Array.isArray(result) ? result[0] : result;
  try {
    await cache.set(text, actualSourceLang, targetLang, provider, resultText);
  } catch (err) {
    log.warn('Failed to cache translation:', err);
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
  if (provider === 'translategemma') {
    return translateWithGemma(text, sourceLang, targetLang, pageContext);
  }

  // DeepL Cloud Provider
  if (provider === 'deepl') {
    await deeplProvider.initialize();
    if (!(await deeplProvider.isAvailable())) {
      throw new Error('DeepL API key not configured. Please configure in Settings.');
    }
    return deeplProvider.translate(text, sourceLang, targetLang);
  }

  // OpenAI Cloud Provider
  if (provider === 'openai') {
    await openaiProvider.initialize();
    if (!(await openaiProvider.isAvailable())) {
      throw new Error('OpenAI API key not configured. Please configure in Settings.');
    }
    return openaiProvider.translate(text, sourceLang, targetLang);
  }

  // Anthropic Cloud Provider
  if (provider === 'anthropic') {
    await anthropicProvider.initialize();
    if (!(await anthropicProvider.isAvailable())) {
      throw new Error('Anthropic API key not configured. Please configure in Settings.');
    }
    return anthropicProvider.translate(text, sourceLang, targetLang);
  }

  // Google Cloud Provider
  if (provider === 'google-cloud') {
    await googleCloudProvider.initialize();
    if (!(await googleCloudProvider.isAvailable())) {
      throw new Error('Google Cloud API key not configured. Please configure in Settings.');
    }
    return googleCloudProvider.translate(text, sourceLang, targetLang);
  }

  // OPUS-MT: check for direct model or pivot route
  const key = `${sourceLang}-${targetLang}`;

  if (MODEL_MAP[key]) {
    return translateDirect(text, sourceLang, targetLang, sessionId);
  }

  const pivotRoute = PIVOT_ROUTES[key];
  if (pivotRoute) {
    const [firstHop, secondHop] = pivotRoute;
    const [firstSrc, firstTgt] = firstHop.split('-');
    const [secondSrc, secondTgt] = secondHop.split('-');

    log.info(`Pivot translation: ${sourceLang} -> ${firstTgt} -> ${targetLang}`);
    const intermediateResult = await translateDirect(text, firstSrc, firstTgt, sessionId);
    return translateDirect(intermediateResult, secondSrc, secondTgt, sessionId);
  }

  throw new Error(`Unsupported language pair: ${key}`);
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
  if (primary !== 'chrome-builtin') {
    try {
      if (await isChromeTranslatorAvailable()) fallbacks.push('chrome-builtin');
    } catch { /* not available */ }
  }

  // Cloud providers as fallbacks (skip entirely when offline)
  if (isOnline()) {
    const cloudProviders: Array<{ id: TranslationProviderId; provider: typeof deeplProvider }> = [
      { id: 'deepl', provider: deeplProvider },
      { id: 'openai', provider: openaiProvider },
      { id: 'anthropic', provider: anthropicProvider },
      { id: 'google-cloud', provider: googleCloudProvider },
    ];

    for (const { id, provider } of cloudProviders) {
      if (id !== primary) {
        try {
          await provider.initialize();
          if (await provider.isAvailable()) fallbacks.push(id);
        } catch { /* not available */ }
      }
    }
  } else {
    log.info('Offline: skipping cloud provider fallbacks');
  }

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
    const errorMsg = primaryError instanceof Error ? primaryError.message : String(primaryError);

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
        log.warn(`Fallback ${fallback} also failed: ${fallbackError instanceof Error ? fallbackError.message : fallbackError}`);
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

// Message handler
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  (async () => {
    try {
      switch (message.type) {
        case 'translate': {
          // Validate required fields to prevent cryptic downstream errors
          if (message.text === undefined || message.text === null) {
            sendResponse({ success: false, error: 'Missing required field: text' });
            return;
          }
          if (!message.sourceLang || !message.targetLang) {
            sendResponse({ success: false, error: 'Missing required field: sourceLang or targetLang' });
            return;
          }

          // Support profiling sessions passed from background
          const sessionId = message.sessionId;
          if (sessionId) {
            profiler.startTiming(sessionId, 'offscreen_processing');
          }

          // Extract page context from translation options if provided
          const pageContext = message.pageContext as string | undefined;

          const result = await translate(
            message.text,
            message.sourceLang,
            message.targetLang,
            message.provider || 'opus-mt',
            sessionId,
            pageContext
          );

          // Collect profiling data to send back
          let profilingData = undefined;
          if (sessionId) {
            profiler.endTiming(sessionId, 'offscreen_processing');
            profilingData = profiler.getSessionData(sessionId);
          }

          sendResponse({ success: true, result, profilingData });
          break;
        }
        case 'getProfilingStats': {
          // Return aggregate profiling statistics
          sendResponse({
            success: true,
            aggregates: profiler.getAllAggregates(),
            formatted: profiler.formatAggregates(),
          });
          break;
        }
        case 'preloadModel': {
          // Preload the requested provider's model
          // Priority: 'low' for background/predictive preloads, 'high' for user-initiated
          const isLowPriority = message.priority === 'low';

          if (isLowPriority) {
            log.debug(`Low-priority preload: ${message.sourceLang}->${message.targetLang}`);
          }

          if (message.provider === 'translategemma') {
            await getTranslateGemmaPipeline();
            sendResponse({ success: true, preloaded: true });
          } else if (message.provider === 'chrome-builtin') {
            // Chrome Built-in doesn't need preloading, just check availability
            const available = await isChromeTranslatorAvailable();
            sendResponse({ success: true, preloaded: available, available });
          } else {
            // OPUS-MT: preload the pipeline for the language pair
            const pair = `${message.sourceLang}-${message.targetLang}`;
            if (MODEL_MAP[pair]) {
              await getPipeline(message.sourceLang, message.targetLang);
              sendResponse({ success: true, preloaded: true });
            } else if (PIVOT_ROUTES[pair]) {
              // For pivot routes, preload the first hop model (source -> English)
              const [firstHop] = PIVOT_ROUTES[pair];
              const [firstSrc, firstTgt] = firstHop.split('-');
              await getPipeline(firstSrc, firstTgt);
              sendResponse({ success: true, preloaded: true, partial: true });
            } else {
              sendResponse({ success: true, preloaded: false });
            }
          }
          break;
        }
        case 'getSupportedLanguages': {
          sendResponse({ success: true, languages: getSupportedLanguages() });
          break;
        }
        case 'ping': {
          sendResponse({ success: true, status: 'ready' });
          break;
        }
        case 'getCacheStats': {
          const cache = getTranslationCache();
          const stats: TranslationCacheStats = await cache.getStats();
          sendResponse({ success: true, stats });
          break;
        }
        case 'clearCache': {
          const cache = getTranslationCache();
          await cache.clear();
          sendResponse({ success: true, cleared: true });
          break;
        }
        case 'clearPipelineCache': {
          // Clear all loaded ML pipelines (frees GPU/WASM memory)
          await clearPipelineCache();
          sendResponse({ success: true, cleared: true });
          break;
        }
        // checkChromeTranslator: handled directly in service-worker via
        // chrome.scripting.executeScript (MAIN world) — offscreen cannot
        // see the Translator API.
        case 'getCloudProviderUsage': {
          // Get usage stats for a specific cloud provider
          const providerId = message.provider as string;
          let usage = { tokens: 0, cost: 0, limitReached: false };

          if (providerId === 'deepl') {
            await deeplProvider.initialize();
            usage = await deeplProvider.getUsage();
          } else if (providerId === 'openai') {
            await openaiProvider.initialize();
            usage = await openaiProvider.getUsage();
          } else if (providerId === 'anthropic') {
            await anthropicProvider.initialize();
            usage = await anthropicProvider.getUsage();
          } else if (providerId === 'google-cloud') {
            await googleCloudProvider.initialize();
            usage = await googleCloudProvider.getUsage();
          }

          sendResponse({ success: true, usage });
          break;
        }
        case 'ocrImage': {
          // Extract text from image using Tesseract.js
          log.info('Processing OCR request...');
          const ocrResult: OCRResult = await extractTextFromImage(
            message.imageData,
            message.lang
          );
          sendResponse({
            success: true,
            text: ocrResult.text,
            confidence: ocrResult.confidence,
            blocks: ocrResult.blocks,
          });
          break;
        }
        case 'terminateOCR': {
          // Clean up OCR worker
          await terminateOCR();
          sendResponse({ success: true });
          break;
        }
        case 'cropImage': {
          // Crop a screenshot image to a specified rectangle
          const { imageData: cropSrc, rect, devicePixelRatio = 1 } = message;
          const img = new Image();
          img.src = cropSrc;
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Failed to load image for cropping'));
          });

          const canvas = document.createElement('canvas');
          const dpr = devicePixelRatio as number;
          canvas.width = rect.width * dpr;
          canvas.height = rect.height * dpr;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(
            img,
            rect.x * dpr, rect.y * dpr,
            rect.width * dpr, rect.height * dpr,
            0, 0,
            canvas.width, canvas.height
          );

          sendResponse({ success: true, imageData: canvas.toDataURL('image/png') });
          break;
        }
        default:
          sendResponse({ success: false, error: `Unknown type: ${message.type}` });
      }
    } catch (error) {
      log.error(' Error:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  return true; // Keep channel open for async response
});

log.info(' Document ready - v2.4 with predictive preloading support');
