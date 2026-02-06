const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('translator cache manager integration', () => {
  let warnSpy;
  let createCacheManager;

  beforeEach(() => {
    jest.resetModules();

    warnSpy = jest.fn();
    createCacheManager = jest.fn(async () => ({
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
      getStats: jest.fn().mockReturnValue({ memoryEntries: 0, hitRate: 0 }),
    }));

    global.window = {};
    global.self = global.window;
    const baseLogger = {
      warn: warnSpy,
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      logBatchTime: jest.fn(),
      logQueueLatency: jest.fn(),
      time: async fn => ({ result: await fn(), ms: 0 }),
      setLevel: jest.fn(),
      level: () => 3,
      create: () => baseLogger,
    };
    global.window.qwenLogger = {
      create: () => baseLogger,
    };
    global.window.qwenThrottle = {
      createThrottle: () => ({
        runWithRateLimit: fn => fn(),
        runWithRetry: fn => fn(),
      }),
      approxTokens: () => 0,
      getUsage: () => ({})
    };
    global.window.qwenProviders = {
      isInitialized: () => true,
      get: () => ({ translate: jest.fn(async () => ({ text: 'ok' })) }),
      candidates: () => ['dashscope'],
      choose: () => 'dashscope',
      register: jest.fn(),
      init: jest.fn(),
    };
    global.window.qwenConfig = {};
    global.window.qwenCoreCache = { createCacheManager };
    global.window.qwenCacheKey = {
      normalizeText: text => text,
      makeCacheKey: (source, target, text) => `${source}:${target}:${text}`,
    };
    global.chrome = {
      runtime: { id: 'test-extension' },
      storage: {
        local: {
          get: (_keys, cb) => cb({}),
          set: (_items, cb) => cb && cb(),
          remove: (_items, cb) => cb && cb(),
        },
      },
    };
  });

  afterEach(() => {
    delete global.window;
    delete global.self;
    delete global.chrome;
  });

  it('initializes browser cache manager when available', async () => {
    const translator = require('../src/translator.js');
    expect(translator).toBeDefined();
    await flushPromises();

    expect(createCacheManager).toHaveBeenCalled();
    const fallbackWarn = warnSpy.mock.calls.find(([msg]) => typeof msg === 'string' && msg.includes('fallback cache implementation'));
    expect(fallbackWarn).toBeUndefined();
  });
});
