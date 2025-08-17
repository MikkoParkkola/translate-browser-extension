(function () {
  const frame = document.getElementById('content');
  const settingsBtn = document.getElementById('settingsBtn');
  let current = 'home.html';

  function load(page) {
    if (frame) frame.src = `popup/${page}`;
    current = page;
  }

  settingsBtn?.addEventListener('click', () => {
    load(current === 'settings.html' ? 'home.html' : 'settings.html');
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;
    switch (msg.action) {
      case 'navigate':
        if (msg.page === 'settings') load('settings.html');
        else if (msg.page === 'home') load('home.html');
        break;
      case 'home:quick-translate':
        chrome.runtime.sendMessage({ action: 'translate' });
        break;
      case 'home:auto-translate':
        chrome.storage?.sync?.set({ autoTranslate: msg.enabled });
        chrome.runtime.sendMessage({ action: 'set-config', config: { autoTranslate: msg.enabled } });
        if (!msg.enabled) {
          chrome.tabs?.query?.({ active: true, currentWindow: true }, tabs => {
            const t = tabs && tabs[0];
            if (t) chrome.tabs.sendMessage(t.id, { action: 'stop' });
          });
        }
        break;
      case 'home:init':
        Promise.all([
          new Promise(res => chrome.runtime.sendMessage({ action: 'metrics' }, res)),
          (window.qwenProviderConfig
            ? window.qwenProviderConfig.loadProviderConfig()
            : Promise.resolve({ providerOrder: [], provider: 'default' })),
          new Promise(res => chrome.storage?.sync?.get({ autoTranslate: false }, res)),
        ]).then(([metrics, provCfg, autoCfg]) => {
          const provider = (provCfg.providerOrder && provCfg.providerOrder[0]) || provCfg.provider || 'default';
          const usage = metrics && metrics.usage ? metrics.usage : {};
          const cache = metrics && metrics.cache ? metrics.cache : {};
          const tm = metrics && metrics.tm ? metrics.tm : {};
          sendResponse({ provider, usage, cache, tm, auto: autoCfg.autoTranslate });
        });
        return true;
      case 'home:get-usage':
        chrome.runtime.sendMessage({ action: 'metrics' }, m => {
          sendResponse({ usage: m && m.usage });
        });
        return true;
    }
  });
})();
