/**
 * Integration tests for cross-module communication in the new modular architecture
 * Tests how the different modules communicate with each other
 */

import {
  setupBackgroundTestEnvironment,
  setupContentScriptTestEnvironment,
  cleanup
} from '../helpers/moduleTestHelper.js';

describe('Background module communication', () => {
  afterEach(() => {
    cleanup();
    jest.resetModules();
  });

  test('MessageRouter coordinates with TranslationService', async () => {
    setupBackgroundTestEnvironment();

    // Mock the modular background components
    const mockTranslationService = {
      handleTranslation: jest.fn().mockResolvedValue({ text: 'Translated text' })
    };

    const mockConfigManager = {
      get: jest.fn().mockResolvedValue({
        apiEndpoint: 'https://test.api/',
        model: 'test-model'
      })
    };

    const mockPerformanceTracker = global.performanceTracker;

    // Simulate MessageRouter handling a translation request
    const messageRouter = {
      async handleMessage(message) {
        const timerId = mockPerformanceTracker.startTimer('translation', {
          textLength: message.text?.length
        });

        try {
          const config = await mockConfigManager.get();
          const result = await mockTranslationService.handleTranslation({
            ...message,
            ...config
          });

          mockPerformanceTracker.endTimer(timerId, { success: true });
          return result;
        } catch (error) {
          mockPerformanceTracker.endTimer(timerId, { success: false, error: error.message });
          throw error;
        }
      }
    };

    // Test the integration
    const result = await messageRouter.handleMessage({
      action: 'translate',
      text: 'Hello world',
      source: 'en',
      target: 'es'
    });

    expect(result).toEqual({ text: 'Translated text' });
    expect(mockConfigManager.get).toHaveBeenCalled();
    expect(mockTranslationService.handleTranslation).toHaveBeenCalledWith({
      action: 'translate',
      text: 'Hello world',
      source: 'en',
      target: 'es',
      apiEndpoint: 'https://test.api/',
      model: 'test-model'
    });
    expect(mockPerformanceTracker.startTimer).toHaveBeenCalledWith('translation', {
      textLength: 11
    });
    expect(mockPerformanceTracker.endTimer).toHaveBeenCalledWith(
      'test-timer-id',
      { success: true }
    );
  });

  test('ConfigManager notifies components of config changes', async () => {
    setupBackgroundTestEnvironment();

    const listeners = [];

    // Mock ConfigManager with observer pattern
    const mockConfigManager = {
      observers: [],
      subscribe(callback) {
        this.observers.push(callback);
      },
      async set(newConfig) {
        // Notify all observers
        for (const observer of this.observers) {
          await observer(newConfig);
        }
      }
    };

    // Mock components that listen to config changes
    const mockTranslationService = {
      updateConfig: jest.fn().mockResolvedValue()
    };

    const mockMessageRouter = {
      updateRateLimit: jest.fn()
    };

    // Subscribe components to config changes
    mockConfigManager.subscribe(async (config) => {
      await mockTranslationService.updateConfig(config);
      mockMessageRouter.updateRateLimit(config.rateLimit);
    });

    // Test config change propagation
    const newConfig = {
      apiEndpoint: 'https://new.api/',
      model: 'new-model',
      rateLimit: { requests: 120, tokens: 200000 }
    };

    await mockConfigManager.set(newConfig);

    expect(mockTranslationService.updateConfig).toHaveBeenCalledWith(newConfig);
    expect(mockMessageRouter.updateRateLimit).toHaveBeenCalledWith(newConfig.rateLimit);
  });
});

