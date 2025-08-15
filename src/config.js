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
  if (out.apiKey && !out.providers[provider].apiKey) out.providers[provider].apiKey = out.apiKey;
  if (out.apiEndpoint && !out.providers[provider].apiEndpoint) out.providers[provider].apiEndpoint = out.apiEndpoint;
  if (out.model && !out.providers[provider].model) out.providers[provider].model = out.model;
  out.apiKey = out.providers[provider].apiKey || out.apiKey || '';
  out.apiEndpoint = out.providers[provider].apiEndpoint || out.apiEndpoint || '';
  out.model = out.providers[provider].model || out.model || '';
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
