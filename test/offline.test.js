// @jest-environment jsdom

describe('offline handling', () => {
  test('content script emits offline status', async () => {
    jest.resetModules();
    delete window.__qwenCSLoaded;
    delete window.__qwenCSModule;
    delete window.translationExtensionInitialized;
    let messageListener;
    const sendMessage = jest.fn();
    global.chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: () => 'chrome-extension://abc/',
        sendMessage,
        onMessage: { addListener: cb => { messageListener = cb; } },
      },
      storage: {
        sync: {
          get: jest.fn((keys) => Promise.resolve({})),
          set: jest.fn((data) => Promise.resolve())
        }
      }
    };
    window.qwenI18n = { t: k => (k === 'popup.offline' ? 'Offline' : k === 'bubble.offline' ? 'Offline' : k), ready: Promise.resolve() };
    const origTranslate = window.qwenTranslate;
    window.qwenTranslate = jest.fn().mockRejectedValue(new Error('Failed to fetch'));
    window.qwenLoadConfig = async () => ({ apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'en', targetLanguage: 'es', providerOrder: [], endpoints: {}, detector: null, failover: null, debug: false });
    window.getSelection = () => ({ toString: () => 'hi' });
    const origDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window.navigator), 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    require('../src/contentScript-simple.js');
    // Wait for initialization to complete (contentScript-simple has 100ms delay)
    await new Promise(r => setTimeout(r, 150));
    messageListener({ type: 'translateSelection' }, {}, () => {});
    await new Promise(r => setTimeout(r, 0));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'popup-status', text: 'Offline', error: true }), expect.any(Function));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'translation-status', status: { offline: true } }), expect.any(Function));
    const status = document.getElementById('qwen-status');
    expect(status && status.textContent).toBe('TRANSLATE! by Mikko: Offline');
    Object.defineProperty(window.navigator, 'onLine', origDesc);
    window.qwenTranslate = origTranslate;
  });

  test('content script handles ERR_NETWORK as offline', async () => {
    jest.resetModules();
    delete window.__qwenCSLoaded;
    delete window.__qwenCSModule;
    delete window.translationExtensionInitialized;
    let messageListener;
    const sendMessage = jest.fn();
    global.chrome = {
      runtime: {
        id: 'test-extension-id',
        getURL: () => 'chrome-extension://abc/',
        sendMessage,
        onMessage: { addListener: cb => { messageListener = cb; } },
      },
      storage: {
        sync: {
          get: jest.fn((keys) => Promise.resolve({})),
          set: jest.fn((data) => Promise.resolve())
        }
      }
    };
    window.qwenI18n = { t: k => (k === 'popup.offline' ? 'Offline' : k === 'bubble.offline' ? 'Offline' : k), ready: Promise.resolve() };
    const origTranslate = window.qwenTranslate;
    const err = new Error('ERR_NETWORK');
    err.code = 'ERR_NETWORK';
    window.qwenTranslate = jest.fn().mockRejectedValue(err);
    window.qwenLoadConfig = async () => ({ apiEndpoint: 'https://e/', model: 'm', sourceLanguage: 'en', targetLanguage: 'es', providerOrder: [], endpoints: {}, detector: null, failover: null, debug: false });
    window.getSelection = () => ({ toString: () => 'hi' });
    const origDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window.navigator), 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    require('../src/contentScript-simple.js');
    // Wait for initialization to complete (contentScript-simple has 100ms delay)
    await new Promise(r => setTimeout(r, 150));
    messageListener({ type: 'translateSelection' }, {}, () => {});
    await new Promise(r => setTimeout(r, 0));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'translation-status', status: { offline: true } }), expect.any(Function));
    const status = document.getElementById('qwen-status');
    expect(status && status.textContent).toBe('TRANSLATE! by Mikko: Offline');
    Object.defineProperty(window.navigator, 'onLine', origDesc);
    window.qwenTranslate = origTranslate;
  });

  test('background emits offline status', async () => {
    jest.resetModules();
    const origDesc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window.navigator), 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const sendMessage = jest.fn();
    global.chrome = {
      action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setIcon: jest.fn() },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() }, onConnect: { addListener: jest.fn() }, sendMessage },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(cb => cb && cb()), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: {
        sync: { get: jest.fn((defaults, cb) => cb({ ...defaults, apiKey: 'k' })) },
        local: { get: jest.fn((_, cb) => cb({ usageHistory: [] })), set: jest.fn((_, cb) => cb && cb()) },
      },
    };
    global.importScripts = () => {};
    global.setInterval = () => {};
    global.OffscreenCanvas = class { constructor() { this.ctx = { clearRect: jest.fn(), lineWidth: 0, strokeStyle: '', beginPath: jest.fn(), arc: jest.fn(), stroke: jest.fn(), fillStyle: '', fill: jest.fn(), getImageData: () => ({}) }; } getContext() { return this.ctx; } };
    global.qwenThrottle = { configure: jest.fn(), getUsage: () => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 60 }), approxTokens: t => t.length };
    global.qwenUsageColor = () => '#00ff00';
    const origTranslate = global.qwenTranslate;
    global.qwenTranslate = jest.fn().mockRejectedValue(new Error('Failed to fetch'));
    global.qwenProviders = { getProvider: () => null };
    const { handleTranslate, _setConfig } = require('../src/background.js');
    _setConfig({ apiEndpoint: 'https://e/', model: 'm' });
    const res = await handleTranslate({ endpoint: 'https://e/', model: 'm', text: 'hi', source: 'en', target: 'es' });
    expect(res).toEqual({ error: 'offline' });
    expect(sendMessage).toHaveBeenCalledWith({ action: 'translation-status', status: { offline: true } }, expect.any(Function));
    Object.defineProperty(window.navigator, 'onLine', origDesc);
    global.qwenTranslate = origTranslate;
  });
});
