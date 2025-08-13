const providers = {};

function registerProvider(name, provider) {
  providers[name] = provider;
}

function getProvider(name) {
  return providers[name];
}

function listProviders() {
  return Object.entries(providers).map(([name, p]) => ({ name, label: p.label || name }));
}

// Register built-in providers when running under CommonJS (tests, Node)
if (typeof require !== 'undefined') {
  registerProvider('qwen', require('./qwen'));
  registerProvider('google', require('./google'));
  const deepl = require('./deepl');
  registerProvider('deepl', deepl.basic);
  registerProvider('deepl-free', deepl.free);
  registerProvider('deepl-pro', deepl.pro);
}

if (typeof window !== 'undefined') {
  window.qwenProviders = { registerProvider, getProvider, listProviders };
} else if (typeof self !== 'undefined') {
  self.qwenProviders = { registerProvider, getProvider, listProviders };
}

module.exports = { registerProvider, getProvider, listProviders };
