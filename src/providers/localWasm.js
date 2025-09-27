/*
 * Local translation provider powered by an embedded ONNX model (opus-mt-nl-en)
 * Uses @xenova/transformers pipeline to translate fully offline once the
 * extension assets are loaded.
 */

const isTestEnv = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test';

let translatorPromise = null;

async function getTranslator() {
  if (translatorPromise) return translatorPromise;

  if (isTestEnv) {
    translatorPromise = Promise.resolve({
      translate: async (text) => `LOCAL:${text}`,
    });
    return translatorPromise;
  }

  translatorPromise = (async () => {
    console.warn('[LocalWasm] Initializing translator');
    let modulePath = '@xenova/transformers';
    if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
      modulePath = chrome.runtime.getURL('vendor/transformers.min.js');
    }
    console.warn('[LocalWasm] Loading transformers runtime from', modulePath);

    let runtime;
    try {
      runtime = await import(modulePath);
      console.warn('[LocalWasm] Transformers runtime loaded');
    } catch (error) {
      console.error('[LocalWasm] Failed to load transformers runtime', error);
      throw new Error('Local translation runtime unavailable');
    }

    const { pipeline, env } = runtime && runtime.pipeline
      ? runtime
      : runtime && runtime.default && runtime.default.pipeline
        ? runtime.default
        : {};

    if (!pipeline || !env) {
      console.error('[LocalWasm] Transformers runtime missing expected exports', runtime);
      throw new Error('Local translation runtime missing exports');
    }

    const base = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL('models/')
      : (typeof window !== 'undefined' ? `${window.location.origin}/models/` : 'models/');

    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = base;
    env.useBrowserCache = true;
    console.warn('[LocalWasm] Runtime environment configured', { base, wasmBase: `${base}onnxruntime/` });

    const wasmBase = `${base}onnxruntime/`;
    env.backends ??= {};
    env.backends.onnx ??= {};
    env.backends.onnx.wasm ??= {};
    env.backends.onnx.wasm.wasmPaths = {
      'ort-wasm.wasm': `${wasmBase}ort-wasm.wasm`,
      'ort-wasm-simd.wasm': `${wasmBase}ort-wasm-simd.wasm`,
      'ort-wasm-threaded.wasm': `${wasmBase}ort-wasm-threaded.wasm`,
      'ort-wasm-simd-threaded.wasm': `${wasmBase}ort-wasm-simd-threaded.wasm`,
    };

    let translator;
    try {
      translator = await pipeline('translation', 'opus-mt-nl-en', {
        quantized: true,
      });
      console.warn('[LocalWasm] Translation pipeline ready');
    } catch (error) {
      console.error('[LocalWasm] Failed to initialize translation pipeline', error);
      throw new Error('Local translation model failed to load');
    }

    return {
      translate: async (text, srcLang = 'nl', tgtLang = 'en') => {
        console.warn('[LocalWasm] Translating text', { length: text?.length, srcLang, tgtLang });
        try {
          const output = await translator(text, { src_lang: srcLang, tgt_lang: tgtLang });
          if (Array.isArray(output) && output.length) {
            console.warn('[LocalWasm] Translation succeeded with array output');
            return output[0].generated_text || text;
          }
          if (Array.isArray(output?.generated_text)) {
            console.warn('[LocalWasm] Translation succeeded with generated_text array');
            return output.generated_text[0];
          }
          console.warn('[LocalWasm] Translation succeeded with fallback output');
          return output?.generated_text || text;
        } catch (error) {
          console.error('[LocalWasm] Translation failed', error);
          throw new Error('Local translation failed');
        }
      },
    };
  })();

  return translatorPromise;
}

async function translate({ text, source, target }) {
  console.warn('[LocalWasm] translate() invoked', { length: text?.length, source, target });
  const translator = await getTranslator();
  const src = (source && source !== 'auto') ? source : 'nl';
  const tgt = target || 'en';
  const translated = await translator.translate(text, src, tgt);
  console.warn('[LocalWasm] translate() completed');
  return { text: translated };
}

const provider = {
  label: 'Local Model (Hunyuan-MT-7B)',
  configFields: [],
  throttle: { requestLimit: 1, windowMs: 1000 },
  translate,
};

module.exports = provider;
