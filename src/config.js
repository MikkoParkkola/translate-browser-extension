(function () {
if (typeof window !== 'undefined') {
  if (window.__qwenConfigLoaded) {
    if (typeof module !== 'undefined') module.exports = window.__qwenConfigModule;
    return;
  }
  window.__qwenConfigLoaded = true;
}

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
  tmSync: false,
  sensitivity: 0.3,
  debug: false,
  qualityVerify: false,
  useWasmEngine: true,
  autoOpenAfterSave: true,
  selectionPopup: false,
  theme: 'dark',
  charLimit: 0,
  strategy: 'balanced',
  secondaryModel: '',
  models: [],
  providers: {
    // Approximate default monthly limits for external providers
    google: { charLimit: 500000 }, // ~500k characters
    deepl: { charLimit: 500000 }, // ~500k characters
  },
  providerOrder: [],
  failover: true,
  parallel: 'auto',
};

const modelTokenLimits = {
  'qwen-mt-turbo': 31980,
  'qwen-mt-plus': 23797,
  'gpt-5-mini': 128000,
};

function migrate(cfg = {}) {
  const out = { ...defaultCfg, ...cfg };
  function mapStrategy(s) {
    if (s === 'cost') return 'cheap';
    if (s === 'speed') return 'fast';
    return s;
  }
  if (!out.providers || typeof out.providers !== 'object') out.providers = {};
  const provider = out.provider || 'qwen';
  if (!out.providers[provider]) out.providers[provider] = {};
  Object.entries(out.providers).forEach(([id, p]) => {
    if (p.charLimit == null) p.charLimit = /^google$|^deepl/.test(id) ? 500000 : out.charLimit || 0;
    if (p.requestLimit == null) p.requestLimit = out.requestLimit;
    if (p.tokenLimit == null) p.tokenLimit = out.tokenLimit;
    if (p.costPerInputToken == null) {
      if (p.costPerToken != null) p.costPerInputToken = p.costPerToken;
      else p.costPerInputToken = 0;
    }
    if (p.costPerOutputToken == null) {
      if (p.costPerToken != null) p.costPerOutputToken = p.costPerToken;
      else p.costPerOutputToken = 0;
    }
    if (p.weight == null) p.weight = 0;
    if (p.strategy != null) p.strategy = mapStrategy(p.strategy);
    if (p.strategy == null) p.strategy = mapStrategy(out.strategy || 'balanced');
    if (!Array.isArray(p.models) || !p.models.length) p.models = p.model ? [p.model] : [];
  });
  if (out.apiKey && !out.providers[provider].apiKey) out.providers[provider].apiKey = out.apiKey;
  if (out.apiEndpoint && !out.providers[provider].apiEndpoint) out.providers[provider].apiEndpoint = out.apiEndpoint;
  if (out.model && !out.providers[provider].model) out.providers[provider].model = out.model;
  const p = out.providers[provider];
  if (!Array.isArray(p.models) || !p.models.length) p.models = p.model ? [p.model] : [];
  out.apiKey = p.apiKey || out.apiKey || '';
  out.apiEndpoint = p.apiEndpoint || out.apiEndpoint || '';
  out.model = p.model || out.model || '';
  out.requestLimit = p.requestLimit || out.requestLimit;
  out.tokenLimit = p.tokenLimit || out.tokenLimit;
  out.charLimit = p.charLimit || out.charLimit;
  out.strategy = mapStrategy(p.strategy || out.strategy);
  out.secondaryModel = p.secondaryModel || '';
  out.models = p.models || [];
  if (!Array.isArray(out.providerOrder)) out.providerOrder = [];
  if (typeof out.failover !== 'boolean') out.failover = true;
  if (typeof out.parallel !== 'boolean' && out.parallel !== 'auto') out.parallel = 'auto';
  if (typeof out.tmSync !== 'boolean') out.tmSync = false;
  if (typeof out.selectionPopup !== 'boolean') out.selectionPopup = false;
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
    const num = v => (v === '' || v == null ? undefined : Number(v));
    const providers = { ...(cfg.providers || {}) };
    providers[provider] = {
      ...(providers[provider] || {}),
      apiKey: cfg.apiKey,
      apiEndpoint: cfg.apiEndpoint,
      model: cfg.model,
      secondaryModel: cfg.secondaryModel,
      models: cfg.models,
      requestLimit: num(cfg.requestLimit),
      tokenLimit: num(cfg.tokenLimit),
      charLimit: num(cfg.charLimit),
      strategy: cfg.strategy,
      costPerInputToken: num(cfg.costPerInputToken),
      costPerOutputToken: num(cfg.costPerOutputToken),
      weight: num(cfg.weight),
    };
    const toSave = { ...cfg, providers };
    return new Promise((resolve) => {
      chrome.storage.sync.set(toSave, resolve);
    });
  }
  return Promise.resolve(); // Otherwise, do nothing
}

if (typeof module !== 'undefined') {
  module.exports = { qwenLoadConfig, qwenSaveConfig, defaultCfg, modelTokenLimits };
}
if (typeof window !== 'undefined') {
  window.qwenDefaultConfig = defaultCfg;
  window.qwenLoadConfig = qwenLoadConfig;
  window.qwenSaveConfig = qwenSaveConfig;
  window.qwenModelTokenLimits = modelTokenLimits;
  window.__qwenConfigModule = module.exports;
}

})();
