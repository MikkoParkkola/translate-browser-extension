<<<<<<< HEAD
const defaultCfg = {
  apiKey: '',
  detectApiKey: '',
  apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
  model: 'qwen-mt-turbo',
  sourceLanguage: 'en',
  targetLanguage: 'en',
  autoTranslate: false,
  requestLimit: 60,
  tokenLimit: 100000,
  tokenBudget: 0,
  debug: false,
  useWasmEngine: true,
  autoOpenAfterSave: true,
=======
const modelTokenLimits = {
  'qwen-mt-turbo': 31980,
  'qwen-mt-plus': 23797,
>>>>>>> d85ab24219afb7ff5c24d5c2a917603994573a7f
};

const defaultProviders = {
  qwen: {
    apiKey: '',
    endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
    model: 'qwen-mt-turbo',
    projectId: '',
    location: '',
    documentModel: '',
  },
  google: {
    apiKey: '',
    endpoint: '',
    model: '',
    projectId: '',
    location: '',
    documentModel: '',
  },
  deeplFree: {
    apiKey: '',
    endpoint: '',
    model: '',
    projectId: '',
    location: '',
    documentModel: '',
  },
  deeplPro: {
    apiKey: '',
    endpoint: '',
    model: '',
    projectId: '',
    location: '',
    documentModel: '',
  },
};

function getDefaultCfg() {
  return {
    apiKey: '',
    apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
    model: 'qwen-mt-turbo',
    failoverStrategy: 'balanced',
    projectId: '',
    location: '',
    documentModel: '',
    sourceLanguage: 'en',
    targetLanguage: 'en',
    autoTranslate: false,
    provider: 'qwen',
    requestLimit: 60,
    tokenLimit: modelTokenLimits['qwen-mt-turbo'],
    tokenBudget: 0,
    remainingRequests: 0,
    remainingTokens: 0,
    providerError: '',
    quotaHistory: [],
    smartThrottle: true,
    tokensPerReq: 0,
    retryDelay: 0,
    debug: false,
    dualMode: false,
    useWasmEngine: true,
    autoOpenAfterSave: true,
    cacheMaxEntries: 1000,
    cacheTTL: 30 * 24 * 60 * 60 * 1000,
    providers: {
      qwen: { ...defaultProviders.qwen },
      google: { ...defaultProviders.google },
      deeplFree: { ...defaultProviders.deeplFree },
      deeplPro: { ...defaultProviders.deeplPro },
    },
  };
}

const defaultCfg = getDefaultCfg();

function migrateConfig(cfg) {
  const out = { ...getDefaultCfg(), ...cfg };
  let needsSave = false;

  out.providers = {
    qwen: { ...defaultProviders.qwen, ...(cfg.providers && cfg.providers.qwen) },
    google: { ...defaultProviders.google, ...(cfg.providers && cfg.providers.google) },
    deeplFree: { ...defaultProviders.deeplFree, ...(cfg.providers && cfg.providers.deeplFree) },
    deeplPro: { ...defaultProviders.deeplPro, ...(cfg.providers && cfg.providers.deeplPro) },
  };

  if (!cfg.providers) needsSave = true;

  if (cfg.apiKey && !out.providers.qwen.apiKey) {
    out.providers.qwen.apiKey = cfg.apiKey;
    needsSave = true;
  }
  if (cfg.apiEndpoint && !out.providers.qwen.endpoint) {
    out.providers.qwen.endpoint = cfg.apiEndpoint;
    needsSave = true;
  }
  if (cfg.model && !out.providers.qwen.model) {
    out.providers.qwen.model = cfg.model;
    needsSave = true;
  }
  if (cfg.projectId && !out.providers.qwen.projectId) {
    out.providers.qwen.projectId = cfg.projectId;
    needsSave = true;
  }
  if (cfg.location && !out.providers.qwen.location) {
    out.providers.qwen.location = cfg.location;
    needsSave = true;
  }
  if (cfg.documentModel && !out.providers.qwen.documentModel) {
    out.providers.qwen.documentModel = cfg.documentModel;
    needsSave = true;
  }

  const active = out.providers[out.provider] || out.providers.qwen;
  out.apiKey = active.apiKey || '';
  out.apiEndpoint = active.endpoint || '';
  out.model = active.model || '';
  out.projectId = active.projectId || '';
  out.location = active.location || '';
  out.documentModel = active.documentModel || '';

  return { cfg: out, needsSave };
}

function qwenLoadConfig() {
  // For local testing (pdfViewer.html), prioritize window.qwenConfig
  if (typeof window !== 'undefined' && window.qwenConfig) {
    const { cfg } = migrateConfig(window.qwenConfig);
    return Promise.resolve(cfg);
  }

  // For the Chrome extension
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(getDefaultCfg(), async (cfg) => {
        const { cfg: mCfg, needsSave } = migrateConfig(cfg);
        if (needsSave) await qwenSaveConfig(mCfg);
        resolve(mCfg);
      });
    });
  }

  // Fallback for other environments (like Node.js for jest tests)
  const { cfg } = migrateConfig({});
  return Promise.resolve(cfg);
}

function qwenSaveConfig(cfg) {
  const { cfg: out } = migrateConfig(cfg);
  const p = out.provider || 'qwen';
  out.providers[p] = {
    ...out.providers[p],
    apiKey: cfg.apiKey || '',
    endpoint: cfg.apiEndpoint || '',
    model: cfg.model || '',
    projectId: cfg.projectId || '',
    location: cfg.location || '',
    documentModel: cfg.documentModel || '',
  };
  const active = out.providers[p];
  out.apiKey = active.apiKey;
  out.apiEndpoint = active.endpoint;
  out.model = active.model;
  out.projectId = active.projectId;
  out.location = active.location;
  out.documentModel = active.documentModel;

  // Only save if in the Chrome extension context
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(out, resolve);
    });
  }
  return Promise.resolve(); // Otherwise, do nothing
}

if (typeof window !== 'undefined') {
  window.qwenDefaultConfig = defaultCfg;
  window.qwenLoadConfig = qwenLoadConfig;
  window.qwenSaveConfig = qwenSaveConfig;
  window.qwenModelTokenLimits = modelTokenLimits;
}

if (typeof module !== 'undefined') {
  module.exports = { qwenLoadConfig, qwenSaveConfig, defaultCfg, modelTokenLimits };
}
