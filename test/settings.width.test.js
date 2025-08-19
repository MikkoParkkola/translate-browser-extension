// @jest-environment jsdom

function flush() { return new Promise(res => setTimeout(res, 0)); }

describe('settings width resizing', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('resizes window on tab switch', async () => {
    document.body.innerHTML = `
      <div class="tabs">
        <button data-tab="general"></button>
        <button data-tab="diagnostics"></button>
      </div>
      <div id="generalTab">
        <section id="detectionSection"><input type="checkbox" id="enableDetection"></section>
        <section id="glossarySection"><textarea id="glossary"></textarea></section>
      </div>
      <div id="providersTab" class="tab">
        <section id="providerSection"><div id="providerList"></div><button id="addProvider"></button></section>
      </div>
      <div id="advancedTab">
        <section id="cacheSection"><input type="checkbox" id="cacheEnabled"><button id="clearCache"></button></section>
      </div>
      <div id="diagnosticsTab">
        <section id="statsDetails"><pre id="usageStats"></pre></section>
        <section id="tmDetails"><pre id="tmMetrics"></pre></section>
        <section id="cacheDetails"><pre id="cacheStats"></pre></section>
      </div>
    `;
    global.chrome = { storage: { sync: { get: jest.fn((defs, cb) => cb(defs)), set: jest.fn() } }, runtime: { sendMessage: jest.fn() } };
    window.resizeTo = jest.fn();
    window.outerHeight = 100;
    Object.defineProperty(document.body, 'scrollWidth', { configurable: true, value: 200 });
    require('../src/popup/settings.js');
    await flush();
    expect(window.resizeTo).toHaveBeenCalledWith(200, 100);
    window.resizeTo.mockClear();
    Object.defineProperty(document.body, 'scrollWidth', { configurable: true, value: 150 });
    document.querySelectorAll('.tabs button')[1].click();
    await flush();
    expect(window.resizeTo).toHaveBeenCalledWith(150, 100);
  });
});
