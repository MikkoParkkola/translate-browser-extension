/**
 * Offscreen document for Transformers.js ML inference.
 * Service workers can't use window/document, so we run ML here.
 */

import { pipeline, env, type TextGenerationPipeline } from '@huggingface/transformers';
import { franc } from 'franc-min';
import type { TranslationProviderId } from '../types';
import { getTranslationCache, type TranslationCacheStats } from '../core/translation-cache';

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

// Model loading timeout (5 minutes for large models like TranslateGemma)
const MODEL_LOAD_TIMEOUT_MS = 5 * 60 * 1000;

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

console.log('[Offscreen] WASM path configured:', wasmBasePath);

// Model mapping (direct language pairs with available Xenova OPUS-MT models)
// Source: https://huggingface.co/models?search=xenova/opus-mt (76 models)
const MODEL_MAP: Record<string, string> = {
  // === English <-> Major European Languages ===
  'en-de': 'Xenova/opus-mt-en-de',
  'de-en': 'Xenova/opus-mt-de-en',
  'en-fr': 'Xenova/opus-mt-en-fr',
  'fr-en': 'Xenova/opus-mt-fr-en',
  'en-es': 'Xenova/opus-mt-en-es',
  'es-en': 'Xenova/opus-mt-es-en',
  'en-it': 'Xenova/opus-mt-en-it',
  'it-en': 'Xenova/opus-mt-it-en',
  'en-nl': 'Xenova/opus-mt-en-nl',
  'nl-en': 'Xenova/opus-mt-nl-en',

  // === English <-> Nordic Languages ===
  'en-fi': 'Xenova/opus-mt-en-fi',
  'fi-en': 'Xenova/opus-mt-fi-en',
  'en-sv': 'Xenova/opus-mt-en-sv',
  'sv-en': 'Xenova/opus-mt-sv-en',
  'en-da': 'Xenova/opus-mt-en-da',
  'da-en': 'Xenova/opus-mt-da-en',

  // === English <-> Eastern European Languages ===
  'en-ru': 'Xenova/opus-mt-en-ru',
  'ru-en': 'Xenova/opus-mt-ru-en',
  'en-uk': 'Xenova/opus-mt-en-uk',
  'uk-en': 'Xenova/opus-mt-uk-en',
  'en-cs': 'Xenova/opus-mt-en-cs',
  'cs-en': 'Xenova/opus-mt-cs-en',
  'en-hu': 'Xenova/opus-mt-en-hu',
  'hu-en': 'Xenova/opus-mt-hu-en',
  'en-ro': 'Xenova/opus-mt-en-ro',
  // Note: ro-en not directly available, use pivot

  // === English <-> Asian Languages ===
  'en-zh': 'Xenova/opus-mt-en-zh',
  'zh-en': 'Xenova/opus-mt-zh-en',
  'en-ja': 'Xenova/opus-mt-en-jap',
  'ja-en': 'Xenova/opus-mt-jap-en',
  'en-ko': 'Xenova/opus-mt-en-mul', // Korean via multilingual (no direct ko model)
  'ko-en': 'Xenova/opus-mt-ko-en',
  'en-vi': 'Xenova/opus-mt-en-vi',
  'vi-en': 'Xenova/opus-mt-vi-en',
  'en-th': 'Xenova/opus-mt-en-mul', // Thai via multilingual (no direct th model)
  'th-en': 'Xenova/opus-mt-th-en',
  'en-hi': 'Xenova/opus-mt-en-hi',
  'hi-en': 'Xenova/opus-mt-hi-en',
  'en-id': 'Xenova/opus-mt-en-id',
  'id-en': 'Xenova/opus-mt-id-en',

  // === English <-> Middle Eastern Languages ===
  'en-ar': 'Xenova/opus-mt-en-ar',
  'ar-en': 'Xenova/opus-mt-ar-en',
  // Note: Hebrew (he) not available in Xenova collection

  // === English <-> Other Languages ===
  'en-af': 'Xenova/opus-mt-en-af',
  'af-en': 'Xenova/opus-mt-af-en',
  'en-xh': 'Xenova/opus-mt-en-xh', // Xhosa
  'xh-en': 'Xenova/opus-mt-xh-en',
  'et-en': 'Xenova/opus-mt-et-en', // Estonian (en-et not available)

  // === Turkish (tc-big model for better quality) ===
  'tr-en': 'Xenova/opus-mt-tc-big-tr-en',
  // Note: en-tr not directly available, use ROMANCE or pivot

  // === Direct Non-English Pairs (Romance languages) ===
  'fr-de': 'Xenova/opus-mt-fr-de',
  'de-fr': 'Xenova/opus-mt-de-fr',
  'fr-es': 'Xenova/opus-mt-fr-es',
  'es-fr': 'Xenova/opus-mt-es-fr',
  'it-fr': 'Xenova/opus-mt-it-fr',
  'it-es': 'Xenova/opus-mt-it-es',
  'es-it': 'Xenova/opus-mt-es-it',
  'de-es': 'Xenova/opus-mt-de-es',
  'es-de': 'Xenova/opus-mt-es-de',
  'nl-fr': 'Xenova/opus-mt-nl-fr',
  'ro-fr': 'Xenova/opus-mt-ro-fr',
  'fr-ro': 'Xenova/opus-mt-fr-ro',

  // === Direct Non-English Pairs (Slavic and others) ===
  'ru-uk': 'Xenova/opus-mt-ru-uk',
  'uk-ru': 'Xenova/opus-mt-uk-ru',
  'ru-fr': 'Xenova/opus-mt-ru-fr',
  'fr-ru': 'Xenova/opus-mt-fr-ru',
  'ru-es': 'Xenova/opus-mt-ru-es',
  'es-ru': 'Xenova/opus-mt-es-ru',

  // === Nordic <-> German pairs ===
  'da-de': 'Xenova/opus-mt-da-de',
  'no-de': 'Xenova/opus-mt-no-de', // Note: no = Norwegian
  'fi-de': 'Xenova/opus-mt-fi-de',

  // === Multilingual Models (fallback) ===
  // 'mul-en': 'Xenova/opus-mt-mul-en',  // Many languages -> English
  // 'en-mul': 'Xenova/opus-mt-en-mul',  // English -> Many languages
  // 'ROMANCE-en': 'Xenova/opus-mt-ROMANCE-en', // Romance languages -> English
  // 'en-ROMANCE': 'Xenova/opus-mt-en-ROMANCE', // English -> Romance languages
  // 'gem-gem': 'Xenova/opus-mt-gem-gem',  // Germanic family
  // 'gmw-gmw': 'Xenova/opus-mt-gmw-gmw',  // West Germanic family
  // 'bat-en': 'Xenova/opus-mt-bat-en',    // Baltic languages -> English
};

