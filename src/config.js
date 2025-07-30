const defaultCfg = {
  apiKey: '',
  apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1/',
  targetLanguage: 'en',
  ignoredLanguages: [],
  autoTranslate: false,
  model: 'qwen-mt-turbo',
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
