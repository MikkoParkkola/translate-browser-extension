// @jest-environment jsdom

describe('popup auto-translate toggle', () => {
  let listener;
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<iframe id="content"></iframe><button id="settingsBtn"></button>';
    listener = undefined;
    global.chrome = {
      runtime: {
        sendMessage: jest.fn(),
        onMessage: { addListener: cb => { listener = cb; } },
        getURL: jest.fn((path) => `chrome-extension://fake-id/${path}`),
      },
      storage: {
        sync: {
          get: jest.fn((defaults, cb) => cb({})),
          set: jest.fn(),
        },
      },
      tabs: {
        query: jest.fn((query, cb) => cb([{ id: 1 }, { id: 2 }])),
        sendMessage: jest.fn(),
      },
    };
    require('../src/popup.js');
  });

  const flush = () => new Promise(res => setTimeout(res, 0));

  test('disabling auto-translate stops all tabs', async () => {
    chrome.tabs.sendMessage.mockClear();
    listener({ action: 'home:auto-translate', enabled: false });
    await flush();
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ autoTranslate: false }, expect.any(Function));
    expect(chrome.tabs.query).toHaveBeenCalledWith({}, expect.any(Function));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { action: 'stop' }, {}, expect.any(Function));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, { action: 'stop' }, {}, expect.any(Function));
  });
});
