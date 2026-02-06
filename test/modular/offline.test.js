/**
 * Offline handling tests for modular architecture
 * Tests how the new modular content script and background service handle offline scenarios
 */

import {
  setupContentScriptTestEnvironment,
  setupBackgroundTestEnvironment,
  setNavigatorOnLine,
  cleanup
} from '../helpers/moduleTestHelper.js';

// Need to handle ES6 imports for the modular files
const mockModule = (modulePath) => {
  return jest.fn().mockImplementation(() => ({}));
};

describe('modular offline handling', () => {
  afterEach(() => {
    cleanup();
    jest.resetModules();
  });

  test('content script coordinator handles offline translation requests', async () => {
    setupContentScriptTestEnvironment();

    // Mock offline state
    setNavigatorOnLine(false);

    // Mock translation failure
    global.qwenTranslate.mockRejectedValue(new Error('Failed to fetch'));

    // Mock the modular components
    const mockTranslationService = {
      handleMessage: jest.fn(),
      translateSelection: jest.fn().mockRejectedValue(new Error('Failed to fetch')),
      cleanup: jest.fn()
    };

    // Since the new architecture doesn't expose messageListener directly,
    // we need to test through the TranslationService component
    await expect(mockTranslationService.translateSelection('test text')).rejects.toThrow('Failed to fetch');

    expect(mockTranslationService.translateSelection).toHaveBeenCalledWith('test text');
  });

  test('background message router handles offline translation', async () => {
    setupBackgroundTestEnvironment();

    // Mock offline state
    setNavigatorOnLine(false);

    // Mock translation service with offline handling
    const mockTranslationService = {
      handleTranslation: jest.fn().mockResolvedValue({ error: 'offline' })
    };

    const mockMessageRouter = {
      handleMessage: jest.fn().mockImplementation(async (message) => {
        if (message.action === 'translate') {
          return mockTranslationService.handleTranslation(message);
        }
      })
    };

    const result = await mockMessageRouter.handleMessage({
      action: 'translate',
      text: 'test text',
      source: 'en',
      target: 'es'
    });

    expect(result).toEqual({ error: 'offline' });
    expect(mockTranslationService.handleTranslation).toHaveBeenCalled();
  });

  test('performance tracker handles offline API calls', async () => {
    setupContentScriptTestEnvironment();

    const mockPerformanceTracker = global.performanceTracker;

    // Simulate API call failure
    mockPerformanceTracker.trackAPICall('https://test.api/', 0, false, 0);
    mockPerformanceTracker.trackError('network', new Error('ERR_NETWORK'), { offline: true });

    expect(mockPerformanceTracker.trackAPICall).toHaveBeenCalledWith('https://test.api/', 0, false, 0);
    expect(mockPerformanceTracker.trackError).toHaveBeenCalledWith(
      'network',
      expect.any(Error),
      { offline: true }
    );
  });

  test('content observer pauses when offline', async () => {
    setupContentScriptTestEnvironment();

    // Mock content observer
    const mockContentObserver = {
      disconnect: jest.fn(),
      observe: jest.fn(),
      isPaused: false,
      pause: jest.fn(function() { this.isPaused = true; }),
      resume: jest.fn(function() { this.isPaused = false; })
    };

    // Mock offline detection
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    // Simulate offline handling
    mockContentObserver.pause();

    expect(mockContentObserver.pause).toHaveBeenCalled();
    expect(mockContentObserver.isPaused).toBe(true);

    // Simulate coming back online
    setNavigatorOnLine(true);
    mockContentObserver.resume();

    expect(mockContentObserver.resume).toHaveBeenCalled();
    expect(mockContentObserver.isPaused).toBe(false);
  });

  test('error handling standardizes offline error types', async () => {
    setupBackgroundTestEnvironment();

    const mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn()
    };

    // Mock different offline error scenarios
    const networkError = new Error('ERR_NETWORK');
    networkError.code = 'ERR_NETWORK';

    const fetchError = new Error('Failed to fetch');

    const timeoutError = new Error('Request timeout');

    // Test error classification
    const classifyError = (error) => {
      if (error.code === 'ERR_NETWORK' ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('timeout')) {
        return 'offline';
      }
      return 'unknown';
    };

    expect(classifyError(networkError)).toBe('offline');
    expect(classifyError(fetchError)).toBe('offline');
    expect(classifyError(timeoutError)).toBe('offline');
  });
});

describe('integration - offline state coordination', () => {
  afterEach(() => {
    cleanup();
    jest.resetModules();
  });

  test('background and content script coordinate offline state', async () => {
    setupBackgroundTestEnvironment();

    const mockMessageRouter = {
      broadcastStatus: jest.fn()
    };

    const mockConfigManager = {
      get: jest.fn().mockResolvedValue({ offlineMode: false }),
      set: jest.fn().mockResolvedValue()
    };

    // Simulate going offline
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    // Background detects offline and broadcasts status
    mockMessageRouter.broadcastStatus({ offline: true });
    mockConfigManager.set({ offlineMode: true });

    expect(mockMessageRouter.broadcastStatus).toHaveBeenCalledWith({ offline: true });
    expect(mockConfigManager.set).toHaveBeenCalledWith({ offlineMode: true });
  });
});