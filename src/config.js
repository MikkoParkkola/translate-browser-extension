const modelTokenLimits = {
  'qwen-mt-turbo': 31980,
  'qwen-mt-plus': 23797,
};

const defaultCfg = {
  apiKey: '',
  apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
  model: 'qwen-mt-turbo',
  sourceLanguage: 'en',
  targetLanguage: 'en',
  autoTranslate: false,
  requestLimit: 60,
  tokenLimit: modelTokenLimits['qwen-mt-turbo'],
  tokenBudget: 0,
  smartThrottle: true,
  tokensPerReq: 0,
  retryDelay: 0,
  debug: false,
  dualMode: false,
  useWasmEngine: true,
  autoOpenAfterSave: true,
  cacheMaxEntries: 1000,
  cacheTTL: 30 * 24 * 60 * 60 * 1000,
};

function qwenLoadConfig() {
  // For local testing (pdfViewer.html), prioritize window.qwenConfig
  if (typeof window !== 'undefined' && window.qwenConfig) {
    return Promise.resolve({ ...defaultCfg, ...window.qwenConfig });
  }

  // For the Chrome extension
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(defaultCfg, (cfg) => resolve(cfg));
    });
  }

  // Fallback for other environments (like Node.js for jest tests)
  return Promise.resolve(defaultCfg);
}

function qwenSaveConfig(cfg) {
  // Only save if in the Chrome extension context
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    return new Promise((resolve) => {
      chrome.storage.sync.set(cfg, resolve);
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
