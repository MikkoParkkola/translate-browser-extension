const providers = {};
let providerOrder = [];

function registerProvider(name, provider) {
  providers[name] = provider;
}

function setProviderOrder(order) {
  providerOrder = Array.isArray(order) ? order.filter(n => providers[n]) : [];
}

function getProviderOrder() {
  return providerOrder.slice();
}

function getProvider(name) {
  return providers[name];
}

function listProviders() {
  return Object.entries(providers).map(([name, p]) => ({ name, label: p.label || name }));
}

async function translateWithFallback(opts) {
  if (!providerOrder.length) providerOrder = Object.keys(providers);
  let lastErr;
  for (let i = 0; i < providerOrder.length; i++) {
    const name = providerOrder[0];
    const prov = providers[name];
    if (!prov || typeof prov.translate !== 'function') {
      providerOrder.shift();
      continue;
    }
    try {
      const res = await prov.translate({ ...opts, provider: name });
      return { ...res, provider: name };
    } catch (e) {
      lastErr = e;
      providerOrder.push(providerOrder.shift());
    }
  }
  throw lastErr || new Error('No providers available');
}

if (typeof window !== 'undefined') {
  window.qwenProviders = {
    registerProvider,
    getProvider,
    listProviders,
    setProviderOrder,
    getProviderOrder,
    translateWithFallback,
  };
} else if (typeof self !== 'undefined') {
  self.qwenProviders = {
    registerProvider,
    getProvider,
    listProviders,
    setProviderOrder,
    getProviderOrder,
    translateWithFallback,
  };
}

module.exports = {
  registerProvider,
  getProvider,
  listProviders,
  setProviderOrder,
  getProviderOrder,
  translateWithFallback,
};
