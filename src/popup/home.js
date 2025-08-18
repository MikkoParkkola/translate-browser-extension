(function () {
  const quickBtn = document.getElementById('quickTranslate');
  const autoToggle = document.getElementById('autoTranslate');
  const providerName = document.getElementById('providerName');
  const providerKey = document.getElementById('providerKey');
  const usageEl = document.getElementById('usage');
  const limitsEl = document.getElementById('limits');
  const cacheEl = document.getElementById('cacheStatus');
  const reqBar = document.getElementById('reqBar');
  const tokBar = document.getElementById('tokBar');
  const srcSel = document.getElementById('srcLang');
  const destSel = document.getElementById('destLang');
  const diagBtn = document.getElementById('toDiagnostics');
  const themeSel = document.getElementById('theme');
  const themeStyleSel = document.getElementById('themeStyle');

  const languages = (window.qwenLanguages || []).slice();

  function handleLastError(cb) {
    return (...args) => {
      const err = chrome.runtime.lastError;
      if (err && !err.message.includes('Receiving end does not exist')) console.debug(err);
      if (typeof cb === 'function') cb(...args);
    };
  }
  function fillSelect(sel, allowAuto) {
    if (!sel) return;
    if (allowAuto) {
      const opt = document.createElement('option');
      opt.value = 'auto';
      opt.textContent = 'Auto';
      sel.appendChild(opt);
    }
    languages.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.code;
      opt.textContent = l.name;
      sel.appendChild(opt);
    });
  }
  fillSelect(srcSel, true);
  fillSelect(destSel);

  chrome.storage?.sync?.get({ sourceLanguage: 'auto', targetLanguage: 'en', theme: 'dark', themeStyle: 'apple' }, cfg => {
    if (srcSel) srcSel.value = cfg.sourceLanguage;
    if (destSel) destSel.value = cfg.targetLanguage;
    if (themeSel) themeSel.value = cfg.theme;
    if (themeStyleSel) themeStyleSel.value = cfg.themeStyle;
    document.documentElement.setAttribute('data-qwen-theme', cfg.themeStyle || 'apple');
    document.documentElement.setAttribute('data-qwen-color', cfg.theme || 'dark');
  });

  srcSel?.addEventListener('change', e => {
    chrome.storage?.sync?.set({ sourceLanguage: e.target.value });
    chrome.runtime.sendMessage({ action: 'set-config', config: { sourceLanguage: e.target.value } }, handleLastError());
  });
  destSel?.addEventListener('change', e => {
    chrome.storage?.sync?.set({ targetLanguage: e.target.value });
    chrome.runtime.sendMessage({ action: 'set-config', config: { targetLanguage: e.target.value } }, handleLastError());
  });

  themeSel?.addEventListener('change', e => {
    const theme = e.target.value;
    document.documentElement.setAttribute('data-qwen-color', theme);
    chrome.storage?.sync?.set({ theme });
    chrome.runtime.sendMessage({ action: 'set-config', config: { theme } }, handleLastError());
    chrome.tabs?.query?.({ active: true, currentWindow: true }, tabs => {
      const t = tabs && tabs[0];
      if (t) chrome.tabs.sendMessage(t.id, { action: 'update-theme', theme, themeStyle: themeStyleSel?.value }, handleLastError());
    });
  });

  themeStyleSel?.addEventListener('change', e => {
    const style = e.target.value;
    document.documentElement.setAttribute('data-qwen-theme', style);
    chrome.storage?.sync?.set({ themeStyle: style });
    chrome.runtime.sendMessage({ action: 'set-config', config: { themeStyle: style } }, handleLastError());
    chrome.tabs?.query?.({ active: true, currentWindow: true }, tabs => {
      const t = tabs && tabs[0];
      if (t) chrome.tabs.sendMessage(t.id, { action: 'update-theme', theme: themeSel?.value, themeStyle: style }, handleLastError());
    });
  });

  quickBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'home:quick-translate' }, handleLastError());
  });

  autoToggle?.addEventListener('change', e => {
    chrome.runtime.sendMessage({ action: 'home:auto-translate', enabled: e.target.checked }, handleLastError());
  });

  diagBtn?.addEventListener('click', () => { location.href = 'diagnostics.html'; });

  chrome.runtime.sendMessage({ action: 'home:init' }, handleLastError(res => {
    if (!res) return;
    providerName.textContent = res.provider || '-';
    if (providerKey) providerKey.textContent = res.apiKey ? '✓' : '✗';
    const u = res.usage || {};
    usageEl.textContent = `Requests: ${u.requests || 0}/${u.requestLimit || 0} Tokens: ${u.tokens || 0}/${u.tokenLimit || 0}`;
    if (limitsEl) limitsEl.textContent = `Queue: ${u.queue || 0}`;
    const c = res.cache || {};
    const t = res.tm || {};
    if (cacheEl) cacheEl.textContent = `Cache: ${c.size || 0}/${c.max || 0} TM: ${t.hits || 0}/${t.misses || 0}`;
    if (reqBar) {
      reqBar.max = u.requestLimit || 0;
      reqBar.value = u.requests || 0;
      reqBar.style.accentColor = self.qwenUsageColor ? self.qwenUsageColor(reqBar.value / (reqBar.max || 1)) : '';
    }
    if (tokBar) {
      tokBar.max = u.tokenLimit || 0;
      tokBar.value = u.tokens || 0;
      tokBar.style.accentColor = self.qwenUsageColor ? self.qwenUsageColor(tokBar.value / (tokBar.max || 1)) : '';
    }
    autoToggle.checked = !!res.auto;
  }));

  chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.action === 'home:update-usage') {
      const u = msg.usage || {};
      usageEl.textContent = `Requests: ${u.requests || 0}/${u.requestLimit || 0} Tokens: ${u.tokens || 0}/${u.tokenLimit || 0}`;
      if (limitsEl) limitsEl.textContent = `Queue: ${u.queue || 0}`;
      if (reqBar) {
        reqBar.max = u.requestLimit || 0;
        reqBar.value = u.requests || 0;
        reqBar.style.accentColor = self.qwenUsageColor ? self.qwenUsageColor(reqBar.value / (reqBar.max || 1)) : '';
      }
      if (tokBar) {
        tokBar.max = u.tokenLimit || 0;
        tokBar.value = u.tokens || 0;
        tokBar.style.accentColor = self.qwenUsageColor ? self.qwenUsageColor(tokBar.value / (tokBar.max || 1)) : '';
      }
    }
  });
})();
