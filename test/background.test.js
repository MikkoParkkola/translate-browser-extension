describe('background icon plus indicator', () => {
  let updateBadge, setUsingPlus, _setActiveTranslations, handleTranslate;
  beforeEach(() => {
    jest.resetModules();
    global.models = null;
    global.chrome = {
      action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setIcon: jest.fn(),
      },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: {
        sync: { get: (_, cb) => cb({ requestLimit: 60, tokenLimit: 60 }) },
        local: {
          get: (_, cb) => cb({ usageHistory: [] }),
          set: (_obj, cb) => cb && cb(),
        },
      },
    };
    global.importScripts = () => {};
    global.setInterval = () => {};
    global.OffscreenCanvas = class {
      constructor() {
        this.ctx = {
          clearRect: jest.fn(),
          lineWidth: 0,
          strokeStyle: '',
          beginPath: jest.fn(),
          arc: jest.fn(),
          stroke: jest.fn(),
          fillStyle: '',
          fill: jest.fn(),
          getImageData: () => ({}),
        };
      }
      getContext() { return this.ctx; }
    };
    global.qwenThrottle = {
      configure: jest.fn(),
      getUsage: () => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 60 }),
      approxTokens: t => t.length,
    };
    global.qwenUsageColor = () => '#00ff00';
    ({ updateBadge, setUsingPlus, _setActiveTranslations, handleTranslate } = require('../src/background.js'));
    chrome.action.setBadgeText.mockClear();
  });

  test('shows P badge when plus model active', () => {
    setUsingPlus(true);
    _setActiveTranslations(1);
    updateBadge();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'P' });
  });

  test('reports per-model usage', async () => {
    global.qwenTranslate = jest.fn().mockResolvedValue({ text: 'ok' });
    await handleTranslate({
      endpoint: 'https://e/',
      apiKey: 'k',
      model: 'qwen-mt-plus',
      text: 'hi',
      source: 'en',
      target: 'es',
    });
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const usage = await new Promise(resolve => listener({ action: 'usage' }, null, resolve));
    expect(usage.models['qwen-mt-plus'].requests).toBe(1);
  });
});

describe('background cost tracking', () => {
  let handleTranslate, usageListener, store;
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    store = { usageHistory: [] };
    global.models = null;
    global.chrome = {
      action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setIcon: jest.fn(),
      },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: {
        sync: { get: (_, cb) => cb({ requestLimit: 60, tokenLimit: 60 }) },
        local: {
          get: (key, cb) => {
            const k = typeof key === 'string' ? key : Object.keys(key)[0];
            cb({ [k]: store[k] });
          },
          set: (obj, cb) => {
            Object.assign(store, obj);
            if (cb) cb();
          },
        },
      },
    };
    global.importScripts = () => {};
    global.setInterval = () => {};
    global.OffscreenCanvas = class {
      constructor() {
        this.ctx = {
          clearRect: jest.fn(),
          lineWidth: 0,
          strokeStyle: '',
          beginPath: jest.fn(),
          arc: jest.fn(),
          stroke: jest.fn(),
          fillStyle: '',
          fill: jest.fn(),
          getImageData: () => ({}),
        };
      }
      getContext() { return this.ctx; }
    };
    global.qwenThrottle = {
      configure: jest.fn(),
      getUsage: () => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 60 }),
      approxTokens: jest
        .fn()
        .mockReturnValueOnce(1000) // turbo in
        .mockReturnValueOnce(2000) // turbo out
        .mockReturnValueOnce(3000) // plus in
        .mockReturnValueOnce(4000), // plus out
    };
    global.qwenUsageColor = () => '#00ff00';
    global.qwenTranslate = jest
      .fn()
      .mockResolvedValueOnce({ text: 'out1' })
      .mockResolvedValueOnce({ text: 'out2' });
    ({ handleTranslate } = require('../src/background.js'));
    usageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  });

  test('computes cost windows', async () => {
    await handleTranslate({
      endpoint: 'https://e/',
      apiKey: 'k',
      model: 'qwen-mt-turbo',
      text: 'in1',
      source: 'en',
      target: 'es',
    });
    jest.advanceTimersByTime(25 * 60 * 60 * 1000);
    await handleTranslate({
      endpoint: 'https://e/',
      apiKey: 'k',
      model: 'qwen-mt-plus',
      text: 'in2',
      source: 'en',
      target: 'es',
    });
    const res = await new Promise(resolve => usageListener({ action: 'usage' }, null, resolve));
    expect(res.costs['qwen-mt-turbo']['24h']).toBeCloseTo(0);
    expect(res.costs['qwen-mt-plus']['24h']).toBeCloseTo(0.03686);
    expect(res.costs.total['7d']).toBeCloseTo(0.038);
  });
});
