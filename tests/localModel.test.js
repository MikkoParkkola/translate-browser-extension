/**
 * Tests for localModel.js (singleton factory)
 *
 * Tests the getModelManager singleton and the LocalModelManager subclass
 * that wraps WllamaModelManager with legacy compatibility methods.
 */

// Mock all lib dependencies
jest.mock('../src/lib/logger.js', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../src/lib/standardErrorHandler.js', () => ({
  standardErrorHandler: {
    handleError: jest.fn(function(error) { return error; }),
  },
}));

jest.mock('../src/lib/ModelValidator.js', () => ({
  ModelValidator: jest.fn().mockImplementation(() => ({
    validateModelIntegrity: jest.fn().mockResolvedValue({ valid: true }),
  })),
}));

jest.mock('../src/lib/ModelUpdater.js', () => ({
  ModelUpdater: jest.fn().mockImplementation(() => ({
    checkForUpdates: jest.fn().mockResolvedValue({ hasUpdate: false }),
    scheduleUpdateCheck: jest.fn(),
    getUpdateInfo: jest.fn().mockReturnValue({ hasUpdate: false }),
    destroy: jest.fn(),
  })),
}));

jest.mock('../src/lib/ModelPerformanceMonitor.js', () => ({
  ModelPerformanceMonitor: jest.fn().mockImplementation(() => ({
    startPerformanceMonitoring: jest.fn(),
    updatePerformanceStats: jest.fn(),
    getPerformanceSummary: jest.fn().mockReturnValue({}),
    destroy: jest.fn(),
  })),
}));

// Mock chrome storage
global.chrome = {
  runtime: { getURL: jest.fn(function(path) { return 'chrome-extension://test/' + path; }) },
  storage: {
    local: {
      get: jest.fn(function(keys, cb) { cb({}); }),
      set: jest.fn(function(data, cb) { cb(); }),
    },
  },
};

describe('localModel singleton', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('getModelManager returns a LocalModelManager instance', () => {
    var mod = require('../src/localModel.js');
    var manager = mod.getModelManager();

    expect(manager).toBeDefined();
    expect(manager.modelLoaded).toBe(false);
    expect(manager.isInitialized).toBe(false);
  });

  it('getModelManager returns the same instance (singleton)', () => {
    var mod = require('../src/localModel.js');
    var a = mod.getModelManager();
    var b = mod.getModelManager();

    expect(a).toBe(b);
  });

  it('different module loads share the same singleton via require cache', () => {
    var mod1 = require('../src/localModel.js');
    var mod2 = require('../src/localModel.js');

    expect(mod1.getModelManager()).toBe(mod2.getModelManager());
  });
});

describe('LocalModelManager (subclass)', () => {
  var LocalModelManager;

  beforeEach(() => {
    jest.resetModules();
    LocalModelManager = require('../src/localModel.js').LocalModelManager;
  });

  it('can be instantiated directly', () => {
    var manager = new LocalModelManager();
    expect(manager).toBeDefined();
    expect(manager.modelLoaded).toBe(false);
  });

  describe('legacy compatibility methods', () => {
    var manager;

    beforeEach(() => {
      manager = new LocalModelManager();
    });

    it('getModelInfo returns model info', async () => {
      var info = await manager.getModelInfo();

      expect(info).toHaveProperty('available');
      expect(info).toHaveProperty('ready');
      expect(info).toHaveProperty('backend', 'wllama');
      expect(info).toHaveProperty('name');
    });

    it('checkHealth delegates to performHealthCheck', async () => {
      var health = await manager.checkHealth();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('checks');
      expect(health).toHaveProperty('timestamp');
    });

    it('isModelReady returns false when not downloaded', async () => {
      var ready = await manager.isModelReady();
      expect(ready).toBe(false);
    });

    it('getModelSize returns 0 when no stored data', async () => {
      var size = await manager.getModelSize();
      expect(size).toBe(0);
    });

    it('getPerformanceStats returns summary', () => {
      var stats = manager.getPerformanceStats();
      expect(stats).toBeDefined();
    });

    it('checkForUpdates delegates to updater', async () => {
      var result = await manager.checkForUpdates();
      expect(result).toHaveProperty('hasUpdate', false);
    });

    it('hasUpdate returns boolean', async () => {
      var result = await manager.hasUpdate();
      expect(result).toBe(false);
    });

    it('validateModel returns invalid when not downloaded', async () => {
      var result = await manager.validateModel();
      expect(result.valid).toBe(false);
      expect(result.message).toContain('not downloaded');
    });

    it('formatBytes formats correctly', () => {
      expect(manager.formatBytes(0)).toBe('0 B');
      expect(manager.formatBytes(1024)).toBe('1 KB');
      expect(manager.formatBytes(1048576)).toBe('1 MB');
      expect(manager.formatBytes(1073741824)).toBe('1 GB');
      expect(manager.formatBytes(2489909952)).toMatch(/2\.\d+ GB/);
    });
  });

  describe('inherits from WllamaModelManager', () => {
    it('has downloadModel method', () => {
      var manager = new LocalModelManager();
      expect(typeof manager.downloadModel).toBe('function');
    });

    it('has translateText method', () => {
      var manager = new LocalModelManager();
      expect(typeof manager.translateText).toBe('function');
    });

    it('has translate alias', () => {
      var manager = new LocalModelManager();
      expect(typeof manager.translate).toBe('function');
    });

    it('has init method', () => {
      var manager = new LocalModelManager();
      expect(typeof manager.init).toBe('function');
    });

    it('has destroy method', () => {
      var manager = new LocalModelManager();
      expect(typeof manager.destroy).toBe('function');
    });

    it('has setModelUrls method', () => {
      var manager = new LocalModelManager();
      expect(typeof manager.setModelUrls).toBe('function');
    });
  });
});
