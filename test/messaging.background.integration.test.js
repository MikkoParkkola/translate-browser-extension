// @jest-environment jsdom

describe('messaging background integration', () => {
  function makeDuplexPort() {
    const fMsg = [], fDisc = [], bMsg = [], bDisc = [];
    const fPosted = [], bPosted = [];
    const front = {
      onMessage: { addListener: fn => fMsg.push(fn) },
      onDisconnect: { addListener: fn => fDisc.push(fn) },
      postMessage: jest.fn(msg => {
        fPosted.push(msg);
        bMsg.slice().forEach(fn => fn(msg));
      }),
      disconnect: jest.fn(() => {
        fDisc.slice().forEach(fn => fn());
        bDisc.slice().forEach(fn => fn());
      }),
      _posted: fPosted,
    };
    const back = {
      onMessage: { addListener: fn => bMsg.push(fn) },
      onDisconnect: { addListener: fn => bDisc.push(fn) },
      postMessage: jest.fn(msg => {
        bPosted.push(msg);
        fMsg.slice().forEach(fn => fn(msg));
      }),
      disconnect: jest.fn(() => {
        bDisc.slice().forEach(fn => fn());
        fDisc.slice().forEach(fn => fn());
      }),
      _posted: bPosted,
    };
    return { front, back };
  }

  beforeEach(() => {
    jest.resetModules();
    window.chrome = { runtime: {} };
  });

  test('relays chunks via Port and aborts with AbortController', async () => {
    const { front, back } = makeDuplexPort();
    let connectHandler;
    window.chrome.runtime.onConnect = { addListener: fn => { connectHandler = fn; } };
    window.chrome.runtime.connect = jest.fn(() => { connectHandler(back); return front; });

    // Simplified background handler
    window.chrome.runtime.onConnect.addListener(port => {
      let controller;
      port.onMessage.addListener(msg => {
        if (msg.action === 'translate') {
          controller = new AbortController();
          self.qwenTranslateStream({ ...msg.opts, signal: controller.signal }, chunk => {
            port.postMessage({ requestId: msg.requestId, chunk });
          }).then(result => {
            port.postMessage({ requestId: msg.requestId, result });
          }).catch(() => {});
        } else if (msg.action === 'cancel' && controller) {
          controller.abort();
        }
      });
      port.onDisconnect.addListener(() => { if (controller) controller.abort(); });
    });

    self.qwenTranslateStream = jest.fn((opts, onChunk) => {
      return new Promise((resolve, reject) => {
        const t1 = setTimeout(() => onChunk('A'), 0);
        const t2 = setTimeout(() => onChunk('B'), 5);
        const t3 = setTimeout(() => resolve({ text: 'AB' }), 10);
        opts.signal.addEventListener('abort', () => {
          clearTimeout(t1); clearTimeout(t2); clearTimeout(t3);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const messaging = require('../src/lib/messaging.js');
    const controller = new AbortController();
    const chunks = [];
    const p = messaging.requestViaBackground({
      endpoint: 'https://e/',
      model: 'm',
      text: 'T',
      source: 'en',
      target: 'es',
      debug: false,
      stream: true,
      signal: controller.signal,
      onData: c => {
        chunks.push(c);
        if (chunks.length === 1) controller.abort();
      }
    });
    await expect(p).rejects.toThrow(/Abort/);
    expect(chunks).toEqual(['A']);
    expect(front._posted.find(m => m && m.action === 'cancel')).toBeTruthy();
  });

  test('falls back to sendMessage when Port unavailable', async () => {
    let messageListener;
    window.chrome.runtime.onMessage = { addListener: fn => { messageListener = fn; } };
    window.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      messageListener(msg, {}, cb);
    });
    delete window.chrome.runtime.connect;

    self.qwenTranslate = jest.fn(async opts => ({ text: 'OK' }));
    window.chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'translate') {
        self.qwenTranslate(msg.opts).then(sendResponse);
        return true;
      }
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
});

