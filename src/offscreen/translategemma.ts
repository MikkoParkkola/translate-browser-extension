/**
 * TranslateGemma Module
 *
 * Handles TranslateGemma 4B model for high-quality translation with WebGPU.
 *
 * Uses Gemma3ForCausalLM + AutoTokenizer directly (not pipeline) because
 * the model config declares model_type "gemma3_text" which maps correctly,
 * but direct loading gives us more control over dtype and device selection.
 */

import {
  Gemma3ForCausalLM,
  AutoTokenizer,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Tensor,
} from '@huggingface/transformers';
import { CONFIG } from '../config';
import { createLogger } from '../core/logger';

const log = createLogger('TranslateGemma');

export const TRANSLATEGEMMA_MODEL = 'm1cc0z/translategemma-4b-it-onnx-q4-webgpu';

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

// TranslateGemma model + tokenizer (loaded directly, not via pipeline)
let tgModel: PreTrainedModel | null = null;
let tgTokenizer: PreTrainedTokenizer | null = null;
let tgLoading: Promise<{ model: PreTrainedModel; tokenizer: PreTrainedTokenizer }> | null = null;

// Flag: set to true when TranslateGemma WebGPU load fails with ONNX type mismatch.
// This indicates the ONNX Runtime WebGPU state is corrupted, so subsequent WebGPU
// loads (e.g., OPUS-MT) should skip straight to WASM.
let _webGpuOnnxTainted = false;

/**
 * Check if the ONNX Runtime WebGPU state is tainted by a failed TranslateGemma load.
 * When true, other models should skip WebGPU and use WASM directly.
 */
export function isWebGpuOnnxTainted(): boolean {
  return _webGpuOnnxTainted;
}

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
 * Check WebGPU support and capabilities.
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
 * Format the TranslateGemma prompt from the official chat template.
 */
export function formatTranslateGemmaPrompt(
  text: string,
  sourceLang: string,
  targetLang: string,
  context?: string
): string {
  const srcName = LANG_NAMES[sourceLang] || sourceLang;
  const tgtName = LANG_NAMES[targetLang] || targetLang;

  const contextLine = context
    ? `\nContext: This text appears in "${context}". Use this context for disambiguation.\n`
    : '';

  return (
    `<start_of_turn>user\n` +
    `You are a professional ${srcName} (${sourceLang}) to ${tgtName} (${targetLang}) translator. ` +
    `Your goal is to accurately convey the meaning and nuances of the original ${srcName} text ` +
    `while adhering to ${tgtName} grammar, vocabulary, and cultural sensitivities.${contextLine}` +
    `Produce only the ${tgtName} translation, without any additional explanations or commentary. ` +
    `Please translate the following ${srcName} text into ${tgtName}:\n\n\n` +
    `${text}<end_of_turn>\n` +
    `<start_of_turn>model\n`
  );
}

/**
 * Send model progress update to popup via service worker.
 */
function sendProgress(update: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage({
      type: 'modelProgress',
      modelId: TRANSLATEGEMMA_MODEL,
      ...update,
    });
  } catch {
    // Popup may be closed
  }
}

/**
 * Check if an error is an ONNX type mismatch (float vs float16 in layernorm).
 */
export function isOnnxTypeMismatch(error: unknown): boolean {
  const errorMsg = error instanceof Error ? error.message : String(error);
  return errorMsg.includes('Type parameter') || errorMsg.includes('bound to different types');
}

/**
 * Load TranslateGemma model + tokenizer directly (singleton, cached in IndexedDB).
 *
 * Loading strategy:
 * 1. Try WebGPU + q4f16 (best performance)
 * 2. On ONNX type mismatch -> fall back to WASM + q4 (the model graph is broken for WebGPU)
 * 3. On other WebGPU errors -> clear cache + retry WebGPU, then WASM + q4 as final fallback
 *
 * Uses Gemma3ForCausalLM explicitly instead of pipeline() to bypass the
 * model_type auto-detection issue: the model declares model_type "gemma3"
 * but Transformers.js only maps "gemma3_text" to the causal LM class.
 */
