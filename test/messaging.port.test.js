// New file
// @jest-environment jsdom

describe('messaging.validateMessage', () => {
  test('handles circular structures without recursion', () => {
    jest.resetModules();
    const messaging = require('../src/lib/messaging.js');
    const msg = { action: 'ping' };
    msg.self = msg;
    const out = messaging.validateMessage(msg);
    expect(out.ok).toBe(true);
    expect(out.msg.self).toBe('[Circular]');
  });
});

describe('messaging via chrome.runtime Port', () => {
  beforeEach(() => {
    jest.resetModules();
    // fresh window.chrome for each test
    window.chrome = { runtime: {} };
  });

  function makePort(config = {}) {
    let msgListeners = [];
    let discListeners = [];
    const posted = [];
    let lastRequestId = null;
    const port = {
      name: 'qwen-translate',
      onMessage: { addListener: fn => msgListeners.push(fn) },
      onDisconnect: { addListener: fn => discListeners.push(fn) },
      postMessage: jest.fn(msg => {
        posted.push(msg);
        if (msg && msg.action === 'translate') {
          lastRequestId = msg.requestId;
          if (typeof config.onTranslate === 'function') {
            config.onTranslate({ requestId: lastRequestId, opts: msg.opts, port, emit });
          } else {
            // default: emit two chunks then result, then disconnect
            emit({ requestId: lastRequestId, chunk: 'A' });
            emit({ requestId: lastRequestId, chunk: 'B' });
            emit({ requestId: lastRequestId, result: { text: 'AB' } });
            port.disconnect();
          }
        } else if (msg && msg.action === 'cancel') {
          if (typeof config.onCancel === 'function') config.onCancel({ requestId: msg.requestId, port });
          // default: just disconnect
          setTimeout(() => port.disconnect(), 0);
        }
      }),
      disconnect: jest.fn(() => { discListeners.slice().forEach(fn => fn()); }),
      _posted: posted,
      _lastRequestId: () => lastRequestId,
    };
    function emit(message) { msgListeners.slice().forEach(fn => fn(message)); }
    return port;
  }

  test('streams chunks and resolves result via Port path', async () => {
    const port = makePort();
    window.chrome.runtime.connect = jest.fn(() => port);

    const messaging = require('../src/lib/messaging.js');

    const chunks = [];
    const res = await messaging.requestViaBackground({
      endpoint: 'https://e/',
      model: 'm',
      text: 'T',
      source: 'en',
      target: 'es',
      debug: false,
      stream: true,
      onData: c => chunks.push(c),
    });

    expect(chunks).toEqual(['A', 'B']);
    expect(res).toEqual({ text: 'AB' });
    expect(window.chrome.runtime.connect).toHaveBeenCalledWith({ name: 'qwen-translate' });
    expect(port.postMessage).toHaveBeenCalled();
  });

  test('AbortController cancels and posts cancel', async () => {
    const port = makePort({
      onTranslate: ({ requestId }) => {
        // do not emit result; let abort happen first
        expect(typeof requestId).toBe('string');
      }
    });
    window.chrome.runtime.connect = jest.fn(() => port);

    const messaging = require('../src/lib/messaging.js');

    const controller = new AbortController();
    const p = messaging.requestViaBackground({
      endpoint: 'https://e/',
      model: 'm',
      text: 'T',
      source: 'en',
      target: 'es',
      debug: false,
      stream: true,
      signal: controller.signal,
      onData: () => { throw new Error('onData should not be called after abort'); },
    });

    controller.abort();

    await expect(p).rejects.toThrow(/Abort/i);
    const cancelMsg = port._posted.find(m => m && m.action === 'cancel');
    expect(cancelMsg).toBeTruthy();
    // ensure we disconnected
    expect(port.disconnect).toHaveBeenCalled();
  });

  test('falls back to sendMessage when connect is unavailable', async () => {
    delete window.chrome.runtime.connect;
    window.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      expect(msg.action).toBe('translate');
      cb({ text: 'OK' });
    });

    const messaging = require('../src/lib/messaging.js');
    const res = await messaging.requestViaBackground({
      endpoint: 'https://e/',
      model: 'm',
      text: 'Hi',
      source: 'en',
      target: 'es',
      debug: false,
      stream: false
    });

    expect(res).toEqual({ text: 'OK' });
    expect(window.chrome.runtime.sendMessage).toHaveBeenCalled();
  });

  test('rejects when Port path sends error', async () => {
    const port = makePort({
      onTranslate: ({ requestId, emit }) => {
        emit({ requestId, error: 'bad' });
      }
    });
    window.chrome.runtime.connect = jest.fn(() => port);

    const messaging = require('../src/lib/messaging.js');

    await expect(
      messaging.requestViaBackground({
        endpoint: 'https://e/',
        model: 'm',
        text: 'oops',
        source: 'en',
        target: 'es',
        debug: false,
        stream: false
      })
    ).rejects.toThrow('bad');
  });

  test('rejects when sendMessage returns error', async () => {
    delete window.chrome.runtime.connect;
    window.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      cb({ error: 'nope' });
    });

    const messaging = require('../src/lib/messaging.js');

    await expect(
      messaging.requestViaBackground({
        endpoint: 'https://e/',
        model: 'm',
        text: 'oops',
        source: 'en',
        target: 'es',
        debug: false,
        stream: false
      })
    ).rejects.toThrow('nope');
  });
});

describe('translator streaming integrates with messaging', () => {
  beforeEach(() => {
    jest.resetModules();
    window.chrome = { runtime: {} };
  });

  test('qwenTranslateStream relays chunks and resolves', async () => {
    const port = (function makePort() {
      let msgListeners = [];
      let discListeners = [];
      let lastRequestId = null;
      const port = {
        onMessage: { addListener: fn => msgListeners.push(fn) },
        onDisconnect: { addListener: fn => discListeners.push(fn) },
        postMessage: jest.fn(msg => {
          if (msg.action === 'translate') {
            lastRequestId = msg.requestId;
            msgListeners.forEach(fn => fn({ requestId: lastRequestId, chunk: 'X' }));
            msgListeners.forEach(fn => fn({ requestId: lastRequestId, result: { text: 'X' } }));
            discListeners.forEach(fn => fn());
          }
        }),
        disconnect: jest.fn(() => { discListeners.forEach(fn => fn()); }),
      };
      return port;
    })();
    window.chrome.runtime.connect = jest.fn(() => port);

    const { qwenTranslateStream } = require('../src/translator.js');

    const chunks = [];
    const res = await qwenTranslateStream(
      {
        endpoint: 'https://e/',
        model: 'm',
        text: 'hello',
        source: 'en',
        target: 'es',
        debug: false,
        stream: true
      },
      c => chunks.push(c)
    );

    expect(chunks).toEqual(['X']);
    expect(res).toEqual({ text: 'X' });
  });
});
