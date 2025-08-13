describe('background icon plus indicator', () => {
  let updateBadge, setUsingPlus, _setActiveTranslations, handleTranslate;
  beforeEach(() => {
    jest.resetModules();
    global.chrome = {
      action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setIcon: jest.fn(),
      },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: { sync: { get: (_, cb) => cb({ requestLimit: 60, tokenLimit: 60 }) } },
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
