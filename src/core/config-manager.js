/**
 * @fileoverview Extension configuration manager with encryption and validation
 * Provides secure configuration management with Chrome storage sync and caching
 */

(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else {
    root.qwenConfigManager = mod;
  }
}(typeof self !== 'undefined' ? self : this, function (root) {

  // Import types for JSDoc
  /// <reference path="./types.js" />

  /** @type {Object} */
  let logger = console;
  
  /** @type {Object|null} */
  let storageAdapter = null;

  try {
    // Initialize logger
    if (root.qwenCoreLogger && root.qwenCoreLogger.create) {
      logger = root.qwenCoreLogger.create('config');
    } else if (root.qwenLogger && root.qwenLogger.create) {
      logger = root.qwenLogger.create('config');
    }

    // Initialize storage adapter
    if (root.qwenStorageAdapter && root.qwenStorageAdapter.createAdapter) {
      storageAdapter = root.qwenStorageAdapter.createAdapter('sync');
    }
  } catch (error) {
    logger.warn('Failed to initialize config manager dependencies', error);
  }

  /** @type {ExtensionConfig|null} Cached configuration */
  let configCache = null;

  /** @type {number} Cache timestamp */
  let cacheTimestamp = 0;

  /** @type {number} Cache TTL in milliseconds */
  const CACHE_TTL = 1000; // 1 second for fast access

  /** @type {Set<Function>} Change listeners */
  const changeListeners = new Set();

  /** @type {boolean} Whether encryption is available */
  const encryptionAvailable = typeof crypto !== 'undefined' && 
                               crypto.subtle && 
                               typeof TextEncoder !== 'undefined';

  /** @type {string} Encryption key prefix for identification */
  const ENCRYPTED_PREFIX = 'qwen:encrypted:';

  /**
   * Default configuration values
   * @type {ExtensionConfig}
   */
  const DEFAULT_CONFIG = {
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

  /**
   * Configuration validation schema
   */
  const VALIDATION_SCHEMA = {
    apiKey: { type: 'string', sensitive: true },
    detectApiKey: { type: 'string', sensitive: true },
    apiEndpoint: { type: 'string', pattern: /^https?:\/\/.+/ },
    model: { type: 'string', minLength: 1 },
    sourceLanguage: { type: 'string', minLength: 2, maxLength: 10 },
    targetLanguage: { type: 'string', minLength: 2, maxLength: 10 },
    autoTranslate: { type: 'boolean' },
    requestLimit: { type: 'number', min: 1, max: 1000 },
    tokenLimit: { type: 'number', min: 100, max: 1000000 },
    tokenBudget: { type: 'number', min: 0 },
    calibratedAt: { type: 'number', min: 0 },
    memCacheMax: { type: 'number', min: 0, max: 50000 },
    tmSync: { type: 'boolean' },
    sensitivity: { type: 'number', min: 0, max: 1 },
    minDetectLength: { type: 'number', min: 0, max: 100 },
    debug: { type: 'boolean' },
    qualityVerify: { type: 'boolean' },
    useWasmEngine: { type: 'boolean' },
    autoOpenAfterSave: { type: 'boolean' },
    selectionPopup: { type: 'boolean' },
    theme: { type: 'string', enum: ['dark', 'light', 'auto'] },
    themeStyle: { type: 'string' },
    charLimit: { type: 'number', min: 0 },
    strategy: { type: 'string', enum: ['fast', 'balanced', 'quality', 'cheap'] },
    secondaryModel: { type: 'string' },
    models: { type: 'array' },
    providers: { type: 'object' },
    providerOrder: { type: 'array' },
    failover: { type: 'boolean' },
    parallel: { type: ['boolean', 'string'] },
    translateTimeoutMs: { type: 'number', min: 1000, max: 300000 }
  };

  /**
   * Generate encryption key from password
   * @param {string} password - Password string
   * @returns {Promise<CryptoKey>} Encryption key
   */
  async function deriveKey(password) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits', 'deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: encoder.encode('qwen-translator-salt'),
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt sensitive data
   * @param {string} value - Value to encrypt
   * @returns {Promise<string>} Encrypted value
   */
  async function encryptValue(value) {
    if (!encryptionAvailable || !value) return value;

    try {
      const encoder = new TextEncoder();
      const key = await deriveKey('qwen-config-key');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(value)
      );

      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);

      return ENCRYPTED_PREFIX + btoa(String.fromCharCode(...combined));
    } catch (error) {
      logger.warn('Encryption failed, storing value in plain text', error);
      return value;
    }
  }

  /**
   * Decrypt sensitive data
   * @param {string} encryptedValue - Encrypted value
   * @returns {Promise<string>} Decrypted value
   */
  async function decryptValue(encryptedValue) {
    if (!encryptionAvailable || !encryptedValue || !encryptedValue.startsWith(ENCRYPTED_PREFIX)) {
      return encryptedValue;
    }

    try {
      const decoder = new TextDecoder();
      const key = await deriveKey('qwen-config-key');
      
      const combined = new Uint8Array(
        atob(encryptedValue.slice(ENCRYPTED_PREFIX.length))
          .split('')
          .map(char => char.charCodeAt(0))
      );

      const iv = combined.slice(0, 12);
      const encrypted = combined.slice(12);

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encrypted
      );

      return decoder.decode(decrypted);
    } catch (error) {
      logger.error('Decryption failed', error);
      return encryptedValue;
    }
  }

  /**
   * Validate configuration value
   * @param {string} key - Configuration key
   * @param {any} value - Value to validate
   * @returns {{valid: boolean, error?: string}} Validation result
   */
  function validateValue(key, value) {
    const schema = VALIDATION_SCHEMA[key];
    if (!schema) {
      return { valid: true }; // Allow unknown keys
    }

    // Type validation
    if (schema.type === 'array') {
      if (!Array.isArray(value)) {
        return { valid: false, error: `${key} must be an array` };
      }
    } else if (schema.type === 'object') {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { valid: false, error: `${key} must be an object` };
      }
    } else if (Array.isArray(schema.type)) {
      if (!schema.type.includes(typeof value)) {
        return { valid: false, error: `${key} must be one of types: ${schema.type.join(', ')}` };
      }
    } else if (typeof value !== schema.type) {
      return { valid: false, error: `${key} must be of type ${schema.type}` };
    }

    // Additional validations
    if (schema.minLength && typeof value === 'string' && value.length < schema.minLength) {
      return { valid: false, error: `${key} must be at least ${schema.minLength} characters` };
    }

    if (schema.maxLength && typeof value === 'string' && value.length > schema.maxLength) {
      return { valid: false, error: `${key} must be at most ${schema.maxLength} characters` };
    }

    if (schema.min && typeof value === 'number' && value < schema.min) {
      return { valid: false, error: `${key} must be at least ${schema.min}` };
    }

    if (schema.max && typeof value === 'number' && value > schema.max) {
      return { valid: false, error: `${key} must be at most ${schema.max}` };
    }

    if (schema.pattern && typeof value === 'string' && !schema.pattern.test(value)) {
      return { valid: false, error: `${key} format is invalid` };
    }

    if (schema.enum && !schema.enum.includes(value)) {
      return { valid: false, error: `${key} must be one of: ${schema.enum.join(', ')}` };
    }

    return { valid: true };
  }

  /**
   * Migrate legacy configuration format
   * @param {Object} config - Configuration to migrate
   * @returns {ExtensionConfig} Migrated configuration
   */
  function migrateConfig(config = {}) {
    const migrated = { ...DEFAULT_CONFIG, ...config };

    // Strategy mapping
    if (migrated.strategy === 'cost') migrated.strategy = 'cheap';
    if (migrated.strategy === 'speed') migrated.strategy = 'fast';

    // Provider migration
    if (!migrated.providers || typeof migrated.providers !== 'object') {
      migrated.providers = { ...DEFAULT_CONFIG.providers };
    }

    // Ensure provider has required fields
    Object.entries(migrated.providers).forEach(([id, provider]) => {
      if (!provider || typeof provider !== 'object') {
        migrated.providers[id] = {};
        return;
      }

      const p = migrated.providers[id];
      if (p.charLimit == null) {
        p.charLimit = /^google$|^deepl/.test(id) ? 500000 : migrated.charLimit || 0;
      }
      if (p.requestLimit == null) p.requestLimit = migrated.requestLimit;
      if (p.tokenLimit == null) p.tokenLimit = migrated.tokenLimit;
      if (p.weight == null) p.weight = 0;
      if (p.strategy == null) p.strategy = migrated.strategy;
      if (!Array.isArray(p.models)) p.models = p.model ? [p.model] : [];
    });

    // Timeout validation
    migrated.translateTimeoutMs = parseInt(migrated.translateTimeoutMs, 10);
    if (!Number.isFinite(migrated.translateTimeoutMs) || migrated.translateTimeoutMs <= 0) {
      migrated.translateTimeoutMs = DEFAULT_CONFIG.translateTimeoutMs;
    }

    // Language validation
    if (migrated.sourceLanguage === migrated.targetLanguage) {
      logger.warn('Source and target languages are the same, enabling auto-detect');
      migrated.sourceLanguage = 'auto';
    }

    return migrated;
  }

  /**
   * Check if cache is valid
   * @returns {boolean} True if cache is valid
   */
  function isCacheValid() {
    return configCache && (Date.now() - cacheTimestamp) < CACHE_TTL;
  }

  /**
   * Notify change listeners
   * @param {string} key - Changed key
   * @param {any} value - New value
   * @param {any} oldValue - Previous value
   */
  function notifyListeners(key, value, oldValue) {
    changeListeners.forEach(listener => {
      try {
        listener({ key, value, oldValue, config: configCache });
      } catch (error) {
        logger.error('Config change listener error', error);
      }
    });
  }

  /**
   * Load configuration from storage
   * @returns {Promise<ExtensionConfig>} Configuration object
   */
  async function loadConfig() {
    try {
      if (isCacheValid()) {
        logger.debug('Config cache hit');
        return configCache;
      }

      let rawConfig = DEFAULT_CONFIG;

      // Try to load from storage
      if (storageAdapter) {
        const result = await storageAdapter.read(DEFAULT_CONFIG);
        if (result.success) {
          rawConfig = result.data;
          logger.debug('Config loaded from storage', { 
            keys: Object.keys(rawConfig).length,
            duration: result.duration 
          });
        } else {
          logger.warn('Failed to load config from storage', result.error);
        }
      }

      // Migrate and validate
      const migratedConfig = migrateConfig(rawConfig);
      
      // Decrypt sensitive values
      for (const [key, schema] of Object.entries(VALIDATION_SCHEMA)) {
        if (schema.sensitive && migratedConfig[key]) {
          migratedConfig[key] = await decryptValue(migratedConfig[key]);
        }
      }

      // Update cache
      configCache = migratedConfig;
      cacheTimestamp = Date.now();

      logger.debug('Config loaded and cached', { 
        cacheSize: Object.keys(configCache).length 
      });

      return configCache;
    } catch (error) {
      logger.error('Config load failed', error);
      return DEFAULT_CONFIG;
    }
  }

  /**
   * Save configuration to storage
   * @param {Partial<ExtensionConfig>} updates - Configuration updates
   * @returns {Promise<boolean>} Success status
   */
  async function saveConfig(updates) {
    try {
      if (!storageAdapter) {
        logger.error('Storage adapter not available');
        return false;
      }

      // Load current config to merge
      const current = await loadConfig();
      const merged = { ...current, ...updates };

      // Validate changes
      const errors = [];
      for (const [key, value] of Object.entries(updates)) {
        const validation = validateValue(key, value);
        if (!validation.valid) {
          errors.push(validation.error);
        }
      }

      if (errors.length > 0) {
        logger.error('Config validation failed', { errors });
        throw new Error(`Validation failed: ${errors.join(', ')}`);
      }

      // Migrate and prepare for storage
      const toSave = migrateConfig(merged);
      
      // Encrypt sensitive values
      const sensitiveKeys = [];
      for (const [key, schema] of Object.entries(VALIDATION_SCHEMA)) {
        if (schema.sensitive && toSave[key]) {
          sensitiveKeys.push(key);
          toSave[key] = await encryptValue(toSave[key]);
        }
      }

      // Save to storage
      const result = await storageAdapter.write(toSave);
      
      if (result.success) {
        // Decrypt values back for cache
        for (const key of sensitiveKeys) {
          if (toSave[key]) {
            toSave[key] = await decryptValue(toSave[key]);
          }
        }

        // Update cache
        const oldConfig = configCache;
        configCache = toSave;
        cacheTimestamp = Date.now();

        // Notify listeners
        for (const [key, value] of Object.entries(updates)) {
          const oldValue = oldConfig ? oldConfig[key] : undefined;
          if (oldValue !== value) {
            notifyListeners(key, value, oldValue);
          }
        }

        logger.debug('Config saved successfully', { 
          keys: Object.keys(updates),
          duration: result.duration 
        });

        return true;
      } else {
        logger.error('Config save failed', result.error);
        return false;
      }
    } catch (error) {
      logger.error('Config save error', error);
      return false;
    }
  }

  // Public API
  const configManager = {
    /**
     * Get configuration value
     * @param {string} key - Configuration key
     * @param {any} [defaultValue] - Default value if key not found
     * @returns {Promise<any>} Configuration value
     */
    async get(key, defaultValue) {
      const config = await loadConfig();
      const value = config[key];
      return value !== undefined ? value : defaultValue;
    },

    /**
     * Set configuration value
     * @param {string} key - Configuration key
     * @param {any} value - Configuration value
     * @returns {Promise<boolean>} Success status
     */
    async set(key, value) {
      return saveConfig({ [key]: value });
    },

    /**
     * Get all configuration
     * @returns {Promise<ExtensionConfig>} Complete configuration
     */
    async getAll() {
      return loadConfig();
    },

    /**
     * Update multiple configuration values
     * @param {Partial<ExtensionConfig>} updates - Configuration updates
     * @returns {Promise<boolean>} Success status
     */
    async setAll(updates) {
      return saveConfig(updates);
    },

    /**
     * Add configuration change listener
     * @param {Function} callback - Change callback function
     * @returns {Function} Unsubscribe function
     */
    onChange(callback) {
      if (typeof callback === 'function') {
        changeListeners.add(callback);
        return () => changeListeners.delete(callback);
      }
      return () => {};
    },

    /**
     * Clear configuration cache
     */
    clearCache() {
      configCache = null;
      cacheTimestamp = 0;
      logger.debug('Config cache cleared');
    },

    /**
     * Validate configuration
     * @param {Object} config - Configuration to validate
     * @returns {Object} Validation result
     */
    validate(config) {
      const errors = [];
      for (const [key, value] of Object.entries(config)) {
        const validation = validateValue(key, value);
        if (!validation.valid) {
          errors.push({ key, error: validation.error });
        }
      }
      return { valid: errors.length === 0, errors };
    },

    /**
     * Get default configuration
     * @returns {ExtensionConfig} Default configuration
     */
    getDefaults() {
      return { ...DEFAULT_CONFIG };
    },

    /**
     * Check if encryption is available
     * @returns {boolean} Encryption availability
     */
    hasEncryption() {
      return encryptionAvailable;
    },

    /**
     * Get configuration manager info
     * @returns {Object} Manager information
     */
    getInfo() {
      return {
        version: '1.0.0',
        encryptionAvailable,
        storageAvailable: !!storageAdapter,
        cacheValid: isCacheValid(),
        listenersCount: changeListeners.size
      };
    }
  };

  return configManager;

}));