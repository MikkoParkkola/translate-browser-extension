/**
 * Offscreen document for Transformers.js ML inference.
 * Service workers can't use window/document, so we run ML here.
 */

import { pipeline, env } from '@huggingface/transformers';
import type { TranslationProviderId } from '../types';
import { getTranslationCache, type TranslationCacheStats } from '../core/translation-cache';
import { CONFIG } from '../config';
import { createLogger } from '../core/logger';

// Extracted modules
import { MODEL_MAP, PIVOT_ROUTES } from './model-maps';
import { getCachedPipeline, cachePipeline } from './pipeline-cache';
import { detectLanguage } from './language-detection';
import { translateWithGemma, getTranslateGemmaPipeline } from './translategemma';

const log = createLogger('Offscreen');

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
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout: ${message} (${ms / 1000}s)`)), ms)
    ),
  ]);
}

/**
 * Check WebGPU support.
 */
async function detectWebGPU(): Promise<boolean> {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

/**
 * Get or create pipeline for a language pair with LRU caching.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPipeline(sourceLang: string, targetLang: string): Promise<any> {
  const key = `${sourceLang}-${targetLang}`;
  const modelId = MODEL_MAP[key];

  if (!modelId) {
    throw new Error(`Unsupported language pair: ${key}`);
  }

  // Check LRU cache first
  const cached = getCachedPipeline(modelId);
  if (cached) {
    log.info(` Pipeline cache HIT: ${modelId}`);
    return cached;
  }

  log.info(` Loading model: ${modelId}`);

  const webgpu = await detectWebGPU();
  const device = webgpu ? 'webgpu' : 'wasm';
  log.info(` Using device: ${device}`);

  // Note: dtype removed because q4f16 quantization causes numeric errors with some models
  // Use optimized timeout for OPUS-MT direct models (~170MB, typically loads in <60s)
  const pipe = await withTimeout(
    pipeline('translation', modelId, { device }),
    CONFIG.timeouts.opusMtDirectMs,
    `Loading model ${modelId}`
  );

  // Store in LRU cache (may evict old models)
  cachePipeline(modelId, pipe);
  log.info(` Model loaded: ${modelId}`);

  return pipe;
}

/**
 * Translate text using a single direct model.
 */
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

/**
 * Translate text (handles auto-detection, pivot routing, and provider selection).
 */
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
        console.log(`[Offscreen] Cache hit for text ${i + 1}/${text.length}`);
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
        provider
      );

      // Store results and cache them
      const translationArray = Array.isArray(translations) ? translations : [translations];
      for (let i = 0; i < uncachedItems.length; i++) {
        const { index, text: originalText } = uncachedItems[i];
        const translation = translationArray[i];
        results[index] = translation;

        // Cache the translation (fire and forget)
        cache.set(originalText, actualSourceLang, targetLang, provider, translation).catch((err) => {
          log.warn(' Failed to cache translation:', err);
        });
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
  const result = await translateWithProvider(text, actualSourceLang, targetLang, provider);

  // Cache the translation (fire and forget)
  const resultText = Array.isArray(result) ? result[0] : result;
  cache.set(text, actualSourceLang, targetLang, provider, resultText).catch((err) => {
    log.warn(' Failed to cache translation:', err);
  });

  return result;
}

/**
 * Internal translation function that routes to the appropriate provider.
 */
async function translateWithProvider(
  text: string | string[],
  sourceLang: string,
  targetLang: string,
  provider: TranslationProviderId
): Promise<string | string[]> {
  // TranslateGemma: supports any-to-any translation with a single model
  if (provider === 'translategemma') {
    console.log(`[Offscreen] TranslateGemma translation: ${sourceLang} -> ${targetLang}`);
    return translateWithGemma(text, sourceLang, targetLang);
  }

  // OPUS-MT: check for direct model or pivot route
  const key = `${sourceLang}-${targetLang}`;

  // Check if we have a direct model
  if (MODEL_MAP[key]) {
    console.log(`[Offscreen] Direct translation: ${key}`);
    return translateDirect(text, sourceLang, targetLang);
  }

  // Check if we have a pivot route
  const pivotRoute = PIVOT_ROUTES[key];
  if (pivotRoute) {
    const [firstHop, secondHop] = pivotRoute;
    const [firstSrc, firstTgt] = firstHop.split('-');
    const [secondSrc, secondTgt] = secondHop.split('-');

    console.log(`[Offscreen] Pivot translation: ${sourceLang} -> ${firstTgt} -> ${targetLang}`);

    // First hop: source -> English
    const intermediateResult = await translateDirect(text, firstSrc, firstTgt);

    // Second hop: English -> target
    const finalResult = await translateDirect(intermediateResult, secondSrc, secondTgt);

    return finalResult;
  }

  // No route available
  throw new Error(`Unsupported language pair: ${key}`);
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
          const result = await translate(
            message.text,
            message.sourceLang,
            message.targetLang,
            message.provider || 'opus-mt'
          );
          sendResponse({ success: true, result });
          break;
        }
        case 'preloadModel': {
          // Preload the requested provider's model
          if (message.provider === 'translategemma') {
            await getTranslateGemmaPipeline();
            sendResponse({ success: true, preloaded: true });
          } else {
            // OPUS-MT: preload the pipeline for the language pair
            const pair = `${message.sourceLang}-${message.targetLang}`;
            if (MODEL_MAP[pair]) {
              await getPipeline(message.sourceLang, message.targetLang);
              sendResponse({ success: true, preloaded: true });
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

log.info(' Document ready - v2.3 with modular architecture');