// Pivot routes for language pairs without direct models (translate via English)
// Format: 'source-target': ['source-en', 'en-target']
const PIVOT_ROUTES: Record<string, [string, string]> = {
  // === Nordic <-> Other European ===
  'nl-fi': ['nl-en', 'en-fi'],  // Dutch -> English -> Finnish
  'fi-nl': ['fi-en', 'en-nl'],  // Finnish -> English -> Dutch
  'cs-fi': ['cs-en', 'en-fi'],  // Czech -> English -> Finnish
  'fi-cs': ['fi-en', 'en-cs'],  // Finnish -> English -> Czech
  'sv-fi': ['sv-en', 'en-fi'],  // Swedish -> English -> Finnish
  'fi-sv': ['fi-en', 'en-sv'],  // Finnish -> English -> Swedish
  'da-fi': ['da-en', 'en-fi'],  // Danish -> English -> Finnish
  'fi-da': ['fi-en', 'en-da'],  // Finnish -> English -> Danish

  // === German <-> Various ===
  'de-fi': ['de-en', 'en-fi'],  // German -> English -> Finnish (fi-de exists but not de-fi)
  'de-nl': ['de-en', 'en-nl'],  // German -> English -> Dutch
  'nl-de': ['nl-en', 'en-de'],  // Dutch -> English -> German
  'de-it': ['de-en', 'en-it'],  // German -> English -> Italian
  'it-de': ['it-en', 'en-de'],  // Italian -> English -> German
  'de-ru': ['de-en', 'en-ru'],  // German -> English -> Russian
  'ru-de': ['ru-en', 'en-de'],  // Russian -> English -> German

  // === Polish (no direct en-pl or pl-en, use pivot via mul) ===
  // Note: Polish not available in Xenova OPUS-MT - recommend TranslateGemma instead

  // === Portuguese (no direct models, use pivot via ROMANCE) ===
  // Note: Portuguese not available in Xenova OPUS-MT - recommend TranslateGemma instead

  // === Norwegian (no-en not available, but no-de exists) ===
  // Note: Norwegian has limited support - use TranslateGemma for better coverage

  // === Greek, Hebrew, Turkish (en-*) ===
  // Note: These don't have en->X models - use TranslateGemma

  // === Romanian pivots ===
  'ro-en': ['ro-fr', 'fr-en'],  // Romanian -> French -> English (no direct ro-en)
  'ro-de': ['ro-fr', 'fr-de'],  // Romanian -> French -> German
  'ro-es': ['ro-fr', 'fr-es'],  // Romanian -> French -> Spanish
  'de-ro': ['de-fr', 'fr-ro'],  // German -> French -> Romanian
  'es-ro': ['es-fr', 'fr-ro'],  // Spanish -> French -> Romanian

  // === Asian language pivots (where direct not available) ===
  'ja-de': ['ja-en', 'en-de'],  // Japanese -> English -> German
  'de-ja': ['de-en', 'en-ja'],  // German -> English -> Japanese
  'ja-fr': ['ja-en', 'en-fr'],  // Japanese -> English -> French
  'fr-ja': ['fr-en', 'en-ja'],  // French -> English -> Japanese
  'zh-de': ['zh-en', 'en-de'],  // Chinese -> English -> German
  'de-zh': ['de-en', 'en-zh'],  // German -> English -> Chinese
  'zh-fr': ['zh-en', 'en-fr'],  // Chinese -> English -> French
  'fr-zh': ['fr-en', 'en-zh'],  // French -> English -> Chinese
  'ko-de': ['ko-en', 'en-de'],  // Korean -> English -> German
  'ko-fr': ['ko-en', 'en-fr'],  // Korean -> English -> French

  // === Slavic language pivots ===
  'cs-de': ['cs-en', 'en-de'],  // Czech -> English -> German
  'de-cs': ['de-en', 'en-cs'],  // German -> English -> Czech
  'uk-de': ['uk-en', 'en-de'],  // Ukrainian -> English -> German
  'de-uk': ['de-en', 'en-uk'],  // German -> English -> Ukrainian
  'uk-fr': ['uk-en', 'en-fr'],  // Ukrainian -> English -> French
  'fr-uk': ['fr-en', 'en-uk'],  // French -> English -> Ukrainian

  // === Hungarian pivots ===
  'hu-de': ['hu-en', 'en-de'],  // Hungarian -> English -> German
  'de-hu': ['de-en', 'en-hu'],  // German -> English -> Hungarian
  'hu-fr': ['hu-en', 'en-fr'],  // Hungarian -> English -> French
  'fr-hu': ['fr-en', 'en-hu'],  // French -> English -> Hungarian

  // === Arabic pivots ===
  'ar-de': ['ar-en', 'en-de'],  // Arabic -> English -> German
  'de-ar': ['de-en', 'en-ar'],  // German -> English -> Arabic
  'ar-fr': ['ar-en', 'en-fr'],  // Arabic -> English -> French
  'fr-ar': ['fr-en', 'en-ar'],  // French -> English -> Arabic

  // === Vietnamese pivots ===
  'vi-de': ['vi-en', 'en-de'],  // Vietnamese -> English -> German
  'de-vi': ['de-en', 'en-vi'],  // German -> English -> Vietnamese
  'vi-fr': ['vi-en', 'en-fr'],  // Vietnamese -> English -> French
  'fr-vi': ['fr-en', 'en-vi'],  // French -> English -> Vietnamese

  // === Hindi pivots ===
  'hi-de': ['hi-en', 'en-de'],  // Hindi -> English -> German
  'de-hi': ['de-en', 'en-hi'],  // German -> English -> Hindi
};

