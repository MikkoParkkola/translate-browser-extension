/**
 * TranslateGemma Module
 *
 * Handles TranslateGemma 4B model for high-quality translation with WebGPU.
 */

import { pipeline, type TextGenerationPipeline } from '@huggingface/transformers';
import { CONFIG } from '../config';
import { createLogger } from '../core/logger';

const log = createLogger('TranslateGemma');

export const TRANSLATEGEMMA_MODEL = 'm1cc0z/translategemma-4b-webgpu-q4';

// Language names for TranslateGemma prompt (ISO 639-1 -> English name)
export const LANG_NAMES: Record<string, string> = {
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
 * Format the TranslateGemma prompt from the official chat template.
 */
export function formatTranslateGemmaPrompt(
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
export async function getTranslateGemmaPipeline(): Promise<TextGenerationPipeline> {
  if (tgPipeline) return tgPipeline;
  if (tgLoading) return tgLoading;

  tgLoading = (async () => {
    log.info(' Loading TranslateGemma model...');

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
        CONFIG.timeouts.translateGemmaMs,  // 5 min for ~3.6GB model
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

      log.info(' TranslateGemma loaded successfully');
      return tgPipeline;
    } catch (error) {
      tgLoading = null;
      log.error(' TranslateGemma failed to load:', error);

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
export async function translateWithGemma(
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

/**
 * Check if TranslateGemma is loaded.
 */
export function isTranslateGemmaLoaded(): boolean {
  return tgPipeline !== null;
}

/**
 * Check if TranslateGemma is currently loading.
 */
export function isTranslateGemmaLoading(): boolean {
  return tgLoading !== null;
}
