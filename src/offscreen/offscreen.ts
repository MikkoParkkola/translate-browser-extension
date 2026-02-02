/**
 * Offscreen document for Transformers.js ML inference.
 * Service workers can't use window/document, so we run ML here.
 */

import { pipeline, type Pipeline } from '@huggingface/transformers';
import { franc } from 'franc-min';

// Model mapping
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
};

// Pipeline cache
const pipelines = new Map<string, Pipeline>();

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

  const pipe = await pipeline('translation', modelId, {
    device,
    dtype: 'q4f16',
  });

  pipelines.set(modelId, pipe);
  console.log(`[Offscreen] Model loaded: ${modelId}`);

  return pipe;
}

// Translate text
async function translate(
  text: string | string[],
  sourceLang: string,
  targetLang: string
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

  const pipe = await getPipeline(actualSourceLang, targetLang);

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

// Get supported language pairs
function getSupportedLanguages(): Array<{ src: string; tgt: string }> {
  return Object.keys(MODEL_MAP).map((key) => {
    const [src, tgt] = key.split('-');
    return { src, tgt };
  });
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
            message.targetLang
          );
          sendResponse({ success: true, result });
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

console.log('[Offscreen] Document ready - v2.1 with language detection');
