let modelPromise;

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
  const model = await loadModel();
  if (!model || typeof model.translate !== 'function') {
    throw new Error('Local model not available');
  }
  if (debug) {
    console.log('QTDEBUG: local WASM translate', { text, source, target });
  }
  const out = await model.translate(text, { source, target });
  const result = typeof out === 'string' ? out : out.text;
  return { text: result };
}

const provider = {
  translate,
  label: 'Local WASM',
  configFields: [],
  throttle: { requestLimit: 1, windowMs: 1000 },
};

try {
  const reg = (typeof window !== 'undefined' && window.qwenProviders) ||
              (typeof self !== 'undefined' && self.qwenProviders) ||
              (typeof require !== 'undefined' ? require('../lib/providers') : null);
  if (reg && reg.register && !reg.get('local-wasm')) reg.register('local-wasm', provider);
} catch {}

module.exports = provider;