export async function getTranslateGemmaPipeline(): Promise<{ model: PreTrainedModel; tokenizer: PreTrainedTokenizer }> {
  if (tgModel && tgTokenizer) return { model: tgModel, tokenizer: tgTokenizer };
  if (tgLoading) return tgLoading;

  tgLoading = (async () => {
    log.info('Loading TranslateGemma model...');

    const gpu = await detectWebGPU();

    const progressCallback = (progress: Record<string, unknown>) => {
      sendProgress({
        status: progress.status || 'progress',
        progress: progress.progress ?? 0,
        file: progress.file || null,
        loaded: progress.loaded || null,
        total: progress.total || null,
      });
    };

    const loadModel = async (device: 'webgpu' | 'wasm', dtype: string) => {
      log.info(`Loading TranslateGemma with device: ${device}, dtype: ${dtype}`);
      // Load model and tokenizer in parallel for faster startup.
      // Gemma3ForCausalLM is used directly to avoid pipeline model_type
      // resolution failure (model declares "gemma3", TJS only maps "gemma3_text").
      const [model, tokenizer] = await withTimeout(
        Promise.all([
          Gemma3ForCausalLM.from_pretrained(TRANSLATEGEMMA_MODEL, {
            device,
            dtype,
            use_external_data_format: 2, // Split into 2 chunks (<2GB each) to avoid ArrayBuffer limit
            progress_callback: progressCallback,
          } as Record<string, unknown>),
          AutoTokenizer.from_pretrained(TRANSLATEGEMMA_MODEL, {
            progress_callback: progressCallback,
          }),
        ]),
        CONFIG.timeouts.translateGemmaMs,  // 5 min for ~3.6GB model
        `Loading TranslateGemma model (${device}/${dtype})`
      );
      return { model: model as PreTrainedModel, tokenizer: tokenizer as PreTrainedTokenizer };
    };

    const setResult = (result: { model: PreTrainedModel; tokenizer: PreTrainedTokenizer }) => {
      tgModel = result.model;
      tgTokenizer = result.tokenizer;
      tgLoading = null;
      sendProgress({ status: 'ready', progress: 100 });
      return { model: tgModel, tokenizer: tgTokenizer };
    };

    const loadWasmFallback = async () => {
      log.info('TranslateGemma: falling back to WASM + q4');
      try {
        const result = await loadModel('wasm', 'q4');
        log.info('TranslateGemma loaded successfully via WASM + q4');
        return setResult(result);
      } catch (wasmError) {
        tgLoading = null;
        log.error('TranslateGemma WASM fallback also failed:', wasmError);
        sendProgress({
          status: 'error',
          error: wasmError instanceof Error ? wasmError.message : String(wasmError),
        });
        throw wasmError;
      }
    };

    // If WebGPU is not available or lacks shader-f16, go straight to WASM
    if (!gpu.supported || !gpu.fp16) {
      log.info(`WebGPU ${!gpu.supported ? 'not supported' : 'lacks shader-f16'}, using WASM + q4`);
      return loadWasmFallback();
    }

    // Try WebGPU + q4f16 first (best performance path)
    try {
      const result = await loadModel('webgpu', 'q4f16');
      log.info('TranslateGemma loaded successfully via WebGPU + q4f16');
      return setResult(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (isOnnxTypeMismatch(error)) {
        // ONNX type mismatch: the model graph mixes float and float16 in layernorm.
        // This is a model graph issue, not a cache issue. Fall back to WASM + q4.
        // Also mark WebGPU ONNX state as tainted to protect subsequent model loads.
        _webGpuOnnxTainted = true;
        log.warn(`TranslateGemma: WebGPU q4f16 failed (type mismatch), falling back to WASM q4. Error: ${errorMsg}`);
        return loadWasmFallback();
      }

      // Other WebGPU errors (timeout, GPU crash, etc): try cache-bust + retry WebGPU
      log.warn(`TranslateGemma: WebGPU load failed (${errorMsg}), clearing cache and retrying...`);
      try {
        if (typeof caches !== 'undefined') {
          await caches.delete('transformers-cache');
          log.info('Cleared transformers-cache, retrying WebGPU load');
        }

        const result = await loadModel('webgpu', 'q4f16');
        log.info('TranslateGemma loaded successfully after cache clear (WebGPU + q4f16)');
        return setResult(result);
      } catch (retryError) {
        // Cache-bust retry also failed. Final fallback: WASM + q4
        const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
        log.warn(`TranslateGemma: WebGPU retry also failed (${retryMsg}), final fallback to WASM + q4`);

        if (isOnnxTypeMismatch(retryError)) {
          _webGpuOnnxTainted = true;
        }

        return loadWasmFallback();
      }
    }
  })();

  return tgLoading;
}

/**
 * Translate using TranslateGemma (direct model + tokenizer).
 */
export async function translateWithGemma(
  text: string | string[],
  sourceLang: string,
  targetLang: string,
  context?: string
): Promise<string | string[]> {
  const { model, tokenizer } = await getTranslateGemmaPipeline();

  const translateSingle = async (t: string): Promise<string> => {
    if (!t || t.trim().length === 0) return t;

    const prompt = formatTranslateGemmaPrompt(t, sourceLang, targetLang, context);
    const inputs = tokenizer(prompt);

    // Generate translation
    const outputIds = await (model as PreTrainedModel & {
      generate(params: Record<string, unknown>): Promise<Tensor>;
    }).generate({
      ...inputs,
      max_new_tokens: 1024,
      do_sample: false,
    });

    // Decode only the generated tokens (skip input prompt tokens)
    const inputLength = (inputs.input_ids as Tensor).dims[1];
    const allTokenIds = (outputIds as Tensor).tolist() as number[][];
    const generatedTokenIds = (allTokenIds[0] ?? []).slice(inputLength);
    let translation = tokenizer.decode(
      generatedTokenIds,
      { skip_special_tokens: true }
    );

    // Clean up: remove any trailing special tokens / template artifacts
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
  return tgModel !== null;
}

/**
 * Check if TranslateGemma is currently loading.
 */
export function isTranslateGemmaLoading(): boolean {
  return tgLoading !== null;
}
