// src/popup.js

(function () {
  const frame = document.getElementById('content');
  const settingsBtn = document.getElementById('settingsBtn');
  let current = 'home.html';

  function handleLastError(cb) {
    return (...args) => {
      const err = chrome.runtime.lastError;
      if (err && !err.message.includes('Receiving end does not exist')) console.debug(err);
      if (typeof cb === 'function') cb(...args);
    };
  }

  function resize() {
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (doc) {
        const { scrollHeight, scrollWidth } = doc.documentElement;
        frame.style.height = scrollHeight + 'px';
        frame.style.width = scrollWidth + 'px';
        document.body.style.width = scrollWidth + 'px';
      }
    } catch {}
  }

  chrome.storage?.local?.get({ theme: 'modern' }, data => {
    const theme = data.theme || 'modern';
    applyTheme(theme);
  });

  function applyTheme(theme) {
    document.querySelectorAll('link[data-theme]').forEach(link => link.remove());
    if (theme !== 'modern') {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `styles/${theme}.css`;
      link.dataset.theme = theme;
      document.head.appendChild(link);
    }
    if (theme === 'cyberpunk') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }

  function load(page) {
    if (frame) frame.src = `popup/${page}`;
    current = page;
  }

  settingsBtn?.addEventListener('click', () => {
    load(current === 'settings.html' ? 'home.html' : 'settings.html');
  });

  let resizeObserver;
  function observeResize() {
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (!doc) return;
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(() => {
        resizeObserver.disconnect();
        requestAnimationFrame(() => {
          resize();
          resizeObserver.observe(doc.documentElement);
        });
      });
      resizeObserver.observe(doc.documentElement);
    } catch {}
  }
  frame?.addEventListener('load', () => {
    resize();
    observeResize();
  });
  if (frame?.contentDocument && frame.contentDocument.readyState === 'complete') {
    resize();
    observeResize();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.action) return;
    switch (msg.action) {
      case 'navigate':
        if (msg.page === 'settings') load('settings.html');
        else if (msg.page === 'home') load('home.html');
        break;
      case 'home:quick-translate':
        chrome.tabs?.query?.({ active: true, currentWindow: true }, tabs => {
          const t = tabs && tabs[0];
          if (t) {
            chrome.runtime.sendMessage({ action: 'ensure-start', tabId: t.id, url: t.url, targetLanguage: msg.targetLanguage }, handleLastError());
          }
        });
        break;
      case 'home:auto-translate':
        chrome.storage?.local?.set({ autoTranslate: msg.enabled });
        chrome.runtime.sendMessage({ action: 'set-config', config: { autoTranslate: msg.enabled } }, handleLastError());
        if (!msg.enabled) {
          chrome.tabs?.query?.({}, tabs => {
            (tabs || []).forEach(t => {
              if (t.id) chrome.tabs.sendMessage(t.id, { action: 'stop' }, handleLastError());
            });
          });
        }
        break;
      case 'home:get-usage':
        chrome.runtime.sendMessage({ action: 'metrics' }, handleLastError(m => {
          sendResponse({ usage: m && m.usage });
        }));
        return true;
      case 'settings:theme-change':
        applyTheme(msg.theme);
        chrome.storage.local.set({ theme: msg.theme });
        break;
      case 'settings:get-metrics':
        chrome.runtime.sendMessage({ action: 'metrics' }, handleLastError(m => {
          sendResponse(m);
        }));
        return true;
    }
  });
})();