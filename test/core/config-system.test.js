/**
 * @fileoverview Comprehensive test suite for modernized configuration system
 * Tests ConfigManager, ConfigService, and provider configurations
 */

// Mock dependencies
global.chrome = {
  storage: {
    sync: {
      get: jest.fn(),
      set: jest.fn()
    }
  },
  runtime: {
    lastError: null
  }
};

describe('Modern Configuration System', () => {
  let ConfigManager, configManager, CONFIG_SCHEMA;
  let ConfigService, configService;
  let ProviderConfigs;

  beforeAll(() => {
    // Load configuration modules
    const configManagerModule = require('../../src/core/config-manager');
    ConfigManager = configManagerModule.ConfigManager;
    configManager = configManagerModule.configManager;
    CONFIG_SCHEMA = configManagerModule.CONFIG_SCHEMA;

    const configServiceModule = require('../../src/core/config-service');
    ConfigService = configServiceModule.ConfigService;
    configService = configServiceModule.configService;

    ProviderConfigs = require('../../src/core/provider-configs');

    // Mock environment
    global.self = {
      qwenConfigManager: { ConfigManager, configManager },
      qwenProviderConfigs: ProviderConfigs
    };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    chrome.runtime.lastError = null;
  });

  describe('ConfigManager', () => {
    test('GOLDEN: creates valid default configuration', () => {
      const defaultConfig = configManager.createDefault();
      
      expect(defaultConfig).toHaveProperty('core');
      expect(defaultConfig).toHaveProperty('translation');
      expect(defaultConfig).toHaveProperty('performance');
      expect(defaultConfig).toHaveProperty('interface');
      expect(defaultConfig).toHaveProperty('providers');
      expect(defaultConfig).toHaveProperty('routing');
      expect(defaultConfig).toHaveProperty('memory');
      
      expect(defaultConfig.core.sourceLanguage).toBe('en');
      expect(defaultConfig.translation.translateTimeoutMs).toBe(20000);
      expect(defaultConfig.performance.memCacheMax).toBe(5000);
      expect(defaultConfig.providers).toEqual({});
    });

    test('GOLDEN: validates configuration sections correctly', () => {
      const testConfig = {
        core: {
          sourceLanguage: 'en',
          targetLanguage: 'es',
          debug: true
        },
        translation: {
          translateTimeoutMs: 15000,
          strategy: 'quality'
        }
      };

      const validated = configManager.validate(testConfig);
      
      expect(validated.core.sourceLanguage).toBe('en');
      expect(validated.core.targetLanguage).toBe('es');
      expect(validated.core.debug).toBe(true);
      expect(validated.translation.translateTimeoutMs).toBe(15000);
      expect(validated.translation.strategy).toBe('quality');
    });

    test('validates provider configuration with required fields', () => {
      const providerConfig = {
        apiKey: 'test-key-123',
        model: 'gpt-3.5-turbo',
        requestLimit: 100
      };

      const validated = configManager.validateProvider('openai', providerConfig);
      
      expect(validated.apiKey).toBe('test-key-123');
      expect(validated.model).toBe('gpt-3.5-turbo');
      expect(validated.requestLimit).toBe(100);
      expect(validated.tokenLimit).toBeDefined(); // Should get default
    });

    test('handles validation errors gracefully', () => {
      const invalidConfig = {
        core: {
          sourceLanguage: 123, // Invalid type
          theme: 'invalid-theme' // Invalid enum value
        },
        translation: {
          translateTimeoutMs: -1000 // Below minimum
        }
      };

      const validated = configManager.validate(invalidConfig);
      
      // Should fallback to defaults for invalid values
      expect(validated.core.sourceLanguage).toBe('en');
      expect(validated.core.theme).toBe('dark');
      expect(validated.translation.translateTimeoutMs).toBe(20000);
    });

    test('flattens and unflattens configuration correctly', () => {
      const structuredConfig = {
        core: { sourceLanguage: 'en', debug: true },
        translation: { strategy: 'fast' },
        providers: { qwen: { apiKey: 'test' } }
      };

      const flattened = configManager.flatten(structuredConfig);
      expect(flattened.sourceLanguage).toBe('en');
      expect(flattened.debug).toBe(true);
      expect(flattened.strategy).toBe('fast');
      expect(flattened.providers.qwen.apiKey).toBe('test');

      const unflattened = configManager.unflatten(flattened);
      expect(unflattened.core.sourceLanguage).toBe('en');
      expect(unflattened.core.debug).toBe(true);
      expect(unflattened.translation.strategy).toBe('fast');
      expect(unflattened.providers.qwen.apiKey).toBe('test');
    });

    test('GOLDEN: migrates legacy configuration format', () => {
      const legacyConfig = {
        apiKey: 'legacy-key',
        apiEndpoint: 'https://api.example.com',
        model: 'legacy-model',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        autoTranslate: true,
        debug: false,
        providers: {
          qwen: { apiKey: 'qwen-key' }
        }
      };

      const migrated = configManager.migrate(legacyConfig);
      
      expect(migrated.core.sourceLanguage).toBe('en');
      expect(migrated.core.targetLanguage).toBe('es');
      expect(migrated.core.autoTranslate).toBe(true);
      expect(migrated.core.debug).toBe(false);
      expect(migrated.providers.qwen.apiKey).toBe('qwen-key');
      expect(migrated.migration.version).toBe('2.0.0');
      expect(migrated.migration.fromLegacy).toBe(true);
    });

    test('caches configuration with expiration', () => {
      const testConfig = { core: { debug: true } };
      
      configManager.setCache(testConfig, 'test-context');
      
      const cached = configManager.getCache('test-context');
      expect(cached).toEqual(testConfig);
      
      // Test expiration
      const expired = configManager.getCache('test-context', 0); // maxAge = 0
      expect(expired).toBeNull();
    });
  });

  describe('ProviderConfigs', () => {
    test('GOLDEN: provides correct Qwen configuration', () => {
      const qwenConfig = ProviderConfigs.getProviderConfig('qwen');
      
      expect(qwenConfig.name).toBe('qwen');
      expect(qwenConfig.label).toBe('Alibaba Qwen MT');
      expect(qwenConfig.defaults.apiEndpoint).toContain('dashscope');
      expect(qwenConfig.defaults.model).toBe('qwen-mt-turbo');
      expect(qwenConfig.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'qwen-mt-turbo' }),
          expect.objectContaining({ id: 'qwen-mt-plus' })
        ])
      );
    });

    test('GOLDEN: provides correct OpenAI configuration', () => {
      const openaiConfig = ProviderConfigs.getProviderConfig('openai');
      
      expect(openaiConfig.name).toBe('openai');
      expect(openaiConfig.label).toBe('OpenAI GPT');
      expect(openaiConfig.defaults.apiEndpoint).toBe('https://api.openai.com/v1');
      expect(openaiConfig.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'gpt-3.5-turbo' }),
          expect.objectContaining({ id: 'gpt-4' })
        ])
      );
    });

    test('validates provider-specific fields', () => {
      // Valid OpenAI API key (needs to be at least 20 chars)
      expect(ProviderConfigs.validateProviderField('openai', 'apiKey', 'sk-test123456789abcdef')).toBe(true);
      
      // Invalid OpenAI API key format
      expect(ProviderConfigs.validateProviderField('openai', 'apiKey', 'invalid-key')).toBe(false);
      
      // Valid Anthropic API key (needs to be at least 50 chars)
      expect(ProviderConfigs.validateProviderField('anthropic', 'apiKey', 'sk-ant-test123456789abcdef123456789abcdef123456789abc')).toBe(true);
    });

    test('returns providers by strategy', () => {
      const cheapProviders = ProviderConfigs.getProvidersByStrategy('cheap');
      const qualityProviders = ProviderConfigs.getProvidersByStrategy('quality');
      const fastProviders = ProviderConfigs.getProvidersByStrategy('fast');
      
      expect(Array.isArray(cheapProviders)).toBe(true);
      expect(Array.isArray(qualityProviders)).toBe(true);
      expect(Array.isArray(fastProviders)).toBe(true);
      
      expect(cheapProviders.length).toBeGreaterThan(0);
      expect(qualityProviders.length).toBeGreaterThan(0);
      expect(fastProviders.length).toBeGreaterThan(0);
    });

    test('gets provider models and capabilities', () => {
      const qwenModels = ProviderConfigs.getProviderModels('qwen');
      const qwenCapabilities = ProviderConfigs.getProviderCapabilities('qwen');
      
      expect(qwenModels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'qwen-mt-turbo', tokenLimit: 31980 })
        ])
      );
      
      expect(qwenCapabilities).toEqual(
        expect.arrayContaining(['streaming', 'batch', 'language_detection'])
      );
    });
  });

  describe('ConfigService', () => {
    let testService;

    beforeEach(() => {
      testService = new ConfigService();
    });

    test('GOLDEN: loads and migrates legacy configuration', async () => {
      const legacyConfig = {
        apiKey: 'test-key',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        providers: { qwen: { apiKey: 'qwen-key' } }
      };

      chrome.storage.sync.get
        .mockImplementationOnce((key, callback) => {
          // No modern config found
          callback({});
        })
        .mockImplementationOnce((key, callback) => {
          // Return legacy config in the format expected (key-based)
          if (key === 'qwen_config') {
            callback({ qwen_config: legacyConfig });
          } else {
            callback(legacyConfig);
          }
        });

      chrome.storage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      const config = await testService.load();
      
      expect(config.migration).toBeDefined();
      expect(config.migration.fromLegacy).toBe(true);
      expect(config.core.sourceLanguage).toBe('en');
      expect(config.providers.qwen.apiKey).toBe('qwen-key');
      expect(chrome.storage.sync.set).toHaveBeenCalled();
    }, 10000);

    test('GOLDEN: saves configuration with validation', async () => {
      const testConfig = {
        core: { sourceLanguage: 'en', debug: true },
        providers: { qwen: { apiKey: 'test-key' } }
      };

      chrome.storage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      const saved = await testService.save(testConfig);
      
      expect(saved.core.sourceLanguage).toBe('en');
      expect(saved.core.debug).toBe(true);
      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          qwen_config_v2: expect.objectContaining({
            core: expect.objectContaining({
              sourceLanguage: 'en',
              debug: true
            })
          })
        }),
        expect.any(Function)
      );
    });

    test('manages provider configurations', async () => {
      const baseConfig = {
        core: { sourceLanguage: 'en' },
        providers: {}
      };

      chrome.storage.sync.get.mockImplementation((key, callback) => {
        callback({ qwen_config_v2: baseConfig });
      });

      chrome.storage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      // Add provider
      await testService.addProvider('openai', { 
        apiKey: 'sk-test123456789',
        model: 'gpt-4'
      });

      expect(chrome.storage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          qwen_config_v2: expect.objectContaining({
            providers: expect.objectContaining({
              openai: expect.objectContaining({
                apiKey: 'sk-test123456789',
                model: 'gpt-4'
              })
            })
          })
        }),
        expect.any(Function)
      );
    });

    test('handles Chrome storage errors gracefully', async () => {
      chrome.runtime.lastError = { message: 'Storage quota exceeded' };
      chrome.storage.sync.get.mockImplementation((key, callback) => {
        callback({});
      });

      const config = await testService.load();
      
      // Should return default configuration on error
      expect(config.core).toBeDefined();
      expect(config.translation).toBeDefined();
      expect(config.providers).toBeDefined();
    });

    test('provides backward compatibility with flat configuration', async () => {
      const modernConfig = {
        core: { sourceLanguage: 'en', debug: true },
        translation: { strategy: 'fast' },
        providers: { qwen: { apiKey: 'test' } },
        migration: { version: '2.0.0' }
      };

      chrome.storage.sync.get.mockImplementation((key, callback) => {
        callback({ qwen_config_v2: modernConfig });
      });

      const flatConfig = await testService.getFlat();
      
      expect(flatConfig.sourceLanguage).toBe('en');
      expect(flatConfig.debug).toBe(true);
      expect(flatConfig.strategy).toBe('fast');
      expect(flatConfig.providers.qwen.apiKey).toBe('test');
    });

    test('validates configuration without saving', () => {
      const testConfig = {
        core: { sourceLanguage: 'invalid-lang' },
        translation: { strategy: 'invalid-strategy' }
      };

      const validated = testService.validate(testConfig);
      
      // Validation falls back to defaults for invalid values
      expect(validated.core.sourceLanguage).toBe('invalid-lang'); // String validation allows any string
      expect(validated.translation.strategy).toBe('balanced'); // Invalid enum falls back to default
    });

    test('resets to default configuration', async () => {
      chrome.storage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      const defaultConfig = await testService.reset();
      
      expect(defaultConfig.core.sourceLanguage).toBe('en');
      expect(defaultConfig.translation.translateTimeoutMs).toBe(20000);
      expect(Object.keys(defaultConfig.providers)).toHaveLength(0);
      expect(chrome.storage.sync.set).toHaveBeenCalled();
    });

    test('detects when migration is needed', async () => {
      // No modern config exists
      chrome.storage.sync.get.mockImplementation((key, callback) => {
        callback({});
      });

      const needsMigration = await testService.needsMigration();
      expect(needsMigration).toBe(true);

      // Modern config exists
      chrome.storage.sync.get.mockImplementation((key, callback) => {
        callback({ 
          qwen_config_v2: { 
            migration: { version: '2.0.0' } 
          } 
        });
      });

      const noMigrationNeeded = await testService.needsMigration();
      expect(noMigrationNeeded).toBe(false);
    });
  });

  describe('Integration Tests', () => {
    test('GOLDEN: end-to-end configuration workflow', async () => {
      const legacyConfig = {
        apiKey: 'legacy-qwen-key',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        autoTranslate: false,
        providers: {
          qwen: { apiKey: 'legacy-qwen-key' },
          openai: { apiKey: 'sk-legacy123456789' }
        }
      };

      // Mock storage responses
      chrome.storage.sync.get
        .mockImplementationOnce((key, callback) => {
          // No modern config
          callback({});
        })
        .mockImplementationOnce((key, callback) => {
          // Return legacy config
          callback(legacyConfig);
        })
        .mockImplementation((key, callback) => {
          // Return modern config for subsequent calls
          callback({
            qwen_config_v2: {
              core: { sourceLanguage: 'en', targetLanguage: 'zh', autoTranslate: false },
              providers: {
                qwen: { apiKey: 'legacy-qwen-key' },
                openai: { apiKey: 'sk-legacy123456789' }
              },
              migration: { version: '2.0.0', fromLegacy: true }
            }
          });
        });

      chrome.storage.sync.set.mockImplementation((data, callback) => {
        callback();
      });

      const service = new ConfigService();

      // 1. Load configuration (triggers migration)
      const config = await service.load();
      expect(config.migration.fromLegacy).toBe(true);

      // 2. Update provider configuration
      await service.updateProvider('openai', { model: 'gpt-4' });

      // 3. Add new provider
      await service.addProvider('anthropic', {
        apiKey: 'sk-ant-test123456789',
        model: 'claude-3-haiku-20240307'
      });

      // 4. Get flattened config for legacy compatibility
      const flatConfig = await service.getFlat();
      expect(flatConfig.sourceLanguage).toBe('en');
      expect(flatConfig.providers.qwen.apiKey).toBe('legacy-qwen-key');

      // Verify all storage operations happened
      expect(chrome.storage.sync.set).toHaveBeenCalledTimes(3); // Migration + 2 updates
    });
  });
});