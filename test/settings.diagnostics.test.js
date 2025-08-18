// @jest-environment jsdom

function flush() { return new Promise(res => setTimeout(res, 0)); }

describe('settings diagnostics metrics', () => {
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div class="tabs"><button data-tab="general"></button></div>
      <div id="generalTab">
        <section id="detectionSection"><input type="checkbox" id="enableDetection"></section>
        <section id="glossarySection"><textarea id="glossary"></textarea></section>
      </div>
      <div id="providersTab" class="tab">
        <section id="providerSection">
          <div id="providerList"></div>
          <button id="addLocalProvider"></button>
          <div id="localProviderWizard"><select id="localProviderType"></select><div id="ollamaForm"></div><div id="macosForm"></div><button id="saveLocalProvider"></button></div>
        </section>
      </div>
      <div id="advancedTab">
        <section id="limitSection"><input id="requestLimit"><input id="tokenLimit"></section>
        <section id="cacheSection"><input type="checkbox" id="cacheEnabled"><button id="clearCache"></button></section>
      </div>
      <div id="diagnosticsTab">
        <section id="statsDetails"><pre id="usageStats"></pre></section>
        <section id="tmDetails"><pre id="tmMetrics"></pre></section>
        <section id="cacheDetails"><pre id="cacheStats"></pre></section>
      </div>
    `;
    global.chrome = {
      storage: { sync: { get: jest.fn((defs, cb) => cb(defs)), set: jest.fn() } },
      runtime: { sendMessage: jest.fn((msg, cb) => {
        if (msg.action === 'metrics') cb({ usage: {} });
        else if (msg.action === 'tm-cache-metrics') cb({ tmMetrics: { hits: 1 }, cacheStats: { hits: 2 } });
        else cb && cb({});
      }) },
    };
    window.qwenProviders = { ensureProviders: jest.fn(), listProviders: jest.fn(() => []) };
    window.qwenProviderConfig = { loadProviderConfig: jest.fn(() => Promise.resolve({ providers: {}, providerOrder: [] })), saveProviderConfig: jest.fn(() => Promise.resolve()) };
  });

  test('displays tm and cache metrics', async () => {
    require('../src/popup/settings.js');
    await flush();
    expect(document.getElementById('tmMetrics').textContent).toContain('hits');
    expect(document.getElementById('cacheStats').textContent).toContain('hits');
  });
});

