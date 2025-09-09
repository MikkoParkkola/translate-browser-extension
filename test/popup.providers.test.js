// @jest-environment jsdom

describe('background home:init includes provider usage', () => {
  let listener;
  beforeEach(() => {
    jest.resetModules();
    global.chrome = {
      action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setIcon: jest.fn() },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() }, onConnect: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(cb => cb && cb()), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: {
        sync: { get: jest.fn((defaults, cb) => cb(defaults)) },
        local: { get: jest.fn((defaults, cb) => cb(defaults)), set: jest.fn() }
      },
    };
    global.importScripts = () => {};
    global.setInterval = () => {};
    global.self = global;
    global.qwenThrottle = { configure: jest.fn(), getUsage: () => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 100000 }), approxTokens: jest.fn().mockReturnValue(10) };
    global.qwenGetCacheSize = () => 0;
    global.qwenTM = { stats: () => ({ entries: 0 }) };
    global.qwenTranslate = jest.fn().mockResolvedValue({ text: 'hola' });
    global.qwenErrorHandler = {
      handle: jest.fn(),
      handleAsync: jest.fn((promise) => promise),
      safe: jest.fn((fn, context, fallback, logger) => {
        return () => {
          try {
            return fn();
          } catch (error) {
            return fallback || { ok: false, error };
          }
        };
      })
    };
    
    const backgroundModule = require('../src/background.js');
    listener = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];
  });

  test('returns providers usage', async () => {
    // First simulate a translation to create provider usage using the exported function
    const { handleTranslate } = require('../src/background.js');
    await handleTranslate({
      provider: 'qwen',
      endpoint: 'test',
      apiKey: 'test',
      model: 'qwen-turbo',
      text: 'hello',
      source: 'en',
      target: 'es'
    });
    
    // Now check the home:init response
    const res = await new Promise(resolve => listener({ action: 'home:init' }, { id: 'test-extension', tab: { url: 'https://test.com' } }, resolve));
    expect(res.providers.qwen).toBeDefined();
    expect(res.providers.qwen.requests).toBeGreaterThan(0);
  });
});