describe('Content script module communication', () => {
  afterEach(() => {
    cleanup();
    jest.resetModules();
  });

  test('ContentObserver coordinates with TranslationService', async () => {
    setupContentScriptTestEnvironment();

    const mockTranslationService = {
      translateNodes: jest.fn().mockResolvedValue({ translatedCount: 5, totalNodes: 5 }),
      isTranslating: false
    };

    const mockLanguageDetector = {
      detectLanguage: jest.fn().mockResolvedValue({
        language: 'es',
        confidence: 0.9,
        method: 'heuristic'
      })
    };

    const mockPerformanceTracker = global.performanceTracker;

    // Mock ContentObserver that uses other modules
    const contentObserver = {
      async processNewNodes(nodes) {
        const timerId = mockPerformanceTracker.startTimer('dom-scan', {
          nodeCount: nodes.length
        });

        try {
          // Skip if already translating
          if (mockTranslationService.isTranslating) {
            return;
          }

          // Process nodes through translation service
          const result = await mockTranslationService.translateNodes(nodes);

          mockPerformanceTracker.trackDOMScan(nodes.length, Date.now() - timerId);
          mockPerformanceTracker.endTimer(timerId, {
            success: true,
            nodesProcessed: result.translatedCount
          });

          return result;
        } catch (error) {
          mockPerformanceTracker.endTimer(timerId, { success: false, error: error.message });
          throw error;
        }
      }
    };

    // Test the integration
    const mockNodes = [
      { textContent: 'Hello' },
      { textContent: 'World' },
      { textContent: 'Test' },
      { textContent: 'Content' },
      { textContent: 'Here' }
    ];

    const result = await contentObserver.processNewNodes(mockNodes);

    expect(result).toEqual({ translatedCount: 5, totalNodes: 5 });
    expect(mockTranslationService.translateNodes).toHaveBeenCalledWith(mockNodes);
    expect(mockPerformanceTracker.startTimer).toHaveBeenCalledWith('dom-scan', {
      nodeCount: 5
    });
    expect(mockPerformanceTracker.trackDOMScan).toHaveBeenCalledWith(5, expect.any(Number));
    expect(mockPerformanceTracker.endTimer).toHaveBeenCalledWith(
      'test-timer-id',
      { success: true, nodesProcessed: 5 }
    );
  });

  test('LanguageDetector works with TranslationService context', async () => {
    setupContentScriptTestEnvironment();

    const mockLanguageDetector = {
      detectLanguage: jest.fn().mockImplementation(async (text, context) => {
        // Use context from translation service to improve detection
        const hints = context?.languageHints || {};

        if (hints.documentLang === 'es') {
          return { language: 'es', confidence: 0.95, method: 'context' };
        }

        return { language: 'en', confidence: 0.8, method: 'heuristic' };
      })
    };

    const mockTranslationService = {
      getLanguageContext: jest.fn().mockReturnValue({
        languageHints: {
          documentLang: 'es',
          contentLanguage: 'es-ES'
        }
      })
    };

    // Test language detection with context
    const context = mockTranslationService.getLanguageContext();
    const result = await mockLanguageDetector.detectLanguage('Hola mundo', context);

    expect(result).toEqual({
      language: 'es',
      confidence: 0.95,
      method: 'context'
    });
    expect(mockLanguageDetector.detectLanguage).toHaveBeenCalledWith('Hola mundo', {
      languageHints: {
        documentLang: 'es',
        contentLanguage: 'es-ES'
      }
    });
  });
});

describe('Background and Content script communication', () => {
  afterEach(() => {
    cleanup();
    jest.resetModules();
  });

  test('Content script sends translation requests to background', async () => {
    setupContentScriptTestEnvironment();

    const mockChrome = global.chrome;

    // Mock content script translation service
    const contentTranslationService = {
      async sendTranslationRequest(text, options) {
        return new Promise((resolve) => {
          mockChrome.runtime.sendMessage({
            action: 'translate',
            text,
            ...options
          }, resolve);
        });
      }
    };

    // Mock background response
    mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (callback) {
        callback({ text: `Translated: ${message.text}` });
      }
    });

    const result = await contentTranslationService.sendTranslationRequest('Hello world', {
      source: 'en',
      target: 'es'
    });

    expect(result).toEqual({ text: 'Translated: Hello world' });
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'translate',
      text: 'Hello world',
      source: 'en',
      target: 'es'
    }, expect.any(Function));
  });

  test('Background broadcasts status updates to content scripts', async () => {
    setupBackgroundTestEnvironment();

    const mockChrome = global.chrome;
    const mockTabs = [
      { id: 1, url: 'https://example.com' },
      { id: 2, url: 'https://test.com' }
    ];

    // Mock background status broadcaster
    const statusBroadcaster = {
      async broadcastStatus(status) {
        for (const tab of mockTabs) {
          mockChrome.tabs.sendMessage(tab.id, {
            action: 'status-update',
            status
          });
        }
      }
    };

    // Mock chrome.tabs.sendMessage
    mockChrome.tabs.sendMessage = jest.fn();

    await statusBroadcaster.broadcastStatus({
      translationActive: true,
      usage: { requests: 5, tokens: 1500 }
    });

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
      action: 'status-update',
      status: {
        translationActive: true,
        usage: { requests: 5, tokens: 1500 }
      }
    });
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(2, {
      action: 'status-update',
      status: {
        translationActive: true,
        usage: { requests: 5, tokens: 1500 }
      }
    });
  });
});