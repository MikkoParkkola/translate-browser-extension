/**
 * Configuration Manager for Background Service Worker
 * Handles settings persistence and management
 */

import { logger } from '../lib/logger.js';
import { trackError } from '../lib/performanceTracker.js';
import { createErrorHandler, throwStandardError, ERROR_CODES } from '../lib/standardErrorHandler.js';

class ConfigManager {
  constructor() {
    this.config = {};
    this.errorHandler = createErrorHandler('ConfigManager');
    this.defaults = {
      // Translation settings
      sourceLanguage: 'auto',
      targetLanguage: 'en',
      provider: 'qwen-mt-turbo',
      strategy: 'smart',

      // Auto-translation settings
      autoTranslate: false,
      autoTranslateLanguages: [],
      skipLanguages: ['en'], // Don't auto-translate these languages

      // Performance settings
      batchSize: 50,
      batchDelay: 300,
      maxRetries: 3,

      // API settings
      requestsPerMinute: 60,
      tokensPerMinute: 100000,

      // UI settings
      theme: 'light',
      showUsageStats: true,
      showPerformanceDashboard: false,

      // Advanced settings
      enableLogging: true,
      logLevel: 'info',
      enableTelemetry: true,
      cacheEnabled: true,
      cacheTimeout: 3600000, // 1 hour

      // Security settings
      allowedOrigins: ['*'],
      requireAuth: false,

      // Feature flags
      enableLocalModels: false,
      enableAdvancedFiltering: true,
      enableSmartBatching: true,

      // Cost tracking
      monthlyBudget: 5.00, // USD
      costAlertThreshold: 0.8, // 80% of budget
      trackCosts: true
    };

    this.observers = new Map();
    this.isLoaded = false;
  }

  // Initialize configuration
  async initialize() {
    try {
      await this.loadConfig();
      this.setupStorageListener();
      this.isLoaded = true;
      logger.info('ConfigManager', 'Configuration initialized successfully');
    } catch (error) {
      trackError('ConfigManager', error);
      throw await this.errorHandler.handleError(error, { operation: 'initialize' });
    }
  }

  // Load configuration from Chrome storage
  async loadConfig() {
    try {
      // Load from sync storage first (user preferences)
      const syncData = await chrome.storage.sync.get();

      // Load from local storage (session data, cache, etc.)
      const localData = await chrome.storage.local.get();

      // Merge with defaults
      this.config = {
        ...this.defaults,
        ...syncData,
        // Keep some local-only settings separate
        _local: localData
      };

      // Validate and fix any invalid settings
      this.validateAndFixConfig();

      logger.debug('ConfigManager', 'Configuration loaded:', Object.keys(this.config));

      // Notify observers
      this.notifyObservers('config:loaded', this.config);

    } catch (error) {
      const handledException = await this.errorHandler.handleError(error, { operation: 'loadConfig' });
      // For storage failures, use defaults as fallback
      if (handledException.category === 'storage') {
        this.config = { ...this.defaults };
        logger.warn('ConfigManager', 'Using default configuration due to storage error');
        return; // Continue with defaults instead of throwing
      }
      throw handledException;
    }
  }

  // Save configuration to Chrome storage
  async saveConfig(syncOnly = false) {
    try {
      // Separate sync and local data
      const { _local, ...syncData } = this.config;

      // Save user preferences to sync storage
      await chrome.storage.sync.set(syncData);

      // Save local data if not sync-only
      if (!syncOnly && _local) {
        await chrome.storage.local.set(_local);
      }

      logger.debug('ConfigManager', 'Configuration saved');

      // Notify observers
      this.notifyObservers('config:saved', this.config);

    } catch (error) {
      trackError('ConfigManager', error);
      throw await this.errorHandler.handleError(error, { operation: 'saveConfig' });
    }
  }

