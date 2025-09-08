/**
 * Module Adapter - Bridge between old and new module systems
 * 
 * This adapter helps gradually migrate from the monolithic translator.js
 * to the new modular system with clear interfaces. It provides backwards
 * compatibility while enabling incremental refactoring.
 */

class ModuleAdapter {
  constructor() {
    this.modules = new Map();
    this.initialized = false;
    this.logger = this._initLogger();
  }

  /**
   * Initialize the module adapter
   */
  async init() {
    if (this.initialized) return;

    try {
      // Load core modules
      await this._loadCoreModules();
      this.initialized = true;
      this.logger.debug('ModuleAdapter initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize ModuleAdapter:', error);
      throw error;
    }
  }

  /**
   * Load core modules with proper interfaces
   * @private
   */
  async _loadCoreModules() {
    // Load HTTP Client module
    try {
      if (typeof require !== 'undefined') {
        const { defaultHttpClient } = require('./http-client');
        this.modules.set('httpClient', defaultHttpClient);
      } else {
        // Browser environment - modules loaded via script tags
        if (typeof window !== 'undefined' && window.qwenHttpClient) {
          this.modules.set('httpClient', window.qwenHttpClient.defaultHttpClient);
        }
      }
    } catch (e) {
      this.logger.warn('HTTP Client module not available:', e);
    }

    // Load Language Detector module
    try {
      if (typeof require !== 'undefined') {
        const { defaultDetector } = require('./language-detector');
        this.modules.set('languageDetector', defaultDetector);
      } else {
        // Browser environment
        if (typeof window !== 'undefined' && window.qwenLanguageDetector) {
          this.modules.set('languageDetector', window.qwenLanguageDetector.defaultDetector);
        }
      }
    } catch (e) {
      this.logger.warn('Language Detector module not available:', e);
    }

    // Load Cache Manager (if available)
    try {
      if (typeof window !== 'undefined' && window.qwenCoreCache) {
        this.modules.set('cache', window.qwenCoreCache);
      } else if (typeof self !== 'undefined' && self.qwenCoreCache) {
        this.modules.set('cache', self.qwenCoreCache);
      } else if (typeof require !== 'undefined') {
        const cacheManager = require('./cache-manager');
        this.modules.set('cache', cacheManager);
      }
    } catch (e) {
      this.logger.warn('Cache Manager module not available:', e);
    }

    // Load Security module
    try {
      if (typeof window !== 'undefined' && window.qwenSecurity) {
        this.modules.set('security', window.qwenSecurity);
      } else if (typeof self !== 'undefined' && self.qwenSecurity) {
        this.modules.set('security', self.qwenSecurity);
      } else if (typeof require !== 'undefined') {
        const security = require('./security');
        this.modules.set('security', security);
      }
    } catch (e) {
      this.logger.warn('Security module not available:', e);
    }
  }

  /**
   * Get a module instance
   * @param {string} name - Module name
   * @returns {any} Module instance or null if not available
   */
  getModule(name) {
    return this.modules.get(name) || null;
  }

  /**
   * Register a module instance
   * @param {string} name - Module name  
   * @param {any} instance - Module instance
   */
  registerModule(name, instance) {
    this.modules.set(name, instance);
    this.logger.debug(`Module '${name}' registered`);
  }

  /**
   * Check if a module is available
   * @param {string} name - Module name
   * @returns {boolean} True if available
   */
  hasModule(name) {
    return this.modules.has(name);
  }

  /**
   * Get all registered modules
   * @returns {Array<string>} Module names
   */
  getModuleNames() {
    return Array.from(this.modules.keys());
  }

