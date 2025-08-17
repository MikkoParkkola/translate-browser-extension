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
      <input id="compactMode" type="checkbox" />
      <input id="lightMode" type="checkbox" />
      <div id="status"></div>
      <button id="translate"></button>
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
      compact: false,
      theme: 'dark',
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
          else if (msg.action === 'ensure-start') cb({ ok: true });
          else if (msg.action === 'debug') cb({ cache: {}, tm: {} });
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
    const logger = require('../src/lib/logger');
    window.qwenConfig = { logLevel: 'debug' };
    window.qwenLogger = logger;
    const entries = [];
    const remove = logger.addCollector(e => entries.push(e));
    require('../src/popup.js');
    await Promise.resolve();
    document.getElementById('debug').checked = true;
    document.getElementById('test').click();
    await Promise.resolve();
    await new Promise(res => setTimeout(res, 0));
    expect(document.getElementById('status').textContent).toContain('All tests passed');
    expect(entries.some(e => e.ns === 'popup' && e.level === 'info' && e.args[0] === 'diagnostic step started')).toBe(true);
    expect(global.qwenTranslate.mock.calls.some(c => c[0].noProxy === true)).toBe(true);
    remove();
  });

  test('toggles compact and light modes', async () => {
    require('../src/popup.js');
    await Promise.resolve();
    expect(document.body.classList.contains('qwen-bg-animated')).toBe(true);
    expect(document.getElementById('translate').classList.contains('primary-glow')).toBe(true);
    const compact = document.getElementById('compactMode');
    compact.checked = true;
    compact.dispatchEvent(new Event('change'));
    expect(document.body.classList.contains('qwen-compact')).toBe(true);
    const light = document.getElementById('lightMode');
    light.checked = true;
    light.dispatchEvent(new Event('change'));
    expect(document.documentElement.getAttribute('data-qwen-color')).toBe('light');
  });
});

