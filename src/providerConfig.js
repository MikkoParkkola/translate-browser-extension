function applyProviderConfig(provider, doc = document) {
  const fields = (provider && provider.configFields) || ['apiKey', 'apiEndpoint', 'model'];
  const all = [
    'apiKey',
    'apiEndpoint',
    'model',
    'projectId',
    'location',
    'documentModel',
    'secondaryModel',
    'secondaryModelWarning',
  ];
  all.forEach(name => {
    const show = fields.includes(name);
    doc.querySelectorAll(`[data-field="${name}"]`).forEach(el => {
      el.style.display = show ? '' : 'none';
    });
  });
}

function loadProviderConfig() {
  const defaults = {
    provider: 'qwen',
    providers: {},
    providerOrder: [],
    failover: true,
    parallel: 'auto',
    model: '',
    models: [],
    secondaryModel: '',
  };
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    return new Promise(resolve => {
      chrome.storage.sync.get(defaults, resolve);
    });
  }
  return Promise.resolve({ ...defaults });
}

function saveProviderConfig(cfg) {
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
      costPerToken: primary.costPerToken,
      weight: primary.weight,
    };
    return new Promise(resolve => chrome.storage.sync.set(toSave, resolve));
  }
  return Promise.resolve();
}

const api = { applyProviderConfig, loadProviderConfig, saveProviderConfig };

if (typeof window !== 'undefined') {
  window.qwenProviderConfig = api;
}
if (typeof module !== 'undefined') {
  module.exports = api;
}
