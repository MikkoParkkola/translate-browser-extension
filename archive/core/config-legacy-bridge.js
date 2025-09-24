/**
 * @fileoverview Legacy configuration bridge for backward compatibility
 * Provides qwenLoadConfig and qwenSaveConfig functions that use the modern config system
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenLegacyBridge = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const ConfigService = (typeof self !== 'undefined' && self.qwenConfigService?.ConfigService) ||
                       (typeof require !== 'undefined' ? require('./config-service').ConfigService : null);

  const logger = (typeof self !== 'undefined' && self.qwenLogger?.create) 
    ? self.qwenLogger.create('config-legacy-bridge')
    : console;

  if (!ConfigService) {
    throw new Error('ConfigService not available - ensure config-service.js is loaded');
  }

  // Singleton config service instance
  let configServiceInstance = null;
  
  function getConfigService() {
    if (!configServiceInstance) {
      configServiceInstance = new ConfigService();
    }
    return configServiceInstance;
  }

  /**
   * Legacy qwenLoadConfig function with modern backend
   */
  async function qwenLoadConfig() {
    try {
      const service = getConfigService();
      const config = await service.getFlat();
      
      logger.debug('Legacy config loaded via modern system');
      return config;
    } catch (error) {
      logger.error('Failed to load config via legacy bridge:', error);
      
      // Return minimal safe defaults
      return {
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
          google: { charLimit: 500000 },
          deepl: { charLimit: 500000 }
        },
        providerOrder: [],
        failover: true,
        parallel: 'auto',
        translateTimeoutMs: 20000
      };
    }
  }

  /**
   * Legacy qwenSaveConfig function with modern backend
   */
  async function qwenSaveConfig(cfg) {
    try {
      const service = getConfigService();
      
      // Convert flat legacy config to structured format
      const structuredConfig = service.manager.unflatten(cfg);
      
      // Save using modern system
      await service.save(structuredConfig);
      
      logger.debug('Legacy config saved via modern system');
      return Promise.resolve();
    } catch (error) {
      logger.error('Failed to save config via legacy bridge:', error);
      return Promise.reject(error);
    }
  }

  /**
   * Get default configuration in legacy format
   */
  function getDefaultConfig() {
    const service = getConfigService();
    const defaultConfig = service.manager.createDefault();
    return service.manager.flatten(defaultConfig);
  }

  /**
   * Model token limits for backward compatibility
   */
  const modelTokenLimits = {
    'qwen-mt-turbo': 31980,
    'qwen-mt-plus': 23797,
    'gpt-3.5-turbo': 4096,
    'gpt-4': 8192,
    'gpt-4-turbo': 128000,
    'gpt-4o': 128000,
    'claude-3-haiku-20240307': 200000,
    'claude-3-sonnet-20240229': 200000,
    'claude-3-opus-20240229': 200000,
    'claude-3-5-sonnet-20241022': 200000
  };

  /**
   * Translation timeout constant
   */
  const TRANSLATE_TIMEOUT_MS = 20000;

  /**
   * Migration helper - detects if legacy format needs upgrading
   */
  async function needsMigration() {
    const service = getConfigService();
    return await service.needsMigration();
  }

  /**
   * Migrate legacy configuration explicitly
   */
  async function migrateLegacyConfig(legacyConfig) {
    const service = getConfigService();
    const migrated = service.manager.migrate(legacyConfig);
    await service.save(migrated);
    return service.manager.flatten(migrated);
  }

  /**
   * Setup global exports for backward compatibility
   */
  function setupGlobalExports() {
    const exportsObj = { 
      qwenLoadConfig, 
      qwenSaveConfig, 
      defaultCfg: getDefaultConfig(),
      modelTokenLimits, 
      TRANSLATE_TIMEOUT_MS,
      needsMigration,
      migrateLegacyConfig
    };

    // Set up window/self globals like original config.js
    if (typeof window !== 'undefined') {
      window.qwenDefaultConfig = exportsObj.defaultCfg;
      window.qwenLoadConfig = qwenLoadConfig;
      window.qwenSaveConfig = qwenSaveConfig;
      window.qwenModelTokenLimits = modelTokenLimits;
      window.qwenTranslateTimeoutMs = TRANSLATE_TIMEOUT_MS;
      
      // Only set module reference in extension context
      if (
        (typeof process === 'undefined' || process.env.NODE_ENV !== 'test') &&
        typeof chrome !== 'undefined' &&
        chrome.runtime &&
        chrome.runtime.id
      ) {
        window.__qwenConfigModule = exportsObj;
      }
    }

    if (typeof self !== 'undefined' && self !== window) {
      self.qwenDefaultConfig = exportsObj.defaultCfg;
      self.qwenLoadConfig = qwenLoadConfig;
      self.qwenSaveConfig = qwenSaveConfig;
      self.qwenModelTokenLimits = modelTokenLimits;
      self.qwenTranslateTimeoutMs = TRANSLATE_TIMEOUT_MS;
    }

    return exportsObj;
  }

  return {
    qwenLoadConfig,
    qwenSaveConfig,
    getDefaultConfig,
    modelTokenLimits,
    TRANSLATE_TIMEOUT_MS,
    needsMigration,
    migrateLegacyConfig,
    setupGlobalExports,
    getConfigService
  };

}));