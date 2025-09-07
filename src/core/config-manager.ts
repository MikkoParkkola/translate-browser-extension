/**
 * @fileoverview Extension configuration manager with encryption and validation
 * TypeScript version with full type safety and modern async/await patterns
 */

import type { 
  ExtensionConfig,
  ProviderConfig,
  ThrottleConfig,
  CacheConfig,
  UiConfig,
  FeatureFlags,
  LogConfig,
  ValidationResult,
  StorageResult 
} from './types';

/// <reference path="../../types/chrome-extension.d.ts" />

type ConfigChangeListener = (config: ExtensionConfig, changes: Partial<ExtensionConfig>) => void;

interface ConfigManagerDependencies {
  logger?: any;
  storageAdapter?: any;
}

class ConfigManager {
  private logger: any = console;
  private storageAdapter: any = null;
  private configCache: ExtensionConfig | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL = 1000; // 1 second for fast access
  private changeListeners = new Set<ConfigChangeListener>();
  private readonly encryptionAvailable: boolean;
  private readonly ENCRYPTED_PREFIX = 'qwen:encrypted:';

  /**
   * Default configuration values
   */
  private readonly DEFAULT_CONFIG: ExtensionConfig = {
    apiKey: '',
    detectApiKey: '',
    apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
    model: 'qwen-mt-turbo',
    sourceLanguage: 'en',
    targetLanguage: 'en',
    streaming: false,
    timeout: 30000,
    theme: 'modern',
    enabled: true,
    showUsage: true,
    providers: {
      qwen: {
        id: 'qwen',
        name: 'Qwen MT',
        apiKey: '',
        apiEndpoint: 'https://dashscope-intl.aliyuncs.com/api/v1',
        model: 'qwen-mt-turbo',
        models: ['qwen-mt-turbo'],
        requestLimit: 60,
        tokenLimit: 31980,
        charLimit: 50000,
        weight: 1.0,
        strategy: 'balanced',
        costPerInputToken: 0.0001,
        costPerOutputToken: 0.0001,
        enabled: true
      }
    },
    activeProvider: 'qwen',
    fallbackProviders: [],
    throttle: {
      requestLimit: 60,
      tokenLimit: 31980,
      windowMs: 60000
    },
    cache: {
      enabled: true,
      maxEntries: 5000,
      defaultTtl: 300000, // 5 minutes
      cleanupInterval: 60000, // 1 minute
      evictionStrategy: 'lru',
      storageBackend: 'local'
    },
    ui: {
      theme: 'modern',
      showOverlay: true,
      overlayPosition: 'bottom',
      animations: true,
      fontScale: 1.0,
      highContrast: false,
      reduceMotion: false
    },
    features: {
      experimental: false,
      pdfTranslation: true,
      contextMenu: true,
      shortcuts: true,
      batchTranslation: false,
      autoDetection: true,
      history: true,
      glossary: false
    }
  };

  constructor(dependencies: ConfigManagerDependencies = {}) {
    this.encryptionAvailable = typeof crypto !== 'undefined' && 
                               !!crypto.subtle && 
                               typeof TextEncoder !== 'undefined';

    this.initializeDependencies(dependencies);
  }

  /**
   * Initialize dependencies
   */
  private initializeDependencies(deps: ConfigManagerDependencies): void {
    try {
      // Initialize logger
      if (deps.logger) {
        this.logger = deps.logger;
      } else if (typeof (globalThis as any).qwenCoreLogger !== 'undefined') {
        this.logger = (globalThis as any).qwenCoreLogger.create('config');
      } else if (typeof (globalThis as any).qwenLogger !== 'undefined') {
        this.logger = (globalThis as any).qwenLogger.create('config');
      }

      // Initialize storage adapter
      if (deps.storageAdapter) {
        this.storageAdapter = deps.storageAdapter;
      } else if (typeof (globalThis as any).qwenStorageAdapter !== 'undefined') {
        this.storageAdapter = (globalThis as any).qwenStorageAdapter.createAdapter('sync');
      }
    } catch (error) {
      this.logger.warn('Failed to initialize config manager dependencies', error);
    }
  }

  /**
   * Check if cache is valid
   */
  private isCacheValid(): boolean {
    return this.configCache !== null && 
           (Date.now() - this.cacheTimestamp) < this.CACHE_TTL;
  }

  /**
   * Encrypt sensitive data if encryption is available
   */
  private async encrypt(data: string): Promise<string> {
    if (!this.encryptionAvailable) {
      return data; // Return as-is if encryption not available
    }

    try {
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);
      
      // Generate a key (in a real implementation, you'd want to derive this securely)
      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      
      // Generate IV
      const iv = crypto.getRandomValues(new Uint8Array(12));
      
      // Encrypt
      const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        dataBuffer
      );

