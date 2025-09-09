(function () {
// Initialize logger
const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) 
  ? window.qwenLogger.create('config')
  : (typeof self !== 'undefined' && self.qwenLogger && self.qwenLogger.create)
    ? self.qwenLogger.create('config')
    : console;

// Guard only when running in the extension to allow test re-imports
  if (
    (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') &&
  typeof window !== 'undefined' &&
  typeof chrome !== 'undefined' &&
  chrome.runtime &&
  chrome.runtime.id
  ) {
    if (window.__qwenConfigLoaded) {
      if (typeof module !== 'undefined') module.exports = window.__qwenConfigModule;
      return;
    }
    window.__qwenConfigLoaded = true;
  }

  // Initialize error handler for config operations
  let errorHandler = null;
  try {
    errorHandler = (typeof self !== 'undefined' && self.qwenErrorHandler) || 
                   (typeof window !== 'undefined' && window.qwenErrorHandler);
  } catch (e) {
    // Ignore error handler loading failures
  }
  
  // Fallback error handler
  if (!errorHandler) {
    errorHandler = {
      handle: (error, context = {}, fallback) => {
        logger.error('Config error:', error, context);
        return fallback !== undefined ? fallback : null;
      },
      handleAsync: async (promise, context = {}, fallback) => {
        try {
          return await promise;
        } catch (error) {
          logger.error('Config async error:', error, context);
          return fallback !== undefined ? fallback : null;
        }
      },
      safe: (fn, context = {}, fallback) => {
        return (...args) => {
          try {
            return fn.apply(this, args);
          } catch (error) {
            logger.error('Config safe wrapper error:', error, context);
            return fallback !== undefined ? fallback : null;
          }
        };
      }
    };
  }

  const TRANSLATE_TIMEOUT_MS = 20000;

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
    minDetectLength: 2,
    debug: false,
    qualityVerify: false,
    useWasmEngine: true,
    autoOpenAfterSave: true,
    selectionPopup: false,
    theme: 'dark',
    themeStyle: 'apple',
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
    translateTimeoutMs: TRANSLATE_TIMEOUT_MS,
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
    out.translateTimeoutMs = parseInt(out.translateTimeoutMs, 10);
    if (!Number.isFinite(out.translateTimeoutMs) || out.translateTimeoutMs <= 0) {
      out.translateTimeoutMs = TRANSLATE_TIMEOUT_MS;
    }
    out.minDetectLength = parseInt(out.minDetectLength, 10);
    if (!Number.isFinite(out.minDetectLength) || out.minDetectLength < 0) {
      out.minDetectLength = defaultCfg.minDetectLength;
    }
    if (out.sourceLanguage && out.targetLanguage && out.sourceLanguage === out.targetLanguage) {
      if (typeof console !== 'undefined' && console.warn) {
        logger.warn('sourceLanguage equals targetLanguage; enabling auto-detect');
      }
      out.sourceLanguage = 'auto';
    }
    return out;
  }

  function qwenLoadConfig() {
    // For the Chrome extension
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      return errorHandler.handleAsync(
        new Promise((resolve, reject) => {
          try {
            chrome.storage.sync.get(defaultCfg, (cfg) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              
              const migrated = errorHandler.safe(() => migrate(cfg), 
                { operation: 'migrateConfig', module: 'config' }, 
                defaultCfg
              )();
              
              chrome.storage.sync.set(migrated, () => {
                if (chrome.runtime.lastError) {
                  // Log but don't fail - we can still return the migrated config
                  errorHandler.handle(
                    new Error(chrome.runtime.lastError.message),
                    { operation: 'saveConfigAfterMigration', module: 'config' },
                    null
                  );
                }
                resolve(migrated);
              });
            });
          } catch (error) {
            reject(error);
          }
        }),
        { operation: 'loadConfig', module: 'config' },
        defaultCfg
      );
    }

    // For local testing (pdfViewer.html)
    if (typeof window !== 'undefined' && window.qwenConfig) {
      return Promise.resolve(errorHandler.safe(() => ({ ...defaultCfg, ...window.qwenConfig }), 
        { operation: 'loadLocalConfig', module: 'config' }, 
        defaultCfg
      )());
    }

    // Fallback for other environments (like Node.js for jest tests)
    return Promise.resolve(errorHandler.safe(() => migrate(), 
      { operation: 'loadFallbackConfig', module: 'config' }, 
      defaultCfg
    )());
  }

  function qwenSaveConfig(cfg) {
    // Only save if in the Chrome extension context
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      return errorHandler.handleAsync(
        new Promise((resolve, reject) => {
          try {
            const processedConfig = errorHandler.safe(() => {
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
              return { 
                ...cfg, 
                providers, 
                translateTimeoutMs: num(cfg.translateTimeoutMs), 
                minDetectLength: num(cfg.minDetectLength) 
              };
            }, { operation: 'processConfigForSave', module: 'config' }, cfg)();
            
            chrome.storage.sync.set(processedConfig, () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              resolve();
            });
          } catch (error) {
            reject(error);
          }
        }),
        { operation: 'saveConfig', module: 'config' },
        null
      );
    }
    return Promise.resolve(); // Otherwise, do nothing
  }

  const exportsObj = { qwenLoadConfig, qwenSaveConfig, defaultCfg, modelTokenLimits, TRANSLATE_TIMEOUT_MS };

  if (typeof module !== 'undefined') {
    module.exports = exportsObj;
  }
  if (typeof window !== 'undefined') {
    window.qwenDefaultConfig = defaultCfg;
    window.qwenLoadConfig = qwenLoadConfig;
    window.qwenSaveConfig = qwenSaveConfig;
    window.qwenModelTokenLimits = modelTokenLimits;
    window.qwenTranslateTimeoutMs = TRANSLATE_TIMEOUT_MS;
    if (
      (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') &&
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    chrome.runtime.id
    ) {
      window.__qwenConfigModule = typeof module !== 'undefined' ? module.exports : exportsObj;
    }
  }

})();
