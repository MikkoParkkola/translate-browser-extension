describe('background icon plus indicator', () => {
  let updateBadge, setUsingPlus, _setActiveTranslations;
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
    global.qwenThrottle = { configure: jest.fn(), getUsage: () => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 60 }) };
    global.qwenUsageColor = () => '#00ff00';
    ({ updateBadge, setUsingPlus, _setActiveTranslations } = require('../src/background.js'));
    chrome.action.setBadgeText.mockClear();
  });

  test('shows P badge when plus model active', () => {
    setUsingPlus(true);
    _setActiveTranslations(1);
    updateBadge();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'P' });
  });
});
