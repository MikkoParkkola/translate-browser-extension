const Providers = require('../lib/providers');

// Register built-in providers for Node/tests and browser environments
Providers.register('qwen', require('./qwen'));
Providers.register('google', require('./google'));
const deepl = require('./deepl');
Providers.register('deepl', deepl.basic);
Providers.register('deepl-free', deepl.free);
Providers.register('deepl-pro', deepl.pro);

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
  window.qwenProviders = { registerProvider, getProvider, listProviders };
} else if (typeof self !== 'undefined') {
  self.qwenProviders = { registerProvider, getProvider, listProviders };
}

module.exports = { registerProvider, getProvider, listProviders };
