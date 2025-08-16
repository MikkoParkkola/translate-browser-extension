const defaultCfg = {
  apiKey: '',
  detectApiKey: '',
  apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
  model: 'qwen-mt-turbo',
  sourceLanguage: 'en',
  targetLanguage: 'en',
  autoTranslate: false,
  requestLimit: 60,
  tokenLimit: 31980,
  tokenBudget: 0,
  calibratedAt: 0,
  memCacheMax: 5000,
  sensitivity: 0.3,
  debug: false,
  useWasmEngine: true,
  autoOpenAfterSave: true,
  compact: false,
  theme: 'dark',
  charLimit: 0,
  strategy: 'balanced',
  secondaryModel: '',
  models: [],
  providers: {},
  providerOrder: [],
  failover: true,
  parallel: false,
};

const modelTokenLimits = {
  'qwen-mt-turbo': 31980,
  'qwen-mt-plus': 23797,
  'gpt-4o-mini': 128000,
};

function migrate(cfg = {}) {
  const out = { ...defaultCfg, ...cfg };
  if (!out.providers || typeof out.providers !== 'object') out.providers = {};
  const provider = out.provider || 'qwen';
  if (!out.providers[provider]) out.providers[provider] = {};
  Object.entries(out.providers).forEach(([id, p]) => {
    if (p.charLimit == null) p.charLimit = /^google$|^deepl/.test(id) ? 500000 : out.charLimit || 0;
  });
  if (out.apiKey && !out.providers[provider].apiKey) out.providers[provider].apiKey = out.apiKey;
  if (out.apiEndpoint && !out.providers[provider].apiEndpoint) out.providers[provider].apiEndpoint = out.apiEndpoint;
  if (out.model && !out.providers[provider].model) out.providers[provider].model = out.model;
  const p = out.providers[provider];
  if (!p.requestLimit) p.requestLimit = out.requestLimit;
  if (!p.tokenLimit) p.tokenLimit = out.tokenLimit;
  if (!p.costPerToken) p.costPerToken = 0;
  if (!p.weight) p.weight = 0;
  if (!p.strategy) p.strategy = out.strategy || 'balanced';
  if (Array.isArray(cfg.models)) p.models = cfg.models.slice();
  else if (!p.models) p.models = p.model ? [p.model] : [];
  if (!p.secondaryModel) {
    p.secondaryModel = p.models.length > 1
      ? p.models.find(m => m !== p.model) || ''
      : '';
  }
  out.apiKey = p.apiKey || out.apiKey || '';
  out.apiEndpoint = p.apiEndpoint || out.apiEndpoint || '';
  out.model = p.model || out.model || '';
  out.requestLimit = p.requestLimit || out.requestLimit;
  out.tokenLimit = p.tokenLimit || out.tokenLimit;
  out.charLimit = p.charLimit || out.charLimit;
  out.strategy = p.strategy || out.strategy;
  out.secondaryModel = p.secondaryModel || '';
  out.models = p.models || [];
  if (!Array.isArray(out.providerOrder)) out.providerOrder = [];
  if (typeof out.failover !== 'boolean') out.failover = true;
  if (typeof out.parallel !== 'boolean') out.parallel = false;
  return out;
}

function qwenLoadConfig() {
  // For local testing (pdfViewer.html), prioritize window.qwenConfig
  if (typeof window !== 'undefined' && window.qwenConfig) {
    return Promise.resolve({ ...defaultCfg, ...window.qwenConfig });
  }

  // For the Chrome extension
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(defaultCfg, (cfg) => {
        const out = migrate(cfg);
        chrome.storage.sync.set(out, () => resolve(out));
      });
    });
  }

  // Fallback for other environments (like Node.js for jest tests)
  return Promise.resolve(migrate());
}

function qwenSaveConfig(cfg) {
  // Only save if in the Chrome extension context
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    const provider = cfg.provider || 'qwen';
    const providers = { ...(cfg.providers || {}) };
    providers[provider] = {
      ...(providers[provider] || {}),
      apiKey: cfg.apiKey,
      apiEndpoint: cfg.apiEndpoint,
      model: cfg.model,
      secondaryModel: cfg.secondaryModel,
      models: cfg.models,
      requestLimit: cfg.requestLimit,
      tokenLimit: cfg.tokenLimit,
      charLimit: cfg.charLimit,
      strategy: cfg.strategy,
      costPerToken: cfg.costPerToken,
      weight: cfg.weight,
    };
    const toSave = { ...cfg, providers };
    return new Promise((resolve) => {
      chrome.storage.sync.set(toSave, resolve);
    });
  }
  return Promise.resolve(); // Otherwise, do nothing
}

if (typeof window !== 'undefined') {
  window.qwenDefaultConfig = defaultCfg;
  window.qwenLoadConfig = qwenLoadConfig;
  window.qwenSaveConfig = qwenSaveConfig;
}

if (typeof module !== 'undefined') {
  module.exports = { qwenLoadConfig, qwenSaveConfig, defaultCfg, modelTokenLimits };
}
