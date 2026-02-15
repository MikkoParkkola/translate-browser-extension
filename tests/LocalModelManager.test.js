/**
 * Tests for LocalModelManager (src/lib/LocalModelManager.js)
 *
 * Tests the wllama-backed model manager: init, download, translate,
 * model status, health checks, and cleanup.
 */

// Mock all dependencies that LocalModelManager imports from sibling files
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
    handleError: jest.fn(function(error) {
      var handled = new Error(error.message || 'handled error');
      handled.context = arguments[1];
      return handled;
    }),
  },
}));

var mockValidatorInstance = {
  validateModelIntegrity: jest.fn().mockResolvedValue({ valid: true }),
};
jest.mock('../src/lib/ModelValidator.js', () => ({
  ModelValidator: jest.fn().mockImplementation(() => mockValidatorInstance),
}));

var mockUpdaterInstance = {
  checkForUpdates: jest.fn().mockResolvedValue({ hasUpdate: false }),
  scheduleUpdateCheck: jest.fn(),
  getUpdateInfo: jest.fn().mockReturnValue({ hasUpdate: false }),
  destroy: jest.fn(),
};
jest.mock('../src/lib/ModelUpdater.js', () => ({
  ModelUpdater: jest.fn().mockImplementation(() => mockUpdaterInstance),
}));

var mockPerformanceMonitorInstance = {
  startPerformanceMonitoring: jest.fn(),
  updatePerformanceStats: jest.fn(),
  getPerformanceSummary: jest.fn().mockReturnValue({
    avgInferenceTime: 100,
    totalTranslations: 10,
  }),
  destroy: jest.fn(),
};
jest.mock('../src/lib/ModelPerformanceMonitor.js', () => ({
  ModelPerformanceMonitor: jest.fn().mockImplementation(() => mockPerformanceMonitorInstance),
}));

// Mock Worker
var mockWorkerPostMessage = jest.fn();
var mockWorkerTerminate = jest.fn();
var workerMessageHandler = null;

class MockWorker {
  constructor() {
    this.postMessage = mockWorkerPostMessage;
    this.terminate = mockWorkerTerminate;
    this._listeners = {};
  }

  addEventListener(event, handler) {
    this._listeners[event] = this._listeners[event] || [];
    this._listeners[event].push(handler);
    workerMessageHandler = handler;
  }

  removeEventListener(event, handler) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(function(h) { return h !== handler; });
    }
  }
}

global.Worker = MockWorker;

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

// Mock caches API
global.caches = {
  keys: jest.fn().mockResolvedValue([]),
  delete: jest.fn().mockResolvedValue(true),
};

var { LocalModelManager } = require('../src/lib/LocalModelManager.js');

