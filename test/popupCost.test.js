// @jest-environment jsdom

describe('home view display', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <button id="quickTranslate"></button>
      <label><input type="checkbox" id="autoTranslate"></label>
        <div id="provider">Provider: <span id="providerName"></span> <span id="providerKey"></span></div>
      <div id="usage">Requests: 0/0 Tokens: 0/0</div>
      <progress id="reqBar" value="0" max="0"></progress>
      <progress id="tokBar" value="0" max="0"></progress>
      <div id="limits"></div>
      <div id="cacheStatus"></div>
      <button id="toDiagnostics"></button>
    `;
    global.chrome = {
      runtime: {
        sendMessage: jest.fn(),
        onMessage: { addListener: jest.fn() },
      },
      storage: {
        sync: {
          get: jest.fn((defaults, cb) => cb(defaults)),
          set: jest.fn(),
        },
      },
    };
    global.qwenUsageColor = jest.fn(() => '#000');
    global.window.qwenUsageColor = global.qwenUsageColor;
  });

  test('initializes and handles actions', () => {
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
        if (msg.action === 'home:init') cb({
          provider: 'qwen',
          apiKey: false,
          usage: { requests: 5, tokens: 10, requestLimit: 100, tokenLimit: 200, queue: 0 },
          cache: { size: 1, max: 2 },
          tm: { hits: 3, misses: 4 },
          auto: false,
        });
    });
    require('../src/popup/home.js');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'home:init' }, expect.any(Function));
      expect(document.getElementById('providerName').textContent).toBe('qwen');
      expect(document.getElementById('providerKey').textContent).toBe('✗');
    expect(document.getElementById('usage').textContent).toBe('Requests: 5/100 Tokens: 10/200');
    expect(document.getElementById('reqBar').value).toBe(5);
    expect(document.getElementById('reqBar').max).toBe(100);
    expect(document.getElementById('cacheStatus').textContent).toBe('Cache: 1/2 TM: 3/4');

    document.getElementById('quickTranslate').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'home:quick-translate' });

    const auto = document.getElementById('autoTranslate');
    auto.checked = true;
    auto.dispatchEvent(new Event('change'));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'home:auto-translate', enabled: true });
  });
});

