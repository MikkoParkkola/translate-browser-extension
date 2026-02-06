/**
 * Offscreen document for Transformers.js ML inference.
 * Service workers can't use window/document, so we run ML here.
 */

import { pipeline, env, type Pipeline, type TextGenerationPipeline } from '@huggingface/transformers';
import { franc } from 'franc-min';
import type { TranslationProviderId } from '../types';

// Configure Transformers.js for Chrome extension environment
env.allowRemoteModels = true;  // Models from HuggingFace Hub
env.allowLocalModels = false;  // No local filesystem
env.useBrowserCache = true;    // Cache models in IndexedDB

// CRITICAL: Point ONNX Runtime to bundled WASM files (not CDN)
// This avoids CSP violations from dynamic CDN imports
const wasmBasePath = chrome.runtime.getURL('assets/');
env.backends.onnx.wasm.wasmPaths = wasmBasePath;

console.log('[Offscreen] WASM path configured:', wasmBasePath);

// Model mapping (direct language pairs with available models)
const MODEL_MAP: Record<string, string> = {
  'en-fi': 'Xenova/opus-mt-en-fi',
  'fi-en': 'Xenova/opus-mt-fi-en',
  'en-de': 'Xenova/opus-mt-en-de',
  'de-en': 'Xenova/opus-mt-de-en',
  'en-fr': 'Xenova/opus-mt-en-fr',
  'fr-en': 'Xenova/opus-mt-fr-en',
  'en-es': 'Xenova/opus-mt-en-es',
  'es-en': 'Xenova/opus-mt-es-en',
  'en-sv': 'Xenova/opus-mt-en-sv',
  'sv-en': 'Xenova/opus-mt-sv-en',
  'en-ru': 'Xenova/opus-mt-en-ru',
  'ru-en': 'Xenova/opus-mt-ru-en',
  'en-zh': 'Xenova/opus-mt-en-zh',
  'zh-en': 'Xenova/opus-mt-zh-en',
  'en-ja': 'Xenova/opus-mt-en-jap',
  'ja-en': 'Xenova/opus-mt-jap-en',
  // Dutch
  'en-nl': 'Xenova/opus-mt-en-nl',
  'nl-en': 'Xenova/opus-mt-nl-en',
  // Czech
  'en-cs': 'Xenova/opus-mt-en-cs',
  'cs-en': 'Xenova/opus-mt-cs-en',
};

// Pivot routes for language pairs without direct models (translate via English)
// Format: 'source-target': ['source-en', 'en-target']
const PIVOT_ROUTES: Record<string, [string, string]> = {
  'nl-fi': ['nl-en', 'en-fi'],  // Dutch -> English -> Finnish
  'fi-nl': ['fi-en', 'en-nl'],  // Finnish -> English -> Dutch
  'cs-fi': ['cs-en', 'en-fi'],  // Czech -> English -> Finnish
  'fi-cs': ['fi-en', 'en-cs'],  // Finnish -> English -> Czech
};

// Pipeline cache (OPUS-MT)
const pipelines = new Map<string, Pipeline>();

// ============================================================================
// TranslateGemma Configuration
// ============================================================================

const TRANSLATEGEMMA_MODEL = 'm1cc0z/translategemma-4b-webgpu-q4';

// Language names for TranslateGemma prompt (ISO 639-1 -> English name)
const LANG_NAMES: Record<string, string> = {
  en: 'English', fi: 'Finnish', de: 'German', fr: 'French', es: 'Spanish',
  sv: 'Swedish', ru: 'Russian', zh: 'Chinese', ja: 'Japanese', nl: 'Dutch',
  cs: 'Czech', da: 'Danish', no: 'Norwegian', pl: 'Polish', pt: 'Portuguese',
  it: 'Italian', ko: 'Korean', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish',
  uk: 'Ukrainian', vi: 'Vietnamese', th: 'Thai', el: 'Greek', hu: 'Hungarian',
  ro: 'Romanian', bg: 'Bulgarian', hr: 'Croatian', sk: 'Slovak', sl: 'Slovenian',
  et: 'Estonian', lv: 'Latvian', lt: 'Lithuanian', id: 'Indonesian', ms: 'Malay',
  he: 'Hebrew', fa: 'Persian', ur: 'Urdu', bn: 'Bengali', ta: 'Tamil',
  te: 'Telugu', ml: 'Malayalam', ka: 'Georgian', hy: 'Armenian', sq: 'Albanian',
  mk: 'Macedonian', sr: 'Serbian', bs: 'Bosnian', is: 'Icelandic', mt: 'Maltese',
  ga: 'Irish', cy: 'Welsh', eu: 'Basque', ca: 'Catalan', gl: 'Galician',
  af: 'Afrikaans', sw: 'Swahili',
};

