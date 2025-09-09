/**
 * Tests for the dynamic provider loading system
 */

const path = require('path');

describe('Provider Loader', () => {
  let providerLoader;
  
  beforeEach(() => {
    // Reset global state
    if (global.qwenProviderLoader) {
      delete global.qwenProviderLoader;
    }
    
    // Clean up any existing provider global variables
    Object.keys(global).forEach(key => {
      if (key.startsWith('qwenProvider')) {
        delete global[key];
      }
    });
    
    // Mock importScripts for service worker environment
    global.importScripts = jest.fn();
    
    // Mock self as service worker context
    global.self = global;
    
    // Load the provider loader module  
    const providerLoaderPath = path.resolve(__dirname, '../src/core/provider-loader.js');
    delete require.cache[providerLoaderPath];
    providerLoader = require(providerLoaderPath);
    
    // Also ensure it's available on global for compatibility
    global.qwenProviderLoader = providerLoader;
    
    // Reset provider loader internal state for testing
    if (providerLoader.resetForTesting) {
      providerLoader.resetForTesting();
    }
  });

  afterEach(() => {
    // Clean up mocks
    delete global.importScripts;
    delete global.self;
    jest.clearAllMocks();
  });

  describe('Provider Configuration', () => {
    test('should have correct provider configuration', () => {
      expect(providerLoader.providerConfig).toBeDefined();
      expect(providerLoader.providerConfig.dashscope).toEqual({
        file: 'providers/dashscope.js',
        globalVar: 'qwenProviderDashScope',
        size: 5108,
        priority: 1,
        description: 'Alibaba DashScope API provider'
      });
    });

    test('should identify essential providers correctly', () => {
      const essential = providerLoader.getEssentialProviders();
      expect(essential).toContain('dashscope');
      expect(essential).toContain('qwen');
      expect(essential.length).toBe(2); // Only priority 1 providers
    });
  });

  describe('Provider Size Calculations', () => {
    test('should calculate provider sizes correctly', () => {
      const sizes = providerLoader.getProviderSizes();
      expect(sizes.total).toBe(50018); // Sum of all provider sizes
      expect(sizes.loaded).toBe(0); // Nothing loaded initially
      expect(sizes.saved).toBe(50018); // All bytes saved initially
      expect(sizes.count.total).toBe(12); // Total providers
    });

    test('should calculate sizes for specific providers', () => {
      const sizes = providerLoader.getProviderSizes(['dashscope', 'openai']);
      expect(sizes.total).toBe(5108 + 4862); // dashscope + openai
      expect(sizes.count.total).toBe(2);
    });
  });

  describe('Provider Loading', () => {
    test('should detect already loaded provider', async () => {
      // Mock provider as already loaded
      global.qwenProviderDashScope = { translate: jest.fn() };
      
      const result = await providerLoader.loadProvider('dashscope');
      expect(result).toBe(true);
      expect(global.importScripts).not.toHaveBeenCalled();
    });

    test('should load provider using importScripts', async () => {
      // Mock successful loading
      global.importScripts.mockImplementation(() => {
        global.qwenProviderDashScope = { translate: jest.fn() };
      });
      
      const result = await providerLoader.loadProvider('dashscope');
      expect(result).toBe(true);
      expect(global.importScripts).toHaveBeenCalledWith('providers/dashscope.js');
    });

    test('should handle loading failure gracefully', async () => {
      // Mock loading failure
      global.importScripts.mockImplementation(() => {
        throw new Error('Failed to load');
      });
      
      const result = await providerLoader.loadProvider('dashscope');
      expect(result).toBe(false);
    });

    test('should handle unknown provider', async () => {
      const result = await providerLoader.loadProvider('unknown-provider');
      expect(result).toBe(false);
    });

    test('should prevent double loading', async () => {
      global.importScripts.mockImplementation(() => {
        global.qwenProviderDashScope = { translate: jest.fn() };
      });
      
      // Load once
      await providerLoader.loadProvider('dashscope');
      expect(global.importScripts).toHaveBeenCalledTimes(1);
      
      // Load again - should not call importScripts
      await providerLoader.loadProvider('dashscope');
      expect(global.importScripts).toHaveBeenCalledTimes(1);
    });
  });

  describe('Batch Provider Loading', () => {
    test('should load multiple providers', async () => {
      global.importScripts.mockImplementation((file) => {
        if (file === 'providers/dashscope.js') {
          global.qwenProviderDashScope = { translate: jest.fn() };
        } else if (file === 'providers/openai.js') {
          global.qwenProviderOpenAI = { translate: jest.fn() };
        }
      });
      
      const result = await providerLoader.loadProviders(['dashscope', 'openai']);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.total).toBe(2);
    });

    test('should handle mixed success/failure', async () => {
      global.importScripts.mockImplementation((file) => {
        if (file === 'providers/dashscope.js') {
          global.qwenProviderDashScope = { translate: jest.fn() };
        } else if (file === 'providers/openai.js') {
          throw new Error('Failed to load');
        }
      });
      
      const result = await providerLoader.loadProviders(['dashscope', 'openai']);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('Load Statistics', () => {
    test('should provide accurate load statistics', async () => {
      // Mock loading one provider
      global.importScripts.mockImplementation(() => {
        global.qwenProviderDashScope = { translate: jest.fn() };
      });
      
      await providerLoader.loadProvider('dashscope');
      
      const stats = providerLoader.getLoadStats();
      expect(stats.loaded).toBe(5108); // dashscope size
      expect(stats.saved).toBe(50018 - 5108); // total - dashscope
      expect(stats.loadedProviders).toContain('dashscope');
      expect(stats.memoryImpact).toContain('5KB loaded');
    });
  });

  describe('Provider Preloading', () => {
    test('should preload providers based on context', async () => {
      global.importScripts.mockImplementation((file) => {
        const providerMap = {
          'providers/dashscope.js': () => { global.qwenProviderDashScope = {}; },
          'providers/openai.js': () => { global.qwenProviderOpenAI = {}; },
          'providers/deepl.js': () => { global.qwenProviderDeepL = {}; }
        };
        if (providerMap[file]) providerMap[file]();
      });
      
      const result = await providerLoader.preloadLikelyProviders('popup');
      expect(result.successful).toBeGreaterThan(0);
      // Popup context should load dashscope, openai, deepl
      expect(global.qwenProviderDashScope).toBeDefined();
    });
  });
});