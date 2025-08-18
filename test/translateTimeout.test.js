describe('translation timeout', () => {
  let handleTranslate, _setConfig;
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    global.chrome = {
      action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setIcon: jest.fn() },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() }, onConnect: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: { sync: { get: (_, cb) => cb({ requestLimit: 60, tokenLimit: 60 }) }, local: { get: jest.fn(), set: jest.fn() } },
    };
    global.importScripts = () => {};
    global.setInterval = () => {};
    global.OffscreenCanvas = class { getContext() { return { clearRect: jest.fn(), lineWidth: 0, strokeStyle: '', beginPath: jest.fn(), arc: jest.fn(), stroke: jest.fn(), fillStyle: '', fill: jest.fn(), getImageData: () => ({}) }; } };
    global.qwenThrottle = {
      configure: jest.fn(),
      getUsage: () => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 60 }),
      approxTokens: t => t.length,
    };
    global.qwenUsageColor = () => '#00ff00';
    ({ handleTranslate, _setConfig } = require('../src/background.js'));
    global.qwenTranslate = opts => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('aborts after configured timeout', async () => {
    _setConfig({ translateTimeoutMs: 50 });
    const p = handleTranslate({ endpoint: '', apiKey: '', model: '', text: 'hi', source: 'en', target: 'es' });
    jest.advanceTimersByTime(50);
    await jest.runAllTimersAsync();
    await expect(p).resolves.toEqual({ error: 'aborted' });
  });
});
