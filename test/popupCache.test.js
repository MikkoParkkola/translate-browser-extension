// @jest-environment jsdom

describe('home usage updates', () => {
  let listener;
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <button id="quickTranslate"></button>
      <label><input type="checkbox" id="autoTranslate"></label>
      <div id="provider">Provider: <span id="providerName"></span></div>
      <div id="usage">Requests: 0 Tokens: 0</div>
    `;
    listener = undefined;
    global.chrome = {
      runtime: {
        sendMessage: jest.fn((msg, cb) => {
          if (msg.action === 'home:init') cb({ provider: 'p', usage: { requests: 1, tokens: 2 }, auto: false });
        }),
        onMessage: { addListener: fn => { listener = fn; } },
      },
    };
    require('../src/popup/home.js');
  });

  test('updates usage on runtime message', () => {
    expect(document.getElementById('usage').textContent).toBe('Requests: 1 Tokens: 2');
    listener({ action: 'home:update-usage', usage: { requests: 3, tokens: 4 } });
    expect(document.getElementById('usage').textContent).toBe('Requests: 3 Tokens: 4');
  });
});

