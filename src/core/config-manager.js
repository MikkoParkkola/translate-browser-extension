/**
 * @fileoverview Modern configuration management system with schema validation and type safety
 * Provides centralized configuration management with provider-specific modules and validation
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenConfigManager = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const logger = (typeof self !== 'undefined' && self.qwenLogger?.create) 
    ? self.qwenLogger.create('config-manager')
    : console;

  const errorHandler = (typeof self !== 'undefined' && self.qwenErrorHandler) ||
                      (typeof require !== 'undefined' ? require('./error-handler') : null);

  /**
   * Provider defaults from design document
   */
  const PROVIDER_DEFAULTS = {
    'qwen-mt-turbo': {
      name: 'Qwen MT Turbo',
      type: 'ai-mt',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aimt/text-translation/message',
      model: 'qwen-mt-turbo',
      features: ['fast', 'cost-effective', 'streaming'],
      limits: {
        requests: 100, // per minute
        characters: 50000, // per minute
        costPer1K: 0.002
      },
      languages: 100,
      priority: 1,
      enabled: true
    },
    'qwen-mt': {
      name: 'Qwen MT',
      type: 'ai-mt',
      endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1/services/aimt/text-translation/message',
      model: 'qwen-mt',
      features: ['high-quality', 'batch-support'],
      limits: {
        requests: 50, // per minute
        characters: 30000, // per minute
        costPer1K: 0.004
      },
      languages: 100,
      priority: 2,
      enabled: false
    },
    'deepl-free': {
      name: 'DeepL Free',
      type: 'traditional-mt',
      endpoint: 'https://api-free.deepl.com/v2/translate',
      features: ['high-quality', 'limited-usage'],
      limits: {
        requests: 100, // per hour
        characters: 500000, // per month
        costPer1K: 0
      },
      languages: 30,
      priority: 3,
      enabled: false
    },
    'deepl-pro': {
      name: 'DeepL Pro',
      type: 'traditional-mt',
      endpoint: 'https://api.deepl.com/v2/translate',
      features: ['highest-quality', 'unlimited', 'formal-informal'],
      limits: {
        requests: 1000, // per minute
        characters: 1000000, // per minute
        costPer1K: 0.020
      },
      languages: 30,
      priority: 4,
      enabled: false
    }
  };

  /**
   * Configuration schema definitions
   */
  const CONFIG_SCHEMA = {
    // Core application settings
    core: {
      sourceLanguage: { type: 'string', default: 'en', required: false },
      targetLanguage: { type: 'string', default: 'en', required: false },
      autoTranslate: { type: 'boolean', default: false, required: false },
      selectionPopup: { type: 'boolean', default: false, required: false },
      theme: { type: 'string', default: 'dark', enum: ['light', 'dark', 'auto'], required: false },
      themeStyle: { type: 'string', default: 'apple', enum: ['apple', 'material', 'classic'], required: false },
      debug: { type: 'boolean', default: false, required: false }
    },

    // Translation behavior settings
    translation: {
      translateTimeoutMs: { type: 'number', default: 20000, min: 5000, max: 120000, required: false },
      minDetectLength: { type: 'number', default: 2, min: 1, max: 50, required: false },
      qualityVerify: { type: 'boolean', default: false, required: false },
      useWasmEngine: { type: 'boolean', default: true, required: false },
      sensitivity: { type: 'number', default: 0.3, min: 0.0, max: 1.0, required: false },
      strategy: { type: 'string', default: 'balanced', enum: ['cheap', 'fast', 'balanced', 'quality'], required: false }
    },

    // Memory and caching settings
    performance: {
      memCacheMax: { type: 'number', default: 5000, min: 100, max: 50000, required: false },
      tokenBudget: { type: 'number', default: 0, min: 0, required: false },
      calibratedAt: { type: 'number', default: 0, min: 0, required: false }
    },

    // UI and UX settings
    interface: {
      autoOpenAfterSave: { type: 'boolean', default: true, required: false }
    },

    // Provider configuration (validated separately)
    providers: { type: 'object', default: {}, required: false },
    
    // Provider ordering and failover
    routing: {
      providerOrder: { type: 'array', default: [], required: false },
      failover: { type: 'boolean', default: true, required: false },
      parallel: { type: 'string', default: 'auto', enum: ['auto', 'enabled', 'disabled'], required: false }
    },

    // Translation memory and sync
    memory: {
      tmSync: { type: 'boolean', default: false, required: false }
    }
  };

  /**
   * Provider-specific schema definitions
   */
  const PROVIDER_SCHEMA = {
    apiKey: { type: 'string', default: '', required: true },
    apiEndpoint: { type: 'string', default: '', required: false },
    model: { type: 'string', default: '', required: false },
    secondaryModel: { type: 'string', default: '', required: false },
    models: { type: 'array', default: [], required: false },
    requestLimit: { type: 'number', default: 60, min: 1, max: 10000, required: false },
    tokenLimit: { type: 'number', default: 100000, min: 1000, max: 1000000, required: false },
    charLimit: { type: 'number', default: 0, min: 0, max: 10000000, required: false },
    strategy: { type: 'string', default: 'balanced', enum: ['cheap', 'fast', 'balanced', 'quality'], required: false },
    costPerInputToken: { type: 'number', default: 0, min: 0, required: false },
    costPerOutputToken: { type: 'number', default: 0, min: 0, required: false },
    weight: { type: 'number', default: 0, min: 0, max: 1, required: false }
  };

  /**
   * Configuration validation and management class
   */
  class ConfigManager {
    constructor() {
      this.schema = CONFIG_SCHEMA;
      this.providerSchema = PROVIDER_SCHEMA;
      this.migrationVersion = '2.0.0';
      this.cache = new Map();
      this.validators = new Map();
      
      this._setupValidators();
    }

    /**
     * Setup field validators
     */
    _setupValidators() {
      this.validators.set('string', (value, field) => {
        if (typeof value !== 'string') return false;
        if (field.enum && !field.enum.includes(value)) return false;
        return true;
      });

      this.validators.set('number', (value, field) => {
        const num = Number(value);
        if (!Number.isFinite(num)) return false;
        if (field.min !== undefined && num < field.min) return false;
        if (field.max !== undefined && num > field.max) return false;
        return true;
      });

      this.validators.set('boolean', (value) => {
        return typeof value === 'boolean';
      });

      this.validators.set('array', (value) => {
        return Array.isArray(value);
      });

      this.validators.set('object', (value) => {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      });
    }

    /**
     * Validate a single field against schema
     */
    validateField(value, fieldName, fieldSchema) {
      if (value === undefined || value === null) {
        if (fieldSchema.required) {
          throw new Error(`Required field '${fieldName}' is missing`);
        }
        return fieldSchema.default;
      }

      const validator = this.validators.get(fieldSchema.type);
      if (!validator) {
        throw new Error(`Unknown field type '${fieldSchema.type}' for field '${fieldName}'`);
      }

      if (!validator(value, fieldSchema)) {
        throw new Error(`Invalid value for field '${fieldName}': ${JSON.stringify(value)}`);
      }

      return value;
    }

    /**
     * Validate configuration section against schema
     */
    validateSection(config, sectionName, sectionSchema) {
      const result = {};
      const configSection = config[sectionName] || {};

      for (const [fieldName, fieldSchema] of Object.entries(sectionSchema)) {
        try {
          result[fieldName] = this.validateField(
            configSection[fieldName], 
            `${sectionName}.${fieldName}`, 
            fieldSchema
          );
        } catch (error) {
          if (errorHandler) {
            result[fieldName] = errorHandler.handle(
              error,
              { operation: 'validateField', field: fieldName, section: sectionName },
              fieldSchema.default
            );
          } else {
            logger.warn(`Config validation error: ${error.message}`);
            result[fieldName] = fieldSchema.default;
          }
        }
      }

      return result;
    }

    /**
     * Validate provider configuration
     */
    validateProvider(providerId, providerConfig) {
      const result = {};
      
      for (const [fieldName, fieldSchema] of Object.entries(this.providerSchema)) {
        try {
          result[fieldName] = this.validateField(
            providerConfig[fieldName],
            `providers.${providerId}.${fieldName}`,
            fieldSchema
          );
        } catch (error) {
          if (fieldSchema.required) {
            throw error; // Re-throw for required fields
          }
          
          if (errorHandler) {
            result[fieldName] = errorHandler.handle(
              error,
              { operation: 'validateProvider', provider: providerId, field: fieldName },
              fieldSchema.default
            );
          } else {
            logger.warn(`Provider validation error: ${error.message}`);
            result[fieldName] = fieldSchema.default;
          }
        }
      }

      return result;
    }

    /**
     * Validate complete configuration
     */
    validate(config) {
      const validatedConfig = {};

      // Validate each schema section
      for (const [sectionName, sectionSchema] of Object.entries(this.schema)) {
        if (sectionName === 'providers') {
          // Handle providers separately
          validatedConfig.providers = {};
          const providers = config.providers || {};
          
          for (const [providerId, providerConfig] of Object.entries(providers)) {
            validatedConfig.providers[providerId] = this.validateProvider(providerId, providerConfig);
          }
        } else {
          validatedConfig[sectionName] = this.validateSection(config, sectionName, sectionSchema);
        }
      }

      return validatedConfig;
    }

    /**
     * Create default configuration
     */
    createDefault() {
      const defaultConfig = {};

      for (const [sectionName, sectionSchema] of Object.entries(this.schema)) {
        if (sectionName === 'providers') {
          defaultConfig.providers = {};
        } else {
          defaultConfig[sectionName] = {};
          for (const [fieldName, fieldSchema] of Object.entries(sectionSchema)) {
            defaultConfig[sectionName][fieldName] = fieldSchema.default;
          }
        }
      }

      return defaultConfig;
    }

    /**
     * Create default provider configurations
     */
    createDefaultProviders() {
      const providers = {};

      Object.entries(PROVIDER_DEFAULTS).forEach(([providerId, defaults]) => {
        providers[providerId] = {
          ...defaults,
          apiKey: '' // Always start with empty API key for security
        };
      });

      return providers;
    }

    /**
     * Get enabled providers in priority order
     */
    getEnabledProviders(config) {
      const providers = config.providers || {};

      return Object.entries(providers)
        .filter(([_, provider]) => provider.enabled && provider.apiKey)
        .sort(([a], [b]) => {
          const priorityA = providers[a].priority || 999;
          const priorityB = providers[b].priority || 999;
          return priorityA - priorityB;
        })
        .map(([id, provider]) => ({ ...provider, id }));
    }

    /**
     * Select best provider based on strategy
     */
    selectProvider(config, strategy = 'smart', textLength = 0) {
      const enabled = this.getEnabledProviders(config);
      if (enabled.length === 0) {
        return null;
      }

      switch (strategy) {
        case 'fast':
          return enabled.find(p => p.features?.includes('fast')) || enabled[0];

        case 'quality':
          return enabled.find(p => p.features?.includes('highest-quality')) ||
                 enabled.find(p => p.features?.includes('high-quality')) ||
                 enabled[0];

        case 'smart':
        default:
          // Smart selection based on text length and capabilities
          if (textLength < 1000) {
            return enabled.find(p => p.features?.includes('fast')) || enabled[0];
          } else if (textLength > 10000) {
            const suitable = enabled.filter(p =>
              p.limits?.characters >= textLength * 1.2 // 20% buffer
            );
            return suitable.find(p => p.features?.includes('high-quality')) ||
                   suitable[0] || enabled[0];
          } else {
            return enabled[0];
          }
      }
    }

    /**
     * Flatten configuration for backward compatibility
     */
    flatten(config) {
      const flattened = {};

      for (const [sectionName, section] of Object.entries(config)) {
        if (sectionName === 'providers') {
          flattened.providers = section;
        } else if (typeof section === 'object' && section !== null) {
          Object.assign(flattened, section);
        } else {
          flattened[sectionName] = section;
        }
      }

      return flattened;
    }

    /**
     * Unflatten legacy configuration into sections
     */
    unflatten(flatConfig) {
      const config = {};
      const processed = new Set();

      // Initialize sections
      for (const sectionName of Object.keys(this.schema)) {
        if (sectionName === 'providers') {
          config.providers = flatConfig.providers || {};
        } else {
          config[sectionName] = {};
        }
      }

      // Distribute fields to sections
      for (const [key, value] of Object.entries(flatConfig)) {
        if (processed.has(key) || key === 'providers') continue;

        let placed = false;
        for (const [sectionName, sectionSchema] of Object.entries(this.schema)) {
          if (sectionName === 'providers') continue;
          
          if (key in sectionSchema) {
            config[sectionName][key] = value;
            processed.add(key);
            placed = true;
            break;
          }
        }

        // If not placed in any section, put in core for backward compatibility
        if (!placed && key !== 'providers') {
          if (!config.core) config.core = {};
          config.core[key] = value;
        }
      }

      return config;
    }

    /**
     * Migrate legacy configuration format
     */
    migrate(legacyConfig) {
      const unflattened = this.unflatten(legacyConfig);
      const validated = this.validate(unflattened);
      
      // Add migration metadata
      validated.migration = {
        version: this.migrationVersion,
        migratedAt: Date.now(),
        fromLegacy: true
      };

      return validated;
    }

    /**
     * Get configuration cache key
     */
    getCacheKey(contextId = 'default') {
      return `config:${contextId}`;
    }

    /**
     * Cache configuration
     */
    setCache(config, contextId = 'default') {
      this.cache.set(this.getCacheKey(contextId), {
        config,
        timestamp: Date.now()
      });
    }

    /**
     * Get cached configuration
     */
    getCache(contextId = 'default', maxAge = 60000) {
      const cacheKey = this.getCacheKey(contextId);
      const cached = this.cache.get(cacheKey);
      
      if (!cached) return null;
      
      if (Date.now() - cached.timestamp >= maxAge) {
        this.cache.delete(cacheKey);
        return null;
      }
      
      return cached.config;
    }
  }

  // Export singleton instance
  const configManager = new ConfigManager();

  return {
    ConfigManager,
    configManager,
    CONFIG_SCHEMA,
    PROVIDER_SCHEMA,
    PROVIDER_DEFAULTS
  };

}));