  // Get configuration value
  get(key, defaultValue = undefined) {
    if (key.includes('.')) {
      // Handle nested keys like 'ui.theme'
      const keys = key.split('.');
      let value = this.config;

      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          return defaultValue !== undefined ? defaultValue : this.getDefault(key);
        }
      }

      return value;
    }

    return key in this.config ? this.config[key] : defaultValue !== undefined ? defaultValue : this.getDefault(key);
  }

  // Set configuration value
  async set(key, value, persist = true) {
    try {
      if (key.includes('.')) {
        // Handle nested keys
        const keys = key.split('.');
        let target = this.config;

        for (let i = 0; i < keys.length - 1; i++) {
          const k = keys[i];
          if (!target[k] || typeof target[k] !== 'object') {
            target[k] = {};
          }
          target = target[k];
        }

        target[keys[keys.length - 1]] = value;
      } else {
        this.config[key] = value;
      }

      // Validate the new value
      this.validateConfigValue(key, value);

      if (persist) {
        await this.saveConfig();
      }

      // Notify observers
      this.notifyObservers('config:changed', { key, value, config: this.config });

      logger.debug('ConfigManager', `Configuration updated: ${key} =`, value);

    } catch (error) {
      trackError('ConfigManager', error, { key, value });
      throw await this.errorHandler.handleError(error, { operation: 'setConfig', key, value });
    }
  }

  // Update multiple configuration values
  async update(updates, persist = true) {
    try {
      for (const [key, value] of Object.entries(updates)) {
        await this.set(key, value, false); // Don't persist each individual change
      }

      if (persist) {
        await this.saveConfig();
      }

      logger.debug('ConfigManager', 'Bulk configuration update:', Object.keys(updates));

    } catch (error) {
      throw await this.errorHandler.handleError(error, { operation: 'updateConfig', updates: Object.keys(updates) });
    }
  }

  // Get all configuration
  getAll() {
    return { ...this.config };
  }

  // Reset to defaults
  async resetToDefaults(keys = null) {
    try {
      if (keys === null) {
        // Reset all
        this.config = { ...this.defaults };
      } else if (Array.isArray(keys)) {
        // Reset specific keys
        for (const key of keys) {
          if (key in this.defaults) {
            this.config[key] = this.defaults[key];
          }
        }
      } else if (typeof keys === 'string') {
        // Reset single key
        if (keys in this.defaults) {
          this.config[keys] = this.defaults[keys];
        }
      }

      await this.saveConfig();

      logger.info('ConfigManager', 'Configuration reset to defaults:', keys || 'all');

      // Notify observers
      this.notifyObservers('config:reset', { keys, config: this.config });

    } catch (error) {
      throw await this.errorHandler.handleError(error, { operation: 'resetToDefaults', keys });
    }
  }

  // Get default value
  getDefault(key) {
    if (key.includes('.')) {
      const keys = key.split('.');
      let value = this.defaults;

      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          return undefined;
        }
      }

      return value;
    }

    return this.defaults[key];
  }

  // Validate and fix configuration
  validateAndFixConfig() {
    // Validate language codes
    if (this.config.sourceLanguage && typeof this.config.sourceLanguage !== 'string') {
      this.config.sourceLanguage = this.defaults.sourceLanguage;
    }

    // Validate numeric limits
    if (typeof this.config.requestsPerMinute !== 'number' || this.config.requestsPerMinute < 1) {
      this.config.requestsPerMinute = this.defaults.requestsPerMinute;
    }

    if (typeof this.config.tokensPerMinute !== 'number' || this.config.tokensPerMinute < 100) {
      this.config.tokensPerMinute = this.defaults.tokensPerMinute;
    }

    // Validate arrays
    if (!Array.isArray(this.config.autoTranslateLanguages)) {
      this.config.autoTranslateLanguages = this.defaults.autoTranslateLanguages;
    }

    // Validate enums
    const validStrategies = ['smart', 'fast', 'quality'];
    if (!validStrategies.includes(this.config.strategy)) {
      this.config.strategy = this.defaults.strategy;
    }

    const validProviders = ['qwen-mt-turbo', 'qwen-mt'];
    if (!validProviders.includes(this.config.provider)) {
      this.config.provider = this.defaults.provider;
    }

    logger.debug('ConfigManager', 'Configuration validated and fixed');
  }

  // Validate a single configuration value
  validateConfigValue(key, value) {
    switch (key) {
      case 'requestsPerMinute':
      case 'tokensPerMinute':
        if (typeof value !== 'number' || value < 1) {
          throwStandardError('CONFIG_INVALID', `${key} must be a positive number`, null, { key, value });
        }
        break;

      case 'strategy':
        if (!['smart', 'fast', 'quality'].includes(value)) {
          throwStandardError('CONFIG_INVALID', 'Invalid strategy value', null, { key, value, validValues: ['smart', 'fast', 'quality'] });
        }
        break;

      case 'provider':
        if (!['qwen-mt-turbo', 'qwen-mt'].includes(value)) {
          throwStandardError('CONFIG_INVALID', 'Invalid provider value', null, { key, value, validValues: ['qwen-mt-turbo', 'qwen-mt'] });
        }
        break;

      case 'monthlyBudget':
        if (typeof value !== 'number' || value < 0) {
          throwStandardError('CONFIG_INVALID', 'Monthly budget must be a non-negative number', null, { key, value });
        }
        break;

      case 'autoTranslateLanguages':
        if (!Array.isArray(value)) {
          throwStandardError('CONFIG_INVALID', 'autoTranslateLanguages must be an array', null, { key, value });
        }
        break;
    }
  }

  // Add configuration change observer
  addObserver(eventType, callback) {
    if (!this.observers.has(eventType)) {
      this.observers.set(eventType, new Set());
    }

    this.observers.get(eventType).add(callback);

    // Return unsubscribe function
    return () => {
      const observers = this.observers.get(eventType);
      if (observers) {
        observers.delete(callback);
      }
    };
  }

  // Notify observers
  notifyObservers(eventType, data) {
    const observers = this.observers.get(eventType);
    if (!observers) return;

    for (const callback of observers) {
      try {
        callback(data);
      } catch (error) {
        logger.error('ConfigManager', 'Observer callback error:', error);
      }
    }
  }

  // Setup storage change listener
  setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      // Only handle sync storage changes (user preferences)
      if (namespace === 'sync') {
        // Update local config cache
        for (const [key, change] of Object.entries(changes)) {
          this.config[key] = change.newValue;
        }

        logger.debug('ConfigManager', 'Configuration updated from storage:', Object.keys(changes));

        // Notify observers
        this.notifyObservers('config:external_change', { changes, namespace });
      }
    });
  }

  // Get configuration summary for debugging
  getSummary() {
    return {
      loaded: this.isLoaded,
      keys: Object.keys(this.config).length,
      observers: this.observers.size,
      defaults: Object.keys(this.defaults).length
    };
  }

  // Export configuration (for backup/import)
  exportConfig() {
    const { _local, ...exportData } = this.config;
    return {
      version: '1.0',
      timestamp: new Date().toISOString(),
      config: exportData
    };
  }

  // Import configuration (from backup)
  async importConfig(importData) {
    try {
      if (!importData.config) {
        throwStandardError('CONFIG_INVALID', 'Invalid import data format', null, { importData: !!importData });
      }

      // Merge with current config (don't replace everything)
      const newConfig = {
        ...this.config,
        ...importData.config
      };

      this.config = newConfig;
      this.validateAndFixConfig();

      await this.saveConfig();

      logger.info('ConfigManager', 'Configuration imported successfully');

      // Notify observers
      this.notifyObservers('config:imported', importData);

    } catch (error) {
      throw await this.errorHandler.handleError(error, { operation: 'importConfig' });
    }
  }
}

export { ConfigManager };