// TranslateGemma pipeline (text-generation, singleton)
let tgPipeline: TextGenerationPipeline | null = null;
let tgLoading: Promise<TextGenerationPipeline> | null = null;

/**
 * Format the TranslateGemma prompt from the official chat template.
 */
function formatTranslateGemmaPrompt(
  text: string,
  sourceLang: string,
  targetLang: string
): string {
  const srcName = LANG_NAMES[sourceLang] || sourceLang;
  const tgtName = LANG_NAMES[targetLang] || targetLang;

  return (
    `<start_of_turn>user\n` +
    `You are a professional ${srcName} (${sourceLang}) to ${tgtName} (${targetLang}) translator. ` +
    `Your goal is to accurately convey the meaning and nuances of the original ${srcName} text ` +
    `while adhering to ${tgtName} grammar, vocabulary, and cultural sensitivities.\n` +
    `Produce only the ${tgtName} translation, without any additional explanations or commentary. ` +
    `Please translate the following ${srcName} text into ${tgtName}:\n\n\n` +
    `${text}<end_of_turn>\n` +
    `<start_of_turn>model\n`
  );
}

/**
 * Load TranslateGemma model (singleton, cached in IndexedDB).
 */
async function getTranslateGemmaPipeline(): Promise<TextGenerationPipeline> {
  if (tgPipeline) return tgPipeline;
  if (tgLoading) return tgLoading;

  tgLoading = (async () => {
    console.log('[Offscreen] Loading TranslateGemma model...');

    const webgpu = await detectWebGPU();
    if (!webgpu) {
      throw new Error(
        'TranslateGemma requires WebGPU. Please use Chrome 113+ with WebGPU enabled.'
      );
    }

    try {
      const pipe = await pipeline('text-generation', TRANSLATEGEMMA_MODEL, {
        device: 'webgpu',
        progress_callback: (progress: Record<string, unknown>) => {
          // Forward progress to popup via service worker
          try {
            chrome.runtime.sendMessage({
              type: 'modelProgress',
              modelId: TRANSLATEGEMMA_MODEL,
              status: progress.status || 'progress',
              progress: progress.progress ?? 0,
              file: progress.file || null,
              loaded: progress.loaded || null,
              total: progress.total || null,
            });
          } catch {
            // Popup may be closed
          }
        },
      });

      tgPipeline = pipe as TextGenerationPipeline;
      tgLoading = null;

      // Notify ready
      try {
        chrome.runtime.sendMessage({
          type: 'modelProgress',
          modelId: TRANSLATEGEMMA_MODEL,
          status: 'ready',
          progress: 100,
        });
      } catch {
        // Popup may be closed
      }

      console.log('[Offscreen] TranslateGemma loaded successfully');
      return tgPipeline;
    } catch (error) {
      tgLoading = null;
      console.error('[Offscreen] TranslateGemma failed to load:', error);

      // Notify error
      try {
        chrome.runtime.sendMessage({
          type: 'modelProgress',
          modelId: TRANSLATEGEMMA_MODEL,
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Popup may be closed
      }

      throw error;
    }
  })();

  return tgLoading;
}

/**
 * Translate using TranslateGemma (text-generation pipeline).
 */
async function translateWithGemma(
  text: string | string[],
  sourceLang: string,
  targetLang: string
): Promise<string | string[]> {
  const pipe = await getTranslateGemmaPipeline();

  const translateSingle = async (t: string): Promise<string> => {
    if (!t || t.trim().length === 0) return t;

    const prompt = formatTranslateGemmaPrompt(t, sourceLang, targetLang);
    const result = await pipe(prompt, {
      max_new_tokens: 1024,
      do_sample: false,
      return_full_text: false,
    });

    // Extract generated text
    const output = (result as Array<{ generated_text: string }>)[0];
    let translation = output.generated_text || '';

    // Clean up: remove any trailing special tokens
    translation = translation
      .replace(/<end_of_turn>/g, '')
      .replace(/<start_of_turn>/g, '')
      .replace(/model\n?$/g, '')
      .trim();

    return translation;
  };

  if (Array.isArray(text)) {
    // Sequential to avoid OOM on large batches
    const results: string[] = [];
    for (const t of text) {
      results.push(await translateSingle(t));
    }
    return results;
  }

  return translateSingle(text);
}

// Map franc ISO 639-3 codes to our ISO 639-1 codes
const FRANC_TO_ISO: Record<string, string> = {
  'eng': 'en',
  'fin': 'fi',
  'deu': 'de',
  'fra': 'fr',
  'spa': 'es',
  'swe': 'sv',
  'rus': 'ru',
  'cmn': 'zh',
  'jpn': 'ja',
  'nld': 'nl',  // Dutch
  'ces': 'cs',  // Czech
};

// Detect language from text
function detectLanguage(text: string): string {
  // franc returns 'und' (undetermined) if it can't detect
  const detected = franc(text, { minLength: 3 });
  console.log(`[Offscreen] franc raw detection: "${detected}" for text: "${text.slice(0, 50)}..."`);

  if (detected === 'und' || !detected) {
    // Try to guess from character sets
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja'; // Japanese
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh'; // Chinese
    if (/[\u0400-\u04ff]/.test(text)) return 'ru'; // Cyrillic -> Russian
    if (/[äöåÄÖÅ]/.test(text)) return 'fi'; // Finnish characters
    console.log('[Offscreen] Could not detect language, defaulting to English');
    return 'en';
  }

  const lang = FRANC_TO_ISO[detected];
  console.log(`[Offscreen] Detected language: ${detected} -> ${lang || 'en'}`);
  return lang || 'en'; // Default to English if unknown
}

// Check WebGPU support
async function detectWebGPU(): Promise<boolean> {
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}

// Get or create pipeline for a language pair
async function getPipeline(sourceLang: string, targetLang: string): Promise<Pipeline> {
  const key = `${sourceLang}-${targetLang}`;
  const modelId = MODEL_MAP[key];

  if (!modelId) {
    throw new Error(`Unsupported language pair: ${key}`);
  }

  if (pipelines.has(modelId)) {
    return pipelines.get(modelId)!;
  }

  console.log(`[Offscreen] Loading model: ${modelId}`);

  const webgpu = await detectWebGPU();
  const device = webgpu ? 'webgpu' : 'wasm';
  console.log(`[Offscreen] Using device: ${device}`);

  // Note: dtype removed because q4f16 quantization causes numeric errors with some models
  const pipe = await pipeline('translation', modelId, {
    device,
  });

  pipelines.set(modelId, pipe);
  console.log(`[Offscreen] Model loaded: ${modelId}`);

  return pipe;
}

// Translate text using a single direct model
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

// Translate text (handles auto-detection, pivot routing, and provider selection)
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
      console.log('[Offscreen] Source equals target, skipping translation');
      return text;
    }
  }

  // TranslateGemma: supports any-to-any translation with a single model
  if (provider === 'translategemma') {
    console.log(`[Offscreen] TranslateGemma translation: ${actualSourceLang} -> ${targetLang}`);
    return translateWithGemma(text, actualSourceLang, targetLang);
  }

  // OPUS-MT: check for direct model or pivot route
  const key = `${actualSourceLang}-${targetLang}`;

  // Check if we have a direct model
  if (MODEL_MAP[key]) {
    console.log(`[Offscreen] Direct translation: ${key}`);
    return translateDirect(text, actualSourceLang, targetLang);
  }

  // Check if we have a pivot route
  const pivotRoute = PIVOT_ROUTES[key];
  if (pivotRoute) {
    const [firstHop, secondHop] = pivotRoute;
    const [firstSrc, firstTgt] = firstHop.split('-');
    const [secondSrc, secondTgt] = secondHop.split('-');

    console.log(`[Offscreen] Pivot translation: ${actualSourceLang} -> ${firstTgt} -> ${targetLang}`);

    // First hop: source -> English
    const intermediateResult = await translateDirect(text, firstSrc, firstTgt);

    // Second hop: English -> target
    const finalResult = await translateDirect(intermediateResult, secondSrc, secondTgt);

    return finalResult;
  }

  // No route available
  throw new Error(`Unsupported language pair: ${key}`);
}

// Get supported language pairs (direct + pivot)
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
        default:
          sendResponse({ success: false, error: `Unknown type: ${message.type}` });
      }
    } catch (error) {
      console.error('[Offscreen] Error:', error);
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })();

  return true; // Keep channel open for async response
});

console.log('[Offscreen] Document ready - v2.2 with TranslateGemma + language detection');
