describe('background tm/cache metrics endpoint', () => {
  test('returns tm metrics and cache stats', async () => {
    jest.resetModules();
    const syncGet = jest.fn((defaults, cb) => cb(defaults));
    global.chrome = {
      action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setIcon: jest.fn() },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() }, onConnect: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(cb => cb && cb()), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: { sync: { get: syncGet }, local: { get: jest.fn(), set: jest.fn() } },
    };
    global.importScripts = () => {};
    global.setInterval = () => {};
    global.qwenTM = { stats: () => ({ hits: 1, misses: 0 }), enableSync: jest.fn() };
    global.qwenGetCacheStats = () => ({ hits: 2, misses: 0, hitRate: 1 });
    global.qwenThrottle = { configure: jest.fn(), getUsage: () => ({ requests: 0, requestLimit: 1, tokens: 0, tokenLimit: 1, totalRequests:0, totalTokens:0 }) };
    require('../src/background.js');
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const res = await new Promise(resolve => listener({ action: 'tm-cache-metrics' }, {}, resolve));
    expect(res.tmMetrics.hits).toBe(1);
    expect(res.cacheStats.hits).toBe(2);
    expect(res.cacheStats.hitRate).toBe(1);
  });
});

