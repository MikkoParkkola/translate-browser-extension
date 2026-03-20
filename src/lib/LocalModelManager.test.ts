/**
 * Tests for LocalModelManager (src/lib/LocalModelManager.js)
 *
 * Tests the wllama-backed model manager: init, download, translate,
 * model status, health checks, and cleanup.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Hoist mock instances AND constructor mocks so vi.mock factories can reference them
const {
  mockValidatorInstance,
  mockUpdaterInstance,
  mockPerformanceMonitorInstance,
  MockModelValidator,
  MockModelUpdater,
  MockModelPerformanceMonitor,
} = vi.hoisted(() => {
  const validatorInst = {
    validateModelIntegrity: vi.fn().mockResolvedValue({ valid: true }),
  };
  const updaterInst = {
    checkForUpdates: vi.fn().mockResolvedValue({ hasUpdate: false }),
    scheduleUpdateCheck: vi.fn(),
    getUpdateInfo: vi.fn().mockReturnValue({ hasUpdate: false }),
    destroy: vi.fn(),
  };
  const perfMonInst = {
    startPerformanceMonitoring: vi.fn(),
    updatePerformanceStats: vi.fn(),
    getPerformanceSummary: vi.fn().mockReturnValue({
      avgInferenceTime: 100,
      totalTranslations: 10,
    }),
    destroy: vi.fn(),
  };
  return {
    mockValidatorInstance: validatorInst,
    mockUpdaterInstance: updaterInst,
    mockPerformanceMonitorInstance: perfMonInst,
    // NOTE: Must use regular functions, not arrows — arrows can't be constructors
    MockModelValidator: vi.fn(function () { return validatorInst; }),
    MockModelUpdater: vi.fn(function () { return updaterInst; }),
    MockModelPerformanceMonitor: vi.fn(function () { return perfMonInst; }),
  };
});

// Mock all dependencies — paths relative to THIS file (src/lib/)
vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('./standardErrorHandler.js', () => ({
  standardErrorHandler: {
    handleError: vi.fn((error: Error, context?: string) => {
      const handled = new Error(error.message || 'handled error') as Error & { context?: string };
      handled.context = context;
      return handled;
    }),
  },
}));

vi.mock('./ModelValidator.js', () => ({
  ModelValidator: MockModelValidator,
}));

vi.mock('./ModelUpdater.js', () => ({
  ModelUpdater: MockModelUpdater,
}));

vi.mock('./ModelPerformanceMonitor.js', () => ({
  ModelPerformanceMonitor: MockModelPerformanceMonitor,
}));

// Mock Worker
const mockWorkerPostMessage = vi.fn();
const mockWorkerTerminate = vi.fn();
let workerMessageHandler: ((event: { data: Record<string, unknown> }) => void) | null = null;

class MockWorker {
  postMessage = mockWorkerPostMessage;
  terminate = mockWorkerTerminate;
  _listeners: Record<string, Array<(event: { data: Record<string, unknown> }) => void>> = {};

  addEventListener(event: string, handler: (event: { data: Record<string, unknown> }) => void) {
    this._listeners[event] = this._listeners[event] || [];
    this._listeners[event].push(handler);
    workerMessageHandler = handler;
  }

  removeEventListener(event: string, handler: (event: { data: Record<string, unknown> }) => void) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter((h) => h !== handler);
    }
  }
}

// @ts-expect-error - Mock Worker in global scope
globalThis.Worker = MockWorker;

// Mock chrome storage
// @ts-expect-error - Mock chrome in global scope
globalThis.chrome = {
  runtime: { getURL: vi.fn((path: string) => 'chrome-extension://test/' + path) },
  storage: {
    local: {
      get: vi.fn((keys: unknown, cb: (result: Record<string, unknown>) => void) => { cb({}); }),
      set: vi.fn((data: unknown, cb: () => void) => { cb(); }),
    },
  },
};

// Mock caches API
// @ts-expect-error - Mock caches in global scope
globalThis.caches = {
  keys: vi.fn().mockResolvedValue([]),
  delete: vi.fn().mockResolvedValue(true),
};

// Vitest hoists vi.mock() above this import automatically
import { LocalModelManager } from './LocalModelManager.js';

describe('LocalModelManager', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let manager: InstanceType<typeof LocalModelManager> & Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new LocalModelManager();

    // Make postMessage simulate immediate worker response via microtask
    mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
      Promise.resolve().then(() => {
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

    it('initializes validator, updater, and performance monitor', async () => {
      const { ModelValidator } = await import('./ModelValidator.js');
      const { ModelUpdater } = await import('./ModelUpdater.js');
      const { ModelPerformanceMonitor } = await import('./ModelPerformanceMonitor.js');

      expect(ModelValidator).toHaveBeenCalled();
      expect(ModelUpdater).toHaveBeenCalled();
      expect(ModelPerformanceMonitor).toHaveBeenCalled();
    });
  });

  describe('init', () => {
    it('initializes successfully', async () => {
      const result = await manager.init();

      expect(result.success).toBe(true);
      expect(manager.isInitialized).toBe(true);
    });

    it('returns early if already initialized', async () => {
      await manager.init();
      const result = await manager.init();

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
      const urls: string[] = manager.modelConfig.modelUrls;
      expect(urls).toHaveLength(6);
      urls.forEach((url, i) => {
        const shardNum = String(i + 1).padStart(5, '0');
        expect(url).toContain(shardNum + '-of-00006');
      });
    });

    it('returns correct inference config', () => {
      const config = manager.modelConfig.inference;
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

      const downloadPromise = manager.downloadModel();
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
      const onProgress = vi.fn();

      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
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
      const lastCall = (onProgress.mock.calls[onProgress.mock.calls.length - 1] as unknown[])[0] as Record<string, unknown>;
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
      manager.modelWorker = { postMessage: vi.fn() };
      manager.cancelModelDownload();

      expect(manager.downloadCancelled).toBe(true);
      expect(manager.modelWorker.postMessage).toHaveBeenCalledWith({ type: 'abort' });
    });
  });

  describe('getModelStatus', () => {
    it('returns default status when no stored data', async () => {
      const status = await manager.getModelStatus();

      expect(status.downloaded).toBe(false);
      expect(status.loaded).toBe(false);
      expect(status.backend).toBe('wllama');
    });

    it('includes performance summary', async () => {
      const status = await manager.getModelStatus();

      expect(status.performance).toBeDefined();
      expect(status.performance.avgInferenceTime).toBe(100);
    });

    it('includes update info', async () => {
      const status = await manager.getModelStatus();

      expect(status.updateInfo).toBeDefined();
      expect(status.updateInfo.hasUpdate).toBe(false);
    });
  });

  describe('getModelInfo', () => {
    it('returns model info object', () => {
      const info = manager.getModelInfo();

      expect(info.name).toBe('TranslateGemma 4B Q4_K_M');
      expect(info.backend).toBe('wllama');
      expect(info.ready).toBe(false);
      expect(info.downloading).toBe(false);
    });

    it('reflects loaded state', () => {
      manager.modelLoaded = true;
      const info = manager.getModelInfo();
      expect(info.ready).toBe(true);
      expect(info.available).toBe(true);
    });
  });

  describe('getDownloadProgress', () => {
    it('returns current download state', () => {
      const progress = manager.getDownloadProgress();
      expect(progress.isDownloading).toBe(false);
      expect(progress.progress).toBe(0);
    });
  });

  describe('performHealthCheck', () => {
    it('returns unhealthy when not initialized', async () => {
      const health = await manager.performHealthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.checks.initialized.passed).toBe(false);
    });

    it('returns with backend check passing for wllama', async () => {
      await manager.init();
      const health = await manager.performHealthCheck();

      expect(health.checks.initialized.passed).toBe(true);
      expect(health.checks.backend.passed).toBe(true);
      expect(health.checks.backend.message).toContain('wllama');
    });
  });

  describe('setModelUrls', () => {
    it('updates model URLs', () => {
      const newUrls = ['http://example.com/shard-1.gguf', 'http://example.com/shard-2.gguf'];
      manager.setModelUrls(newUrls);

      expect(manager.modelConfig.modelUrls).toEqual(newUrls);
    });

    it('throws for empty array', () => {
      expect(() => { manager.setModelUrls([]); }).toThrow('non-empty array');
    });

    it('throws for non-array', () => {
      expect(() => { manager.setModelUrls('not-an-array'); }).toThrow('non-empty array');
    });
  });

  describe('deleteModel', () => {
    it('terminates worker and clears cache', async () => {
      manager.modelWorker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
      };
      manager.modelLoaded = true;

      await manager.deleteModel();

      expect(manager.modelWorker).toBeNull();
      expect(manager.modelLoaded).toBe(false);
    });

    it('cleans wllama caches', async () => {
      (globalThis.caches.keys as Mock).mockResolvedValue(['wllama-cache', 'other-cache', 'gguf-data']);

      await manager.deleteModel();

      expect(globalThis.caches.delete).toHaveBeenCalledWith('wllama-cache');
      expect(globalThis.caches.delete).toHaveBeenCalledWith('gguf-data');
      expect(globalThis.caches.delete).not.toHaveBeenCalledWith('other-cache');
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
      const prompt: string = manager._createTranslationPrompt('hello', 'English', 'Finnish');

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
      (globalThis.chrome.storage.local.get as Mock).mockImplementation(
        (keys: unknown, cb: (result: Record<string, unknown>) => void) => {
          cb({ model_status: { downloaded: true } });
        },
      );

      const result = await manager.retrieveModel();
      expect(result).toEqual({ cached: true });
    });

    it('returns null when model not downloaded', async () => {
      (globalThis.chrome.storage.local.get as Mock).mockImplementation(
        (keys: unknown, cb: (result: Record<string, unknown>) => void) => {
          cb({});
        },
      );

      const result = await manager.retrieveModel();
      expect(result).toBeNull();
    });
  });
});
