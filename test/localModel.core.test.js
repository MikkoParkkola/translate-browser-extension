/**
 * Core LocalModelManager functionality tests
 * Tests initialization, status management, and basic operations
 */

// Mock Web APIs
global.crypto = {
  subtle: {
    digest: jest.fn(),
    importKey: jest.fn()
  }
};

global.performance = {
  memory: {
    usedJSHeapSize: 1024 * 1024 * 50, // 50MB
    totalJSHeapSize: 1024 * 1024 * 100, // 100MB
    jsHeapSizeLimit: 1024 * 1024 * 200  // 200MB
  }
};

global.indexedDB = {
  open: jest.fn(),
  deleteDatabase: jest.fn()
};

// Mock IndexedDB transaction
const mockTransaction = {
  objectStore: jest.fn().mockReturnValue({
    add: jest.fn().mockReturnValue({ onsuccess: null, onerror: null }),
    get: jest.fn().mockReturnValue({ onsuccess: null, onerror: null }),
    put: jest.fn().mockReturnValue({ onsuccess: null, onerror: null }),
    delete: jest.fn().mockReturnValue({ onsuccess: null, onerror: null })
  })
};

const mockDB = {
  transaction: jest.fn().mockReturnValue(mockTransaction),
  close: jest.fn()
};

