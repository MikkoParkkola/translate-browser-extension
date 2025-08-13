const providers = {};

function registerProvider(name, provider) {
  providers[name] = provider;
}

function getProvider(name) {
  return providers[name];
}

if (typeof window !== 'undefined') {
  window.qwenProviders = { registerProvider, getProvider };
} else if (typeof self !== 'undefined') {
  self.qwenProviders = { registerProvider, getProvider };
}

module.exports = { registerProvider, getProvider };
