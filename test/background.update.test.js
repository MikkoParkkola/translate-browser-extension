describe('background auto-update', () => {
  let intervalCallback, updateListener, installListener;

  beforeEach(() => {
    jest.resetModules();
    global.chrome = {
      runtime: {
        onInstalled: { addListener: jest.fn() },
        onUpdateAvailable: { addListener: jest.fn() },
        onMessage: { addListener: jest.fn() },
        onConnect: { addListener: jest.fn() },
        requestUpdateCheck: jest.fn(cb => cb && cb('no_update')),
        reload: jest.fn(),
        getManifest: () => ({ version: '1.44.0' }),
      },
      notifications: { create: jest.fn(), onClicked: { addListener: jest.fn() } },
      action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setIcon: jest.fn() },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(cb => cb && cb()), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() }, query: jest.fn(), sendMessage: jest.fn() },
      storage: {
        sync: { get: (_d, cb) => cb({ requestLimit: 60, tokenLimit: 60 }), set: (_o, cb) => cb && cb() },
        local: { get: (_d, cb) => cb({ usageHistory: [] }), set: (_o, cb) => cb && cb() },
      },
    };
    global.importScripts = () => {};
    global.setInterval = jest.fn();
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
    require('../src/background.js');
    const intervalCall = setInterval.mock.calls.find(c => c[1] === 6 * 60 * 60 * 1000);
    intervalCallback = intervalCall && intervalCall[0];
    updateListener = chrome.runtime.onUpdateAvailable.addListener.mock.calls[0][0];
    installListener = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
  });

  test('requests update checks periodically', () => {
    chrome.runtime.requestUpdateCheck.mockClear();
    intervalCallback();
    expect(chrome.runtime.requestUpdateCheck).toHaveBeenCalledTimes(1);
  });

  test('reloads when update is available', () => {
    updateListener({ version: '1.44.0' });
    expect(chrome.runtime.reload).toHaveBeenCalled();
  });

  test('notifies user after updating', () => {
    installListener({ reason: 'update' });
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: expect.stringContaining('1.44.0') })
    );
  });
});
