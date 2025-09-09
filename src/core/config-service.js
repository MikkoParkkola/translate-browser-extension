/**
 * @fileoverview Modern configuration service with async/await API and type safety
 * Provides a modern interface to configuration management with backward compatibility
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenConfigService = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const ConfigManager = (typeof self !== 'undefined' && self.qwenConfigManager?.ConfigManager) ||
                       (typeof require !== 'undefined' ? require('./config-manager').ConfigManager : null);

  const ProviderConfigs = (typeof self !== 'undefined' && self.qwenProviderConfigs) ||
                         (typeof require !== 'undefined' ? require('./provider-configs') : null);

  const logger = (typeof self !== 'undefined' && self.qwenLogger?.create) 
    ? self.qwenLogger.create('config-service')
    : console;

  const errorHandler = (typeof self !== 'undefined' && self.qwenErrorHandler) ||
                      (typeof require !== 'undefined' ? require('./error-handler') : null);

  if (!ConfigManager) {
    throw new Error('ConfigManager not available - ensure config-manager.js is loaded');
  }

  /**
   * Modern configuration service class
   */
  class ConfigService {
    constructor() {
      this.manager = new ConfigManager();
      this.providerConfigs = ProviderConfigs;
      this.storageKey = 'qwen_config_v2';
      this.eventListeners = new Map();
      this.migrationCompleted = false;
    }

    /**
     * Load configuration with automatic migration
     */
    async load() {
      try {
        // Try loading from modern storage first
        const modernConfig = await this._loadFromStorage(this.storageKey);
        if (modernConfig && modernConfig.migration?.version) {
          logger.debug('Loaded modern configuration');
          return this.manager.validate(modernConfig);
        }

        // Fallback to legacy configuration and migrate
        logger.info('Migrating legacy configuration to modern format');
        const legacyConfig = await this._loadLegacyConfig();
        const migratedConfig = this.manager.migrate(legacyConfig);
        
        // Save migrated configuration
        await this._saveToStorage(this.storageKey, migratedConfig);
        this.migrationCompleted = true;
        
        logger.info('Configuration migration completed');
        this._notifyListeners('migrated', { from: 'legacy', to: 'modern' });
        
        return migratedConfig;
      } catch (error) {
        const fallback = this.manager.createDefault();
        
        if (errorHandler) {
          return errorHandler.handle(
            error,
            { operation: 'loadConfig', service: 'config' },
            fallback
          );
        }
        
        logger.error('Failed to load configuration, using defaults:', error);
        return fallback;
      }
    }

    /**
     * Save configuration
     */
    async save(config) {
      try {
        const validatedConfig = this.manager.validate(config);
        await this._saveToStorage(this.storageKey, validatedConfig);
        
        // Update cache
        this.manager.setCache(validatedConfig);
        
        logger.debug('Configuration saved successfully');
        this._notifyListeners('saved', validatedConfig);
        
        return validatedConfig;
      } catch (error) {
        if (errorHandler) {
          return errorHandler.handleAsync(
            Promise.reject(error),
            { operation: 'saveConfig', service: 'config' },
            null
          );
        }
        
        logger.error('Failed to save configuration:', error);
        throw error;
      }
    }

    /**
     * Get specific configuration section
     */
    async getSection(sectionName) {
      const config = await this.load();
      return config[sectionName] || {};
    }

    /**
     * Update specific configuration section
     */
    async updateSection(sectionName, sectionData) {
      const currentConfig = await this.load();
      const updatedConfig = {
        ...currentConfig,
        [sectionName]: {
          ...currentConfig[sectionName],
          ...sectionData
        }
      };
      
      return await this.save(updatedConfig);
    }

    /**
     * Get provider configuration
     */
    async getProvider(providerId) {
      const config = await this.load();
      const providerConfig = config.providers?.[providerId] || {};
      
      // Merge with defaults
      const defaults = this.providerConfigs?.getProviderDefaults(providerId) || {};
      return { ...defaults, ...providerConfig };
    }

    /**
     * Update provider configuration
     */
    async updateProvider(providerId, providerData) {
      const currentConfig = await this.load();
      const updatedConfig = {
        ...currentConfig,
        providers: {
          ...currentConfig.providers,
          [providerId]: {
            ...currentConfig.providers?.[providerId],
            ...providerData
          }
        }
      };
      
      return await this.save(updatedConfig);
    }

    /**
     * Get all providers configuration
     */
    async getProviders() {
      const config = await this.load();
      return config.providers || {};
    }

    /**
     * Add new provider
     */
    async addProvider(providerId, providerData) {
      // Validate provider exists in configurations
      if (this.providerConfigs && !this.providerConfigs.getProviderConfig(providerId)) {
        throw new Error(`Unknown provider: ${providerId}`);
      }
      
      return await this.updateProvider(providerId, providerData);
    }

    /**
     * Remove provider
     */
    async removeProvider(providerId) {
      const currentConfig = await this.load();
      const providers = { ...currentConfig.providers };
      delete providers[providerId];
      
      const updatedConfig = {
        ...currentConfig,
        providers
      };
      
      return await this.save(updatedConfig);
    }

    /**
     * Get flattened configuration for backward compatibility
     */
    async getFlat() {
      const config = await this.load();
      return this.manager.flatten(config);
    }

    /**
     * Reset to default configuration
     */
    async reset() {
      const defaultConfig = this.manager.createDefault();
      return await this.save(defaultConfig);
    }

    /**
     * Validate configuration without saving
     */
    validate(config) {
      return this.manager.validate(config);
    }

    /**
     * Check if configuration needs migration
     */
    async needsMigration() {
      try {
        const modernConfig = await this._loadFromStorage(this.storageKey);
        return !modernConfig || !modernConfig.migration?.version;
      } catch (error) {
        return true;
      }
    }

    /**
     * Add event listener for configuration changes
     */
    addEventListener(event, listener) {
      if (!this.eventListeners.has(event)) {
        this.eventListeners.set(event, new Set());
      }
      this.eventListeners.get(event).add(listener);
    }

    /**
     * Remove event listener
     */
    removeEventListener(event, listener) {
      if (this.eventListeners.has(event)) {
        this.eventListeners.get(event).delete(listener);
      }
    }

    /**
     * Load from Chrome storage or fallback
     */
    async _loadFromStorage(key) {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.get(key, (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(result[key] || null);
          });
        });
      }
      
      // Fallback for testing or other environments
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : null;
      }
      
      return null;
    }

    /**
     * Save to Chrome storage or fallback
     */
    async _saveToStorage(key, data) {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        return new Promise((resolve, reject) => {
          chrome.storage.sync.set({ [key]: data }, () => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve();
          });
        });
      }
      
      // Fallback for testing or other environments
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(key, JSON.stringify(data));
        return Promise.resolve();
      }
      
      return Promise.resolve();
    }

    /**
     * Load legacy configuration using existing config.js functions
     */
    async _loadLegacyConfig() {
      // Try to use existing qwenLoadConfig if available
      if (typeof self !== 'undefined' && self.qwenLoadConfig) {
        return await self.qwenLoadConfig();
      }
      
      if (typeof window !== 'undefined' && window.qwenLoadConfig) {
        return await window.qwenLoadConfig();
      }
      
      // Load from legacy storage key
      const legacy = await this._loadFromStorage('qwen_config') || 
                    await this._loadFromStorage(null); // Chrome storage default
      
      return legacy || this.manager.createDefault();
    }

    /**
     * Notify event listeners
     */
    _notifyListeners(event, data) {
      if (this.eventListeners.has(event)) {
        this.eventListeners.get(event).forEach(listener => {
          try {
            listener(data);
          } catch (error) {
            logger.error(`Error in event listener for ${event}:`, error);
          }
        });
      }
    }
  }

  // Create singleton instance
  const configService = new ConfigService();

  return {
    ConfigService,
    configService
  };

}));