describe('LocalModelManager', () => {
  var manager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new LocalModelManager();

    // Make postMessage simulate immediate worker response via microtask
    mockWorkerPostMessage.mockImplementation(function(msg) {
      Promise.resolve().then(function() {
        if (workerMessageHandler) {
          if (msg.type === 'loadModel') {
            workerMessageHandler({
              data: { type: 'modelLoaded', modelInfo: { n_ctx: 2048 } },
            });
          } else if (msg.type === 'translate') {
            workerMessageHandler({
              data: {
                type: 'translationComplete',
                requestId: msg.requestId,
                translatedText: 'translated text',
                tokensGenerated: 5,
              },
            });
          } else if (msg.type === 'cleanup') {
            workerMessageHandler({
              data: { type: 'cleanupComplete', requestId: msg.requestId },
            });
          }
        }
      });
    });
  });

  describe('constructor', () => {
    it('initializes with correct defaults', () => {
      expect(manager.isInitialized).toBe(false);
      expect(manager.modelLoaded).toBe(false);
      expect(manager.isDownloading).toBe(false);
      expect(manager.downloadProgress).toBe(0);
      expect(manager.maxRetries).toBe(3);
      expect(manager.consecutiveFailures).toBe(0);
    });

    it('has default model config with 6 shard URLs', () => {
      expect(manager.modelConfig.modelUrls).toHaveLength(6);
      expect(manager.modelConfig.modelUrls[0]).toContain('huggingface.co');
      expect(manager.modelConfig.totalSize).toBeGreaterThan(0);
      expect(manager.modelConfig.displayName).toBe('TranslateGemma 4B Q4_K_M');
    });

    it('initializes validator, updater, and performance monitor', () => {
      var { ModelValidator } = require('../src/lib/ModelValidator.js');
      var { ModelUpdater } = require('../src/lib/ModelUpdater.js');
      var { ModelPerformanceMonitor } = require('../src/lib/ModelPerformanceMonitor.js');

      expect(ModelValidator).toHaveBeenCalled();
      expect(ModelUpdater).toHaveBeenCalled();
      expect(ModelPerformanceMonitor).toHaveBeenCalled();
    });
  });

  describe('init', () => {
    it('initializes successfully', async () => {
      var result = await manager.init();

      expect(result.success).toBe(true);
      expect(manager.isInitialized).toBe(true);
    });

    it('returns early if already initialized', async () => {
      await manager.init();
      var result = await manager.init();

      expect(result.message).toBe('Already initialized');
    });

    it('schedules update check and starts monitoring', async () => {
      await manager.init();

      expect(mockUpdaterInstance.scheduleUpdateCheck).toHaveBeenCalled();
      expect(mockPerformanceMonitorInstance.startPerformanceMonitoring).toHaveBeenCalled();
    });
  });

  describe('getModelConfig (via modelConfig)', () => {
    it('returns correct shard URLs', () => {
      var urls = manager.modelConfig.modelUrls;
      expect(urls).toHaveLength(6);
      urls.forEach(function(url, i) {
        var shardNum = String(i + 1).padStart(5, '0');
        expect(url).toContain(shardNum + '-of-00006');
      });
    });

    it('returns correct inference config', () => {
      var config = manager.modelConfig.inference;
      expect(config.n_ctx).toBe(2048);
      expect(config.n_batch).toBe(512);
      expect(config.cache_type_k).toBe('q8_0');
      expect(config.cache_type_v).toBe('q8_0');
    });

    it('total size reflects 6-shard model', () => {
      expect(manager.modelConfig.totalSize).toBe(2489909952);
    });
  });

  describe('downloadModel', () => {
    beforeEach(async () => {
      await manager.init();
    });

    it('sets downloading state correctly', async () => {
      expect(manager.isDownloading).toBe(false);

      var downloadPromise = manager.downloadModel();
      expect(manager.isDownloading).toBe(true);

      await downloadPromise;

      expect(manager.isDownloading).toBe(false);
      expect(manager.modelLoaded).toBe(true);
    });

    it('throws if download already in progress', async () => {
      manager.isDownloading = true;
      await expect(manager.downloadModel()).rejects.toThrow('Download already in progress');
    });

    it('calls onProgress callback', async () => {
      var onProgress = jest.fn();

      mockWorkerPostMessage.mockImplementation(function(msg) {
        Promise.resolve().then(function() {
          if (workerMessageHandler && msg.type === 'loadModel') {
            workerMessageHandler({
              data: { type: 'progress', loaded: 500, total: 1000, progress: 50 },
            });
            workerMessageHandler({
              data: { type: 'modelLoaded', modelInfo: { n_ctx: 2048 } },
            });
          }
        });
      });

      await manager.downloadModel(onProgress);

      expect(onProgress).toHaveBeenCalled();
      var lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
      expect(lastCall.complete).toBe(true);
      expect(lastCall.progress).toBe(100);
    });

    it('resets consecutive failures on success', async () => {
      manager.consecutiveFailures = 2;

      await manager.downloadModel();

      expect(manager.consecutiveFailures).toBe(0);
      expect(manager.lastError).toBeNull();
    });
  });

  describe('cancelModelDownload', () => {
    it('sets downloadCancelled flag', () => {
      manager.modelWorker = { postMessage: jest.fn() };
      manager.cancelModelDownload();

      expect(manager.downloadCancelled).toBe(true);
      expect(manager.modelWorker.postMessage).toHaveBeenCalledWith({ type: 'abort' });
    });
  });

  describe('getModelStatus', () => {
    it('returns default status when no stored data', async () => {
      var status = await manager.getModelStatus();

      expect(status.downloaded).toBe(false);
      expect(status.loaded).toBe(false);
      expect(status.backend).toBe('wllama');
    });

    it('includes performance summary', async () => {
      var status = await manager.getModelStatus();

      expect(status.performance).toBeDefined();
      expect(status.performance.avgInferenceTime).toBe(100);
    });

    it('includes update info', async () => {
      var status = await manager.getModelStatus();

      expect(status.updateInfo).toBeDefined();
      expect(status.updateInfo.hasUpdate).toBe(false);
    });
  });

  describe('getModelInfo', () => {
    it('returns model info object', () => {
      var info = manager.getModelInfo();

      expect(info.name).toBe('TranslateGemma 4B Q4_K_M');
      expect(info.backend).toBe('wllama');
      expect(info.ready).toBe(false);
      expect(info.downloading).toBe(false);
    });

    it('reflects loaded state', () => {
      manager.modelLoaded = true;
      var info = manager.getModelInfo();
      expect(info.ready).toBe(true);
      expect(info.available).toBe(true);
    });
  });

  describe('getDownloadProgress', () => {
    it('returns current download state', () => {
      var progress = manager.getDownloadProgress();
      expect(progress.isDownloading).toBe(false);
      expect(progress.progress).toBe(0);
    });
  });

  describe('performHealthCheck', () => {
    it('returns unhealthy when not initialized', async () => {
      var health = await manager.performHealthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.checks.initialized.passed).toBe(false);
    });

    it('returns with backend check passing for wllama', async () => {
      await manager.init();
      var health = await manager.performHealthCheck();

      expect(health.checks.initialized.passed).toBe(true);
      expect(health.checks.backend.passed).toBe(true);
      expect(health.checks.backend.message).toContain('wllama');
    });
  });

  describe('setModelUrls', () => {
    it('updates model URLs', () => {
      var newUrls = ['http://example.com/shard-1.gguf', 'http://example.com/shard-2.gguf'];
      manager.setModelUrls(newUrls);

      expect(manager.modelConfig.modelUrls).toEqual(newUrls);
    });

    it('throws for empty array', () => {
      expect(function() { manager.setModelUrls([]); }).toThrow('non-empty array');
    });

    it('throws for non-array', () => {
      expect(function() { manager.setModelUrls('not-an-array'); }).toThrow('non-empty array');
    });
  });

  describe('deleteModel', () => {
    it('terminates worker and clears cache', async () => {
      manager.modelWorker = {
        postMessage: jest.fn(),
        terminate: jest.fn(),
      };
      manager.modelLoaded = true;

      await manager.deleteModel();

      expect(manager.modelWorker).toBeNull();
      expect(manager.modelLoaded).toBe(false);
    });

    it('cleans wllama caches', async () => {
      global.caches.keys.mockResolvedValue(['wllama-cache', 'other-cache', 'gguf-data']);

      await manager.deleteModel();

      expect(global.caches.delete).toHaveBeenCalledWith('wllama-cache');
      expect(global.caches.delete).toHaveBeenCalledWith('gguf-data');
      expect(global.caches.delete).not.toHaveBeenCalledWith('other-cache');
    });
  });

  describe('destroy', () => {
    it('cleans up all resources', async () => {
      await manager.init();

      await manager.destroy();

      expect(mockPerformanceMonitorInstance.destroy).toHaveBeenCalled();
      expect(mockUpdaterInstance.destroy).toHaveBeenCalled();
      expect(manager.isInitialized).toBe(false);
      expect(manager.modelLoaded).toBe(false);
    });
  });

  describe('_createTranslationPrompt', () => {
    it('formats translation prompt correctly', () => {
      var prompt = manager._createTranslationPrompt('hello', 'English', 'Finnish');

      expect(prompt).toContain('English');
      expect(prompt).toContain('Finnish');
      expect(prompt).toContain('hello');
      expect(prompt).toContain('Translation:');
    });
  });

  describe('_shouldRetryDownload', () => {
    it('returns true for network errors', () => {
      expect(manager._shouldRetryDownload(new Error('network error'))).toBe(true);
      expect(manager._shouldRetryDownload(new Error('timeout'))).toBe(true);
      expect(manager._shouldRetryDownload(new Error('Failed to fetch'))).toBe(true);
    });

    it('returns false for non-network errors', () => {
      expect(manager._shouldRetryDownload(new Error('memory error'))).toBe(false);
    });
  });

  describe('_shouldRetryTranslation', () => {
    it('returns false for memory/corruption errors', () => {
      expect(manager._shouldRetryTranslation(new Error('out of memory'))).toBe(false);
      expect(manager._shouldRetryTranslation(new Error('corrupted data'))).toBe(false);
    });

    it('returns true for other errors', () => {
      expect(manager._shouldRetryTranslation(new Error('timeout'))).toBe(true);
    });
  });

  describe('retrieveModel', () => {
    it('returns cached status when model downloaded', async () => {
      global.chrome.storage.local.get.mockImplementation(function(keys, cb) {
        cb({ model_status: { downloaded: true } });
      });

      var result = await manager.retrieveModel();
      expect(result).toEqual({ cached: true });
    });

    it('returns null when model not downloaded', async () => {
      global.chrome.storage.local.get.mockImplementation(function(keys, cb) {
        cb({});
      });

      var result = await manager.retrieveModel();
      expect(result).toBeNull();
    });
  });
});
