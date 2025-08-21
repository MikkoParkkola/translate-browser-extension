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

  test('disabling auto-translate stops all tabs', () => {
    chrome.tabs.sendMessage.mockClear();
    listener({ action: 'home:auto-translate', enabled: false });
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({ autoTranslate: false });
    expect(chrome.tabs.query).toHaveBeenCalledWith({}, expect.any(Function));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { action: 'stop' }, expect.any(Function));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, { action: 'stop' }, expect.any(Function));
  });
});
