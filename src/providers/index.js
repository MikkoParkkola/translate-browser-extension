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

if (typeof window !== 'undefined') {
  window.qwenProviders = { registerProvider, getProvider, listProviders };
} else if (typeof self !== 'undefined') {
  self.qwenProviders = { registerProvider, getProvider, listProviders };
}

module.exports = { registerProvider, getProvider, listProviders };
