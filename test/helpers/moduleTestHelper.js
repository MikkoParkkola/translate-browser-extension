/**
 * Test helper utilities for modular architecture testing
 * Provides setup/teardown and mocking utilities for the new modular components
 */

/**
 * Mock Chrome Extension APIs for testing
 */
export function setupChromeAPIMocks() {
  global.chrome = {
    runtime: {
      getURL: jest.fn((path) => `chrome-extension://test-extension/${path}`),
      sendMessage: jest.fn(),
      onMessage: {
        addListener: jest.fn(),
        removeListener: jest.fn()
      },
      onStartup: {
        addListener: jest.fn()
      },
      onInstalled: {
        addListener: jest.fn()
      },
      onConnect: {
        addListener: jest.fn()
      },
      getManifest: jest.fn(() => ({
        version: '1.0.0',
        version_name: 'test'
      }))
    },
    storage: {
      sync: {
        get: jest.fn((keys, callback) => {
          callback({});
        }),
        set: jest.fn((items, callback) => {
          if (callback) callback();
        })
      },
      local: {
        get: jest.fn((keys, callback) => {
          callback({});
        }),
        set: jest.fn((items, callback) => {
          if (callback) callback();
        })
      }
    },
    action: {
      setBadgeText: jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
      setIcon: jest.fn()
    },
    contextMenus: {
      create: jest.fn(),
      removeAll: jest.fn((callback) => {
        if (callback) callback();
      }),
      onClicked: {
        addListener: jest.fn()
      }
    },
    tabs: {
      onUpdated: {
        addListener: jest.fn()
      }
    },
    scripting: {
      executeScript: jest.fn()
    }
  };

  // Mock navigator for offline/online testing
  // Store original descriptor for cleanup
  const originalOnLine = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), 'onLine') ||
                        Object.getOwnPropertyDescriptor(navigator, 'onLine');

  Object.defineProperty(navigator, 'onLine', {
    writable: true,
    configurable: true,
    value: true
  });

  // Store for cleanup
  global._originalNavigatorOnLine = originalOnLine;
}

/**
 * Set navigator.onLine value for testing offline scenarios
 */
export function setNavigatorOnLine(value) {
  Object.defineProperty(navigator, 'onLine', {
    writable: true,
    configurable: true,
    value: value
  });
}

/**
 * Setup DOM environment for content script testing
 */
export function setupDOMEnvironment() {
  // Create basic DOM structure
  document.body.innerHTML = '';

  // Mock DOM methods that might be used
  document.createElement = jest.fn((tagName) => {
    const element = {
      tagName: tagName.toUpperCase(),
      style: {},
      classList: {
        add: jest.fn(),
        remove: jest.fn(),
        contains: jest.fn()
      },
      setAttribute: jest.fn(),
      getAttribute: jest.fn(),
      appendChild: jest.fn(),
      removeChild: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      textContent: '',
      innerHTML: '',
      remove: jest.fn()
    };
    return element;
  });

  // Mock selection API
  window.getSelection = jest.fn(() => ({
    toString: jest.fn(() => ''),
    rangeCount: 0,
    getRangeAt: jest.fn()
  }));

  // Mock ResizeObserver
  global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn()
  }));
}

/**
 * Mock performance tracker for testing
 */
export function mockPerformanceTracker() {
  global.performanceTracker = {
    startTimer: jest.fn(() => 'test-timer-id'),
    endTimer: jest.fn(() => 100),
    trackTranslation: jest.fn(),
    trackDOMScan: jest.fn(),
    trackAPICall: jest.fn(),
    trackError: jest.fn(),
    getDashboardData: jest.fn(() => ({
      summary: {
        activeOperations: 0,
        totalOperations: 0,
        averageResponseTime: 0,
        errorRate: 0,
        uptime: 0
      },
      translations: { count: 0 },
      domScans: { count: 0 },
      apiCalls: { count: 0 },
      errors: { count: 0 },
      recentActivity: [],
      insights: {
        performance: [],
        efficiency: [],
        reliability: [],
        recommendations: []
      }
    }))
  };
}

/**
 * Setup translation-related mocks
 */
export function setupTranslationMocks() {
  global.qwenTranslate = jest.fn().mockResolvedValue({ text: 'Translated text' });
  global.qwenLoadConfig = jest.fn().mockResolvedValue({
    apiEndpoint: 'https://test.api/',
    model: 'test-model',
    sourceLanguage: 'en',
    targetLanguage: 'es',
    providerOrder: ['test-provider'],
    endpoints: {},
    detector: null,
    failover: false,
    debug: false
  });

  global.qwenProviders = {
    getProvider: jest.fn(() => null)
  };

  global.qwenThrottle = {
    configure: jest.fn(),
    getUsage: jest.fn(() => ({
      requests: 0,
      requestLimit: 60,
      tokens: 0,
      tokenLimit: 100000
    })),
    approxTokens: jest.fn((text) => text.length)
  };

  global.qwenUsageColor = jest.fn(() => '#00ff00');
}

/**
 * Setup background script test environment
 */
export function setupBackgroundTestEnvironment() {
  setupChromeAPIMocks();
  setupTranslationMocks();
  mockPerformanceTracker();

  // Mock background script specific globals
  global.importScripts = jest.fn();
  global.setInterval = jest.fn();
  global.OffscreenCanvas = class {
    constructor() {
      this.ctx = {
        clearRect: jest.fn(),
        lineWidth: 0,
        strokeStyle: '',
        beginPath: jest.fn(),
        arc: jest.fn(),
        stroke: jest.fn(),
        fillStyle: '',
        fill: jest.fn(),
        getImageData: () => ({})
      };
    }
    getContext() {
      return this.ctx;
    }
  };
}

/**
 * Setup content script test environment
 */
export function setupContentScriptTestEnvironment() {
  setupChromeAPIMocks();
  setupDOMEnvironment();
  setupTranslationMocks();
  mockPerformanceTracker();

  // Mock i18n system
  window.qwenI18n = {
    t: jest.fn((key) => {
      const translations = {
        'popup.offline': 'Offline',
        'bubble.offline': 'Offline',
        'status.translating': 'Translating...',
        'status.ready': 'Ready'
      };
      return translations[key] || key;
    }),
    ready: Promise.resolve()
  };
}

/**
 * Cleanup function to reset all mocks
 */
export function cleanup() {
  jest.clearAllMocks();

  // Clean up global mocks
  delete global.chrome;
  delete global.qwenTranslate;
  delete global.qwenLoadConfig;
  delete global.qwenProviders;
  delete global.qwenThrottle;
  delete global.qwenUsageColor;
  delete global.performanceTracker;
  delete global.importScripts;
  delete global.setInterval;
  delete global.OffscreenCanvas;
  delete global.ResizeObserver;

  // Clean up window mocks
  if (typeof window !== 'undefined') {
    delete window.qwenI18n;
    delete window.translationExtensionInitialized;
    delete window.translationScriptInstance;
    delete window.contentScriptDebug;
  }

  // Reset DOM
  if (typeof document !== 'undefined') {
    document.body.innerHTML = '';
  }

  // Restore navigator.onLine
  if (global._originalNavigatorOnLine) {
    Object.defineProperty(navigator, 'onLine', global._originalNavigatorOnLine);
    delete global._originalNavigatorOnLine;
  }
}