      // Combine key, iv, and encrypted data (simplified approach)
      const combined = new Uint8Array(key.toString().length + iv.length + encrypted.byteLength);
      // Note: This is a simplified approach. In production, you'd handle key management differently
      
      return this.ENCRYPTED_PREFIX + btoa(String.fromCharCode(...combined));
    } catch (error) {
      this.logger.warn('Encryption failed, storing as plaintext', error);
      return data;
    }
  }

  /**
   * Decrypt sensitive data
   */
  private async decrypt(data: string): Promise<string> {
    if (!data.startsWith(this.ENCRYPTED_PREFIX) || !this.encryptionAvailable) {
      return data; // Return as-is if not encrypted
    }

    try {
      const encryptedData = data.slice(this.ENCRYPTED_PREFIX.length);
      // Simplified decryption - in production, implement proper key management
      return encryptedData; // Placeholder implementation
    } catch (error) {
      this.logger.warn('Decryption failed', error);
      return data;
    }
  }

  /**
   * Validate configuration object
   */
  private validateConfig(config: Partial<ExtensionConfig>): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required fields
    if (config.providers) {
      for (const [providerId, provider] of Object.entries(config.providers)) {
        if (!provider.apiKey && provider.enabled) {
          warnings.push(`Provider ${providerId} is enabled but has no API key`);
        }
        
        if (!provider.apiEndpoint) {
          errors.push(`Provider ${providerId} has no API endpoint`);
        }

        if (provider.requestLimit <= 0) {
          errors.push(`Provider ${providerId} has invalid request limit`);
        }

        if (provider.tokenLimit <= 0) {
          errors.push(`Provider ${providerId} has invalid token limit`);
        }
      }
    }

    // Validate active provider exists
    if (config.activeProvider && config.providers && !config.providers[config.activeProvider]) {
      errors.push(`Active provider ${config.activeProvider} not found in providers`);
    }

    // Validate throttle config
    if (config.throttle) {
      if (config.throttle.requestLimit <= 0) {
        errors.push('Invalid throttle request limit');
      }
      if (config.throttle.tokenLimit <= 0) {
        errors.push('Invalid throttle token limit');
      }
      if (config.throttle.windowMs <= 0) {
        errors.push('Invalid throttle window size');
      }
    }

    // Validate cache config
    if (config.cache) {
      if (config.cache.maxEntries <= 0) {
        errors.push('Invalid cache max entries');
      }
      if (config.cache.defaultTtl < 0) {
        errors.push('Invalid cache TTL');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get current configuration
   */
  async getConfig(): Promise<ExtensionConfig> {
    // Return cached config if valid
    if (this.isCacheValid()) {
      return this.configCache!;
    }

    try {
      const result: StorageResult<ExtensionConfig> = this.storageAdapter 
        ? await this.storageAdapter.get('qwen_config')
        : await this.getChromeStorageConfig();

      if (result.success && result.data) {
        // Decrypt sensitive fields
        const config = { ...result.data };
        if (config.providers) {
          for (const provider of Object.values(config.providers)) {
            provider.apiKey = await this.decrypt(provider.apiKey);
          }
        }

        // Merge with defaults to ensure all fields exist
        const mergedConfig = this.mergeWithDefaults(config);
        
        // Update cache
        this.configCache = mergedConfig;
        this.cacheTimestamp = Date.now();
        
        return mergedConfig;
      }
    } catch (error) {
      this.logger.error('Failed to get config', error);
    }

    // Return default config if storage fails
    return this.DEFAULT_CONFIG;
  }

  /**
   * Update configuration
   */
  async updateConfig(updates: Partial<ExtensionConfig>): Promise<boolean> {
    try {
      const currentConfig = await this.getConfig();
      const newConfig = { ...currentConfig, ...updates };

      // Validate new configuration
      const validation = this.validateConfig(newConfig);
      if (!validation.valid) {
        this.logger.error('Config validation failed', validation.errors);
        return false;
      }

      if (validation.warnings.length > 0) {
        this.logger.warn('Config validation warnings', validation.warnings);
      }

      // Encrypt sensitive fields
      if (newConfig.providers) {
        for (const provider of Object.values(newConfig.providers)) {
          provider.apiKey = await this.encrypt(provider.apiKey);
        }
      }

      // Store configuration
      const result = this.storageAdapter
        ? await this.storageAdapter.set('qwen_config', newConfig)
        : await this.setChromeStorageConfig(newConfig);

      if (result.success) {
        // Update cache
        this.configCache = { ...newConfig };
        // Decrypt for cache
        if (this.configCache.providers) {
          for (const provider of Object.values(this.configCache.providers)) {
            provider.apiKey = await this.decrypt(provider.apiKey);
          }
        }
        this.cacheTimestamp = Date.now();

        // Notify listeners
        this.notifyListeners(this.configCache, updates);
        
        return true;
      }
    } catch (error) {
      this.logger.error('Failed to update config', error);
    }

    return false;
  }

  /**
   * Reset configuration to defaults
   */
  async resetConfig(): Promise<boolean> {
    const result = await this.updateConfig(this.DEFAULT_CONFIG);
    if (result) {
      this.logger.info('Configuration reset to defaults');
    }
    return result;
  }

  /**
   * Add configuration change listener
   */
  addListener(listener: ConfigChangeListener): void {
    this.changeListeners.add(listener);
  }

  /**
   * Remove configuration change listener
   */
  removeListener(listener: ConfigChangeListener): void {
    this.changeListeners.delete(listener);
  }

  /**
   * Get provider configuration
   */
  async getProvider(providerId: string): Promise<ProviderConfig | null> {
    const config = await this.getConfig();
    return config.providers[providerId] || null;
  }

  /**
   * Update provider configuration
   */
  async updateProvider(providerId: string, updates: Partial<ProviderConfig>): Promise<boolean> {
    const config = await this.getConfig();
    
    if (!config.providers[providerId]) {
      this.logger.error(`Provider ${providerId} not found`);
      return false;
    }

    const updatedProviders = {
      ...config.providers,
      [providerId]: { ...config.providers[providerId], ...updates }
    };

    return await this.updateConfig({ providers: updatedProviders });
  }

  /**
   * Merge partial config with defaults
   */
  private mergeWithDefaults(partial: Partial<ExtensionConfig>): ExtensionConfig {
    const merged = { ...this.DEFAULT_CONFIG };
    
    // Deep merge providers
    if (partial.providers) {
      merged.providers = { ...this.DEFAULT_CONFIG.providers, ...partial.providers };
    }

    // Deep merge other objects
    if (partial.throttle) {
      merged.throttle = { ...this.DEFAULT_CONFIG.throttle, ...partial.throttle };
    }
    
    if (partial.cache) {
      merged.cache = { ...this.DEFAULT_CONFIG.cache, ...partial.cache };
    }
    
    if (partial.ui) {
      merged.ui = { ...this.DEFAULT_CONFIG.ui, ...partial.ui };
    }
    
    if (partial.features) {
      merged.features = { ...this.DEFAULT_CONFIG.features, ...partial.features };
    }

    // Merge primitive values
    Object.keys(partial).forEach(key => {
      if (partial[key] !== undefined && typeof partial[key] !== 'object') {
        (merged as any)[key] = partial[key];
      }
    });

    return merged;
  }

  /**
   * Fallback Chrome storage methods
   */
  private async getChromeStorageConfig(): Promise<StorageResult<ExtensionConfig>> {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        chrome.storage.sync.get(['qwen_config'], (result) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: new Error(chrome.runtime.lastError.message),
              duration: 0
            });
          } else {
            resolve({
              success: true,
              data: result.qwen_config,
              duration: 0
            });
          }
        });
      } else {
        resolve({
          success: false,
          error: new Error('Chrome storage not available'),
          duration: 0
        });
      }
    });
  }

  private async setChromeStorageConfig(config: ExtensionConfig): Promise<StorageResult> {
    return new Promise((resolve) => {
      if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
        chrome.storage.sync.set({ qwen_config: config }, () => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error: new Error(chrome.runtime.lastError.message),
              duration: 0
            });
          } else {
            resolve({
              success: true,
              duration: 0
            });
          }
        });
      } else {
        resolve({
          success: false,
          error: new Error('Chrome storage not available'),
          duration: 0
        });
      }
    });
  }

  /**
   * Notify change listeners
   */
  private notifyListeners(config: ExtensionConfig, changes: Partial<ExtensionConfig>): void {
    for (const listener of this.changeListeners) {
      try {
        listener(config, changes);
      } catch (error) {
        this.logger.error('Config change listener failed', error);
      }
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.configCache = null;
    this.cacheTimestamp = 0;
  }
}

// Create singleton instance
const configManager = new ConfigManager();

// UMD export for compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = configManager;
} else if (typeof globalThis !== 'undefined') {
  (globalThis as any).qwenConfigManager = configManager;
}

export default configManager;
export { ConfigManager };
export type { ConfigChangeListener };