  /**
   * Create a legacy-compatible interface for existing translator code
   * This allows gradual migration without breaking existing functionality
   */
  createLegacyAdapter() {
    const adapter = this;
    
    return {
      // HTTP client adapter
      async fetch(url, options) {
        const httpClient = adapter.getModule('httpClient');
        if (httpClient) {
          return httpClient.request(url, options);
        }
        // Fallback to native fetch or XHR
        return this._fallbackFetch(url, options);
      },

      async fetchStream(url, options, onData) {
        const httpClient = adapter.getModule('httpClient');
        if (httpClient) {
          return httpClient.requestStream(url, options, onData);
        }
        throw new Error('Streaming not supported without HTTP client module');
      },

      // Language detection adapter
      async detectLanguage(text, options) {
        const detector = adapter.getModule('languageDetector');
        if (detector) {
          return detector.detect(text, options);
        }
        // Fallback to basic detection
        return { lang: 'en', confidence: 0.1 };
      },

      // Cache adapter
      getCacheValue(key) {
        const cache = adapter.getModule('cache');
        if (cache && typeof cache.get === 'function') {
          return cache.get(key);
        }
        return undefined;
      },

      setCacheValue(key, value, options) {
        const cache = adapter.getModule('cache');
        if (cache && typeof cache.set === 'function') {
          return cache.set(key, value, options);
        }
      },

      // Security adapter
      sanitizeInput(text, options) {
        const security = adapter.getModule('security');
        if (security && typeof security.sanitizeInput === 'function') {
          return security.sanitizeInput(text, options);
        }
        // Basic sanitization fallback
        return typeof text === 'string' ? text.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') : '';
      },

      sanitizeOutput(text, options) {
        const security = adapter.getModule('security');
        if (security && typeof security.sanitizeOutput === 'function') {
          return security.sanitizeOutput(text, options);
        }
        return text;
      },

      // Fallback fetch implementation
      _fallbackFetch(url, options) {
        if (typeof fetch !== 'undefined') {
          return fetch(url, options);
        }
        // Use XHR fallback (implementation similar to translator.js fetchViaXHR)
        return this._xhrFallback(url, options);
      },

      _xhrFallback(url, options) {
        return new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(options.method || 'GET', url, true);
          
          Object.entries(options.headers || {}).forEach(([k, v]) => {
            xhr.setRequestHeader(k, v);
          });
          
          xhr.responseType = 'text';
          
          if (options.signal) {
            if (options.signal.aborted) {
              return reject(new DOMException('Aborted', 'AbortError'));
            }
            const onAbort = () => {
              xhr.abort();
              reject(new DOMException('Aborted', 'AbortError'));
            };
            options.signal.addEventListener('abort', onAbort, { once: true });
            xhr.addEventListener('loadend', () => {
              options.signal.removeEventListener('abort', onAbort);
            });
          }
          
          xhr.onload = () => {
            const resp = {
              ok: xhr.status >= 200 && xhr.status < 300,
              status: xhr.status,
              json: async () => JSON.parse(xhr.responseText || 'null'),
              text: async () => xhr.responseText,
              headers: new Map()
            };
            resolve(resp);
          };
          
          xhr.onerror = () => reject(new Error('Network error'));
          xhr.send(options.body);
        });
      }
    };
  }

  /**
   * Initialize logger
   * @private
   */
  _initLogger() {
    try {
      if (typeof window !== 'undefined' && window.qwenLogger) {
        return window.qwenLogger.create('module-adapter');
      } else if (typeof self !== 'undefined' && self.qwenLogger) {
        return self.qwenLogger.create('module-adapter');
      } else if (typeof require !== 'undefined') {
        return require('./logger').create('module-adapter');
      }
    } catch (e) {
      // Fallback logger
    }
    
    return {
      debug: (...args) => console.debug('[ModuleAdapter]', ...args),
      info: (...args) => console.info('[ModuleAdapter]', ...args),
      warn: (...args) => console.warn('[ModuleAdapter]', ...args),
      error: (...args) => console.error('[ModuleAdapter]', ...args)
    };
  }

  /**
   * Get module statistics
   * @returns {Object} Statistics about loaded modules
   */
  getStats() {
    const stats = {
      initialized: this.initialized,
      modulesLoaded: this.modules.size,
      modules: {}
    };

    for (const [name, module] of this.modules.entries()) {
      stats.modules[name] = {
        available: !!module,
        type: typeof module,
        hasStats: typeof module.getStats === 'function'
      };

      if (stats.modules[name].hasStats) {
        try {
          stats.modules[name].stats = module.getStats();
        } catch (e) {
          stats.modules[name].statsError = e.message;
        }
      }
    }

    return stats;
  }
}

// Create global instance
const moduleAdapter = new ModuleAdapter();

// Auto-initialize in environments where it's safe
if (typeof window !== 'undefined' || typeof self !== 'undefined') {
  // Initialize after a brief delay to allow modules to load
  setTimeout(() => moduleAdapter.init().catch(console.warn), 100);
}

// Export for different environments
if (typeof module !== 'undefined') {
  module.exports = {
    ModuleAdapter,
    moduleAdapter
  };
}

if (typeof window !== 'undefined') {
  window.qwenModuleAdapter = {
    ModuleAdapter,
    moduleAdapter
  };
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenModuleAdapter = {
    ModuleAdapter,
    moduleAdapter
  };
}