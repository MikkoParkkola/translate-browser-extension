/**
 * Secure Storage Manager
 * Handles secure storage of API keys and sensitive configuration data
 */

(function(root, factory) {
  const mod = factory(root || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.qwenStorageManager = mod;
}(typeof self !== 'undefined' ? self : this, function(root) {

  const logger = (typeof self !== 'undefined' && self.qwenLogger?.create)
    ? self.qwenLogger.create('storage-manager')
    : console;

  const errorHandler = (typeof self !== 'undefined' && self.qwenErrorHandler) ||
                      (typeof require !== 'undefined' ? require('./error-handler') : null) ||
                      {
                        handle: (error, context = {}, fallback) => {
                          logger.error('Storage error:', error, context);
                          return fallback !== undefined ? fallback : null;
                        },
                        handleAsync: async (promise, context = {}, fallback) => {
                          try {
                            return await promise;
                          } catch (error) {
                            logger.error('Storage async error:', error, context);
                            return fallback !== undefined ? fallback : null;
                          }
                        }
                      };

  /**
   * Storage Manager Class
   */
  class StorageManager {
    constructor() {
      this.secureStorage = this._initializeSecureStorage();
      this.cache = new Map();
      this.initialized = false;
    }

    /**
     * Initialize secure storage backend
     */
    _initializeSecureStorage() {
      // Try to use existing secure storage if available
      if (typeof self !== 'undefined' && self.qwenSecureStorage) {
        return self.qwenSecureStorage;
      }

      // Fallback to Chrome storage with encryption wrapper
      return {
        async getSecure(key) {
          if (!this._isStorageAvailable()) return null;

          try {
            const result = await this._chromeStorageGet(key);
            return result ? this._decrypt(result) : null;
          } catch (error) {
            logger.warn('Secure storage get failed:', error);
            return null;
          }
        },

        async setSecure(key, value) {
          if (!this._isStorageAvailable()) return false;

          try {
            const encrypted = this._encrypt(value);
            await this._chromeStorageSet(key, encrypted);
            return true;
          } catch (error) {
            logger.warn('Secure storage set failed:', error);
            return false;
          }
        },

        async removeSecure(key) {
          if (!this._isStorageAvailable()) return false;

          try {
            await this._chromeStorageRemove(key);
            return true;
          } catch (error) {
            logger.warn('Secure storage remove failed:', error);
            return false;
          }
        },

        _isStorageAvailable() {
          return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
        },

        async _chromeStorageGet(key) {
          return new Promise((resolve) => {
            chrome.storage.sync.get([key], (result) => {
              if (chrome.runtime.lastError) {
                resolve(null);
              } else {
                resolve(result[key]);
              }
            });
          });
        },

        async _chromeStorageSet(key, value) {
          return new Promise((resolve, reject) => {
            chrome.storage.sync.set({ [key]: value }, () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          });
        },

        async _chromeStorageRemove(key) {
          return new Promise((resolve, reject) => {
            chrome.storage.sync.remove([key], () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                resolve();
              }
            });
          });
        },

        _encrypt(value) {
          // Simple base64 encoding for now - replace with proper encryption in production
          try {
            return btoa(JSON.stringify({ v: value, t: Date.now() }));
          } catch (error) {
            logger.warn('Encryption failed:', error);
            return value;
          }
        },

        _decrypt(encrypted) {
          // Simple base64 decoding for now - replace with proper decryption in production
          try {
            const decoded = JSON.parse(atob(encrypted));
            return decoded.v;
          } catch (error) {
            logger.warn('Decryption failed:', error);
            return encrypted;
          }
        }
      };
    }

    /**
     * Initialize storage manager
     */
    async initialize() {
      if (this.initialized) return;

      try {
        // Test storage availability
        await this.testStorage();
        this.initialized = true;
        logger.info('Storage manager initialized successfully');
      } catch (error) {
        logger.error('Storage manager initialization failed:', error);
        throw error;
      }
    }

    /**
     * Test storage functionality
     */
    async testStorage() {
      const testKey = 'storage_test';
      const testValue = 'test_value_' + Date.now();

      try {
        // Test secure storage
        await this.secureStorage.setSecure(testKey, testValue);
        const retrieved = await this.secureStorage.getSecure(testKey);

        if (retrieved !== testValue) {
          throw new Error('Storage test failed: values do not match');
        }

        await this.secureStorage.removeSecure(testKey);
        return true;
      } catch (error) {
        throw new Error(`Storage test failed: ${error.message}`);
      }
    }

    /**
     * Get provider API key securely
     */
    async getProviderApiKey(providerId) {
      if (!providerId) {
        throw new Error('Provider ID is required');
      }

      const cacheKey = `provider_key_${providerId}`;

      // Check cache first
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        if (Date.now() - cached.timestamp < 300000) { // 5 minute cache
          return cached.value;
        }
        this.cache.delete(cacheKey);
      }

      try {
        const key = await errorHandler.handleAsync(
          this.secureStorage.getSecure(`provider:${providerId}`),
          { operation: 'getProviderApiKey', provider: providerId },
          null
        );

        // Cache the result
        this.cache.set(cacheKey, {
          value: key,
          timestamp: Date.now()
        });

        return key;
      } catch (error) {
        logger.error(`Failed to get API key for provider ${providerId}:`, error);
        return null;
      }
    }

    /**
     * Set provider API key securely
     */
    async setProviderApiKey(providerId, apiKey) {
      if (!providerId) {
        throw new Error('Provider ID is required');
      }

      try {
        const success = await errorHandler.handleAsync(
          this.secureStorage.setSecure(`provider:${providerId}`, apiKey || ''),
          { operation: 'setProviderApiKey', provider: providerId },
          false
        );

        if (success) {
          // Update cache
          const cacheKey = `provider_key_${providerId}`;
          this.cache.set(cacheKey, {
            value: apiKey,
            timestamp: Date.now()
          });

          logger.info(`API key updated for provider: ${providerId}`);
        }

        return success;
      } catch (error) {
        logger.error(`Failed to set API key for provider ${providerId}:`, error);
        return false;
      }
    }

    /**
     * Remove provider API key
     */
    async removeProviderApiKey(providerId) {
      if (!providerId) {
        throw new Error('Provider ID is required');
      }

      try {
        const success = await errorHandler.handleAsync(
          this.secureStorage.removeSecure(`provider:${providerId}`),
          { operation: 'removeProviderApiKey', provider: providerId },
          false
        );

        if (success) {
          // Clear cache
          const cacheKey = `provider_key_${providerId}`;
          this.cache.delete(cacheKey);

          logger.info(`API key removed for provider: ${providerId}`);
        }

        return success;
      } catch (error) {
        logger.error(`Failed to remove API key for provider ${providerId}:`, error);
        return false;
      }
    }

    /**
     * Get general configuration from storage
     */
    async getConfig(defaults = {}) {
      if (!this._isStorageAvailable()) {
        return defaults;
      }

      try {
        return new Promise((resolve) => {
          chrome.storage.sync.get(defaults, (result) => {
            if (chrome.runtime.lastError) {
              logger.warn('Failed to get config:', chrome.runtime.lastError);
              resolve(defaults);
            } else {
              resolve(result);
            }
          });
        });
      } catch (error) {
        logger.error('Config retrieval failed:', error);
        return defaults;
      }
    }

    /**
     * Set general configuration in storage
     */
    async setConfig(config) {
      if (!this._isStorageAvailable()) {
        return false;
      }

      try {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.set(config, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(true);
            }
          });
        });
      } catch (error) {
        logger.error('Config save failed:', error);
        return false;
      }
    }

    /**
     * Get usage data from local storage
     */
    async getUsageData(key, defaults = {}) {
      if (!this._isLocalStorageAvailable()) {
        return defaults;
      }

      try {
        return new Promise((resolve) => {
          chrome.storage.local.get([key], (result) => {
            if (chrome.runtime.lastError) {
              logger.warn('Failed to get usage data:', chrome.runtime.lastError);
              resolve(defaults);
            } else {
              resolve(result[key] || defaults);
            }
          });
        });
      } catch (error) {
        logger.error('Usage data retrieval failed:', error);
        return defaults;
      }
    }

    /**
     * Set usage data in local storage
     */
    async setUsageData(key, data) {
      if (!this._isLocalStorageAvailable()) {
        return false;
      }

      try {
        return new Promise((resolve, reject) => {
          chrome.storage.local.set({ [key]: data }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(true);
            }
          });
        });
      } catch (error) {
        logger.error('Usage data save failed:', error);
        return false;
      }
    }

    /**
     * Clear cache
     */
    clearCache() {
      this.cache.clear();
      logger.info('Storage cache cleared');
    }

    /**
     * Check if Chrome sync storage is available
     */
    _isStorageAvailable() {
      return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
    }

    /**
     * Check if Chrome local storage is available
     */
    _isLocalStorageAvailable() {
      return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    }

    /**
     * Migrate legacy API keys to secure storage
     */
    async migrateLegacyKeys() {
      logger.info('Starting legacy API key migration...');

      try {
        const config = await this.getConfig({});
        const migrations = [];

        // Migrate main API key
        if (config.apiKey) {
          migrations.push(this.setProviderApiKey('qwen-mt-turbo', config.apiKey));
        }

        // Migrate detect API key
        if (config.detectApiKey) {
          migrations.push(this.setProviderApiKey('google-detect', config.detectApiKey));
        }

        // Migrate provider-specific keys
        if (config.providers) {
          Object.entries(config.providers).forEach(([providerId, provider]) => {
            if (provider.apiKey) {
              migrations.push(this.setProviderApiKey(providerId, provider.apiKey));
            }
          });
        }

        await Promise.all(migrations);

        // Clean up legacy keys from config
        const cleanConfig = { ...config };
        delete cleanConfig.apiKey;
        delete cleanConfig.detectApiKey;
        if (cleanConfig.providers) {
          Object.values(cleanConfig.providers).forEach(provider => {
            delete provider.apiKey;
          });
        }

        await this.setConfig(cleanConfig);

        logger.info('Legacy API key migration completed successfully');
        return true;
      } catch (error) {
        logger.error('Legacy API key migration failed:', error);
        return false;
      }
    }
  }

  // Create singleton instance
  const storageManager = new StorageManager();

  return {
    StorageManager,
    storageManager
  };

}));