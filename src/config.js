const defaultCfg = {
  apiKey: '',
  apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
  model: 'qwen-mt-turbo',
  sourceLanguage: 'en',
  targetLanguage: 'en',
  autoTranslate: false,
  requestLimit: 60,
  tokenLimit: 100000,
};

function qwenLoadConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(defaultCfg, (cfg) => resolve(cfg));
  });
}

function qwenSaveConfig(cfg) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(cfg, resolve);
  });
}

if (typeof window !== 'undefined') {
  window.qwenDefaultConfig = defaultCfg;
  window.qwenLoadConfig = qwenLoadConfig;
  window.qwenSaveConfig = qwenSaveConfig;
}
if (typeof module !== 'undefined') {
  module.exports = { qwenLoadConfig, qwenSaveConfig, defaultCfg };
}
