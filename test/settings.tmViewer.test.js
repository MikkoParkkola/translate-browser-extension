// @jest-environment jsdom

function flush() {
  return new Promise(res => setTimeout(res, 0));
}

describe('settings TM viewer', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('background exposes tm getAll and clear over messaging', async () => {
    const syncGet = jest.fn((defs, cb) => cb(defs));
    global.chrome = {
      action: { setBadgeText: jest.fn(), setBadgeBackgroundColor: jest.fn(), setIcon: jest.fn() },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() }, onConnect: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), removeAll: jest.fn(cb => cb && cb()), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: { sync: { get: syncGet }, local: { get: jest.fn(), set: jest.fn() } },
    };
    global.importScripts = () => {};
    global.setInterval = () => {};
    global.self = global;
    global.qwenThrottle = { configure: jest.fn(), getUsage: () => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 100000 }), recordUsage: jest.fn() };
    global.qwenGetCacheSize = () => 0;
    global.qwenErrorHandler = {
      handle: jest.fn(),
      handleAsync: jest.fn((promise) => promise),
      safe: jest.fn((fn, context, fallback, logger) => {
        return () => {
          try {
            return fn();
          } catch (error) {
            return fallback || { ok: false, error };
          }
        };
      })
    };
    const tm = {
      getAll: jest.fn(() => Promise.resolve([{ k: 'a', text: '1' }])),
      clear: jest.fn(() => Promise.resolve()),
      set: jest.fn(() => Promise.resolve()),
      stats: jest.fn(() => ({ entries: 1 })),
    };
    global.qwenTM = tm;
    require('../src/background.js');
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const res = await new Promise(resolve => listener({ action: 'tm-get-all' }, { id: 'test-extension', tab: { url: 'https://test.com' } }, resolve));
    expect(res.entries[0].k).toBe('a');
    await new Promise(resolve => listener({ action: 'tm-clear' }, { id: 'test-extension', tab: { url: 'https://test.com' } }, resolve));
    expect(tm.clear).toHaveBeenCalled();
  });

  test('TM management UI uses messaging actions', async () => {
    document.body.innerHTML = `
      <div class="tabs"><button data-tab="general"></button></div>
      <div id="generalTab">
        <section id="detectionSection"><input type="checkbox" id="enableDetection"></section>
        <section id="glossarySection"><textarea id="glossary"></textarea></section>
      </div>
      <div id="providersTab" class="tab">
        <section id="providerSection"><div id="providerList"></div><button id="addProvider"></button></section>
      </div>
      <div id="advancedTab">
        <section id="timeoutSection"><input id="translateTimeoutMs"></section>
        <section id="cacheSection"><input type="checkbox" id="cacheEnabled"><button id="clearCache"></button></section>
        <section id="tmSection">
          <pre id="tmStats"></pre>
          <button id="tmExport"></button>
          <input type="file" id="tmImportFile">
          <button id="tmImport"></button>
          <button id="tmClear"></button>
        </section>
      </div>
      <div id="diagnosticsTab">
        <section id="statsDetails"><pre id="usageStats"></pre></section>
        <section id="tmDetails"><pre id="tmMetrics"></pre></section>
        <section id="cacheDetails"><pre id="cacheStats"></pre></section>
      </div>
    `;
    let tmEntries = [{ k: 'a', text: '1' }];
    global.URL.createObjectURL = jest.fn(() => 'blob:1');
    global.URL.revokeObjectURL = jest.fn();
    global.chrome = {
      storage: { sync: { get: jest.fn((defs, cb) => cb(defs)), set: jest.fn() } },
      runtime: {
        sendMessage: jest.fn((msg, cb) => {
          if (msg.action === 'tm-stats') {
            cb({ stats: { entries: tmEntries.length } });
          } else if (msg.action === 'tm-get-all') {
            cb({ entries: tmEntries, stats: { entries: tmEntries.length } });
          } else if (msg.action === 'tm-clear') {
            tmEntries = [];
            cb({ ok: true });
          } else if (msg.action === 'tm-import') {
            tmEntries = msg.entries || [];
            cb({ ok: true });
          } else if (msg.action === 'tm-cache-metrics') {
            cb({ tmMetrics: {}, cacheStats: {} });
          } else if (msg.action === 'metrics') {
            cb({ usage: {} });
          } else {
            cb({});
          }
        }),
      },
    };
    window.resizeTo = jest.fn();
    window.outerHeight = 100;
    Object.defineProperty(document.body, 'scrollWidth', { configurable: true, value: 120 });
    require('../src/popup/settings.js');
    await flush();
    expect(window.resizeTo).toHaveBeenCalledWith(120, 100);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'tm-stats' }, expect.any(Function));
    expect(document.getElementById('tmStats').textContent).toContain('"entries": 1');
    window.resizeTo.mockClear();
    Object.defineProperty(document.body, 'scrollWidth', { configurable: true, value: 80 });
    document.getElementById('tmClear').click();
    await flush();
    expect(window.resizeTo).toHaveBeenCalledWith(80, 100);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'tm-clear' }, expect.any(Function));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'tm-stats' }, expect.any(Function));
    await flush();
    expect(document.getElementById('tmStats').textContent).toContain('"entries": 0');
    document.getElementById('tmExport').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'tm-get-all' }, expect.any(Function));
    const fileInput = document.getElementById('tmImportFile');
    const file = new Blob([JSON.stringify([{ k: 'b', text: '2' }])], { type: 'application/json' });
    file.text = () => Promise.resolve(JSON.stringify([{ k: 'b', text: '2' }]));
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fileInput.dispatchEvent(new Event('change'));
    await flush();
    expect(
      chrome.runtime.sendMessage.mock.calls.some(
        ([msg]) => msg && msg.action === 'tm-import' && JSON.stringify(msg.entries) === JSON.stringify([{ k: 'b', text: '2' }])
      )
    ).toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'tm-stats' }, expect.any(Function));
  });
});
