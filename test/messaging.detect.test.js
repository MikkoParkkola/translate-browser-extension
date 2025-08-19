// @jest-environment jsdom
describe('messaging.detectLanguage via Port and fallback', () => {
  beforeEach(() => {
    jest.resetModules();
    window.chrome = { runtime: {} };
  });

  test('detect via Port', async () => {
    let listeners = [];
    const port = {
      onMessage: { addListener: fn => listeners.push(fn) },
      onDisconnect: { addListener: () => {} },
      postMessage: jest.fn(msg => {
        if (msg.action === 'detect') {
          const { requestId } = msg;
          listeners.forEach(fn => fn({ requestId, result: { lang: 'fr', confidence: 0.9 } }));
        }
      }),
      disconnect: jest.fn(),
    };
    window.chrome.runtime.connect = jest.fn(() => port);
    const messaging = require('../src/lib/messaging.js');
    const out = await messaging.detectLanguage({ text: 'bonjour', detector: 'local' });
    expect(out).toEqual({ lang: 'fr', confidence: 0.9 });
  });

  test('detect via sendMessage fallback', async () => {
    delete window.chrome.runtime.connect;
    window.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      expect(msg.action).toBe('detect');
      cb({ lang: 'en', confidence: 0.8 });
    });
    const messaging = require('../src/lib/messaging.js');
    const out = await messaging.detectLanguage({ text: 'hello', detector: 'local' });
    expect(out).toEqual({ lang: 'en', confidence: 0.8 });
  });

  test('falls back when below sensitivity', async () => {
    let listeners = [];
    const port = {
      onMessage: { addListener: fn => listeners.push(fn) },
      onDisconnect: { addListener: () => {} },
      postMessage: jest.fn(msg => {
        if (msg.action === 'detect') {
          const { requestId } = msg;
          listeners.forEach(fn => fn({ requestId, result: { lang: 'fr', confidence: 0.2 } }));
        }
      }),
      disconnect: jest.fn(),
    };
    window.chrome.runtime.connect = jest.fn(() => port);
    const messaging = require('../src/lib/messaging.js');
    const out = await messaging.detectLanguage({ text: 'bonjour', detector: 'local', sensitivity: 0.5 });
    expect(out).toEqual({ lang: 'en', confidence: 0.2 });
  });

  test('sendMessage respects sensitivity threshold', async () => {
    delete window.chrome.runtime.connect;
    window.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      cb({ lang: 'fr', confidence: 0.3 });
    });
    const messaging = require('../src/lib/messaging.js');
    const out = await messaging.detectLanguage({ text: 'bonjour', detector: 'local', sensitivity: 0.5 });
    expect(out).toEqual({ lang: 'en', confidence: 0.3 });
  });
});