describe('LocalModelManager Core Functionality', () => {
  let LocalModelManager;
  let modelManager;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    // Mock console methods to reduce noise in tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    // Mock setTimeout and setInterval
    jest.useFakeTimers();

    LocalModelManager = require('../src/localModel.js');
    modelManager = new LocalModelManager();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    test('should initialize with default configuration', () => {
      expect(modelManager.isInitialized).toBe(false);
      expect(modelManager.isDownloading).toBe(false);
      expect(modelManager.downloadProgress).toBe(0);
      expect(modelManager.currentModelVersion).toBe('1.0.0');
      expect(modelManager.performanceStats.totalTranslations).toBe(0);
      expect(modelManager.performanceStats.successRate).toBe(100);
      expect(modelManager.performanceStats.optimizationLevel).toBe('default');
    });

    test('should have proper validation configuration', () => {
      expect(modelManager.validationConfig.enableChecksumValidation).toBe(true);
      expect(modelManager.validationConfig.enableSizeValidation).toBe(true);
      expect(modelManager.validationConfig.checksumAlgorithm).toBe('sha256');
      expect(modelManager.validationConfig.sizeTolerance).toBe(0.001);
    });

    test('should have performance monitoring configuration', () => {
      expect(modelManager.performanceConfig.performanceOptimizationEnabled).toBe(true);
      expect(modelManager.performanceConfig.adaptiveOptimization).toBe(true);
      expect(modelManager.performanceConfig.historySize).toBe(100);
      expect(modelManager.performanceConfig.memoryThreshold).toBe(0.9);
      expect(modelManager.performanceConfig.strategies).toHaveProperty('low-power');
      expect(modelManager.performanceConfig.strategies).toHaveProperty('balanced');
      expect(modelManager.performanceConfig.strategies).toHaveProperty('performance');
    });

    test('should initialize model registry with versions', () => {
      const registry = modelManager.modelRegistry['hunyuan-mt-7b'];
      expect(registry).toBeDefined();
      expect(registry.versions).toHaveProperty('1.0.0');
      expect(registry.versions).toHaveProperty('1.1.0');
      expect(registry.versions).toHaveProperty('2.0.0');
      expect(registry.latest).toBe('2.0.0');
      expect(registry.migrationStrategies).toHaveProperty('1.0.0->1.1.0');
    });

    test('should handle initialization errors gracefully', async () => {
      // Mock getModelStatus to throw error
      modelManager.getModelStatus = jest.fn().mockRejectedValue(new Error('Storage error'));

      await modelManager.init();

      expect(modelManager.lastError).toBeDefined();
      expect(modelManager.lastError.context).toBe('initialization');
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Model Status Management', () => {
    test('should return correct status for non-existent model', async () => {
      // Mock IndexedDB to return no model
      global.indexedDB.open = jest.fn().mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: mockDB
      });

      mockTransaction.objectStore().get = jest.fn().mockReturnValue({
        onsuccess: null,
        onerror: null,
        result: undefined
      });

      const status = await modelManager.getModelStatus();

      expect(status.downloaded).toBe(false);
      expect(status.size).toBe(0);
      expect(status.version).toBeNull();
    });

    test('should handle database connection errors', async () => {
      global.indexedDB.open = jest.fn().mockReturnValue({
        onsuccess: null,
        onerror: () => {},
        error: new Error('Database connection failed')
      });

      await expect(modelManager.getModelStatus()).rejects.toThrow('Database connection failed');
    });

    test('should determine availability correctly', () => {
      // Test when not downloaded
      modelManager.isDownloaded = false;
      expect(modelManager.isAvailable()).toBe(false);

      // Test when downloaded but not initialized
      modelManager.isDownloaded = true;
      modelManager.isInitialized = false;
      expect(modelManager.isAvailable()).toBe(false);

      // Test when downloaded and initialized
      modelManager.isDownloaded = true;
      modelManager.isInitialized = true;
      expect(modelManager.isAvailable()).toBe(true);

      // Test when downloading
      modelManager.isDownloading = true;
      expect(modelManager.isAvailable()).toBe(false);

      // Test when model corrupted
      modelManager.isDownloading = false;
      modelManager.modelCorrupted = true;
      expect(modelManager.isAvailable()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    test('should categorize and handle different error types', () => {
      const networkError = new Error('Network timeout');
      modelManager.handleError(networkError, 'download', true);

      expect(modelManager.lastError.message).toBe('Network timeout');
      expect(modelManager.lastError.context).toBe('download');
      expect(modelManager.lastError.retryable).toBe(true);
      expect(modelManager.consecutiveFailures).toBe(1);
      expect(modelManager.performanceStats.failureCount).toBe(1);
    });

    test('should reset consecutive failures on success', () => {
      modelManager.consecutiveFailures = 5;
      modelManager.resetConsecutiveFailures();
      expect(modelManager.consecutiveFailures).toBe(0);
    });

    test('should update success rate correctly', () => {
      modelManager.performanceStats.totalTranslations = 10;
      modelManager.performanceStats.failureCount = 2;
      modelManager.updateSuccessRate();

      expect(modelManager.performanceStats.successRate).toBe(80);
    });

    test('should enter recovery mode after consecutive failures', () => {
      for (let i = 0; i < 4; i++) {
        modelManager.handleError(new Error('Test error'), 'inference');
      }

      expect(modelManager.isInRecovery).toBe(true);
      expect(modelManager.consecutiveFailures).toBe(4);
    });
  });

  describe('Model Registry', () => {
    test('should validate version format', () => {
      expect(() => modelManager.validateVersionFormat('1.0.0')).not.toThrow();
      expect(() => modelManager.validateVersionFormat('2.1.3')).not.toThrow();
      expect(() => modelManager.validateVersionFormat('invalid')).toThrow('Invalid version format');
      expect(() => modelManager.validateVersionFormat('1.0')).toThrow('Invalid version format');
    });

    test('should compare versions correctly', () => {
      expect(modelManager.compareVersions('1.0.0', '1.0.1')).toBe(-1);
      expect(modelManager.compareVersions('1.1.0', '1.0.0')).toBe(1);
      expect(modelManager.compareVersions('2.0.0', '2.0.0')).toBe(0);
      expect(modelManager.compareVersions('1.0.0', '2.0.0')).toBe(-1);
      expect(modelManager.compareVersions('2.1.0', '2.0.5')).toBe(1);
    });

    test('should get model registry correctly', () => {
      const registry = modelManager.getModelRegistry('hunyuan-mt-7b');
      expect(registry).toBeDefined();
      expect(registry.versions).toHaveProperty('1.0.0');
      expect(registry.latest).toBe('2.0.0');

      expect(() => modelManager.getModelRegistry('non-existent')).toThrow('Model not found in registry');
    });

    test('should get available versions', () => {
      const versions = modelManager.getAvailableVersions();
      expect(versions).toEqual(['1.0.0', '1.1.0', '2.0.0']);
    });

    test('should get version changelog', () => {
      const changelog = modelManager.getVersionChangelog('1.1.0');
      expect(changelog.version).toBe('1.1.0');
      expect(changelog.features).toContain('Improved translation quality');
      expect(changelog.breaking).toBe(false);

      const changelogBreaking = modelManager.getVersionChangelog('2.0.0');
      expect(changelogBreaking.breaking).toBe(true);
    });
  });

  describe('Utility Methods', () => {
    test('should format memory sizes correctly', () => {
      expect(modelManager.formatMemorySize(0)).toBe('0 B');
      expect(modelManager.formatMemorySize(1024)).toBe('1.00 KB');
      expect(modelManager.formatMemorySize(1024 * 1024)).toBe('1.00 MB');
      expect(modelManager.formatMemorySize(1024 * 1024 * 1024)).toBe('1.00 GB');
      expect(modelManager.formatMemorySize(1536 * 1024 * 1024)).toBe('1.50 GB');
    });

    test('should get memory pressure ratio', () => {
      const memoryPressure = modelManager.getMemoryPressure();
      expect(memoryPressure).toBe(0.5); // 50MB used / 100MB total
      expect(memoryPressure).toBeGreaterThanOrEqual(0);
      expect(memoryPressure).toBeLessThanOrEqual(1);
    });

    test('should handle missing performance.memory gracefully', () => {
      delete global.performance.memory;
      const memoryPressure = modelManager.getMemoryPressure();
      expect(memoryPressure).toBe(0.5); // Default fallback
    });
  });

  describe('Health Check', () => {
    test('should perform basic health check', async () => {
      const health = await modelManager.performHealthCheck();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('checks');
      expect(health.checks).toHaveProperty('modelStatus');
      expect(health.checks).toHaveProperty('memoryUsage');
      expect(health.checks).toHaveProperty('performanceMetrics');
    });

    test('should detect health issues', async () => {
      // Simulate high memory pressure
      global.performance.memory.usedJSHeapSize = 1024 * 1024 * 95; // 95MB used
      global.performance.memory.totalJSHeapSize = 1024 * 1024 * 100; // 100MB total

      const health = await modelManager.performHealthCheck();
      expect(health.status).toBe('degraded');
      expect(health.checks.memoryUsage.status).toBe('warning');
    });
  });
});