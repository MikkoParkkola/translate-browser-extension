describe('background metrics endpoint', () => {
  test('returns usage, cache, tm and provider info', async () => {
    jest.resetModules();
    const syncGet = jest.fn((q, cb) => {
      if (q && Object.prototype.hasOwnProperty.call(q, 'providers')) {
        cb({ providers: { qwen: { apiKey: 'k', model: 'm', apiEndpoint: 'e' } } });
      } else {
        cb({ requestLimit: 10, tokenLimit: 100, memCacheMax: 10, tmSync: false });
      }
    });
    global.chrome = {
      action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setIcon: jest.fn() },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() }, onConnect: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(cb => cb && cb()), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: { sync: { get: syncGet }, local: { get: jest.fn(), set: jest.fn() } },
    };
    global.importScripts = () => {};
    global.setInterval = () => {};
    global.qwenThrottle = { configure: jest.fn(), getUsage: () => ({ requests: 1, requestLimit: 10, tokens: 2, tokenLimit: 100 }), recordUsage: jest.fn() };
    global.qwenGetCacheSize = () => 5;
    global.qwenGetCacheStats = () => ({ hits: 0, misses: 0, hitRate: 0 });
    global.qwenConfig = { memCacheMax: 10 };
    global.qwenTM = { stats: () => ({ hits: 1, misses: 0 }) };
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
    require('../src/background.js');
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const res = await new Promise(resolve => listener({ action: 'metrics' }, { id: 'test-extension', tab: { url: 'https://test.com' } }, resolve));
    expect(res.usage.requests).toBe(1);
    expect(res.cache.size).toBe(5);
    expect(res.tm.hits).toBe(1);
    expect(res.providers.qwen.apiKey).toBe(true);
    expect(res.status.active).toBe(false);

    listener(
      { action: 'translation-status', status: { active: false, summary: { tokens: 3, requests: 2, cache: { size: 7, max: 10, hits: 1, misses: 0, hitRate: 1 }, tm: { hits: 2, misses: 1 } } } },
      { id: 'test-extension', tab: { url: 'https://test.com' } },
      () => {}
    );
    const res2 = await new Promise(resolve => listener({ action: 'metrics' }, { id: 'test-extension', tab: { url: 'https://test.com' } }, resolve));
    expect(global.qwenThrottle.recordUsage).toHaveBeenCalledWith(3, 2);
    expect(res2.cache.hits).toBe(1);
    expect(res2.cache.hitRate).toBe(1);
    expect(res2.tm.hits).toBe(2);
    expect(res2.status.active).toBe(false);
  });
});

