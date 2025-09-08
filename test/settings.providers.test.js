// @jest-environment jsdom

function flush() {
  return new Promise(res => setTimeout(res, 0));
}

describe('settings provider cards', () => {
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
      <div id="diagnosticsTab"><section id="statsDetails"><pre id="usageStats"></pre></section></div>
    `;
    global.chrome = {
      storage: { sync: { get: jest.fn((defs, cb) => cb(defs)), set: jest.fn() } },
      runtime: { sendMessage: jest.fn() },
    };
    const provImpl = {};
    window.qwenProviders = {
      ensureProviders: jest.fn(),
      listProviders: jest.fn(() => [{ name: 'p1', label: 'P1' }, { name: 'p2', label: 'P2' }]),
      getProvider: jest.fn(() => provImpl),
      registerProvider: jest.fn(),
    };
    window.qwenProviderConfig = {
      loadProviderConfig: jest.fn(() => Promise.resolve({
        providers: {
          p1: { enabled: true, apiKey: 'k1', apiEndpoint: 'https://e.com' },
          p2: { enabled: true, apiKey: 'k2', apiEndpoint: 'https://e.com' },
        },
        providerOrder: ['p1', 'p2'],
      })),
      saveProviderConfig: jest.fn(() => Promise.resolve()),
    };
  });

  test('renders provider cards and toggles enabled', async () => {
    require('../src/popup/settings.js');
    await flush();
    const cards = document.querySelectorAll('.provider-card');
    expect(cards).toHaveLength(2);
    const cb = cards[0].querySelector('input[type="checkbox"]');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    
    // Wait for async event handler to complete
    await flush();
    
    expect(window.qwenProviderConfig.saveProviderConfig).toHaveBeenCalledWith(expect.objectContaining({
      providers: expect.objectContaining({ p1: expect.objectContaining({ enabled: false }) }),
    }));
  });

  test('saves provider order on dragend', async () => {
    require('../src/popup/settings.js');
    await flush();
    const list = document.getElementById('providerList');
    const first = list.children[0];
    const second = list.children[1];
    list.insertBefore(second, first);
    first.dispatchEvent(new Event('dragend'));
    
    // Wait for async event handler to complete
    await flush();
    
    expect(window.qwenProviderConfig.saveProviderConfig).toHaveBeenLastCalledWith(expect.objectContaining({
      providerOrder: ['p2', 'p1'],
    }));
  });

  test('duplicates provider configuration', async () => {
    window.fetch = jest.fn(() => Promise.resolve({ text: () => Promise.resolve('<div id="providerEditorOverlay"></div>') }));
    const origCreateElement = document.createElement.bind(document);
    document.createElement = jest.fn(tag => {
      const el = origCreateElement(tag);
      if (tag === 'script') setTimeout(() => el.onload && el.onload(), 0);
      return el;
    });
    window.qwenProviderEditor = { open: jest.fn() };
    require('../src/popup/settings.js');
    await flush();
    const card = document.querySelectorAll('.provider-card')[0];
    const dup = card.querySelector('button.duplicate');
    dup.click();
    await flush();
    expect(window.qwenProviders.registerProvider).toHaveBeenCalledWith('p1-copy', expect.any(Object));
    expect(window.qwenProviderConfig.saveProviderConfig).toHaveBeenLastCalledWith(expect.objectContaining({
      providers: expect.objectContaining({ 'p1-copy': expect.objectContaining({ apiKey: 'k1', apiEndpoint: 'https://e.com', enabled: true }) }),
      providerOrder: ['p1', 'p1-copy', 'p2'],
    }));
    document.createElement = origCreateElement;
  });
});

