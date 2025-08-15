// @jest-environment jsdom

describe('popup configuration test', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <input id="apiEndpoint" />
      <input id="model" />
      <select id="source"></select>
      <select id="target"></select>
      <select id="detector"></select>
      <input id="debug" type="checkbox" />
      <div id="status"></div>
      <button id="test"></button>
    `;
    global.qwenLanguages = [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
    ];
    global.qwenLoadConfig = jest.fn().mockResolvedValue({
      apiKey: 'k',
      apiEndpoint: 'https://e/',
      model: 'm',
      sourceLanguage: 'en',
      targetLanguage: 'es',
      requestLimit: 60,
      tokenLimit: 100000,
      tokenBudget: 0,
      autoTranslate: false,
      detector: 'local',
      debug: true,
    });
    global.qwenSaveConfig = jest.fn().mockResolvedValue();
    global.qwenTranslate = jest.fn().mockResolvedValue({ text: 'hola' });
    global.qwenTranslateStream = jest.fn(async (opts, onData) => {
      if (onData) onData('hola');
      return { text: 'hola' };
    });
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, headers: { entries: () => [] } }));
    global.setInterval = jest.fn();
    global.clearInterval = jest.fn();
    global.qwenUsageColor = () => '#00ff00';
    const store = {};
    global.chrome = {
      runtime: {
        getManifest: () => ({ version: '1', version_name: '2024-01-01' }),
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn((msg, cb) => {
          if (msg.action === 'ping') cb({ ok: true });
          else if (msg.action === 'usage') cb({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 100000, totalRequests: 0, totalTokens: 0, queue: 0, costs: {} });
          else cb && cb({});
        }),
        connect: jest.fn(() => ({ postMessage: jest.fn(), onMessage: { addListener: jest.fn() }, onDisconnect: { addListener: jest.fn() }, disconnect: jest.fn() })),
      },
      tabs: {
        query: jest.fn((opts, cb) => cb([{ id: 1, url: 'https://example.com' }])),
        sendMessage: jest.fn((id, msg, cb) => {
          if (msg.action === 'test-read') cb({ title: 'Page' });
          else if (msg.action === 'test-e2e') cb({ text: 'Hola mundo' });
        }),
      },
      storage: {
        sync: {
          set: jest.fn((obj, cb) => { Object.assign(store, obj); cb && cb(); }),
          get: jest.fn((keys, cb) => {
            if (Array.isArray(keys)) {
              const out = {}; keys.forEach(k => { out[k] = store[k]; });
              cb(out);
            } else cb(store);
          }),
          remove: jest.fn((keys, cb) => { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k]); cb && cb(); }),
        },
        local: { get: jest.fn((keys, cb) => cb({ usageHistory: [] })), set: jest.fn((obj, cb) => cb && cb()) },
      },
    };
  });

  test('runs configuration tests and logs', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    require('../src/popup.js');
    await Promise.resolve();
    document.getElementById('debug').checked = true;
    document.getElementById('test').click();
    await Promise.resolve();
    await new Promise(res => setTimeout(res, 0));
    expect(document.getElementById('status').textContent).toContain('All tests passed');
    expect(logSpy).toHaveBeenCalledWith('QTDEBUG: starting configuration test', expect.any(Object));
    logSpy.mockRestore();
  });
});

