describe('background icon plus indicator', () => {
  let updateBadge, setUsingPlus, _setActiveTranslations, handleTranslate, _setConfig, portListener;
  beforeEach(() => {
    jest.resetModules();
    global.models = null;
    global.chrome = {
      action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setIcon: jest.fn(),
      },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() }, onConnect: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(cb => cb && cb()), onClicked: { addListener: jest.fn() } },
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
    global.lastCtx = null;
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
        global.lastCtx = this.ctx;
      }
      getContext() { return this.ctx; }
    };
    global.qwenThrottle = {
      configure: jest.fn(),
      getUsage: () => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 60 }),
      approxTokens: t => t.length,
    };
    global.qwenUsageColor = () => '#00ff00';
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
    ({ updateBadge, setUsingPlus, _setActiveTranslations, handleTranslate, _setConfig } = require('../src/background.js'));
    portListener = chrome.runtime.onConnect.addListener.mock.calls[0][0];
    chrome.action.setBadgeText.mockClear();
  });

  test('shows P badge when plus model active', () => {
    setUsingPlus(true);
    _setActiveTranslations(1);
    updateBadge();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'P' });
  });

  test('creates context menu entries', () => {
    const ids = chrome.contextMenus.create.mock.calls.map(c => c[0].id).sort();
    expect(ids).toEqual(
      expect.arrayContaining([
        'qwen-translate-selection',
        'qwen-translate-page',
        'qwen-enable-site',
      ])
    );
  });

  test('icon shows gray when idle', async () => {
    _setActiveTranslations(0);
    updateBadge();
    await Promise.resolve();
    expect(lastCtx.fillStyle).toBe('#808080');
  });

  test('icon shows green when busy', async () => {
    _setActiveTranslations(1);
    updateBadge();
    await Promise.resolve();
    expect(lastCtx.fillStyle).toBe('#00c853');
  });

  test('icon shows red on error', async () => {
    global.qwenTranslate = jest.fn().mockRejectedValue(new Error('fail'));
    await handleTranslate({
      endpoint: 'https://e/',
      apiKey: 'k',
      model: 'm',
      text: 'hi',
      source: 'en',
      target: 'es',
    }).catch(() => {});
    updateBadge(); // Need to call updateBadge to refresh the icon
    await Promise.resolve();
    expect(lastCtx.fillStyle).toBe('#ff1744');
  });

  test('reports per-model usage', async () => {
    global.qwenTranslate = jest.fn().mockResolvedValue({ text: 'ok' });
    await handleTranslate({
      provider: 'google',
      endpoint: 'https://e/',
      apiKey: 'k',
      model: 'google-nmt',
      text: 'hi',
      source: 'en',
      target: 'es',
    });
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const usage = await new Promise(resolve => listener({ action: 'usage' }, { id: 'test-extension', tab: { url: 'https://test.com' } }, resolve));
    expect(usage.models['google-nmt'].requests).toBe(1);
  });

  test('switches provider when quota low', async () => {
    const translateSpy = jest.fn().mockResolvedValue({ text: 'ok' });
    global.qwenTranslate = translateSpy;
    global.qwenProviders = {
      getProvider: name =>
        name === 'qwen'
          ? { getQuota: jest.fn().mockResolvedValue({ remaining: { requests: 0, tokens: 0 } }) }
          : {},
    };
    _setConfig({ providerOrder: ['qwen', 'alt'], requestThreshold: 1 });
    await handleTranslate({
      provider: 'qwen',
      endpoint: 'https://e/',
      apiKey: 'k',
      model: 'qwen-mt-turbo',
      text: 'hi',
      source: 'en',
      target: 'es',
    });
    expect(translateSpy).toHaveBeenCalledWith(expect.objectContaining({ provider: 'alt' }));
  });

  test('handleTranslate uses noProxy', async () => {
    const translateSpy = jest.fn().mockResolvedValue({ text: 'ok' });
    global.qwenTranslate = translateSpy;
    await handleTranslate({
      endpoint: 'https://e/',
      apiKey: 'k',
      model: 'm',
      text: 'hi',
      source: 'en',
      target: 'es',
    });
    expect(translateSpy).toHaveBeenCalledWith(expect.objectContaining({ noProxy: true }));
  });

  test('port translation passes noProxy', async () => {
    const posted = [];
    const port = {
      name: 'qwen-translate',
      onMessage: { addListener: fn => (port._onMessage = fn) },
      onDisconnect: { addListener: jest.fn() },
      postMessage: jest.fn(msg => posted.push(msg)),
    };
    portListener(port);
    const translateSpy = jest.fn().mockResolvedValue({ text: 'ok' });
    global.qwenTranslate = translateSpy;
    await port._onMessage({
      action: 'translate',
      requestId: '1',
      opts: { endpoint: 'https://e/', model: 'm', text: 't', source: 'en', target: 'es' },
    });
    expect(translateSpy).toHaveBeenCalledWith(expect.objectContaining({ noProxy: true }));
    expect(posted.length).toBeGreaterThan(0);
  });

  test('falls back to canvas when OffscreenCanvas missing', async () => {
    delete global.OffscreenCanvas;
    const ctx = {
      clearRect: jest.fn(),
      lineWidth: 0,
      strokeStyle: '',
      beginPath: jest.fn(),
      arc: jest.fn(),
      stroke: jest.fn(),
      fillStyle: '',
      fill: jest.fn(),
      getImageData: () => ({}),
      textAlign: '',
      textBaseline: '',
      font: '',
      fillText: jest.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => ctx };
    const createSpy = jest
      .spyOn(global.document, 'createElement')
      .mockImplementation(() => canvas);
    chrome.action.setIcon.mockClear();
    updateBadge();
    await Promise.resolve();
    expect(createSpy).toHaveBeenCalledWith('canvas');
    expect(chrome.action.setIcon).toHaveBeenCalled();
    createSpy.mockRestore();
  });

  test('updateBadge tolerates missing canvas context', () => {
    global.OffscreenCanvas = class { getContext() { return null; } };
    expect(() => updateBadge()).not.toThrow();
  });

  test('notifies on update with version', () => {
    const onInstalled = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
    chrome.runtime.getManifest = () => ({ version: '9.9.9' });
    chrome.notifications = { create: jest.fn(), onClicked: { addListener: jest.fn() } };
    chrome.tabs.create = jest.fn();
    onInstalled({ reason: 'update' });
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      'qwen-update',
      expect.objectContaining({ message: expect.stringContaining('9.9.9') })
    );
    const click = chrome.notifications.onClicked.addListener.mock.calls[0][0];
    click('qwen-update');
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'https://github.com/QwenLM/translate-by-mikko/releases/latest' });
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
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() }, onConnect: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(), onClicked: { addListener: jest.fn() } },
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
      approxTokens: t => t.length,
    };
    global.qwenUsageColor = () => '#00ff00';
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
      text: 'a'.repeat(10000),
      source: 'en',
      target: 'es',
    });
    jest.advanceTimersByTime(25 * 60 * 60 * 1000);
    await handleTranslate({
      provider: 'google',
      endpoint: 'https://e/',
      apiKey: 'k',
      model: 'google-nmt',
      text: 'b'.repeat(10000),
      source: 'en',
      target: 'es',
    });
    expect(store.usageHistory[0].provider).toBe('qwen');
    expect(store.usageHistory[1].provider).toBe('qwen');
    const res = await new Promise(resolve => usageListener({ action: 'usage' }, { id: 'test-extension', tab: { url: 'https://test.com' } }, resolve));
    expect(res.costs['qwen-mt-turbo']['24h']).toBeCloseTo(0);
    expect(res.costs['google-nmt']['24h']).toBeCloseTo(0.2);
    expect(res.costs.total['7d']).toBeCloseTo(0.2016, 4);
  });
});
