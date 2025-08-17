const Providers = require('../lib/providers');

function initProviders() {
  Providers.init({
    qwen: require('./qwen'),
    google: require('./google'),
    deepl: require('./deepl').basic,
    'deepl-free': require('./deepl').free,
    'deepl-pro': require('./deepl').pro,
    macos: { ...require('./macos'), label: 'macOS' },
    mistral: { ...require('./mistral'), label: 'Mistral' },
    openai: { ...require('./openai'), label: 'OpenAI' },
    openrouter: { ...require('./openrouter'), label: 'OpenRouter' },
    ollama: { ...require('./ollama'), label: 'Ollama' },
    gemini: { ...require('./gemini'), label: 'Gemini' },
    anthropic: { ...require('./anthropic'), label: 'Anthropic' },
    'local-wasm': { ...require('./localWasm'), label: 'Local WASM' },
  });
}

function isInitialized() { return Providers.isInitialized(); }
function ensureProviders() {
  if (!isInitialized()) {
    initProviders();
    return true;
  }
  return false;
}
function resetProviders() { Providers.reset(); }

function registerProvider(name, provider) { Providers.register(name, provider); }
function getProvider(name) { return Providers.get(name); }
function listProviders() {
  return Array.from(Providers.candidates({})).map(name => {
    const p = Providers.get(name) || {};
    return { name, label: p.label || name };
  });
}

// Expose registry to globals for browser use
if (typeof window !== 'undefined') {
  window.qwenProviders = { registerProvider, getProvider, listProviders, initProviders, ensureProviders, isInitialized, resetProviders };
} else if (typeof self !== 'undefined') {
  self.qwenProviders = { registerProvider, getProvider, listProviders, initProviders, ensureProviders, isInitialized, resetProviders };
}

module.exports = { registerProvider, getProvider, listProviders, initProviders, ensureProviders, isInitialized, resetProviders };
