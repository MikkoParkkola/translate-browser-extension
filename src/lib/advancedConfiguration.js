/**
 * Advanced Configuration System
 * Provides feature flags, dynamic configuration, runtime adaptation, and environment-aware settings
 * for the browser extension translation system.
 */

(function(global) {
  'use strict';

  
  // Simple logger for advanced configuration
  const logger = {
    info: (...args) => console.log('[AdvancedConfig]', ...args),
    warn: (...args) => console.warn('[AdvancedConfig]', ...args),
    error: (...args) => console.error('[AdvancedConfig]', ...args),
    debug: (...args) => console.debug('[AdvancedConfig]', ...args)
  };
/**
   * Advanced Configuration System for dynamic feature management and runtime adaptation
   */
  class AdvancedConfiguration {
    constructor(options = {}) {
      this.options = {
        enableFeatureFlags: options.enableFeatureFlags ?? true,
        enableDynamicConfig: options.enableDynamicConfig ?? true,
        enableEnvironmentAdaptation: options.enableEnvironmentAdaptation ?? true,
        enableUserSegmentation: options.enableUserSegmentation ?? true,
        enableABTesting: options.enableABTesting ?? false, // Disabled by default for privacy
        enableRemoteConfig: options.enableRemoteConfig ?? false, // Disabled by default for security
        enableConfigValidation: options.enableConfigValidation ?? true,
        enableConfigCaching: options.enableConfigCaching ?? true,
        enableConfigVersioning: options.enableConfigVersioning ?? true,
        enableConfigAnalytics: options.enableConfigAnalytics ?? true,
        maxConfigSize: options.maxConfigSize ?? 1048576, // 1MB max config
        configRefreshInterval: options.configRefreshInterval ?? 3600000, // 1 hour
        storagePrefix: options.storagePrefix ?? 'config_',
        remoteConfigUrl: options.remoteConfigUrl ?? null,
        configSchemaUrl: options.configSchemaUrl ?? null,
        fallbackStrategy: options.fallbackStrategy ?? 'graceful', // graceful, strict, permissive
        debug: options.debug ?? false,
        ...options
      };

      // Configuration state
      this.currentConfig = new Map();
      this.defaultConfig = new Map();
      this.featureFlags = new Map();
      this.userSegments = new Map();
      this.abTests = new Map();
      this.configHistory = [];
      this.configCache = new Map();
      this.pendingUpdates = new Map();

      // Environment detection
      this.environment = this.detectEnvironment();
      this.userAgent = this.parseUserAgent();
      this.capabilities = this.detectCapabilities();

      // Configuration schema for validation
      this.configSchema = {
        translation: {
          type: 'object',
          properties: {
            defaultProvider: { type: 'string', enum: ['qwen-mt-turbo', 'qwen-mt', 'deepl-free', 'deepl-pro'] },
            maxInputLength: { type: 'number', minimum: 1000, maximum: 500000 },
            batchSize: { type: 'number', minimum: 1, maximum: 100 },
            timeout: { type: 'number', minimum: 5000, maximum: 60000 },
            retryAttempts: { type: 'number', minimum: 0, maximum: 5 },
            enableCaching: { type: 'boolean' },
            enableMemory: { type: 'boolean' }
          }
        },
        ui: {
          type: 'object',
          properties: {
            theme: { type: 'string', enum: ['light', 'dark', 'auto'] },
            language: { type: 'string' },
            compactMode: { type: 'boolean' },
            showAdvancedOptions: { type: 'boolean' },
            enableAnimations: { type: 'boolean' },
            enableNotifications: { type: 'boolean' }
          }
        },
        security: {
          type: 'object',
          properties: {
            sanitizationLevel: { type: 'string', enum: ['strict', 'moderate', 'permissive'] },
            enableXSSProtection: { type: 'boolean' },
            enableCSP: { type: 'boolean' },
            maxRequestRate: { type: 'number', minimum: 10, maximum: 1000 },
            enableLogging: { type: 'boolean' }
          }
        },
        performance: {
          type: 'object',
          properties: {
            enableMetrics: { type: 'boolean' },
            enableProfiling: { type: 'boolean' },
            maxCacheSize: { type: 'number', minimum: 100, maximum: 10000 },
            enableCompression: { type: 'boolean' },
            enableLazyLoading: { type: 'boolean' }
          }
        },
        features: {
          type: 'object',
          additionalProperties: { type: 'boolean' }
        }
      };

      // Initialize system
      this.initialize();
    }

    /**
     * Initialize configuration system
     */
    async initialize() {
      if (this.options.debug) {
        logger.info('Initializing configuration system...');
      }

      // Set up default configuration
      this.setupDefaultConfig();

      // Load persisted configuration
      await this.loadPersistedConfig();

      // Set up environment-specific configuration
      this.setupEnvironmentConfig();

      // Initialize feature flags
      this.initializeFeatureFlags();

      // Set up user segmentation
      if (this.options.enableUserSegmentation) {
        this.setupUserSegmentation();
      }

      // Set up remote configuration if enabled
      if (this.options.enableRemoteConfig && this.options.remoteConfigUrl) {
        this.setupRemoteConfig();
      }

      // Set up configuration refresh
      if (this.options.configRefreshInterval > 0) {
        this.setupConfigRefresh();
      }

      if (this.options.debug) {
        logger.info('Configuration system initialized');
      }
    }

    /**
     * Set up default configuration values
     */
    setupDefaultConfig() {
      const defaults = {
        // Translation configuration
        'translation.defaultProvider': 'qwen-mt-turbo',
        'translation.maxInputLength': 100000,
        'translation.batchSize': 10,
        'translation.timeout': 30000,
        'translation.retryAttempts': 3,
        'translation.enableCaching': true,
        'translation.enableMemory': true,

        // UI configuration
        'ui.theme': 'auto',
        'ui.language': 'en',
        'ui.compactMode': false,
        'ui.showAdvancedOptions': false,
        'ui.enableAnimations': true,
        'ui.enableNotifications': true,

        // Security configuration
        'security.sanitizationLevel': 'strict',
        'security.enableXSSProtection': true,
        'security.enableCSP': true,
        'security.maxRequestRate': 300,
        'security.enableLogging': true,

        // Performance configuration
        'performance.enableMetrics': true,
        'performance.enableProfiling': false,
        'performance.maxCacheSize': 5000,
        'performance.enableCompression': true,
        'performance.enableLazyLoading': true,

        // Feature flags
        'features.intelligentLanguageSelection': true,
        'features.adaptiveLimitDetection': true,
        'features.offlineSupport': true,
        'features.glossaryExtraction': true,
        'features.qualityVerification': true,
        'features.performanceMonitoring': true,
        'features.feedbackCollection': true,
        'features.securityEnhancements': true,
        'features.textSplitting': true,
        'features.domOptimization': true,
        'features.translationMemory': true,
        'features.contextAwareness': true,
        'features.userLearning': true,
        'features.batchTranslation': true,
        'features.realTimeTranslation': false, // Experimental
        'features.voiceTranslation': false, // Future feature
        'features.imageTranslation': false, // Future feature
        'features.documentTranslation': true,
        'features.websiteTranslation': true,
        'features.socialMediaOptimization': false, // Experimental
        'features.technicalTerminology': true,
        'features.multiModalTranslation': false, // Future feature
        'features.collaborativeTranslation': false // Future feature
      };

      for (const [key, value] of Object.entries(defaults)) {
        this.defaultConfig.set(key, value);
        this.currentConfig.set(key, value);
      }
    }

    /**
     * Load persisted configuration from storage
     */
    async loadPersistedConfig() {
      if (!this.options.enableConfigCaching) {
        return;
      }

      try {
        // Load from Chrome storage if available
        if (typeof chrome !== 'undefined' && chrome.storage) {
          const result = await chrome.storage.local.get([this.options.storagePrefix + 'config']);
          const persistedConfig = result[this.options.storagePrefix + 'config'];

          if (persistedConfig) {
            this.mergeConfig(persistedConfig);

            if (this.options.debug) {
              logger.info('Loaded persisted configuration');
            }
          }
        }
        // Load from localStorage as fallback
        else if (typeof localStorage !== 'undefined') {
          const persistedConfig = localStorage.getItem(this.options.storagePrefix + 'config');
          if (persistedConfig) {
            this.mergeConfig(JSON.parse(persistedConfig));
          }
        }
      } catch (error) {
        logger.warn('Failed to load persisted config:', error);
      }
    }

    /**
     * Set up environment-specific configuration
     */
    setupEnvironmentConfig() {
      const envConfig = {};

      // Browser-specific configuration
      if (this.userAgent.browser === 'chrome') {
        envConfig['performance.enableCompression'] = true;
        envConfig['features.domOptimization'] = true;
      } else if (this.userAgent.browser === 'safari') {
        envConfig['security.sanitizationLevel'] = 'strict';
        envConfig['features.domOptimization'] = false; // Safari has different DOM optimization needs
      } else if (this.userAgent.browser === 'firefox') {
        envConfig['performance.enableMetrics'] = true;
        envConfig['features.adaptiveLimitDetection'] = true;
      }

      // Platform-specific configuration
      if (this.userAgent.platform === 'mobile') {
        envConfig['ui.compactMode'] = true;
        envConfig['performance.maxCacheSize'] = 1000; // Smaller cache on mobile
        envConfig['translation.batchSize'] = 5; // Smaller batches on mobile
        envConfig['features.enableAnimations'] = false; // Better performance on mobile
      }

      // Memory-constrained devices
      if (this.capabilities.lowMemory) {
        envConfig['performance.maxCacheSize'] = 500;
        envConfig['translation.enableMemory'] = false;
        envConfig['features.performanceMonitoring'] = false;
      }

      // Slow network conditions
      if (this.capabilities.slowNetwork) {
        envConfig['translation.timeout'] = 60000; // Longer timeout
        envConfig['translation.retryAttempts'] = 5;
        envConfig['features.offlineSupport'] = true;
      }

      // Apply environment configuration
      this.mergeConfig(envConfig);

      if (this.options.debug) {
        logger.info('Applied environment configuration:', envConfig);
      }
    }

    /**
     * Initialize feature flags
     */
    initializeFeatureFlags() {
      // Extract feature flags from current configuration
      for (const [key, value] of this.currentConfig.entries()) {
        if (key.startsWith('features.')) {
          const featureName = key.substring(9); // Remove 'features.' prefix
          this.featureFlags.set(featureName, {
            enabled: value,
            rolloutPercentage: 100,
            userSegments: ['all'],
            requirements: [],
            metadata: {}
          });
        }
      }

      if (this.options.debug) {
        logger.info('Initialized feature flags:', this.featureFlags.size);
      }
    }

    /**
     * Set up user segmentation
     */
    setupUserSegmentation() {
      // Define user segments based on various criteria
      const segments = {
        powerUser: {
          criteria: {
            dailyUsage: { min: 100 }, // More than 100 translations per day
            features: ['glossaryExtraction', 'qualityVerification'],
            experience: { min: 30 } // More than 30 days of usage
          },
          config: {
            'ui.showAdvancedOptions': true,
            'features.technicalTerminology': true,
            'performance.enableProfiling': true
          }
        },
        casualUser: {
          criteria: {
            dailyUsage: { max: 10 }, // Less than 10 translations per day
            experience: { max: 7 } // Less than 7 days of usage
          },
          config: {
            'ui.compactMode': true,
            'ui.showAdvancedOptions': false,
            'features.contextAwareness': false
          }
        },
        mobileUser: {
          criteria: {
            platform: 'mobile'
          },
          config: {
            'ui.compactMode': true,
            'performance.maxCacheSize': 1000,
            'translation.batchSize': 5
          }
        },
        securityConscious: {
          criteria: {
            preferences: ['privacy', 'security']
          },
          config: {
            'security.sanitizationLevel': 'strict',
            'security.enableXSSProtection': true,
            'features.securityEnhancements': true
          }
        }
      };

      for (const [segmentName, segment] of Object.entries(segments)) {
        this.userSegments.set(segmentName, segment);
      }

      // Apply user segment configuration
      this.applyUserSegmentConfig();
    }

    /**
     * Apply configuration for matching user segments
     */
    applyUserSegmentConfig() {
      const userProfile = this.getUserProfile();

      for (const [segmentName, segment] of this.userSegments.entries()) {
        if (this.matchesUserSegment(userProfile, segment.criteria)) {
          this.mergeConfig(segment.config);

          if (this.options.debug) {
            logger.info(`Applied ${segmentName} segment configuration`);
          }
        }
      }
    }

    /**
     * Check if user profile matches segment criteria
     */
    matchesUserSegment(userProfile, criteria) {
      for (const [key, condition] of Object.entries(criteria)) {
        const userValue = userProfile[key];

        if (typeof condition === 'object') {
          if (condition.min !== undefined && userValue < condition.min) return false;
          if (condition.max !== undefined && userValue > condition.max) return false;
        } else if (Array.isArray(condition)) {
          if (!condition.some(value => userProfile[key]?.includes?.(value))) return false;
        } else {
          if (userValue !== condition) return false;
        }
      }

      return true;
    }

    /**
     * Get user profile for segmentation
     */
    getUserProfile() {
      // In a real implementation, this would load from user data
      return {
        dailyUsage: 25, // Example value
        experience: 15, // Days since first use
        features: ['glossaryExtraction', 'qualityVerification'],
        platform: this.userAgent.platform,
        preferences: ['security']
      };
    }

    /**
     * Set up remote configuration
     */
    setupRemoteConfig() {
      if (!this.options.remoteConfigUrl) {
        return;
      }

      // Fetch remote configuration periodically
      this.fetchRemoteConfig();
    }

    /**
     * Fetch configuration from remote source
     */
    async fetchRemoteConfig() {
      try {
        const response = await fetch(this.options.remoteConfigUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const remoteConfig = await response.json();

        // Validate remote configuration
        if (this.options.enableConfigValidation) {
          const validation = this.validateConfig(remoteConfig);
          if (!validation.valid) {
            throw new Error(`Invalid remote config: ${validation.errors.join(', ')}`);
          }
        }

        // Merge remote configuration
        this.mergeConfig(remoteConfig);

        if (this.options.debug) {
          logger.info('Applied remote configuration');
        }

      } catch (error) {
        logger.warn('Failed to fetch remote config:', error);
      }
    }

    /**
     * Set up periodic configuration refresh
     */
    setupConfigRefresh() {
      setInterval(() => {
        this.refreshConfiguration();
      }, this.options.configRefreshInterval);
    }

    /**
     * Refresh configuration from all sources
     */
    async refreshConfiguration() {
      if (this.options.enableRemoteConfig) {
        await this.fetchRemoteConfig();
      }

      // Re-apply user segmentation
      if (this.options.enableUserSegmentation) {
        this.applyUserSegmentConfig();
      }

      // Persist updated configuration
      await this.persistConfig();
    }

    /**
     * Get configuration value with optional fallback
     */
    get(key, fallback = undefined) {
      const value = this.currentConfig.get(key);

      if (value === undefined) {
        const defaultValue = this.defaultConfig.get(key);
        return defaultValue !== undefined ? defaultValue : fallback;
      }

      return value;
    }

    /**
     * Set configuration value
     */
    set(key, value, options = {}) {
      const oldValue = this.currentConfig.get(key);

      // Validate value if schema exists
      if (this.options.enableConfigValidation) {
        const validation = this.validateConfigValue(key, value);
        if (!validation.valid) {
          throw new Error(`Invalid config value for ${key}: ${validation.error}`);
        }
      }

      this.currentConfig.set(key, value);

      // Record change in history
      if (this.options.enableConfigVersioning) {
        this.configHistory.push({
          timestamp: Date.now(),
          key,
          oldValue,
          newValue: value,
          source: options.source || 'manual'
        });

        // Keep history size manageable
        if (this.configHistory.length > 1000) {
          this.configHistory = this.configHistory.slice(-500);
        }
      }

      // Persist if requested
      if (options.persist !== false) {
        this.persistConfig();
      }

      if (this.options.debug) {
        logger.info(`Set ${key} = ${value}`);
      }
    }

    /**
     * Check if feature is enabled
     */
    isFeatureEnabled(featureName) {
      const flag = this.featureFlags.get(featureName);
      if (!flag) {
        // Check direct configuration
        return this.get(`features.${featureName}`, false);
      }

      // Check if feature is rolled out to user
      if (flag.rolloutPercentage < 100) {
        const userId = this.getUserId();
        const hash = this.hashUserId(userId + featureName);
        const userPercentile = hash % 100;

        if (userPercentile >= flag.rolloutPercentage) {
          return false;
        }
      }

      // Check user segment requirements
      if (flag.userSegments && !flag.userSegments.includes('all')) {
        const userProfile = this.getUserProfile();
        const matchesSegment = flag.userSegments.some(segment =>
          this.matchesUserSegment(userProfile, this.userSegments.get(segment)?.criteria || {})
        );

        if (!matchesSegment) {
          return false;
        }
      }

      // Check requirements
      if (flag.requirements && flag.requirements.length > 0) {
        const requirementsMet = flag.requirements.every(requirement =>
          this.checkRequirement(requirement)
        );

        if (!requirementsMet) {
          return false;
        }
      }

      return flag.enabled;
    }

    /**
     * Enable feature flag
     */
    enableFeature(featureName, options = {}) {
      const flag = this.featureFlags.get(featureName) || {
        enabled: false,
        rolloutPercentage: 100,
        userSegments: ['all'],
        requirements: [],
        metadata: {}
      };

      flag.enabled = true;

      if (options.rolloutPercentage !== undefined) {
        flag.rolloutPercentage = options.rolloutPercentage;
      }

      if (options.userSegments) {
        flag.userSegments = options.userSegments;
      }

      if (options.requirements) {
        flag.requirements = options.requirements;
      }

      this.featureFlags.set(featureName, flag);
      this.set(`features.${featureName}`, true, { source: 'feature_flag' });
    }

    /**
     * Disable feature flag
     */
    disableFeature(featureName) {
      const flag = this.featureFlags.get(featureName);
      if (flag) {
        flag.enabled = false;
        this.featureFlags.set(featureName, flag);
      }

      this.set(`features.${featureName}`, false, { source: 'feature_flag' });
    }

    /**
     * Merge configuration object into current config
     */
    mergeConfig(configObject, options = {}) {
      for (const [key, value] of Object.entries(configObject)) {
        this.set(key, value, { ...options, persist: false });
      }

      // Persist after merging all values
      if (options.persist !== false) {
        this.persistConfig();
      }
    }

    /**
     * Validate configuration against schema
     */
    validateConfig(config) {
      const errors = [];

      try {
        for (const [key, value] of Object.entries(config)) {
          const validation = this.validateConfigValue(key, value);
          if (!validation.valid) {
            errors.push(`${key}: ${validation.error}`);
          }
        }

        return {
          valid: errors.length === 0,
          errors
        };

      } catch (error) {
        return {
          valid: false,
          errors: [error.message]
        };
      }
    }

    /**
     * Validate individual configuration value
     */
    validateConfigValue(key, value) {
      try {
        const parts = key.split('.');
        const section = parts[0];
        const property = parts[1];

        const sectionSchema = this.configSchema[section];
        if (!sectionSchema) {
          return { valid: true }; // Allow unknown sections for extensibility
        }

        const propertySchema = sectionSchema.properties?.[property];
        if (!propertySchema) {
          return { valid: true }; // Allow unknown properties for extensibility
        }

        // Type validation
        if (propertySchema.type) {
          const actualType = Array.isArray(value) ? 'array' : typeof value;
          if (actualType !== propertySchema.type) {
            return {
              valid: false,
              error: `Expected ${propertySchema.type}, got ${actualType}`
            };
          }
        }

        // Enum validation
        if (propertySchema.enum && !propertySchema.enum.includes(value)) {
          return {
            valid: false,
            error: `Value must be one of: ${propertySchema.enum.join(', ')}`
          };
        }

        // Number range validation
        if (propertySchema.type === 'number') {
          if (propertySchema.minimum !== undefined && value < propertySchema.minimum) {
            return {
              valid: false,
              error: `Value must be >= ${propertySchema.minimum}`
            };
          }

          if (propertySchema.maximum !== undefined && value > propertySchema.maximum) {
            return {
              valid: false,
              error: `Value must be <= ${propertySchema.maximum}`
            };
          }
        }

        return { valid: true };

      } catch (error) {
        return {
          valid: false,
          error: error.message
        };
      }
    }

    /**
     * Persist configuration to storage
     */
    async persistConfig() {
      if (!this.options.enableConfigCaching) {
        return;
      }

      try {
        const configObject = Object.fromEntries(this.currentConfig.entries());

        // Save to Chrome storage if available
        if (typeof chrome !== 'undefined' && chrome.storage) {
          await chrome.storage.local.set({
            [this.options.storagePrefix + 'config']: configObject
          });
        }
        // Save to localStorage as fallback
        else if (typeof localStorage !== 'undefined') {
          localStorage.setItem(
            this.options.storagePrefix + 'config',
            JSON.stringify(configObject)
          );
        }

        if (this.options.debug) {
          logger.info('Configuration persisted');
        }

      } catch (error) {
        logger.warn('Failed to persist config:', error);
      }
    }

    /**
     * Detect environment information
     */
    detectEnvironment() {
      const env = {
        browser: 'unknown',
        version: 'unknown',
        platform: 'unknown',
        isExtension: typeof chrome !== 'undefined' && chrome.runtime,
        isWebWorker: typeof importScripts !== 'undefined',
        hasLocalStorage: typeof localStorage !== 'undefined',
        hasIndexedDB: typeof indexedDB !== 'undefined'
      };

      // Detect browser
      if (typeof navigator !== 'undefined') {
        const userAgent = navigator.userAgent.toLowerCase();

        if (userAgent.includes('chrome')) {
          env.browser = 'chrome';
        } else if (userAgent.includes('firefox')) {
          env.browser = 'firefox';
        } else if (userAgent.includes('safari')) {
          env.browser = 'safari';
        } else if (userAgent.includes('edge')) {
          env.browser = 'edge';
        }

        // Detect platform
        if (userAgent.includes('mobile') || userAgent.includes('android') || userAgent.includes('iphone')) {
          env.platform = 'mobile';
        } else if (userAgent.includes('tablet') || userAgent.includes('ipad')) {
          env.platform = 'tablet';
        } else {
          env.platform = 'desktop';
        }
      }

      return env;
    }

    /**
     * Parse user agent information
     */
    parseUserAgent() {
      if (typeof navigator === 'undefined') {
        return { browser: 'unknown', platform: 'unknown', version: 'unknown' };
      }

      const userAgent = navigator.userAgent;
      const platform = this.environment.platform;

      return {
        browser: this.environment.browser,
        platform,
        version: 'unknown', // Could be parsed more precisely
        userAgent
      };
    }

    /**
     * Detect device capabilities
     */
    detectCapabilities() {
      const capabilities = {
        lowMemory: false,
        slowNetwork: false,
        touchInput: false,
        highDPI: false
      };

      // Memory detection
      if (typeof navigator !== 'undefined' && navigator.deviceMemory) {
        capabilities.lowMemory = navigator.deviceMemory <= 2; // 2GB or less
      }

      // Network detection
      if (typeof navigator !== 'undefined' && navigator.connection) {
        const effectiveType = navigator.connection.effectiveType;
        capabilities.slowNetwork = effectiveType === 'slow-2g' || effectiveType === '2g';
      }

      // Touch input detection
      if (typeof window !== 'undefined') {
        capabilities.touchInput = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      }

      // High DPI detection
      if (typeof window !== 'undefined' && window.devicePixelRatio) {
        capabilities.highDPI = window.devicePixelRatio > 1.5;
      }

      return capabilities;
    }

    /**
     * Get user ID for feature rollout calculations
     */
    getUserId() {
      // In a real implementation, this would return a stable user identifier
      return 'default_user';
    }

    /**
     * Hash user ID for consistent feature rollout
     */
    hashUserId(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return Math.abs(hash);
    }

    /**
     * Check if requirement is met
     */
    checkRequirement(requirement) {
      // Requirements could be feature flags, capabilities, etc.
      if (requirement.startsWith('feature:')) {
        const featureName = requirement.substring(8);
        return this.isFeatureEnabled(featureName);
      }

      if (requirement.startsWith('capability:')) {
        const capability = requirement.substring(11);
        return this.capabilities[capability] === true;
      }

      return true; // Unknown requirements default to true
    }

    /**
     * Get configuration status and statistics
     */
    getStatus() {
      return {
        totalConfig: this.currentConfig.size,
        defaultConfig: this.defaultConfig.size,
        featureFlags: this.featureFlags.size,
        userSegments: this.userSegments.size,
        configHistory: this.configHistory.length,
        environment: this.environment,
        capabilities: this.capabilities,
        enabledFeatures: Array.from(this.featureFlags.entries())
          .filter(([_, flag]) => flag.enabled)
          .map(([name, _]) => name),
        configuration: {
          enableFeatureFlags: this.options.enableFeatureFlags,
          enableDynamicConfig: this.options.enableDynamicConfig,
          enableUserSegmentation: this.options.enableUserSegmentation,
          enableRemoteConfig: this.options.enableRemoteConfig
        }
      };
    }

    /**
     * Reset configuration to defaults
     */
    resetToDefaults() {
      this.currentConfig.clear();

      for (const [key, value] of this.defaultConfig.entries()) {
        this.currentConfig.set(key, value);
      }

      this.persistConfig();

      if (this.options.debug) {
        logger.info('Configuration reset to defaults');
      }
    }

    /**
     * Export configuration
     */
    exportConfig() {
      return {
        timestamp: Date.now(),
        version: '1.0.0',
        environment: this.environment,
        config: Object.fromEntries(this.currentConfig.entries()),
        featureFlags: Object.fromEntries(this.featureFlags.entries()),
        history: this.configHistory.slice(-100) // Last 100 changes
      };
    }

    /**
     * Import configuration
     */
    importConfig(configData) {
      if (configData.config) {
        this.mergeConfig(configData.config, { source: 'import' });
      }

      if (configData.featureFlags) {
        for (const [name, flag] of Object.entries(configData.featureFlags)) {
          this.featureFlags.set(name, flag);
        }
      }

      if (this.options.debug) {
        logger.info('Configuration imported');
      }
    }

    /**
     * Clean up configuration system
     */
    cleanup() {
      this.currentConfig.clear();
      this.featureFlags.clear();
      this.userSegments.clear();
      this.configHistory.length = 0;
      this.configCache.clear();
      this.pendingUpdates.clear();

      if (this.options.debug) {
        logger.info('Configuration system cleaned up');
      }
    }
  }

  // Export for different environments
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdvancedConfiguration;
  } else if (typeof define === 'function' && define.amd) {
    define([], () => AdvancedConfiguration);
  } else {
    global.AdvancedConfiguration = AdvancedConfiguration;
  }

})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);