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
      tabs: {
        query: jest.fn((opts, cb) => cb([{ id: 1, url: 'https://example.com' }])),
        sendMessage: jest.fn(),
      },
    };
    global.window.qwenProviderConfig = {
      loadProviderConfig: jest.fn(() => Promise.resolve({ providerOrder: ['qwen'], provider: 'qwen', providers: {} })),
    };
  });

  test('routes navigation and home actions', () => {
    require('../src/popup.js');
    const frame = document.getElementById('content');
    document.getElementById('settingsBtn').click();
    expect(frame.src).toContain('popup/settings.html');
    document.getElementById('settingsBtn').click();
    expect(frame.src).toContain('popup/home.html');

    listener({ action: 'navigate', page: 'settings' });
    expect(frame.src).toContain('popup/settings.html');

    listener({ action: 'navigate', page: 'home' });
    expect(frame.src).toContain('popup/home.html');

    listener({ action: 'home:quick-translate' });
    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true }, expect.any(Function));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'ensure-start', tabId: 1, url: 'https://example.com' });

    listener({ action: 'home:auto-translate', enabled: true });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ autoTranslate: true });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'set-config', config: { autoTranslate: true } });

    listener({ action: 'home:auto-translate', enabled: false });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ autoTranslate: false });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'set-config', config: { autoTranslate: false } });
    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true }, expect.any(Function));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { action: 'stop' });
  });

  test('initializes home view via home:init', async () => {
      chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (msg.action === 'metrics') cb({ usage: { requests: 1, tokens: 2 }, cache: {}, tm: {}, providers: { qwen: { apiKey: true } } });
      });
    require('../src/popup.js');
    await new Promise(resolve => {
      const ret = listener({ action: 'home:init' }, {}, res => {
        expect(res).toEqual({ provider: 'qwen', apiKey: true, usage: { requests: 1, tokens: 2 }, cache: {}, tm: {}, auto: false });
        resolve();
      });
      expect(ret).toBe(true);
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'metrics' }, expect.any(Function));
    expect(window.qwenProviderConfig.loadProviderConfig).toHaveBeenCalled();
    expect(chrome.storage.sync.get).toHaveBeenCalledWith({ autoTranslate: false }, expect.any(Function));
  });
});

