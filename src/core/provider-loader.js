/**
 * Dynamic Provider Loading System
 * Loads translation providers on-demand to reduce bundle size and startup time
 */

(function(global) {
  'use strict';

  // Initialize logger
  const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) 
    ? window.qwenLogger.create('provider-loader')
    : (typeof self !== 'undefined' && self.qwenLogger && self.qwenLogger.create)
      ? self.qwenLogger.create('provider-loader')
      : (typeof global !== 'undefined' && global.qwenLogger && global.qwenLogger.create)
        ? global.qwenLogger.create('provider-loader')
        : console;

  // Track loaded providers to prevent double-loading
  const loadedProviders = new Set();
  const loadingPromises = new Map();
  
  // Provider configurations for lazy loading
  const providerConfig = {
    'dashscope': {
      file: 'providers/dashscope.js',
      globalVar: 'qwenProviderDashScope',
      size: 5108,
      priority: 1, // Default provider, load first
      description: 'Alibaba DashScope API provider'
    },
    'openai': {
      file: 'providers/openai.js', 
      globalVar: 'qwenProviderOpenAI',
      size: 4862,
      priority: 2,
      description: 'OpenAI GPT provider'
    },
    'openrouter': {
      file: 'providers/openrouter.js',
      globalVar: 'qwenProviderOpenRouter', 
      size: 4997,
      priority: 3,
      description: 'OpenRouter multi-model provider'
    },
    'anthropic': {
      file: 'providers/anthropic.js',
      globalVar: 'qwenProviderAnthropic',
      size: 4756,
      priority: 3,
      description: 'Anthropic Claude provider'
    },
    'gemini': {
      file: 'providers/gemini.js',
      globalVar: 'qwenProviderGemini',
      size: 4239,
      priority: 3,
      description: 'Google Gemini provider'
    },
    'mistral': {
      file: 'providers/mistral.js',
      globalVar: 'qwenProviderMistral',
      size: 4171,
      priority: 3,
      description: 'Mistral AI provider'
    },
    'deepl': {
      file: 'providers/deepl.js',
      globalVar: 'qwenProviderDeepL',
      size: 3612,
      priority: 2,
      description: 'DeepL translation provider'
    },
    'google': {
      file: 'providers/google.js',
      globalVar: 'qwenProviderGoogle',
      size: 3331,
      priority: 3,
      description: 'Google Translate provider'
    },
    'qwen': {
      file: 'providers/qwen.js',
      globalVar: 'qwenProviderQwen',
      size: 7398,
      priority: 1,
      description: 'Qwen MT provider'
    },
    'ollama': {
      file: 'providers/ollama.js',
      globalVar: 'qwenProviderOllama',
      size: 4518,
      priority: 4,
      description: 'Local Ollama provider'
    },
    'localWasm': {
      file: 'providers/localWasm.js',
      globalVar: 'qwenProviderLocalWasm',
      size: 1673,
      priority: 4,
      description: 'Local WebAssembly provider'
    },
    'hunyuan-local': {
      file: 'providers/localWasm.js',
      globalVar: 'qwenProviderLocalWasm',
      size: 0,
      priority: 4,
      description: 'Hunyuan local translation provider',
      aliasOf: 'localWasm'
    },
    'macos': {
      file: 'providers/macos.js',
      globalVar: 'qwenProviderMacOS',
      size: 1353,
      priority: 4,
      description: 'macOS native translation provider'
    }
  };

  /**
   * Check if a provider is already loaded
   * @param {string} providerName 
   * @returns {boolean}
   */
  function isProviderLoaded(providerName) {
    const config = providerConfig[providerName];
    const baseName = config && config.aliasOf ? config.aliasOf : providerName;
    return loadedProviders.has(providerName) || loadedProviders.has(baseName);
  }

  /**
   * Get size information for providers
   * @param {string[]} providers Optional list of specific providers
   * @returns {Object} Size information
   */
  function getProviderSizes(providers = null) {
    const allProviders = providers || Object.keys(providerConfig).filter(name => !providerConfig[name]?.aliasOf);

    const seenFiles = new Set();
    const toSize = (name) => {
      const config = providerConfig[name];
      if (!config) return 0;
      const baseName = config.aliasOf || name;
      const baseConfig = providerConfig[baseName] || config;
      const fileKey = baseConfig.file || baseName;
      if (providers) {
        // When explicit providers requested, don't dedupe to allow caller-controlled selection
        return baseConfig.size || 0;
      }
      if (seenFiles.has(fileKey)) return 0;
      seenFiles.add(fileKey);
      return baseConfig.size || 0;
    };

    const total = allProviders.reduce((sum, name) => sum + toSize(name), 0);

    const loadedFiles = new Set();
    const loaded = Array.from(loadedProviders).reduce((sum, name) => {
      const config = providerConfig[name];
      if (!config) return sum;
      const baseName = config.aliasOf || name;
      const baseConfig = providerConfig[baseName] || config;
      const fileKey = baseConfig.file || baseName;
      if (loadedFiles.has(fileKey)) return sum;
      loadedFiles.add(fileKey);
      return sum + (baseConfig.size || 0);
    }, 0);

    return {
      total,
      loaded,
      saved: total - loaded,
      count: {
        total: allProviders.length,
        loaded: loadedFiles.size,
        pending: allProviders.length - loadedFiles.size
      }
    };
  }

  /**
   * Get essential providers that should be loaded at startup
   * @returns {string[]} Array of provider names
   */
  function getEssentialProviders() {
    // Only load priority 1 providers at startup
    return Object.entries(providerConfig)
      .filter(([name, config]) => config.priority === 1)
      .map(([name]) => name);
  }

  /**
   * Load a provider dynamically using importScripts (service worker)
   * @param {string} providerName Provider identifier
   * @returns {Promise<boolean>} Success status
   */
  async function loadProviderWorker(providerName) {
    const config = providerConfig[providerName];
    if (!config) {
      logger.warn(`Provider ${providerName} not found in configuration`);
      return false;
    }

    const baseName = config.aliasOf || providerName;
    const baseConfig = providerConfig[baseName] || config;
    const loadKey = baseName;

    if (loadedProviders.has(providerName) || loadedProviders.has(baseName)) {
      return true;
    }

    if (loadingPromises.has(loadKey)) {
      return await loadingPromises.get(loadKey);
    }

    const loadPromise = new Promise((resolve) => {
      try {
        // Check if already available globally
        if (global[baseConfig.globalVar]) {
          loadedProviders.add(baseName);
          loadedProviders.add(providerName);
          logger.debug(`Provider ${providerName} already loaded`);
          resolve(true);
          return;
        }

        // Load using importScripts in service worker
        if (typeof importScripts === 'function') {
          importScripts(baseConfig.file);

          if (global[baseConfig.globalVar]) {
            loadedProviders.add(baseName);
            loadedProviders.add(providerName);
            logger.debug(`Provider ${providerName} loaded successfully (${baseConfig.size} bytes)`);
            resolve(true);
          } else {
            logger.error(`Provider ${providerName} failed to load: global variable ${baseConfig.globalVar} not found`);
            resolve(false);
          }
        } else {
          logger.error(`Provider ${providerName} cannot be loaded: importScripts not available`);
          resolve(false);
        }
      } catch (error) {
        logger.error(`Provider ${providerName} load failed:`, error);
        resolve(false);
      }
    });

    loadingPromises.set(loadKey, loadPromise);
    
    try {
      const result = await loadPromise;
      return result;
    } finally {
      loadingPromises.delete(loadKey);
    }
  }

  /**
   * Load a provider dynamically using script injection (content script)
   * @param {string} providerName Provider identifier
   * @returns {Promise<boolean>} Success status
   */
  async function loadProviderContent(providerName) {
    const config = providerConfig[providerName];
    if (!config) {
      logger.warn(`Provider ${providerName} not found in configuration`);
      return false;
    }

    const baseName = config.aliasOf || providerName;
    const baseConfig = providerConfig[baseName] || config;

    if (loadedProviders.has(providerName) || loadedProviders.has(baseName)) {
      return true;
    }

    if (loadingPromises.has(baseName)) {
      return await loadingPromises.get(baseName);
    }

    const loadPromise = new Promise((resolve) => {
      try {
        if (global[baseConfig.globalVar]) {
          loadedProviders.add(baseName);
          loadedProviders.add(providerName);
          logger.debug(`Provider ${providerName} already loaded`);
          resolve(true);
          return;
        }

        const url = (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function')
          ? chrome.runtime.getURL(baseConfig.file)
          : baseConfig.file;
        if (!url) {
          logger.error(`Provider ${providerName} cannot be loaded: unable to resolve URL for ${baseConfig.file}`);
          resolve(false);
          return;
        }

        (async () => {
          try {
            const loadText = async () => {
              if (typeof fetch === 'function') {
                const response = await fetch(url);
                if (!response.ok) {
                  throw new Error(`HTTP ${response.status}`);
                }
                return await response.text();
              }
              return await new Promise((resolveFetch, rejectFetch) => {
                try {
                  const xhr = new XMLHttpRequest();
                  xhr.open('GET', url, true);
                  xhr.onreadystatechange = () => {
                    if (xhr.readyState === XMLHttpRequest.DONE) {
                      if (xhr.status >= 200 && xhr.status < 300) {
                        resolveFetch(xhr.responseText);
                      } else {
                        rejectFetch(new Error(`HTTP ${xhr.status}`));
                      }
                    }
                  };
                  xhr.onerror = () => rejectFetch(new Error('Network error'));
                  xhr.send();
                } catch (xhrError) {
                  rejectFetch(xhrError);
                }
              });
            };

            const code = await loadText();
            const sourceURL = `\n//# sourceURL=${url}`;
            new Function(code + sourceURL).call(global);

            if (global[baseConfig.globalVar]) {
              loadedProviders.add(baseName);
              loadedProviders.add(providerName);
              logger.debug(`Provider ${providerName} loaded successfully (${baseConfig.size} bytes)`);
              resolve(true);
            } else {
              logger.error(`Provider ${providerName} failed to register global ${baseConfig.globalVar}`);
              resolve(false);
            }
          } catch (error) {
            logger.error(`Provider ${providerName} load failed:`, error);
            resolve(false);
          }
        })();
      } catch (error) {
        logger.error(`Provider ${providerName} load failed:`, error);
        resolve(false);
      }
    });

    loadingPromises.set(baseName, loadPromise);

    try {
      const result = await loadPromise;
      return result;
    } finally {
      loadingPromises.delete(baseName);
    }
  }

  /**
   * Load multiple providers in parallel
   * @param {string[]} providerNames Array of provider names
   * @returns {Promise<Object>} Results object with success/failure counts
   */
  async function loadProviders(providerNames) {
    const isWorker = typeof importScripts === 'function';
    const loader = isWorker ? loadProviderWorker : loadProviderContent;
    
    logger.debug(`Loading ${providerNames.length} providers in ${isWorker ? 'worker' : 'content'} context`);
    
    const results = await Promise.allSettled(
      providerNames.map(name => loader(name))
    );
    
    const successful = results.filter(r => r.status === 'fulfilled' && r.value).length;
    const failed = results.length - successful;
    
    logger.debug(`Provider loading complete: ${successful} successful, ${failed} failed`);
    
    return {
      successful,
      failed,
      total: results.length,
      results: results.map((r, i) => ({
        provider: providerNames[i],
        success: r.status === 'fulfilled' && r.value,
        error: r.status === 'rejected' ? r.reason : null
      }))
    };
  }

  /**
   * Load providers based on user configuration
   * @param {Object} config User configuration with preferred providers
   * @returns {Promise<Object>} Load results
   */
  async function loadConfiguredProviders(config = {}) {
    const configuredProviders = config.enabledProviders || [];
    const providerOrder = config.providerOrder || [];
    
    // Combine configured providers with order preference
    const providersToLoad = new Set([
      ...getEssentialProviders(),
      ...configuredProviders,
      ...providerOrder.slice(0, 3) // Load top 3 from order
    ]);
    
    return await loadProviders(Array.from(providersToLoad));
  }

  /**
   * Get load statistics for monitoring
   * @returns {Object} Statistics object
   */
  function getLoadStats() {
    const sizes = getProviderSizes();
    return {
      ...sizes,
      loadedProviders: Array.from(loadedProviders),
      availableProviders: Object.keys(providerConfig),
      loadingInProgress: Array.from(loadingPromises.keys()),
      memoryImpact: `${Math.round(sizes.loaded / 1024)}KB loaded, ${Math.round(sizes.saved / 1024)}KB saved`
    };
  }

  /**
   * Preload providers likely to be needed
   * @param {string} context Context hint (popup, content, background)
   */
  async function preloadLikelyProviders(context = 'unknown') {
    const priorities = {
      'popup': ['dashscope', 'openai', 'deepl'],
      'content': ['dashscope', 'qwen'],
      'background': ['dashscope', 'openai', 'deepl', 'qwen']
    };
    
    const providers = priorities[context] || priorities.background;
    const unloaded = providers.filter(name => !loadedProviders.has(name));
    
    if (unloaded.length > 0) {
      logger.debug(`Preloading ${unloaded.length} providers for ${context} context`);
      return await loadProviders(unloaded);
    }
    
    return { successful: 0, failed: 0, total: 0, results: [] };
  }

  // Testing utilities (only available in test environment)
  function resetForTesting() {
    loadedProviders.clear();
    loadingPromises.clear();
  }

  // Public API
  const providerLoader = {
    loadProvider: typeof importScripts === 'function' ? loadProviderWorker : loadProviderContent,
    loadProviders,
    loadConfiguredProviders,
    preloadLikelyProviders,
    isProviderLoaded,
    getProviderSizes,
    getEssentialProviders,
    getLoadStats,
    providerConfig: Object.freeze(providerConfig),
    // Only expose reset function in test environment
    ...(typeof process !== 'undefined' && process.env.NODE_ENV === 'test' ? { resetForTesting } : {})
  };

  // Export to global scope
  if (typeof self !== 'undefined') {
    self.qwenProviderLoader = providerLoader;
  }
  if (typeof window !== 'undefined') {
    window.qwenProviderLoader = providerLoader;
  }
  if (typeof global !== 'undefined') {
    global.qwenProviderLoader = providerLoader;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = providerLoader;
  }

  // Auto-load essential providers in worker context (skip in test environment)
  if (typeof importScripts === 'function' && 
      (typeof process === 'undefined' || process.env.NODE_ENV !== 'test')) {
    const essentialProviders = getEssentialProviders();
    if (essentialProviders.length > 0) {
      logger.debug('Auto-loading essential providers:', essentialProviders);
      loadProviders(essentialProviders).then(result => {
        logger.debug('Essential providers loaded:', result);
      }).catch(error => {
        logger.error('Failed to load essential providers:', error);
      });
    }
  }

})(typeof self !== 'undefined' ? self : this);