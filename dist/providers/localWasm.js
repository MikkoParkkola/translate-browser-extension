;(function () {
let modelPromise;
const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) ? 
              window.qwenLogger.create('provider:localWasm') :
              (typeof self !== 'undefined' && self.qwenLogger && self.qwenLogger.create) ?
              self.qwenLogger.create('provider:localWasm') : console;
const errorHandler = (typeof window !== 'undefined' && window.qwenProviderErrorHandler) ||
                   (typeof self !== 'undefined' && self.qwenProviderErrorHandler) ||
                   (typeof require !== 'undefined' ? require('../core/provider-error-handler') : null);

async function loadModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      if (typeof WebAssembly === 'undefined') throw new Error('WASM not supported');
      try {
        const mod = await import('../wasm/local/translator.js');
        return typeof mod.init === 'function' ? await mod.init() : mod;
      } catch (e) {
        // Fallback stub when model isn't available (e.g., tests)
        return { translate: async (t) => t };
      }
    })();
  }
  return modelPromise;
}

async function translate({ text, source, target, debug }) {
  try {
    const model = await loadModel();
    if (!model || typeof model.translate !== 'function') {
      if (errorHandler) {
        errorHandler.handleResponseError('Local model not available', 
          { provider: 'localWasm', logger });
      }
      throw new Error('Local model not available');
    }
    if (debug) {
      console.log('QTDEBUG: local WASM translate', { text, source, target });
    }
    const out = await model.translate(text, { source, target });
    const result = typeof out === 'string' ? out : out.text;
    if (!result) {
      if (errorHandler) {
        errorHandler.handleResponseError('Local model returned empty result', 
          { provider: 'localWasm', logger, response: out });
      }
      throw new Error('Local model returned empty result');
    }
    return { text: result };
  } catch (error) {
    if (errorHandler) {
      errorHandler.handleNetworkError(error, { provider: 'localWasm', logger });
    }
    throw error;
  }
}

// Wrap main functions with standardized error handling
const wrappedTranslate = errorHandler ? 
  errorHandler.wrapProviderOperation(translate, { provider: 'localWasm', logger }) : translate;

const provider = {
  translate: wrappedTranslate,
  label: 'Local WASM',
  configFields: [],
  throttle: { requestLimit: 1, windowMs: 1000 },
};
if (typeof window !== 'undefined') window.qwenProviderLocalWasm = provider;
else if (typeof self !== 'undefined') self.qwenProviderLocalWasm = provider;

try {
  const reg = (typeof window !== 'undefined' && window.qwenProviders) ||
              (typeof self !== 'undefined' && self.qwenProviders) ||
              (typeof require !== 'undefined' ? require('../lib/providers') : null);
  if (reg && reg.register && !reg.get('local-wasm')) reg.register('local-wasm', provider);
} catch {}

if (typeof module !== 'undefined') module.exports = provider;
})();
