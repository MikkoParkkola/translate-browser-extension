/**
 * Tests for InferenceEngine (src/llama.cpp.js)
 *
 * Tests the wllama-backed inference engine: init, model loading,
 * completion, chat completion, and cleanup.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hoist mock instances + constructor (vi.fn arrow functions can't be constructors inside hoisted)
const { mockWllamaInstance, MockWllama } = vi.hoisted(() => {
  const inst = {
    loadModelFromUrl: vi.fn().mockResolvedValue(undefined),
    loadModel: vi.fn().mockResolvedValue(undefined),
    getLoadedContextInfo: vi.fn().mockReturnValue({ n_ctx: 2048, model: 'test-model' }),
    createCompletion: vi.fn().mockResolvedValue('translated text'),
    createChatCompletion: vi.fn().mockResolvedValue('chat translated text'),
    tokenize: vi.fn().mockResolvedValue([1, 2, 3, 4]),
    exit: vi.fn().mockResolvedValue(undefined),
  };
  return {
    mockWllamaInstance: inst,
    MockWllama: vi.fn(function () { return inst; }),
  };
});

vi.mock('./wllama.bundle.js', () => ({
  Wllama: MockWllama,
}));

// Vitest hoists vi.mock() above this import automatically
import { InferenceEngine, detectWebGPU } from './llama.cpp';

describe('detectWebGPU', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('returns false when navigator is undefined', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(await detectWebGPU()).toBe(false);
  });

  it('returns false when navigator.gpu is missing', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      writable: true,
      configurable: true,
    });
    expect(await detectWebGPU()).toBe(false);
  });

  it('returns false when requestAdapter returns null', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { gpu: { requestAdapter: vi.fn().mockResolvedValue(null) } },
      writable: true,
      configurable: true,
    });
    expect(await detectWebGPU()).toBe(false);
  });

  it('returns true when adapter is available', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { gpu: { requestAdapter: vi.fn().mockResolvedValue({ name: 'test' }) } },
      writable: true,
      configurable: true,
    });
    expect(await detectWebGPU()).toBe(true);
  });

  it('returns false when requestAdapter throws', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      value: { gpu: { requestAdapter: vi.fn().mockRejectedValue(new Error('GPU error')) } },
      writable: true,
      configurable: true,
    });
    expect(await detectWebGPU()).toBe(false);
  });
});

describe('InferenceEngine', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let engine: any;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new InferenceEngine();

    // Set up navigator.gpu for WebGPU detection
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        gpu: { requestAdapter: vi.fn().mockResolvedValue({ name: 'test' }) },
        hardwareConcurrency: 8,
      },
      writable: true,
      configurable: true,
    });

    // Mock chrome.runtime for extension URL resolution
    globalThis.chrome = {
      runtime: { getURL: vi.fn((path: string) => 'chrome-extension://test-id/' + path) } as unknown as typeof chrome.runtime,
    } as unknown as typeof chrome;
  });

  afterEach(() => {
    // @ts-expect-error - Clean up chrome mock
    delete globalThis.chrome;
  });

  describe('constructor', () => {
    it('creates engine with correct initial state', () => {
      expect(engine.wllama).toBeNull();
      expect(engine.isModelLoaded).toBe(false);
      expect(engine.hasWebGPU).toBe(false);
      expect(engine.modelInfo).toBeNull();
    });
  });

  describe('init', () => {
    it('creates Wllama instance and detects WebGPU', async () => {
      const result = await engine.init();

      expect(result.success).toBe(true);
      expect(result.hasWebGPU).toBe(true);
      expect(engine.wllama).toBeDefined();
      expect(engine.hasWebGPU).toBe(true);
      expect(MockWllama).toHaveBeenCalledTimes(1);
    });

    it('passes WASM paths using chrome.runtime.getURL', async () => {
      await engine.init();

      const [wasmPaths] = MockWllama.mock.calls[0] as unknown as [Record<string, string>];
      expect(wasmPaths['single-thread/wllama.wasm']).toMatch(/chrome-extension:\/\//);
      expect(wasmPaths['multi-thread/wllama.wasm']).toMatch(/chrome-extension:\/\//);
    });

    it('respects suppressNativeLog option', async () => {
      await engine.init({ suppressNativeLog: true });

      const [, options] = MockWllama.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(options.suppressNativeLog).toBe(true);
    });

    it('respects parallelDownloads option', async () => {
      await engine.init({ parallelDownloads: 5 });

      const [, options] = MockWllama.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(options.parallelDownloads).toBe(5);
    });

    it('detects WebGPU as false when not available', async () => {
      Object.defineProperty(globalThis, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const result = await engine.init();
      expect(result.hasWebGPU).toBe(false);
      expect(engine.hasWebGPU).toBe(false);
    });
  });

  describe('loadModel', () => {
    beforeEach(async () => {
      await engine.init();
    });

    it('throws if engine not initialized', async () => {
      const uninitEngine = new InferenceEngine();
      await expect(uninitEngine.loadModel('http://example.com/model.gguf'))
        .rejects.toThrow('Engine not initialized');
    });

    it('loads model from single URL', async () => {
      const result = await engine.loadModel('http://example.com/model.gguf');

      expect(result.success).toBe(true);
      expect(engine.isModelLoaded).toBe(true);
      expect(mockWllamaInstance.loadModelFromUrl).toHaveBeenCalledTimes(1);

      const [urls] = mockWllamaInstance.loadModelFromUrl.mock.calls[0] as [string[]];
      expect(urls).toEqual(['http://example.com/model.gguf']);
    });

    it('loads model from multiple shard URLs', async () => {
      const shardUrls = [
        'http://example.com/model-00001.gguf',
        'http://example.com/model-00002.gguf',
        'http://example.com/model-00003.gguf',
      ];

      const result = await engine.loadModel(shardUrls);

      expect(result.success).toBe(true);
      const [urls] = mockWllamaInstance.loadModelFromUrl.mock.calls[0] as [string[]];
      expect(urls).toEqual(shardUrls);
    });

    it('passes config defaults', async () => {
      await engine.loadModel('http://example.com/model.gguf');

      const [, config] = mockWllamaInstance.loadModelFromUrl.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(config.n_ctx).toBe(2048);
      expect(config.n_batch).toBe(512);
      expect(config.cache_type_k).toBe('q8_0');
      expect(config.cache_type_v).toBe('q8_0');
    });

    it('passes config overrides', async () => {
      await engine.loadModel('http://example.com/model.gguf', { n_ctx: 4096, n_batch: 1024 });

      const [, config] = mockWllamaInstance.loadModelFromUrl.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(config.n_ctx).toBe(4096);
      expect(config.n_batch).toBe(1024);
    });

    it('calls onProgress callback during loading', async () => {
      mockWllamaInstance.loadModelFromUrl.mockImplementation(
        (_urls: string[], config: Record<string, unknown>) => {
          const progressCallback = config.progressCallback as ((p: Record<string, number>) => void) | undefined;
          if (progressCallback) {
            progressCallback({ loaded: 500, total: 1000 });
            progressCallback({ loaded: 1000, total: 1000 });
          }
          return Promise.resolve();
        },
      );

      const onProgress = vi.fn();
      await engine.loadModel('http://example.com/model.gguf', {}, onProgress);

      expect(onProgress).toHaveBeenCalledTimes(2);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ loaded: 500, total: 1000, progress: 50 }),
      );
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ loaded: 1000, total: 1000, progress: 100 }),
      );
    });

    it('unloads previous model before loading new one', async () => {
      await engine.loadModel('http://example.com/model1.gguf');
      expect(engine.isModelLoaded).toBe(true);

      await engine.loadModel('http://example.com/model2.gguf');

      expect(mockWllamaInstance.exit).toHaveBeenCalledTimes(1);
      expect(mockWllamaInstance.loadModelFromUrl).toHaveBeenCalledTimes(2);
    });

    it('sets isModelLoaded false on load failure', async () => {
      mockWllamaInstance.loadModelFromUrl.mockRejectedValueOnce(new Error('Network error'));

      await expect(engine.loadModel('http://example.com/bad.gguf'))
        .rejects.toThrow('Network error');

      expect(engine.isModelLoaded).toBe(false);
    });

    it('stores model info after successful load', async () => {
      await engine.loadModel('http://example.com/model.gguf');

      expect(engine.modelInfo).toEqual({ n_ctx: 2048, model: 'test-model' });
    });
  });

  describe('loadModelFromBlobs', () => {
    beforeEach(async () => {
      await engine.init();
    });

    it('loads model from blob array', async () => {
      const blobs = [new Blob(['data1']), new Blob(['data2'])];
      const result = await engine.loadModelFromBlobs(blobs);

      expect(result.success).toBe(true);
      expect(mockWllamaInstance.loadModel).toHaveBeenCalledTimes(1);
      expect(engine.isModelLoaded).toBe(true);
    });

    it('throws if engine not initialized', async () => {
      const uninitEngine = new InferenceEngine();
      await expect(uninitEngine.loadModelFromBlobs([new Blob(['data'])]))
        .rejects.toThrow('Engine not initialized');
    });
  });

  describe('complete', () => {
    beforeEach(async () => {
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');
    });

    it('throws if model not loaded', async () => {
      engine.isModelLoaded = false;
      await expect(engine.complete('translate this'))
        .rejects.toThrow('Model not loaded');
    });

    it('returns completion text and token count', async () => {
      const result = await engine.complete('Translate: hello');

      expect(result.text).toBe('translated text');
      expect(result.tokensGenerated).toBe(4);
      expect(mockWllamaInstance.createCompletion).toHaveBeenCalledWith(
        'Translate: hello',
        expect.objectContaining({
          nPredict: 512,
          sampling: expect.objectContaining({ temp: 0.1 }),
        }),
      );
    });

    it('respects maxTokens and temperature options', async () => {
      await engine.complete('prompt', { maxTokens: 256, temperature: 0.7 });

      const [, options] = mockWllamaInstance.createCompletion.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(options.nPredict).toBe(256);
      expect((options.sampling as Record<string, unknown>).temp).toBe(0.7);
    });

    it('falls back to approximate token count when tokenize fails', async () => {
      mockWllamaInstance.tokenize.mockRejectedValueOnce(new Error('tokenize error'));
      mockWllamaInstance.createCompletion.mockResolvedValueOnce('a short text');

      const result = await engine.complete('prompt');
      expect(result.tokensGenerated).toBe(3);
    });
  });

  describe('chatComplete', () => {
    beforeEach(async () => {
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');
    });

    it('throws if model not loaded', async () => {
      engine.isModelLoaded = false;
      await expect(engine.chatComplete([{ role: 'user', content: 'hi' }]))
        .rejects.toThrow('Model not loaded');
    });

    it('calls createChatCompletion with messages', async () => {
      const messages = [
        { role: 'system', content: 'Translate' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await engine.chatComplete(messages);

      expect(result.text).toBe('chat translated text');
      expect(mockWllamaInstance.createChatCompletion).toHaveBeenCalledWith(
        messages,
        expect.objectContaining({ nPredict: 512 }),
      );
    });
  });

  describe('unloadModel', () => {
    it('calls wllama.exit and resets state', async () => {
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');

      await engine.unloadModel();

      expect(mockWllamaInstance.exit).toHaveBeenCalled();
      expect(engine.isModelLoaded).toBe(false);
      expect(engine.modelInfo).toBeNull();
    });

    it('handles exit error gracefully', async () => {
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');
      mockWllamaInstance.exit.mockRejectedValueOnce(new Error('cleanup error'));

      await engine.unloadModel();
      expect(engine.isModelLoaded).toBe(false);
    });
  });

  describe('destroy', () => {
    it('unloads model and nullifies wllama instance', async () => {
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');

      await engine.destroy();

      expect(engine.wllama).toBeNull();
      expect(engine.isModelLoaded).toBe(false);
    });
  });

  describe('isReady', () => {
    it('returns false before init', () => {
      expect(engine.isReady()).toBe(false);
    });

    it('returns false after init but before model load', async () => {
      await engine.init();
      expect(engine.isReady()).toBe(false);
    });

    it('returns true after model loaded', async () => {
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');
      expect(engine.isReady()).toBe(true);
    });
  });

  describe('getContextInfo', () => {
    it('returns null if model not loaded', () => {
      expect(engine.getContextInfo()).toBeNull();
    });

    it('returns context info when model loaded', async () => {
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');

      const info = engine.getContextInfo();
      expect(info).toEqual({ n_ctx: 2048, model: 'test-model' });
    });
  });

  describe('abort', () => {
    it('aborts when _abortController is set', async () => {
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');

      // Simulate having an active abort controller
      const controller = new AbortController();
      engine._abortController = controller;
      const abortSpy = vi.spyOn(controller, 'abort');

      engine.abort();

      expect(abortSpy).toHaveBeenCalled();
      expect(engine._abortController).toBeNull();
    });

    it('is a no-op when _abortController is null', () => {
      engine.abort();
      expect(engine._abortController).toBeNull();
    });
  });

  describe('chatComplete (tokenize fallback)', () => {
    beforeEach(async () => {
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');
    });

    it('falls back to approximate token count when tokenize fails', async () => {
      mockWllamaInstance.tokenize.mockRejectedValueOnce(new Error('tokenize error'));
      mockWllamaInstance.createChatCompletion.mockResolvedValueOnce('a short text');

      const result = await engine.chatComplete([{ role: 'user', content: 'hi' }]);
      // 'a short text' is 12 chars => ceil(12/4) = 3
      expect(result.tokensGenerated).toBe(3);
    });

    it('respects maxTokens and temperature options', async () => {
      await engine.chatComplete(
        [{ role: 'user', content: 'hi' }],
        { maxTokens: 256, temperature: 0.7 },
      );

      const [, options] = mockWllamaInstance.createChatCompletion.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(options.nPredict).toBe(256);
      expect((options.sampling as Record<string, unknown>).temp).toBe(0.7);
    });
  });

  describe('init without chrome.runtime', () => {
    it('uses ./ as extension base when chrome is undefined', async () => {
      // @ts-expect-error - remove chrome mock
      delete globalThis.chrome;

      const freshEngine = new InferenceEngine();
      await freshEngine.init();

      const [wasmPaths] = MockWllama.mock.calls[MockWllama.mock.calls.length - 1] as unknown as [Record<string, string>];
      expect(wasmPaths['single-thread/wllama.wasm']).toBe('./wllama-single.wasm');
      expect(wasmPaths['multi-thread/wllama.wasm']).toBe('./wllama-multi.wasm');
    });
  });

  describe('init logger callbacks', () => {
    it('logger.debug forwards to console.debug', async () => {
      const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      await engine.init();

      // Get the logger passed to the Wllama constructor
      const [, options] = MockWllama.mock.calls[MockWllama.mock.calls.length - 1] as unknown as [unknown, Record<string, Record<string, (...args: unknown[]) => void>>];
      options.logger.debug('test debug message');

      expect(spy).toHaveBeenCalledWith('[wllama]', 'test debug message');
    });

    it('logger.log forwards to console.log', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await engine.init();

      const [, options] = MockWllama.mock.calls[MockWllama.mock.calls.length - 1] as unknown as [unknown, Record<string, Record<string, (...args: unknown[]) => void>>];
      options.logger.log('test log message');

      expect(spy).toHaveBeenCalledWith('[wllama]', 'test log message');
    });

    it('logger.warn forwards to console.warn', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await engine.init();

      const [, options] = MockWllama.mock.calls[MockWllama.mock.calls.length - 1] as unknown as [unknown, Record<string, Record<string, (...args: unknown[]) => void>>];
      options.logger.warn('test warn message');

      expect(spy).toHaveBeenCalledWith('[wllama]', 'test warn message');
    });

    it('logger.error forwards to console.error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await engine.init();

      const [, options] = MockWllama.mock.calls[MockWllama.mock.calls.length - 1] as unknown as [unknown, Record<string, Record<string, (...args: unknown[]) => void>>];
      options.logger.error('test error message');

      expect(spy).toHaveBeenCalledWith('[wllama]', 'test error message');
    });
  });

  describe('loadModelFromBlobs (additional paths)', () => {
    beforeEach(async () => {
      await engine.init();
    });

    it('unloads previous model before loading blobs', async () => {
      // First load a model via URL
      await engine.loadModel('http://example.com/model.gguf');
      expect(engine.isModelLoaded).toBe(true);

      // Now load from blobs — should unload first
      const blobs = [new Blob(['data'])];
      await engine.loadModelFromBlobs(blobs);

      expect(mockWllamaInstance.exit).toHaveBeenCalled();
      expect(engine.isModelLoaded).toBe(true);
    });

    it('sets isModelLoaded false on blob load failure', async () => {
      mockWllamaInstance.loadModel.mockRejectedValueOnce(new Error('Blob read error'));

      await expect(engine.loadModelFromBlobs([new Blob(['bad'])]))
        .rejects.toThrow('Blob read error');

      expect(engine.isModelLoaded).toBe(false);
    });

    it('passes config defaults for blob loading', async () => {
      await engine.loadModelFromBlobs([new Blob(['data'])]);

      const [, config] = mockWllamaInstance.loadModel.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(config.n_ctx).toBe(2048);
      expect(config.n_batch).toBe(512);
      expect(config.cache_type_k).toBe('q8_0');
    });
  });

  describe('loadModel (additional paths)', () => {
    beforeEach(async () => {
      await engine.init();
    });

    it('handles progress with total=0', async () => {
      mockWllamaInstance.loadModelFromUrl.mockImplementation(
        (_urls: string[], config: Record<string, unknown>) => {
          const progressCallback = config.progressCallback as ((p: Record<string, number>) => void) | undefined;
          if (progressCallback) {
            progressCallback({ loaded: 100, total: 0 });
          }
          return Promise.resolve();
        },
      );

      const onProgress = vi.fn();
      await engine.loadModel('http://example.com/model.gguf', {}, onProgress);

      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ loaded: 100, total: 0, progress: 0 }),
      );
    });

    it('skips progressCallback when onProgress is null', async () => {
      await engine.loadModel('http://example.com/model.gguf', {}, null);

      const [, config] = mockWllamaInstance.loadModelFromUrl.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(config.progressCallback).toBeUndefined();
    });
  });

  describe('logMemoryUsage', () => {
    it('logs memory when performance.memory is available', async () => {
      // Set up performance.memory mock
      const mockPerformance = {
        ...performance,
        memory: {
          usedJSHeapSize: 100 * 1024 * 1024,
          totalJSHeapSize: 200 * 1024 * 1024,
          jsHeapSizeLimit: 400 * 1024 * 1024,
        },
      };
      vi.stubGlobal('performance', mockPerformance);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // loadModel calls logMemoryUsage('pre-load') and logMemoryUsage('post-load')
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');

      const memLogs = logSpy.mock.calls.filter(
        (c) => typeof c[1] === 'string' && c[1].includes('[memory]'),
      );
      expect(memLogs.length).toBeGreaterThanOrEqual(2);
      expect(memLogs[0][1]).toContain('pre-load');
      expect(memLogs[1][1]).toContain('post-load');

      vi.unstubAllGlobals();
    });

    it('logs memory during blob load', async () => {
      const mockPerformance = {
        ...performance,
        memory: {
          usedJSHeapSize: 50 * 1024 * 1024,
          totalJSHeapSize: 100 * 1024 * 1024,
          jsHeapSizeLimit: 200 * 1024 * 1024,
        },
      };
      vi.stubGlobal('performance', mockPerformance);

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await engine.init();
      await engine.loadModelFromBlobs([new Blob(['data'])]);

      const memLogs = logSpy.mock.calls.filter(
        (c) => typeof c[1] === 'string' && c[1].includes('[memory]'),
      );
      expect(memLogs.some(l => (l[1] as string).includes('post-blob-load'))).toBe(true);

      vi.unstubAllGlobals();
    });
  });

  describe('complete (abortSignal)', () => {
    beforeEach(async () => {
      await engine.init();
      await engine.loadModel('http://example.com/model.gguf');
    });

    it('passes abortSignal to createCompletion', async () => {
      const controller = new AbortController();
      await engine.complete('prompt', { abortSignal: controller.signal });

      const [, opts] = mockWllamaInstance.createCompletion.mock.calls[0] as [unknown, Record<string, unknown>];
      expect(opts.abortSignal).toBe(controller.signal);
    });
  });

  describe('unloadModel when wllama is null', () => {
    it('handles unload gracefully when wllama is null', async () => {
      engine.wllama = null;
      await engine.unloadModel();
      expect(engine.isModelLoaded).toBe(false);
      expect(engine.modelInfo).toBeNull();
    });
  });
});

// Separate test to cover the getWllamaModule() catch path.
// Must use resetModules to get a fresh _wllamaPromise = null.
describe('getWllamaModule error path', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('throws wrapped error when wllama bundle import fails', async () => {
    // Mock the bundle to throw synchronously (vi.doMock + throw makes the import() reject)
    vi.doMock('./wllama.bundle.js', () => {
      throw new Error('WASM load failed');
    });

    // Fresh import so _wllamaPromise starts as null
    const mod = await import('./llama.cpp');
    const freshEngine = new mod.InferenceEngine();

    globalThis.chrome = {
      runtime: { getURL: vi.fn((p: string) => `chrome-extension://test/${p}`) },
      storage: { local: { get: vi.fn(), set: vi.fn() } },
    } as unknown as typeof chrome;

    // init() calls getWllamaModule() which does import('./wllama.bundle.js')
    // The dynamic import should reject because the factory throws
    await expect(freshEngine.init()).rejects.toThrow('Failed to load inference engine');
  });
});
