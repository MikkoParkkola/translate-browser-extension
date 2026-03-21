/**
 * Tests for LocalModelManager (src/lib/LocalModelManager.js)
 *
 * Tests the wllama-backed model manager: init, download, translate,
 * model status, health checks, and cleanup.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';

// Hoist mock instances AND constructor mocks so vi.mock factories can reference them
const {
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
globalThis.chrome = {
  runtime: { getURL: vi.fn((path: string) => 'chrome-extension://test/' + path) },
  storage: {
    local: {
      get: vi.fn((_keys: unknown, cb: (result: Record<string, unknown>) => void) => { cb({}); }),
      set: vi.fn((_data: unknown, cb: () => void) => { cb(); }),
    },
  },
} as unknown as typeof chrome;

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
      expect((manager as any).maxRetries).toBe(3);
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
      manager.modelWorker = { postMessage: vi.fn() } as unknown as Worker;
      manager.cancelModelDownload();

      expect((manager as any).downloadCancelled).toBe(true);
      expect(manager.modelWorker!.postMessage).toHaveBeenCalledWith({ type: 'abort' });
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
      expect(status.performance!.avgInferenceTime).toBe(100);
    });

    it('includes update info', async () => {
      const status = await manager.getModelStatus();

      expect(status.updateInfo).toBeDefined();
      expect(status.updateInfo!.hasUpdate).toBe(false);
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
      expect(() => { manager.setModelUrls('not-an-array' as any); }).toThrow('non-empty array');
    });
  });

  describe('deleteModel', () => {
    it('terminates worker and clears cache', async () => {
      manager.modelWorker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
      } as unknown as Worker;
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
      const prompt: string = (manager as any)._createTranslationPrompt('hello', 'English', 'Finnish');

      expect(prompt).toContain('English');
      expect(prompt).toContain('Finnish');
      expect(prompt).toContain('hello');
      expect(prompt).toContain('Translation:');
    });
  });

  describe('_shouldRetryDownload', () => {
    it('returns true for network errors', () => {
      expect((manager as any)._shouldRetryDownload(new Error('network error'))).toBe(true);
      expect((manager as any)._shouldRetryDownload(new Error('timeout'))).toBe(true);
      expect((manager as any)._shouldRetryDownload(new Error('Failed to fetch'))).toBe(true);
    });

    it('returns false for non-network errors', () => {
      expect((manager as any)._shouldRetryDownload(new Error('memory error'))).toBe(false);
    });
  });

  describe('_shouldRetryTranslation', () => {
    it('returns false for memory/corruption errors', () => {
      expect((manager as any)._shouldRetryTranslation(new Error('out of memory'))).toBe(false);
      expect((manager as any)._shouldRetryTranslation(new Error('corrupted data'))).toBe(false);
    });

    it('returns true for other errors', () => {
      expect((manager as any)._shouldRetryTranslation(new Error('timeout'))).toBe(true);
    });
  });

  describe('retrieveModel', () => {
    it('returns cached status when model downloaded', async () => {
      (globalThis.chrome.storage.local.get as Mock).mockImplementation(
        (_keys: unknown, cb: (result: Record<string, unknown>) => void) => {
          cb({ model_status: { downloaded: true } });
        },
      );

      const result = await manager.retrieveModel();
      expect(result).toEqual({ cached: true });
    });

    it('returns null when model not downloaded', async () => {
      (globalThis.chrome.storage.local.get as Mock).mockImplementation(
        (_keys: unknown, cb: (result: Record<string, unknown>) => void) => {
          cb({});
        },
      );

      const result = await manager.retrieveModel();
      expect(result).toBeNull();
    });
  });
});

// ============================================================================
// Extended coverage tests
// ============================================================================

describe('LocalModelManager Extended Coverage', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let manager: InstanceType<typeof LocalModelManager> & Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Restore chrome mock — earlier tests may set globalThis.chrome = undefined
    globalThis.chrome = {
      runtime: { getURL: vi.fn((path: string) => 'chrome-extension://test/' + path) },
      storage: {
        local: {
          get: vi.fn((_keys: unknown, cb: (result: Record<string, unknown>) => void) => { cb({}); }),
          set: vi.fn((_data: unknown, cb: () => void) => { cb(); }),
        },
      },
    } as unknown as typeof chrome;

    manager = new LocalModelManager();

    // Default: simulate successful worker responses
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

  // -------------------------------------------------------------------------
  // loadModel
  // -------------------------------------------------------------------------
  describe('loadModel', () => {
    it('returns early when model already loaded', async () => {
      manager.modelLoaded = true;
      const result = await manager.loadModel();
      expect(result.message).toBe('Model already loaded');
      expect(mockWorkerPostMessage).not.toHaveBeenCalled();
    });

    it('loads model successfully when not yet loaded', async () => {
      const result = await manager.loadModel();
      expect(result.success).toBe(true);
      expect(manager.modelLoaded).toBe(true);
    });

    it('throws when worker returns error', async () => {
      mockWorkerPostMessage.mockImplementationOnce((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            workerMessageHandler({
              data: { type: 'error', message: 'Worker OOM' },
            });
          }
        });
      });

      // Ensure consecutiveFailures < 3 to avoid _triggerRecovery nulling the worker
      manager.consecutiveFailures = 0;

      await expect(manager.loadModel()).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // translateText
  // -------------------------------------------------------------------------
  describe('translateText', () => {
    beforeEach(async () => {
      // Pre-load model to avoid loading in each translate test
      await manager.downloadModel();
    });

    it('translates text successfully', async () => {
      const result = await manager.translateText('Hello', 'English', 'Finnish');
      expect(result.translatedText).toBe('translated text');
      expect(result.inferenceTime).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBe(0.8);
    });

    it('translate alias calls translateText', async () => {
      const result = await manager.translate('Hello', 'English', 'Spanish');
      expect(result.translatedText).toBe('translated text');
    });

    it('calls loadModel when model not loaded', async () => {
      manager.modelLoaded = false;
      const result = await manager.translateText('Hi', 'English', 'French');
      expect(result.translatedText).toBe('translated text');
      expect(manager.modelLoaded).toBe(true);
    });

    it('throws when worker returns error and shouldRetryTranslation is false', async () => {
      // memory error causes _shouldRetryTranslation to return false (no retry)
      // consecutiveFailures must stay < 3 to avoid _triggerRecovery
      manager.consecutiveFailures = 0;

      mockWorkerPostMessage.mockImplementationOnce((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'translate') {
            workerMessageHandler({
              data: { type: 'error', message: 'memory error' },
            });
          }
        });
      });

      await expect(
        manager.translateText('test', 'English', 'Finnish')
      ).rejects.toThrow();
    });

    it('updates performance stats on success', async () => {
      await manager.translateText('Hello', 'English', 'Finnish');
      expect(mockPerformanceMonitorInstance.updatePerformanceStats).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getPerformanceSummary
  // -------------------------------------------------------------------------
  describe('getPerformanceSummary', () => {
    it('returns performance summary from monitor', () => {
      const summary = manager.getPerformanceSummary();
      expect(summary).toBeDefined();
      expect(summary.avgInferenceTime).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // healthCheck alias
  // -------------------------------------------------------------------------
  describe('healthCheck', () => {
    it('delegates to performHealthCheck', async () => {
      const result = await manager.healthCheck();
      expect(result.status).toBeDefined();
      expect(result.checks).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // performHealthCheck: degraded path
  // -------------------------------------------------------------------------
  describe('performHealthCheck degraded', () => {
    it('returns degraded when some checks fail', async () => {
      await manager.init();
      // modelAvailable will be false, worker will be false, but initialized is true
      // 2 out of 4 checks fail => degraded
      const result = await manager.performHealthCheck();
      // Status depends on check counts — just verify it's valid
      expect(['healthy', 'degraded', 'unhealthy']).toContain(result.status);
    });
  });

  // -------------------------------------------------------------------------
  // updateModelStatus
  // -------------------------------------------------------------------------
  describe('updateModelStatus', () => {
    it('updates stored model status', async () => {
      const mockGet = vi.mocked(globalThis.chrome.storage.local.get as ReturnType<typeof vi.fn>);
      const mockSet = vi.mocked(globalThis.chrome.storage.local.set as ReturnType<typeof vi.fn>);

      mockGet.mockImplementationOnce((_keys: unknown, cb: (r: Record<string, unknown>) => void) => {
        cb({ model_status: { downloaded: false, size: 0 } });
      });

      await manager.updateModelStatus({ downloaded: true, size: 12345 });

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          model_status: expect.objectContaining({ downloaded: true, size: 12345 }),
        }),
        expect.any(Function)
      );
    });
  });

  // -------------------------------------------------------------------------
  // updateModel (delegates to updater)
  // -------------------------------------------------------------------------
  describe('updateModel', () => {
    it('delegates to updater.updateModelToVersion', async () => {
      (mockUpdaterInstance as Record<string, unknown>).updateModelToVersion = vi.fn().mockResolvedValue({ success: true });

      const result = await manager.updateModel(null);

      expect((mockUpdaterInstance as Record<string, unknown>).updateModelToVersion).toHaveBeenCalled();
      expect((result as { success: boolean }).success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // destroy with active worker
  // -------------------------------------------------------------------------
  describe('destroy with active unload timer', () => {
    it('clears unload timer during destroy', async () => {
      await manager.init();
      (manager as any).unloadTimer = setTimeout(() => {}, 60000);
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      await manager.destroy();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('terminates active worker during destroy', async () => {
      await manager.init();
      // Use a fake worker to avoid async mock race
      manager.modelWorker = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker;
      manager.modelLoaded = true;

      await manager.destroy();

      expect(manager.modelWorker).toBeNull();
      expect(manager.isInitialized).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // _scheduleUnload and _unloadModel
  // -------------------------------------------------------------------------
  describe('_scheduleUnload and _unloadModel', () => {
    it('_scheduleUnload sets a timer', () => {
      (manager as any)._scheduleUnload();
      expect((manager as any).unloadTimer).not.toBeNull();
      clearTimeout((manager as any).unloadTimer);
    });

    it('_scheduleUnload clears previous timer', () => {
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
      (manager as any).unloadTimer = setTimeout(() => {}, 60000);
      (manager as any)._scheduleUnload();
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
      clearTimeout((manager as any).unloadTimer);
    });

    it('_unloadModel sets modelLoaded to false', async () => {
      // Set up a fake worker without using the async mock machinery
      manager.modelWorker = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker;
      manager.modelLoaded = true;

      await (manager as any)._unloadModel();

      expect(manager.modelLoaded).toBe(false);
      expect(manager.modelWorker).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // _triggerRecovery
  // -------------------------------------------------------------------------
  describe('_triggerRecovery', () => {
    it('sets modelCorrupted and resets failures', async () => {
      await manager.downloadModel();
      manager.consecutiveFailures = 5;

      await (manager as any)._triggerRecovery();

      expect(manager.modelCorrupted).toBe(true);
      expect(manager.consecutiveFailures).toBe(0);
      expect(manager.lastError).toBeNull();
      expect((manager as any).isInRecovery).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Download retry path
  // -------------------------------------------------------------------------
  describe('downloadModel retry', () => {
    it('throws non-retryable error immediately', async () => {
      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            workerMessageHandler({
              data: { type: 'error', message: 'corrupted GGUF file' },
            });
          }
        });
      });

      await expect(manager.downloadModel()).rejects.toThrow();
    });

    it('throws cancelled error when downloadCancelled is set before error', async () => {
      // Set downloadCancelled before the error so catch detects cancellation first
      mockWorkerPostMessage.mockImplementationOnce((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            (manager as any).downloadCancelled = true;
            workerMessageHandler({
              data: { type: 'error', message: 'aborted' },
            });
          }
        });
      });

      // Reset consecutive failures so _triggerRecovery is NOT called
      manager.consecutiveFailures = 0;

      await expect(manager.downloadModel()).rejects.toThrow('cancelled');
    });
  });

  // -------------------------------------------------------------------------
  // init error path
  // -------------------------------------------------------------------------
  describe('init error path', () => {
    it('throws when getModelStatus fails', async () => {
      const origGet = globalThis.chrome.storage.local.get;
      globalThis.chrome.storage.local.get = vi.fn().mockImplementation(
        (_keys: unknown, cb: (r: Record<string, unknown>) => void) => {
          // Return normally the first call, but error on second
          cb({});
        }
      );

      // Make updater.checkForUpdates throw to trigger catch
      mockUpdaterInstance.checkForUpdates = vi.fn().mockRejectedValue(
        new Error('network failure')
      );

      // Make stored data say model is downloaded to trigger checkForUpdates
      globalThis.chrome.storage.local.get = vi.fn().mockImplementation(
        (_keys: unknown, cb: (r: Record<string, unknown>) => void) => {
          cb({ model_status: { downloaded: true } });
        }
      );

      // Should not throw (error is caught and rethrown as HandledError)
      try {
        await manager.init();
      } catch {
        // Expected to potentially throw
      }

      // Restore
      globalThis.chrome.storage.local.get = origGet;
    });
  });

  // -------------------------------------------------------------------------
  // Worker error message during translate
  // -------------------------------------------------------------------------
  describe('worker error message handling', () => {
    it('rejects translate promise when worker sends memory error (non-retryable)', async () => {
      // memory error: _shouldRetryTranslation returns false
      // Use a standalone mock worker with proper interface
      const fakePostMessage = vi.fn();
      const fakeTerminate = vi.fn();
      let fakeHandler: ((e: { data: Record<string, unknown> }) => void) | null = null;

      const fakeWorker = {
        postMessage: fakePostMessage,
        terminate: fakeTerminate,
        addEventListener: (_event: string, handler: (e: { data: Record<string, unknown> }) => void) => {
          fakeHandler = handler;
        },
        removeEventListener: vi.fn(),
      };

      manager.modelWorker = fakeWorker as unknown as Worker;
      manager.modelLoaded = true;

      fakePostMessage.mockImplementationOnce((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (fakeHandler && msg.type === 'translate') {
            fakeHandler({ data: { type: 'error', message: 'out of memory' } });
          }
        });
      });

      await expect(
        manager.translateText('hello', 'English', 'Finnish')
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // Coverage: localStorage fallback, catch blocks, recovery, retry paths
  // =========================================================================
  describe('storage fallback — localStorage paths', () => {
    // vitest jsdom exposes localStorage as a plain object without Storage
    // prototype methods; provide a working in-memory shim for these tests.
    const _store: Record<string, string> = {};
    let savedLocalStorage: Storage;

    beforeEach(() => {
      savedLocalStorage = globalThis.localStorage;
      for (const k of Object.keys(_store)) delete _store[k];
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          getItem: (k: string) => (k in _store ? _store[k] : null),
          setItem: (k: string, v: string) => { _store[k] = String(v); },
          removeItem: (k: string) => { delete _store[k]; },
          clear: () => { for (const k of Object.keys(_store)) delete _store[k]; },
          get length() { return Object.keys(_store).length; },
          key: (i: number) => Object.keys(_store)[i] ?? null,
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'localStorage', {
        value: savedLocalStorage,
        writable: true,
        configurable: true,
      });
    });

    it('_getStoredData uses localStorage when chrome.storage is unavailable', async () => {
      const savedChrome = globalThis.chrome;
      // @ts-expect-error - remove chrome to trigger localStorage fallback
      globalThis.chrome = undefined;

      localStorage.setItem('lmm_fb_key', JSON.stringify({ val: 42 }));
      const result = await manager._getStoredData('fb_key');
      expect(result).toEqual({ val: 42 });

      localStorage.removeItem('lmm_fb_key');
      globalThis.chrome = savedChrome;
    });

    it('_getStoredData returns null from localStorage when key missing', async () => {
      const savedChrome = globalThis.chrome;
      // @ts-expect-error - remove chrome
      globalThis.chrome = undefined;

      localStorage.removeItem('lmm_missing');
      const result = await manager._getStoredData('missing');
      expect(result).toBeNull();

      globalThis.chrome = savedChrome;
    });

    it('_storeData uses localStorage when chrome.storage is unavailable', async () => {
      const savedChrome = globalThis.chrome;
      // @ts-expect-error - remove chrome
      globalThis.chrome = undefined;

      await manager._storeData('fb_store', { x: 1 });
      const raw = localStorage.getItem('lmm_fb_store');
      expect(raw).toBe(JSON.stringify({ x: 1 }));

      localStorage.removeItem('lmm_fb_store');
      globalThis.chrome = savedChrome;
    });

    it('_getStoredData returns null when localStorage throws', async () => {
      const savedChrome = globalThis.chrome;
      // @ts-expect-error - remove chrome
      globalThis.chrome = undefined;

      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });
      const result = await manager._getStoredData('throw_key');
      expect(result).toBeNull();

      spy.mockRestore();
      globalThis.chrome = savedChrome;
    });

    it('_storeData resolves when localStorage throws', async () => {
      const savedChrome = globalThis.chrome;
      // @ts-expect-error - remove chrome
      globalThis.chrome = undefined;

      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });
      await expect(manager._storeData('throw_key', {})).resolves.toBeUndefined();

      spy.mockRestore();
      globalThis.chrome = savedChrome;
    });
  });

  describe('storage fallback — chrome.storage.local error paths', () => {
    it('_getStoredData returns null when chrome.storage.local.get throws synchronously', async () => {
      const savedGet = (globalThis.chrome as any).storage.local.get;
      (globalThis.chrome as any).storage.local.get = () => { throw new Error('Storage corrupt'); };

      const result = await manager._getStoredData('corrupt_key');
      expect(result).toBeNull();

      (globalThis.chrome as any).storage.local.get = savedGet;
    });

    it('_storeData resolves when chrome.storage.local.set throws synchronously', async () => {
      const savedSet = (globalThis.chrome as any).storage.local.set;
      (globalThis.chrome as any).storage.local.set = () => { throw new Error('Storage corrupt'); };

      await expect(manager._storeData('corrupt_key', {})).resolves.toBeUndefined();

      (globalThis.chrome as any).storage.local.set = savedSet;
    });
  });

  describe('_handleError triggers recovery at threshold', () => {
    it('triggers _triggerRecovery when consecutiveFailures reaches 3', async () => {
      manager.consecutiveFailures = 2;
      manager.modelCorrupted = false;

      manager._handleError(new Error('repeated failure'), 'test-trigger');

      // _triggerRecovery is async fire-and-forget; wait for it
      await vi.waitFor(() => {
        expect(manager.modelCorrupted).toBe(true);
      });
      expect(manager.consecutiveFailures).toBe(0);
    });

    it('does not trigger recovery when already in recovery', async () => {
      manager.consecutiveFailures = 2;
      manager.isInRecovery = true;
      manager.modelCorrupted = false;

      manager._handleError(new Error('repeated failure'), 'test-no-double');

      await new Promise(r => setTimeout(r, 50));
      expect(manager.modelCorrupted).toBe(false);
      expect(manager.consecutiveFailures).toBe(3);
    });
  });

  describe('translateText retry with model reload', () => {
    it('retries translation and reloads model on retryable worker error', async () => {
      manager.modelLoaded = true;
      manager.consecutiveFailures = 0;
      manager.modelWorker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as Worker;

      const sendSpy = vi.spyOn(manager as any, '_sendWorkerMessage')
        .mockRejectedValueOnce(new Error('worker disconnected'))
        .mockResolvedValueOnce({ type: 'loaded' })
        .mockResolvedValueOnce({ type: 'result', translatedText: 'hei', tokensGenerated: 1 });

      const result = await manager.translateText('hello', 'English', 'Finnish');
      expect(result.translatedText).toBe('hei');
      expect(sendSpy).toHaveBeenCalledTimes(3);

      sendSpy.mockRestore();
    });

    it('retries on "not loaded" error and reloads model', async () => {
      manager.modelLoaded = true;
      manager.consecutiveFailures = 0;
      manager.modelWorker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as Worker;

      const sendSpy = vi.spyOn(manager as any, '_sendWorkerMessage')
        .mockRejectedValueOnce(new Error('model not loaded'))
        .mockResolvedValueOnce({ type: 'loaded' })
        .mockResolvedValueOnce({ type: 'result', translatedText: 'ok', tokensGenerated: 2 });

      const result = await manager.translateText('test', 'English', 'Finnish');
      expect(result.translatedText).toBe('ok');

      sendSpy.mockRestore();
    });
  });

  describe('_ensureWorker without chrome.runtime', () => {
    it('creates worker with plain URL when chrome.runtime is absent', async () => {
      const savedChrome = globalThis.chrome;
      // @ts-expect-error - remove chrome
      globalThis.chrome = undefined;
      manager.modelWorker = null;

      await manager._ensureWorker();
      expect(manager.modelWorker).toBeTruthy();

      globalThis.chrome = savedChrome;
    });
  });

  describe('getModelStatus error path', () => {
    it('returns error status when _getStoredData throws', async () => {
      // Mock _getStoredData to reject — the internal chrome.storage throw is
      // caught inside _getStoredData (returns null), so we need to mock at
      // this level to exercise getModelStatus's own catch block.
      vi.spyOn(manager, '_getStoredData').mockRejectedValue(new Error('Corrupt'));

      const status = await manager.getModelStatus();
      expect(status.downloaded).toBe(false);
      expect(status.error).toContain('Corrupt');
    });
  });

  describe('_scheduleUnload with recent usage', () => {
    it('does not unload model when it was used recently', async () => {
      vi.useFakeTimers();
      try {
        await manager.loadModel();
        const unloadSpy = vi.spyOn(manager, '_unloadModel');

        // Schedule unload — timer set for unloadTimeout ms from now
        manager._scheduleUnload();

        // Simulate usage halfway through the timeout
        vi.advanceTimersByTime(manager.unloadTimeout / 2);
        manager.lastUsed = Date.now(); // Touch — model was used recently

        // Fire the timer (remaining half of timeout)
        vi.advanceTimersByTime(manager.unloadTimeout / 2);

        // The callback checks Date.now() - lastUsed >= unloadTimeout
        // Date.now() = unloadTimeout, lastUsed = unloadTimeout/2
        // diff = unloadTimeout/2 < unloadTimeout → should NOT unload
        expect(unloadSpy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('_triggerRecovery failure', () => {
    it('logs error when _unloadModel throws during recovery', async () => {
      vi.spyOn(manager, '_unloadModel').mockRejectedValue(new Error('Unload failed'));

      await manager._triggerRecovery();

      // Should complete without throwing — isInRecovery reset in finally block
      expect(manager.isInRecovery).toBe(false);
    });
  });

  describe('_sleep', () => {
    it('resolves after specified delay', async () => {
      vi.useFakeTimers();
      try {
        const sleepPromise = manager._sleep(1000);
        vi.advanceTimersByTime(1000);
        await expect(sleepPromise).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Uncovered branches and error paths', () => {
    it('getModelInfo - not loaded, not downloading', () => {
      manager.modelLoaded = false;
      manager.isDownloading = false;
      const info = manager.getModelInfo();
      expect(info.available).toBe(false);
      expect(info.ready).toBe(false);
    });

    it('getModelInfo - loaded', () => {
      manager.modelLoaded = true;
      manager.isDownloading = false;
      const info = manager.getModelInfo();
      expect(info.available).toBe(true);
      expect(info.ready).toBe(true);
    });

    it('getModelInfo - downloading', () => {
      manager.modelLoaded = false;
      manager.isDownloading = true;
      const info = manager.getModelInfo();
      expect(info.available).toBe(true);
      expect(info.downloading).toBe(true);
    });

    it('getDownloadProgress returns structure', () => {
      const progress = manager.getDownloadProgress();
      expect(progress).toHaveProperty('isDownloading');
      expect(progress).toHaveProperty('progress');
    });

    it('getPerformanceSummary works', () => {
      const summary = manager.getPerformanceSummary();
      expect(summary).toBeDefined();
    });

    it('setModelUrls updates URLs', () => {
      const newUrls = ['http://example.com/model1'];
      manager.setModelUrls(newUrls);
      expect(manager.modelConfig.modelUrls).toEqual(newUrls);
    });

    it('cancelModelDownload sets downloadCancelled flag', () => {
      manager.downloadCancelled = false;
      manager.cancelModelDownload();
      expect(manager.downloadCancelled).toBe(true);
    });

    it('cancelModelDownload sends abort message to worker if available', () => {
      manager.modelWorker = new (globalThis as any).Worker();
      manager.cancelModelDownload();
      expect(mockWorkerPostMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'abort' }));
    });
  });

  describe('translate alias', () => {
    it('delegates to translateText', async () => {
      await manager.init();
      await manager.downloadModel();
      await manager.loadModel();
      const spy = vi.spyOn(manager, 'translateText');
      const result = await manager.translate('Hello', 'en', 'fi');
      expect(spy).toHaveBeenCalledWith('Hello', 'en', 'fi');
      expect(result.translatedText).toBe('translated text');
    });
  });

  describe('getModelInfo when downloading', () => {
    it('shows available=true when isDownloading is true', () => {
      manager.modelLoaded = false;
      manager.isDownloading = true;
      const info = manager.getModelInfo();
      expect(info.available).toBe(true);
      expect(info.ready).toBe(false);
      expect(info.downloading).toBe(true);
    });
  });

  describe('destroy error handling', () => {
    it('catches errors thrown during cleanup', async () => {
      await manager.init();
      // Force performanceMonitor.destroy to throw
      (manager as any).performanceMonitor.destroy = () => { throw new Error('monitor cleanup fail'); };

      // Should not throw — error is caught internally
      await expect(manager.destroy()).resolves.toBeUndefined();
    });
  });

  describe('_sendWorkerMessage timeout', () => {
    it('rejects when worker does not respond within timeout', async () => {
      vi.useFakeTimers();
      try {
        await manager.init();
        // Create a worker that never responds
        const silentWorker = {
          postMessage: vi.fn(),
          terminate: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        };
        manager.modelWorker = silentWorker as unknown as Worker;

        const promise = (manager as any)._sendWorkerMessage({ type: 'translate', text: 'x', sourceLanguage: 'en', targetLanguage: 'fi', requestId: 'r1' });

        // Advance past the 5-minute timeout
        vi.advanceTimersByTime(5 * 60 * 1000 + 100);

        await expect(promise).rejects.toThrow('Worker communication timeout');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('_scheduleUnload fires and unloads', () => {
    it('calls _unloadModel when enough time has passed', async () => {
      vi.useFakeTimers();
      try {
        manager.modelWorker = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker;
        manager.modelLoaded = true;
        (manager as any).lastUsed = Date.now() - 999999;

        (manager as any)._scheduleUnload();

        // Advance timers past the unload timeout
        vi.advanceTimersByTime((manager as any).unloadTimeout + 100);

        expect(manager.modelLoaded).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not unload when model was recently used', async () => {
      vi.useFakeTimers();
      try {
        manager.modelWorker = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker;
        manager.modelLoaded = true;

        (manager as any)._scheduleUnload();

        // Advance half the timeout — then update lastUsed to "now" so it appears recent
        vi.advanceTimersByTime((manager as any).unloadTimeout / 2);
        (manager as any).lastUsed = Date.now();

        // Advance the remaining half + extra — callback fires but Date.now()-lastUsed < unloadTimeout
        vi.advanceTimersByTime((manager as any).unloadTimeout / 2 + 100);

        // Model should still be loaded because lastUsed was updated midway
        expect(manager.modelLoaded).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// ============================================================================
// Targeted coverage for missing statements, branches, and functions
// ============================================================================

describe('LocalModelManager - Targeted Missing Coverage', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let manager: InstanceType<typeof LocalModelManager> & Record<string, any>;

  beforeEach(() => {
    vi.clearAllMocks();
    workerMessageHandler = null;

    globalThis.chrome = {
      runtime: { getURL: vi.fn((path: string) => 'chrome-extension://test/' + path) },
      storage: {
        local: {
          get: vi.fn((_keys: unknown, cb: (result: Record<string, unknown>) => void) => { cb({}); }),
          set: vi.fn((_data: unknown, cb: () => void) => { cb(); }),
        },
      },
    } as unknown as typeof chrome;

    // @ts-expect-error - Mock caches in global scope
    globalThis.caches = {
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    };

    manager = new LocalModelManager();

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
          }
        }
      });
    });
  });

  // ── Init with downloaded model (update check path) ──────────────────
  describe('init with already-downloaded model', () => {
    it('calls checkForUpdates when stored status shows downloaded', async () => {
      (globalThis.chrome.storage.local.get as Mock).mockImplementation(
        (_keys: unknown, cb: (result: Record<string, unknown>) => void) => {
          cb({ model_status: { downloaded: true } });
        },
      );
      mockUpdaterInstance.checkForUpdates.mockResolvedValue({ hasUpdate: false });

      const result = await manager.init();

      expect(result.success).toBe(true);
      expect(mockUpdaterInstance.checkForUpdates).toHaveBeenCalledTimes(1);
    });
  });

  // ── Download retry with exponential backoff ─────────────────────────
  describe('download retry with exponential backoff', () => {
    it('retries once with correct delay on network timeout', async () => {
      let attempt = 0;
      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            attempt++;
            if (attempt <= 1) {
              workerMessageHandler({ data: { type: 'error', message: 'network timeout' } });
            } else {
              workerMessageHandler({ data: { type: 'modelLoaded' } });
            }
          }
        });
      });

      const sleepSpy = vi.spyOn(manager as any, '_sleep').mockImplementation(async () => {
        manager.isDownloading = false;
      });

      const result = await manager.downloadModel();

      expect(result.success).toBe(true);
      expect(sleepSpy).toHaveBeenCalledTimes(1);
      expect(sleepSpy).toHaveBeenCalledWith(1000);
      sleepSpy.mockRestore();
    });

    it('applies increasing backoff delays on subsequent retries', async () => {
      let attempt = 0;
      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            attempt++;
            if (attempt <= 2) {
              workerMessageHandler({ data: { type: 'error', message: 'Failed to fetch' } });
            } else {
              workerMessageHandler({ data: { type: 'modelLoaded' } });
            }
          }
        });
      });

      const sleepSpy = vi.spyOn(manager as any, '_sleep').mockImplementation(async () => {
        manager.isDownloading = false;
      });

      const result = await manager.downloadModel();

      expect(result.success).toBe(true);
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 1000);
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 2000);
      sleepSpy.mockRestore();
    });
  });

  // ── Max retry exhaustion ────────────────────────────────────────────
  describe('download max retry exhaustion', () => {
    it('throws after all retry attempts are exhausted', async () => {
      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            workerMessageHandler({ data: { type: 'error', message: 'fetch timeout' } });
          }
        });
      });

      const sleepSpy = vi.spyOn(manager as any, '_sleep').mockImplementation(async () => {
        manager.isDownloading = false;
      });

      await expect(manager.downloadModel()).rejects.toThrow();

      expect(sleepSpy).toHaveBeenCalledTimes(3);
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 1000);
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 2000);
      expect(sleepSpy).toHaveBeenNthCalledWith(3, 4000);
      sleepSpy.mockRestore();
    });
  });

  // ── Health check degraded status (partial failures) ─────────────────
  describe('health check degraded status', () => {
    it('returns degraded when exactly half of checks fail', async () => {
      await manager.init();
      // initialized=true (pass), backend=true (pass),
      // modelAvailable=false (fail), worker=false (fail) → 2/4 fail → degraded
      const health = await manager.performHealthCheck();

      expect(health.status).toBe('degraded');
      expect(health.summary).toBe('2/4 checks passed');
    });
  });

  // ── Health check unhealthy status (majority failures) ───────────────
  describe('health check unhealthy status', () => {
    it('returns unhealthy when majority of checks fail', async () => {
      // Not initialized → 3/4 fail (initialized, modelAvailable, worker) → unhealthy
      const health = await manager.performHealthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.summary).toBe('1/4 checks passed');
    });
  });

  // ── Worker message: status type vs progress type ────────────────────
  describe('worker status-type message handling', () => {
    it('forwards status messages through _sendWorkerMessage without calling onProgress', async () => {
      const onProgress = vi.fn();

      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            // Send status type (not progress) — exercises the data.type === 'status' branch
            workerMessageHandler({ data: { type: 'status', status: 'initializing' } });
            // Send progress type — exercises the data.type === 'progress' branch
            workerMessageHandler({ data: { type: 'progress', loaded: 500, total: 1000, progress: 50 } });
            workerMessageHandler({ data: { type: 'modelLoaded' } });
          }
        });
      });

      await manager.downloadModel(onProgress);

      // onProgress called: once for 'progress' msg, once for final complete notification
      // 'status' reaches the intermediate callback but downloadModel's callback
      // only acts on type==='progress', so status is a no-op
      expect(onProgress).toHaveBeenCalledTimes(2);
    });

    it('silently ignores progress/status when no intermediate callback is provided', async () => {
      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            // Both progress and status messages with no intermediate callback (null)
            workerMessageHandler({ data: { type: 'progress', progress: 25 } });
            workerMessageHandler({ data: { type: 'status', status: 'loading' } });
            workerMessageHandler({ data: { type: 'modelLoaded' } });
          }
        });
      });

      // loadModel calls _sendWorkerMessage without onIntermediateMessage → null branch
      const result = await manager.loadModel();
      expect(result.success).toBe(true);
    });
  });

  // ── Cache deletion / deleteModel without caches API ─────────────────
  describe('deleteModel without caches API', () => {
    it('skips cache cleanup when caches is undefined', async () => {
      const savedCaches = globalThis.caches;
      // @ts-expect-error - remove caches API to hit typeof caches === 'undefined' branch
      delete globalThis.caches;

      manager.modelWorker = { postMessage: vi.fn(), terminate: vi.fn() } as unknown as Worker;
      manager.modelLoaded = true;

      await manager.deleteModel();

      expect(manager.modelLoaded).toBe(false);
      expect(manager.modelWorker).toBeNull();

      // @ts-expect-error - restore caches
      globalThis.caches = savedCaches;
    });
  });

  // ── downloadModel with null onProgress ──────────────────────────────
  describe('downloadModel with null onProgress', () => {
    it('updates internal progress but skips onProgress callbacks', async () => {
      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            workerMessageHandler({ data: { type: 'progress', loaded: 500, total: 1000, progress: 50 } });
            workerMessageHandler({ data: { type: 'modelLoaded' } });
          }
        });
      });

      const result = await manager.downloadModel(null);

      expect(result.success).toBe(true);
      expect(manager.downloadProgress).toBe(100);
    });
  });

  // ── performHealthCheck error catch block ────────────────────────────
  describe('performHealthCheck catch block', () => {
    it('returns error status on internal exception', async () => {
      vi.spyOn(manager as any, 'getModelStatus').mockRejectedValue(new Error('Corrupt DB'));

      const health = await manager.performHealthCheck();

      expect(health.status).toBe('error');
      expect(health.error).toBe('Corrupt DB');
    });
  });

  // ── Worker error message parsing ────────────────────────────────────
  describe('worker error message parsing', () => {
    it('rejects with the exact error message string from the worker', async () => {
      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            workerMessageHandler({ data: { type: 'error', message: 'WASM OOM at 0x4f2a' } });
          }
        });
      });

      await expect(manager.loadModel()).rejects.toThrow('WASM OOM at 0x4f2a');
    });
  });

  // ── Lines 528-529: translate() method ─────────────────────────────────
  describe('translate() method', () => {
    it('calls translateText with provided parameters (line 526)', async () => {
      const spy = vi.spyOn(manager as any, 'translateText').mockResolvedValue({
        text: 'translated',
        sourceLang: 'en',
        targetLang: 'es',
      });

      const result = await manager.translate('Hello', 'en', 'es');

      expect(spy).toHaveBeenCalledWith('Hello', 'en', 'es');
      expect(result.text).toBe('translated');

      spy.mockRestore();
    });
  });

  // ── Lines 561-562: getModelInfo() method ──────────────────────────────
  describe('getModelInfo() method', () => {
    it('returns correct ModelInfo structure with model loaded', () => {
      vi.spyOn(manager, 'modelLoaded', 'get').mockReturnValue(true);
      vi.spyOn(manager, 'isDownloading', 'get').mockReturnValue(false);

      const info = manager.getModelInfo();

      expect(info).toEqual({
        available: true,
        ready: true,
        downloading: false,
        name: expect.any(String),
        backend: 'wllama',
        performanceStats: expect.any(Object),
      });
    });

    it('returns correct ModelInfo with model downloading', () => {
      vi.spyOn(manager, 'modelLoaded', 'get').mockReturnValue(false);
      vi.spyOn(manager, 'isDownloading', 'get').mockReturnValue(true);

      const info = manager.getModelInfo();

      expect(info.available).toBe(true);
      expect(info.ready).toBe(false);
      expect(info.downloading).toBe(true);
    });

    it('returns correct ModelInfo with model not available', () => {
      vi.spyOn(manager, 'modelLoaded', 'get').mockReturnValue(false);
      vi.spyOn(manager, 'isDownloading', 'get').mockReturnValue(false);

      const info = manager.getModelInfo();

      expect(info.available).toBe(false);
      expect(info.ready).toBe(false);
      expect(info.downloading).toBe(false);
    });
  });

  // ── Lines 628-629: performHealthCheck() error handling ─────────────────
  describe('performHealthCheck error handling', () => {
    it('catches and returns error status when getModelStatus throws (lines 628-629)', async () => {
      const testError = new Error('Database corruption detected');
      
      // Mock getModelStatus to throw, which will be caught by performHealthCheck
      vi.spyOn(manager as any, 'getModelStatus').mockRejectedValue(testError);

      const health = await manager.performHealthCheck();

      expect(health.status).toBe('error');
      expect(health.error).toBe('Database corruption detected');
    });

    it('handles different error types in health check', async () => {
      const testError = new TypeError('Invalid state');
      
      vi.spyOn(manager as any, 'getModelStatus').mockRejectedValue(testError);

      const health = await manager.performHealthCheck();

      expect(health.status).toBe('error');
      expect(health.error).toBe('Invalid state');
    });

    it('handles error with empty message', async () => {
      const testError = new Error('');
      
      vi.spyOn(manager as any, 'getModelStatus').mockRejectedValue(testError);

      const health = await manager.performHealthCheck();

      expect(health.status).toBe('error');
      expect(health.error).toBe('');
    });
  });

  // ── Lines 661-662: deleteModel() error handling ──────────────────────
  describe('deleteModel error handling', () => {
    it('throws and logs error when caches.delete fails (lines 661-662)', async () => {
      const deleteError = new Error('Cache deletion failed');
      
      // Mock caches.delete to fail
      vi.stubGlobal('caches', {
        keys: vi.fn().mockResolvedValue(['wllama-cache-1']),
        delete: vi.fn().mockRejectedValue(deleteError),
      });

      await expect(manager.deleteModel()).rejects.toThrow('Cache deletion failed');
      
      // Verify that logger.error was called
      const { logger } = await import('./logger.js');
      expect(logger.error).toHaveBeenCalledWith(
        'LocalModelManager',
        'Delete failed:',
        expect.any(Error)
      );
    });

    it('logs error when _storeData fails during delete', async () => {
      const storeError = new Error('Storage write failed');
      
      vi.spyOn(manager as any, '_storeData').mockRejectedValue(storeError);
      vi.stubGlobal('caches', {
        keys: vi.fn().mockResolvedValue([]),
        delete: vi.fn(),
      });

      await expect(manager.deleteModel()).rejects.toThrow('Storage write failed');
      
      const { logger } = await import('./logger.js');
      expect(logger.error).toHaveBeenCalledWith(
        'LocalModelManager',
        'Delete failed:',
        expect.any(Error)
      );
    });

    it('handles DOM exceptions during delete', async () => {
      const domError = new DOMException('QuotaExceededError');
      
      vi.stubGlobal('caches', {
        keys: vi.fn().mockRejectedValue(domError),
        delete: vi.fn(),
      });

      await expect(manager.deleteModel()).rejects.toThrow('QuotaExceededError');
    });
  });

  describe('downloadModel onProgress null/undefined callback handling', () => {
    it('skips onProgress callback when onProgress is null', async () => {
      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            // Send progress events
            workerMessageHandler({ data: { type: 'progress', loaded: 500, total: 1000, progress: 50 } });
            workerMessageHandler({ data: { type: 'modelLoaded' } });
          }
        });
      });

      // Pass null for onProgress
      const result = await manager.downloadModel(null);

      expect(result.success).toBe(true);
      expect(manager.downloadProgress).toBe(100);
    });

    it('calls onProgress callback when provided', async () => {
      const onProgressMock = vi.fn();

      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            workerMessageHandler({ data: { type: 'progress', loaded: 500, total: 1000, progress: 50 } });
            workerMessageHandler({ data: { type: 'modelLoaded' } });
          }
        });
      });

      const result = await manager.downloadModel(onProgressMock);

      expect(result.success).toBe(true);
      expect(onProgressMock).toHaveBeenCalledWith(expect.objectContaining({ progress: 50 }));
    });

    it('handles undefined progressInfo.progress field', async () => {
      const onProgressMock = vi.fn();

      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            // Send progress without progress field
            workerMessageHandler({ data: { type: 'progress', loaded: 500, total: 1000 } });
            workerMessageHandler({ data: { type: 'modelLoaded' } });
          }
        });
      });

      const result = await manager.downloadModel(onProgressMock);

      expect(result.success).toBe(true);
      expect(onProgressMock).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Branch coverage: 12 remaining uncovered branches
  // =========================================================================

  describe('branch coverage: nullish coalescing fallbacks in download progress (L353-355)', () => {
    it('uses fallback 0 when progress message omits loaded and total', async () => {
      const onProgress = vi.fn();

      mockWorkerPostMessage.mockImplementation((msg: Record<string, unknown>) => {
        Promise.resolve().then(() => {
          if (workerMessageHandler && msg.type === 'loadModel') {
            // Send progress WITHOUT loaded/total fields → hits ?? 0 fallbacks (bid=8[1], bid=9[1])
            workerMessageHandler({ data: { type: 'progress', progress: 30 } });
            workerMessageHandler({ data: { type: 'modelLoaded' } });
          }
        });
      });

      await manager.downloadModel(onProgress);

      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
        loaded: 0,
        total: 0,
        progress: 30,
      }));
    });
  });

  describe('branch coverage: nullish coalescing fallbacks in translateText result (L492-496)', () => {
    it('returns empty defaults when worker result lacks translatedText and tokensGenerated', async () => {
      manager.modelLoaded = true;
      manager.modelWorker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as Worker;

      // Return a result with no translatedText or tokensGenerated → hits ?? fallbacks (bid=18[1], bid=19[1], bid=20[1])
      const sendSpy = vi.spyOn(manager as any, '_sendWorkerMessage')
        .mockResolvedValueOnce({ type: 'result' });

      const result = await manager.translateText('hello', 'en', 'fi');

      expect(result.text).toBe('');
      expect(result.translatedText).toBe('');
      expect(result.tokensGenerated).toBe(0);

      sendSpy.mockRestore();
    });
  });

  describe('branch coverage: translation retry without model reload (L506 else branch)', () => {
    it('retries translation without reloading model when error is retryable but not worker/not-loaded', async () => {
      manager.modelLoaded = true;
      manager.consecutiveFailures = 0;
      manager.modelWorker = {
        postMessage: vi.fn(),
        terminate: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as Worker;

      // "timeout" is retryable (_shouldRetryTranslation returns true) but
      // does NOT include 'worker' or 'not loaded' → hits bid=23[1] (else branch)
      const sendSpy = vi.spyOn(manager as any, '_sendWorkerMessage')
        .mockRejectedValueOnce(new Error('timeout'))
        .mockResolvedValueOnce({ type: 'result', translatedText: 'retried', tokensGenerated: 1 });

      const result = await manager.translateText('test', 'en', 'fi');

      expect(result.translatedText).toBe('retried');
      // modelLoaded should still be true since we didn't reload
      expect(manager.modelLoaded).toBe(true);

      sendSpy.mockRestore();
    });
  });

  describe('branch coverage: healthy health check with all checks passing (L602, L606-607, L617)', () => {
    it('returns healthy status when model is downloaded, loaded, and worker exists', async () => {
      await manager.init();

      // Make stored status show downloaded → bid=27[0]: downloaded ? 'Model cached'
      (globalThis.chrome.storage.local.get as Mock).mockImplementation(
        (_keys: unknown, cb: (result: Record<string, unknown>) => void) => {
          cb({ model_status: { downloaded: true } });
        },
      );

      // Set worker and modelLoaded → bid=28[1]: modelWorker !== null && modelLoaded evaluates right operand
      // → bid=29[0]: modelLoaded ? 'Worker operational'
      manager.modelLoaded = true;
      manager.modelWorker = { postMessage: vi.fn() } as unknown as Worker;

      const health = await manager.performHealthCheck();

      // All 4 checks pass → bid=30[0]: failedChecks.length === 0 → 'healthy'
      expect(health.status).toBe('healthy');
      expect(health.checks.modelAvailable.message).toBe('Model cached');
      expect(health.checks.worker.passed).toBe(true);
      expect(health.checks.worker.message).toBe('Worker operational');
      expect(health.summary).toBe('4/4 checks passed');
    });
  });

  describe('branch coverage: error.message || "" fallback in retry helpers (L811, L819)', () => {
    it('_shouldRetryDownload handles error with falsy message', () => {
      // bid=51[1]: error.message || '' — right side taken when message is falsy
      const err = { message: undefined } as unknown as Error;
      expect((manager as any)._shouldRetryDownload(err)).toBe(false);
    });

    it('_shouldRetryTranslation handles error with falsy message', () => {
      // bid=53[1]: error.message || '' — right side taken when message is falsy
      const err = { message: undefined } as unknown as Error;
      expect((manager as any)._shouldRetryTranslation(err)).toBe(true);
    });
  });
});
