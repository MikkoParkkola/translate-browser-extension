/**
 * Verifies background home:init response validation and sanitisation.
 */
describe('home init schema validation', () => {
  let sanitize;
  let loggerMock;

  beforeEach(() => {
    jest.resetModules();
    global.self = global;
    loggerMock = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn(), log: jest.fn() };
    self.qwenLogger = { create: () => loggerMock };
    self.qwenErrorHandler = {
      handle: (_err, _ctx, fallback) => fallback || null,
      handleAsync: async (promise, _ctx, fallback) => {
        try { return await promise; } catch { return fallback || null; }
      },
      safe: fn => fn,
      isNetworkError: () => false,
    };
    self.qwenThrottle = {
      configure: () => {},
      getUsage: () => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 100000 }),
      approxTokens: () => 0,
      createThrottle: () => ({ runWithRateLimit: fn => fn(), runWithRetry: fn => fn() }),
    };
    self.qwenTM = { stats: () => ({}), getAll: async () => [] };
    self.qwenBackgroundStorage = { createStorage: () => ({ get: async () => ({}), set: async () => {}, remove: async () => {} }) };
    self.qwenBackgroundMessaging = { withLastError: cb => cb, sendMessage: async () => null, sendToTab: async () => null, queryTabs: async () => [] };
    self.qwenStateUtils = { buildProvidersUsageSnapshot: () => ({}) };
    global.chrome = {
      action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setIcon: jest.fn() },
      runtime: {
        onInstalled: { addListener: jest.fn() },
        onMessage: { addListener: jest.fn() },
        onConnect: { addListener: jest.fn() },
        requestUpdateCheck: jest.fn((cb) => cb && cb('no_update')),
      },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(cb => cb && cb()), onClicked: { addListener: jest.fn() } },
      storage: {
        sync: { get: jest.fn((defaults, cb) => cb(defaults)), set: jest.fn((_, cb) => cb && cb()) },
        local: { get: jest.fn((defaults, cb) => cb(defaults)), set: jest.fn() },
      },
      tabs: { onUpdated: { addListener: jest.fn() } },
    };
    global.importScripts = () => {};

    const background = require('../src/background.js');
    sanitize = background._sanitizeHomeInitResponse;
  });

  test('accepts valid payload and coerces numeric strings', () => {
    const warningCountBefore = loggerMock.warn.mock.calls.length;

    const result = sanitize({
      providers: {
        qwen: {
          apiKey: true,
          model: 'qwen-turbo',
          endpoint: 'https://api.qwen',
          requests: '2',
          tokens: 3,
          totalRequests: '5',
          totalTokens: 7,
        },
      },
      providersUsage: {
        qwen: { requests: '2', tokens: '3', totalRequests: '5', totalTokens: '7' },
      },
      usage: { requests: '1', tokens: '2', requestLimit: '60' },
      provider: 'qwen',
      apiKey: true,
    });

    expect(result.providers.qwen.requests).toBe(2);
    expect(result.providersUsage.qwen.totalTokens).toBe(7);
    expect(result.usage.requestLimit).toBe(60);
    expect(result.provider).toBe('qwen');
    expect(result.apiKey).toBe(true);
    expect(loggerMock.warn.mock.calls.length).toBe(warningCountBefore);
  });

  test('sanitises invalid payloads to safe defaults', () => {
    const warningCountBefore = loggerMock.warn.mock.calls.length;

    const result = sanitize({
      providers: { bad: { requests: '-4', tokens: '-1' } },
      providersUsage: { bad: { requests: '-4', tokens: '-1', totalRequests: '-9', totalTokens: '-2' } },
      usage: { requests: '-10', tokens: '-5' },
      provider: 123,
      apiKey: 'yes',
    });

    expect(result).toEqual({
      providers: {},
      providersUsage: {},
      usage: { requests: 0, tokens: 0 },
      provider: 'unknown',
      apiKey: false,
    });
    expect(loggerMock.warn.mock.calls.length).toBeGreaterThan(warningCountBefore);
  });
});
