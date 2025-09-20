(function () {
function applyProviderConfig(provider, doc = document) {
  const advanced = [
    'requestLimit',
    'tokenLimit',
    'charLimit',
    'strategy',
    'costPerInputToken',
    'costPerOutputToken',
    'weight',
  ];
  const fields = ((provider && provider.configFields) || ['apiKey', 'apiEndpoint', 'model']).concat(advanced);
  const all = [
    'apiKey',
    'apiEndpoint',
    'model',
    'projectId',
    'location',
    'documentModel',
    'secondaryModel',
    'secondaryModelWarning',
    ...advanced,
  ];
  all.forEach(name => {
    const show = fields.includes(name);
    doc.querySelectorAll(`[data-field="${name}"]`).forEach(el => {
      el.style.display = show ? '' : 'none';
    });
  });
}

let providerStore;
try {
  if (typeof window !== 'undefined' && window.qwenProviderStore) {
    providerStore = window.qwenProviderStore;
  } else if (typeof self !== 'undefined' && self.qwenProviderStore) {
    providerStore = self.qwenProviderStore;
  } else {
    providerStore = require('./lib/providerStore');
  }
} catch (error) {
  providerStore = null;
}

function legacyLoad(defaults) {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    return new Promise(resolve => {
      chrome.storage.sync.get(defaults, resolve);
    });
  }
  return Promise.resolve({ ...defaults });
}

async function loadProviderConfig() {
  if (providerStore && providerStore.loadConfig) {
    try {
      return await providerStore.loadConfig({ includeSecrets: true });
    } catch (error) {
      console.warn('[providerConfig] providerStore.loadConfig failed, falling back', error);
    }
  }
  const defaults = {
    provider: 'qwen',
    providers: {},
    providerOrder: [],
    failover: true,
    parallel: 'auto',
    model: '',
    models: [],
    secondaryModel: '',
    requestLimit: undefined,
    tokenLimit: undefined,
    charLimit: undefined,
    strategy: undefined,
    costPerInputToken: undefined,
    costPerOutputToken: undefined,
    weight: undefined,
  };
  return legacyLoad(defaults);
}

async function saveProviderConfig(cfg) {
  if (providerStore && providerStore.saveConfig) {
    try {
      await providerStore.saveConfig(cfg || {});
      return;
    } catch (error) {
      console.warn('[providerConfig] providerStore.saveConfig failed, falling back', error);
    }
  }
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    const provider = cfg.provider || 'qwen';
    const providers = cfg.providers || {};
    const primary = providers[provider] || {};
    const toSave = {
      provider,
      providers,
      providerOrder: cfg.providerOrder || [],
      failover: cfg.failover !== false,
      parallel:
        cfg.parallel === true ? 'on' : cfg.parallel === false ? 'off' : cfg.parallel || 'auto',
      apiKey: primary.apiKey || '',
      apiEndpoint: primary.apiEndpoint || '',
      model: primary.model || '',
      secondaryModel: primary.secondaryModel || '',
      models: primary.models || [],
      requestLimit: primary.requestLimit,
      tokenLimit: primary.tokenLimit,
      charLimit: primary.charLimit,
      strategy: primary.strategy,
      costPerInputToken: primary.costPerInputToken,
      costPerOutputToken: primary.costPerOutputToken,
      weight: primary.weight,
    };
    await new Promise(resolve => chrome.storage.sync.set(toSave, resolve));
  }
}

const api = { applyProviderConfig, loadProviderConfig, saveProviderConfig };

if (typeof window !== 'undefined') {
  window.qwenProviderConfig = api;
}
if (typeof module !== 'undefined') {
  module.exports = api;
}
})();