// Pipeline cache (OPUS-MT) - using unknown to avoid Transformers.js type conflicts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipelines = new Map<string, any>();

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
      const pipe = await withTimeout(
        pipeline('text-generation', TRANSLATEGEMMA_MODEL, {
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
        }),
        MODEL_LOAD_TIMEOUT_MS,
        `Loading TranslateGemma model`
      );

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
// See: https://iso639-3.sil.org/code_tables/639/data
const FRANC_TO_ISO: Record<string, string> = {
  // Major European languages
  'eng': 'en',
  'deu': 'de',
  'fra': 'fr',
  'spa': 'es',
  'ita': 'it',
  'nld': 'nl',  // Dutch
  'por': 'pt',  // Portuguese

  // Nordic languages
  'fin': 'fi',
  'swe': 'sv',
  'dan': 'da',  // Danish
  'nor': 'no',  // Norwegian (generic)
  'nob': 'no',  // Norwegian Bokmal
  'nno': 'no',  // Norwegian Nynorsk

  // Eastern European languages
  'rus': 'ru',
  'ukr': 'uk',  // Ukrainian
  'pol': 'pl',  // Polish
  'ces': 'cs',  // Czech
  'hun': 'hu',  // Hungarian
  'ron': 'ro',  // Romanian
  'bul': 'bg',  // Bulgarian
  'hrv': 'hr',  // Croatian
  'slk': 'sk',  // Slovak
  'slv': 'sl',  // Slovenian
  'est': 'et',  // Estonian
  'lav': 'lv',  // Latvian
  'lit': 'lt',  // Lithuanian

  // Asian languages
  'cmn': 'zh',  // Mandarin Chinese
  'zho': 'zh',  // Chinese (generic)
  'jpn': 'ja',
  'kor': 'ko',
  'vie': 'vi',  // Vietnamese
  'tha': 'th',  // Thai
  'hin': 'hi',  // Hindi
  'ind': 'id',  // Indonesian
  'msa': 'ms',  // Malay

  // Middle Eastern languages
  'ara': 'ar',  // Arabic
  'heb': 'he',  // Hebrew
  'fas': 'fa',  // Persian/Farsi
  'tur': 'tr',  // Turkish

  // Other languages
  'ell': 'el',  // Greek
  'afr': 'af',  // Afrikaans
  'xho': 'xh',  // Xhosa
  'swa': 'sw',  // Swahili
  'urd': 'ur',  // Urdu
  'ben': 'bn',  // Bengali
  'tam': 'ta',  // Tamil
  'tel': 'te',  // Telugu
  'mal': 'ml',  // Malayalam
  'kat': 'ka',  // Georgian
  'hye': 'hy',  // Armenian
  'sqi': 'sq',  // Albanian
  'mkd': 'mk',  // Macedonian
  'srp': 'sr',  // Serbian
  'bos': 'bs',  // Bosnian
  'isl': 'is',  // Icelandic
  'mlt': 'mt',  // Maltese
  'gle': 'ga',  // Irish
  'cym': 'cy',  // Welsh
  'eus': 'eu',  // Basque
  'cat': 'ca',  // Catalan
  'glg': 'gl',  // Galician
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPipeline(sourceLang: string, targetLang: string): Promise<any> {
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
  const pipe = await withTimeout(
    pipeline('translation', modelId, { device }),
    MODEL_LOAD_TIMEOUT_MS,
    `Loading model ${modelId}`
  );

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
          console.warn('[Offscreen] Failed to cache translation:', err);
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
    console.log('[Offscreen] Cache hit');
    return cached;
  }

  // Translate and cache
  const result = await translateWithProvider(text, actualSourceLang, targetLang, provider);

  // Cache the translation (fire and forget)
  const resultText = Array.isArray(result) ? result[0] : result;
  cache.set(text, actualSourceLang, targetLang, provider, resultText).catch((err) => {
    console.warn('[Offscreen] Failed to cache translation:', err);
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
