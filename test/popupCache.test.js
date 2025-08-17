// @jest-environment jsdom

describe('home usage updates', () => {
  let listener;
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <button id="quickTranslate"></button>
      <label><input type="checkbox" id="autoTranslate"></label>
      <div id="provider">Provider: <span id="providerName"></span></div>
      <div id="usage">Requests: 0/0 Tokens: 0/0</div>
      <progress id="reqBar" value="0" max="0"></progress>
      <progress id="tokBar" value="0" max="0"></progress>
      <div id="limits"></div>
      <button id="toDiagnostics"></button>
    `;
    listener = undefined;
    global.chrome = {
      runtime: {
        sendMessage: jest.fn((msg, cb) => {
          if (msg.action === 'home:init') cb({ provider: 'p', usage: { requests: 1, tokens: 2, requestLimit: 10, tokenLimit: 20, queue: 0 }, auto: false });
        }),
        onMessage: { addListener: fn => { listener = fn; } },
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
    require('../src/popup/home.js');
  });

  test('updates usage on runtime message', () => {
    expect(document.getElementById('usage').textContent).toBe('Requests: 1/10 Tokens: 2/20');
    expect(document.getElementById('reqBar').value).toBe(1);
    expect(document.getElementById('reqBar').max).toBe(10);
    listener({ action: 'home:update-usage', usage: { requests: 3, tokens: 4, requestLimit: 10, tokenLimit: 20, queue: 1 } });
    expect(document.getElementById('usage').textContent).toBe('Requests: 3/10 Tokens: 4/20');
    expect(document.getElementById('tokBar').value).toBe(4);
    expect(document.getElementById('tokBar').max).toBe(20);
  });
});

