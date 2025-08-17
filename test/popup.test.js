// @jest-environment jsdom

describe('popup shell routing', () => {
  let listener;
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="nav"><button id="settingsBtn"></button></div>
      <iframe id="content"></iframe>
    `;
    listener = undefined;
    global.chrome = {
      runtime: {
        sendMessage: jest.fn(),
        onMessage: { addListener: fn => { listener = fn; } },
      },
      storage: {
        sync: {
          set: jest.fn(),
          get: jest.fn((defaults, cb) => cb(defaults)),
        },
      },
    };
    global.window.qwenProviderConfig = {
      loadProviderConfig: jest.fn(() => Promise.resolve({ providerOrder: ['qwen'], provider: 'qwen', providers: {} })),
    };
  });

  test('routes navigation and home actions', () => {
    require('../src/popup.js');
    document.getElementById('settingsBtn').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'navigate', page: 'settings' });

    const frame = document.getElementById('content');
    listener({ action: 'navigate', page: 'settings' });
    expect(frame.src).toContain('popup/settings.html');

    listener({ action: 'navigate', page: 'home' });
    expect(frame.src).toContain('popup/home.html');

    listener({ action: 'home:quick-translate' });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'translate' });

    listener({ action: 'home:auto-translate', enabled: true });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ autoTranslate: true });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'set-config', config: { autoTranslate: true } });
  });

  test('initializes home view via home:init', async () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg.action === 'metrics') cb({ usage: { requests: 1, tokens: 2 } });
    });
    require('../src/popup.js');
    await new Promise(resolve => {
    const ret = listener({ action: 'home:init' }, {}, res => { expect(res).toEqual({ provider: 'qwen', usage: { requests: 1, tokens: 2 }, auto: false }); resolve(); });
      expect(ret).toBe(true);
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'metrics' }, expect.any(Function));
    expect(window.qwenProviderConfig.loadProviderConfig).toHaveBeenCalled();
    expect(chrome.storage.sync.get).toHaveBeenCalledWith({ autoTranslate: false }, expect.any(Function));
  });
});

