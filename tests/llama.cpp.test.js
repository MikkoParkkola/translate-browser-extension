/**
 * Tests for InferenceEngine (src/llama.cpp.js)
 *
 * Tests the wllama-backed inference engine: init, model loading,
 * completion, chat completion, and cleanup.
 */

// Mock the wllama bundle before importing the module under test
const mockWllamaInstance = {
  loadModelFromUrl: jest.fn().mockResolvedValue(undefined),
  loadModel: jest.fn().mockResolvedValue(undefined),
  getLoadedContextInfo: jest.fn().mockReturnValue({ n_ctx: 2048, model: 'test-model' }),
  createCompletion: jest.fn().mockResolvedValue('translated text'),
  createChatCompletion: jest.fn().mockResolvedValue('chat translated text'),
  tokenize: jest.fn().mockResolvedValue([1, 2, 3, 4]),
  exit: jest.fn().mockResolvedValue(undefined),
};

const MockWllama = jest.fn().mockImplementation(() => mockWllamaInstance);

jest.mock('../src/wllama.bundle.js', () => ({
  Wllama: MockWllama,
}));

const { InferenceEngine, detectWebGPU } = require('../src/llama.cpp.js');

describe('detectWebGPU', () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it('returns false when navigator is undefined', async () => {
    Object.defineProperty(global, 'navigator', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    expect(await detectWebGPU()).toBe(false);
  });

  it('returns false when navigator.gpu is missing', async () => {
    Object.defineProperty(global, 'navigator', {
      value: {},
      writable: true,
      configurable: true,
    });
    expect(await detectWebGPU()).toBe(false);
  });

  it('returns false when requestAdapter returns null', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { gpu: { requestAdapter: jest.fn().mockResolvedValue(null) } },
      writable: true,
      configurable: true,
    });
    expect(await detectWebGPU()).toBe(false);
  });

  it('returns true when adapter is available', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { gpu: { requestAdapter: jest.fn().mockResolvedValue({ name: 'test' }) } },
      writable: true,
      configurable: true,
    });
    expect(await detectWebGPU()).toBe(true);
  });

  it('returns false when requestAdapter throws', async () => {
    Object.defineProperty(global, 'navigator', {
      value: { gpu: { requestAdapter: jest.fn().mockRejectedValue(new Error('GPU error')) } },
      writable: true,
      configurable: true,
    });
    expect(await detectWebGPU()).toBe(false);
  });
});

describe('InferenceEngine', () => {
  let engine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new InferenceEngine();

    // Set up navigator.gpu for WebGPU detection
    Object.defineProperty(global, 'navigator', {
      value: {
        gpu: { requestAdapter: jest.fn().mockResolvedValue({ name: 'test' }) },
        hardwareConcurrency: 8,
      },
      writable: true,
      configurable: true,
    });

    // Mock chrome.runtime for extension URL resolution
    global.chrome = {
      runtime: { getURL: jest.fn(function(path) { return 'chrome-extension://test-id/' + path; }) },
    };
  });

  afterEach(() => {
    delete global.chrome;
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

      const [wasmPaths] = MockWllama.mock.calls[0];
      expect(wasmPaths['single-thread/wllama.wasm']).toMatch(/chrome-extension:\/\//);
      expect(wasmPaths['multi-thread/wllama.wasm']).toMatch(/chrome-extension:\/\//);
    });

    it('respects suppressNativeLog option', async () => {
      await engine.init({ suppressNativeLog: true });

      const [, options] = MockWllama.mock.calls[0];
      expect(options.suppressNativeLog).toBe(true);
    });

    it('respects parallelDownloads option', async () => {
      await engine.init({ parallelDownloads: 5 });

      const [, options] = MockWllama.mock.calls[0];
      expect(options.parallelDownloads).toBe(5);
    });

    it('detects WebGPU as false when not available', async () => {
      Object.defineProperty(global, 'navigator', {
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

      const [urls] = mockWllamaInstance.loadModelFromUrl.mock.calls[0];
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
      const [urls] = mockWllamaInstance.loadModelFromUrl.mock.calls[0];
      expect(urls).toEqual(shardUrls);
    });

    it('passes config defaults', async () => {
      await engine.loadModel('http://example.com/model.gguf');

      const [, config] = mockWllamaInstance.loadModelFromUrl.mock.calls[0];
      expect(config.n_ctx).toBe(2048);
      expect(config.n_batch).toBe(512);
      expect(config.cache_type_k).toBe('q8_0');
      expect(config.cache_type_v).toBe('q8_0');
    });

    it('passes config overrides', async () => {
      await engine.loadModel('http://example.com/model.gguf', { n_ctx: 4096, n_batch: 1024 });

      const [, config] = mockWllamaInstance.loadModelFromUrl.mock.calls[0];
      expect(config.n_ctx).toBe(4096);
      expect(config.n_batch).toBe(1024);
    });

    it('calls onProgress callback during loading', async () => {
      mockWllamaInstance.loadModelFromUrl.mockImplementation((urls, config) => {
        if (config.progressCallback) {
          config.progressCallback({ loaded: 500, total: 1000 });
          config.progressCallback({ loaded: 1000, total: 1000 });
        }
        return Promise.resolve();
      });

      const onProgress = jest.fn();
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

      const [, options] = mockWllamaInstance.createCompletion.mock.calls[0];
      expect(options.nPredict).toBe(256);
      expect(options.sampling.temp).toBe(0.7);
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
});
