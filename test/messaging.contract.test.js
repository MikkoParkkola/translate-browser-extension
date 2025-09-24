// @jest-environment node

describe('messaging helpers', () => {
  let messaging;
  let postedMessages;
  let port;

  const createPort = () => {
    const messageListeners = [];
    const disconnectListeners = [];
    return {
      onMessage: { addListener: fn => messageListeners.push(fn) },
      onDisconnect: { addListener: fn => disconnectListeners.push(fn) },
      postMessage: jest.fn(msg => { postedMessages.push(msg); }),
      disconnect: jest.fn(),
      _emitMessage(msg) { messageListeners.forEach(fn => fn(msg)); },
      _disconnect() { disconnectListeners.forEach(fn => fn()); },
    };
  };

  beforeEach(() => {
    jest.resetModules();
    postedMessages = [];
    port = createPort();

    global.chrome = {
      runtime: {
        connect: jest.fn(() => port),
        sendMessage: jest.fn((payload, cb) => cb && cb({ text: 'fallback', payload })),
        lastError: null,
      },
    };

    messaging = require('../src/lib/messaging');
  });

  afterEach(() => {
    delete global.chrome;
  });

  test('validateMessage sanitises payloads and rejects invalid actions', () => {
    const circular = {}; circular.self = circular;
    const valid = messaging.validateMessage({ action: 'translate', data: circular });
    expect(valid.ok).toBe(true);
    expect(valid.msg.data).toEqual({ self: '[Circular]' });

    const invalid = messaging.validateMessage({ action: 'unknown' });
    expect(invalid.ok).toBe(false);
  });

  test('requestViaBackground uses port transport and streams chunks', async () => {
    const onData = jest.fn();
    const promise = messaging.requestViaBackground({ text: 'hi', onData });

    expect(chrome.runtime.connect).toHaveBeenCalledWith({ name: 'qwen-translate' });
    const [{ requestId }] = port.postMessage.mock.calls[0];

    port._emitMessage({ requestId, chunk: 'partial' });
    port._emitMessage({ requestId, result: { text: 'done' } });

    const result = await promise;
    expect(onData).toHaveBeenCalledWith('partial');
    expect(result).toEqual({ text: 'done' });
  });

  test('requestViaBackground falls back to sendMessage when port unavailable', async () => {
    delete chrome.runtime.connect;
    const result = await messaging.requestViaBackground({ text: 'fallback' });
    expect(result.text).toBe('fallback');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'translate', opts: { text: 'fallback' } }, expect.any(Function));
  });

  test('detectLanguage applies sensitivity threshold', async () => {
    const promise = messaging.detectLanguage({ text: 'hola', sensitivity: 0.2 });
    const [{ requestId }] = port.postMessage.mock.calls[0];
    port._emitMessage({ requestId, result: { lang: 'es', confidence: 0.1 } });
    await expect(promise).resolves.toEqual({ lang: 'en', confidence: 0.1 });
  });
});
