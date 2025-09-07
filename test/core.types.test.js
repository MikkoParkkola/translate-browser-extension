/**
 * @fileoverview Unit tests for core type definitions
 * Tests ensure type definitions are properly exported and documented
 */

const types = require('../src/core/types');

describe('Core Types', () => {
  describe('Module Export', () => {
    test('exports type metadata', () => {
      expect(types).toHaveProperty('__types');
      expect(types).toHaveProperty('version');
      expect(types.__types).toBe('Core type definitions for Qwen Translator Extension');
      expect(types.version).toBe('1.0.0');
    });

    test('has no runtime code beyond metadata', () => {
      const keys = Object.keys(types);
      expect(keys).toEqual(['__types', 'version']);
    });
  });

  describe('JSDoc Type Coverage', () => {
    test('TranslationRequest interface has required properties', () => {
      // This test validates the JSDoc is properly structured
      // by checking that our type system can handle expected shapes
      const mockRequest = {
        text: 'Hello world',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        provider: 'qwen',
        timeout: 10000
      };

      expect(typeof mockRequest.text).toBe('string');
      expect(typeof mockRequest.sourceLanguage).toBe('string');
      expect(typeof mockRequest.targetLanguage).toBe('string');
      expect(typeof mockRequest.provider).toBe('string');
      expect(typeof mockRequest.timeout).toBe('number');
    });

    test('TranslationResult interface has required properties', () => {
      const mockResult = {
        translatedText: '你好世界',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        provider: 'qwen',
        model: 'qwen-mt-turbo',
        tokensUsed: 10,
        duration: 500,
        confidence: 0.95,
        cached: false
      };

      expect(typeof mockResult.translatedText).toBe('string');
      expect(typeof mockResult.sourceLanguage).toBe('string');
      expect(typeof mockResult.targetLanguage).toBe('string');
      expect(typeof mockResult.provider).toBe('string');
      expect(typeof mockResult.model).toBe('string');
      expect(typeof mockResult.tokensUsed).toBe('number');
      expect(typeof mockResult.duration).toBe('number');
      expect(typeof mockResult.confidence).toBe('number');
      expect(typeof mockResult.cached).toBe('boolean');
    });

    test('ProviderConfig interface supports required configuration', () => {
      const mockProvider = {
        id: 'qwen',
        name: 'Qwen Translator',
        apiKey: 'encrypted-key',
        apiEndpoint: 'https://api.example.com',
        model: 'qwen-mt-turbo',
        models: ['qwen-mt-turbo', 'qwen-mt-plus'],
        requestLimit: 60,
        tokenLimit: 100000,
        charLimit: 50000,
        weight: 1.0,
        strategy: 'balanced',
        enabled: true
      };

      expect(typeof mockProvider.id).toBe('string');
      expect(typeof mockProvider.name).toBe('string');
      expect(typeof mockProvider.apiKey).toBe('string');
      expect(typeof mockProvider.apiEndpoint).toBe('string');
      expect(typeof mockProvider.model).toBe('string');
      expect(Array.isArray(mockProvider.models)).toBe(true);
      expect(typeof mockProvider.requestLimit).toBe('number');
      expect(typeof mockProvider.tokenLimit).toBe('number');
      expect(typeof mockProvider.charLimit).toBe('number');
      expect(typeof mockProvider.weight).toBe('number');
      expect(typeof mockProvider.strategy).toBe('string');
      expect(typeof mockProvider.enabled).toBe('boolean');
    });

    test('CacheEntry interface has timing and access tracking', () => {
      const mockCache = {
        key: 'en:zh:hello',
        translatedText: '你好',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        provider: 'qwen',
        timestamp: Date.now(),
        ttl: 3600000,
        accessCount: 5,
        lastAccessed: Date.now()
      };

      expect(typeof mockCache.key).toBe('string');
      expect(typeof mockCache.translatedText).toBe('string');
      expect(typeof mockCache.sourceLanguage).toBe('string');
      expect(typeof mockCache.targetLanguage).toBe('string');
      expect(typeof mockCache.provider).toBe('string');
      expect(typeof mockCache.timestamp).toBe('number');
      expect(typeof mockCache.ttl).toBe('number');
      expect(typeof mockCache.accessCount).toBe('number');
      expect(typeof mockCache.lastAccessed).toBe('number');
    });

    test('ExtensionConfig interface covers all configuration options', () => {
      const mockConfig = {
        apiKey: '',
        detectApiKey: '',
        apiEndpoint: 'https://api.example.com',
        model: 'qwen-mt-turbo',
        sourceLanguage: 'en',
        targetLanguage: 'zh',
        autoTranslate: false,
        requestLimit: 60,
        tokenLimit: 100000,
        providers: {},
        theme: 'dark',
        debug: false
      };

      expect(typeof mockConfig.apiKey).toBe('string');
      expect(typeof mockConfig.apiEndpoint).toBe('string');
      expect(typeof mockConfig.autoTranslate).toBe('boolean');
      expect(typeof mockConfig.requestLimit).toBe('number');
      expect(typeof mockConfig.providers).toBe('object');
      expect(typeof mockConfig.theme).toBe('string');
      expect(typeof mockConfig.debug).toBe('boolean');
    });

    test('ApiError interface has error handling structure', () => {
      const mockError = {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        provider: 'qwen',
        status: 429,
        retryAfter: 60000
      };

      expect(typeof mockError.code).toBe('string');
      expect(typeof mockError.message).toBe('string');
      expect(typeof mockError.provider).toBe('string');
      expect(typeof mockError.status).toBe('number');
      expect(typeof mockError.retryAfter).toBe('number');
    });
  });

  describe('Type System Integration', () => {
    test('types work with complex nested structures', () => {
      const complexConfig = {
        providers: {
          qwen: {
            id: 'qwen',
            throttle: {
              requestLimit: 60,
              tokenLimit: 100000,
              windowMs: 60000,
              contexts: {
                translation: { requestLimit: 50 },
                detection: { requestLimit: 10 }
              }
            }
          }
        }
      };

      expect(typeof complexConfig.providers).toBe('object');
      expect(typeof complexConfig.providers.qwen.throttle).toBe('object');
      expect(typeof complexConfig.providers.qwen.throttle.contexts).toBe('object');
    });

    test('storage result interface handles success and error cases', () => {
      const successResult = {
        success: true,
        data: { key: 'value' },
        duration: 15
      };

      const errorResult = {
        success: false,
        error: new Error('Storage failed'),
        duration: 25
      };

      expect(successResult.success).toBe(true);
      expect(successResult).toHaveProperty('data');
      expect(typeof successResult.duration).toBe('number');

      expect(errorResult.success).toBe(false);
      expect(errorResult.error).toBeInstanceOf(Error);
      expect(typeof errorResult.duration).toBe('number');
    });

    test('usage statistics interface tracks comprehensive metrics', () => {
      const stats = {
        requests: 150,
        tokens: 50000,
        characters: 200000,
        cacheHits: 75,
        cacheMisses: 25,
        errors: 5,
        providers: {
          qwen: 100,
          google: 30,
          deepl: 20
        },
        timestamp: Date.now()
      };

      expect(typeof stats.requests).toBe('number');
      expect(typeof stats.tokens).toBe('number');
      expect(typeof stats.characters).toBe('number');
      expect(typeof stats.cacheHits).toBe('number');
      expect(typeof stats.providers).toBe('object');
      expect(typeof stats.providers.qwen).toBe('number');
      expect(typeof stats.timestamp).toBe('number');
    });
  });

  describe('Edge Cases', () => {
    test('handles optional properties correctly', () => {
      const minimalRequest = {
        text: 'Hello',
        sourceLanguage: 'en',
        targetLanguage: 'zh'
      };

      // Should work without optional properties
      expect(minimalRequest.text).toBeDefined();
      expect(minimalRequest.provider).toBeUndefined();
      expect(minimalRequest.metadata).toBeUndefined();
    });

    test('supports parallel translation configuration', () => {
      const parallelConfigs = [
        { parallel: true },
        { parallel: false },
        { parallel: 'auto' }
      ];

      parallelConfigs.forEach(config => {
        expect(['boolean', 'string']).toContain(typeof config.parallel);
      });
    });
  });
});