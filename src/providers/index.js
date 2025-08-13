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
  registerProvider('deepl', require('./deepl'));
}

if (typeof window !== 'undefined') {
  window.qwenProviders = { registerProvider, getProvider, listProviders };
} else if (typeof self !== 'undefined') {
  self.qwenProviders = { registerProvider, getProvider, listProviders };
}

module.exports = { registerProvider, getProvider, listProviders };
