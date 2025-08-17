(function () {
  const quickBtn = document.getElementById('quickTranslate');
  const autoToggle = document.getElementById('autoTranslate');
  const providerName = document.getElementById('providerName');
  const usageEl = document.getElementById('usage');
  const limitsEl = document.getElementById('limits');
  const cacheEl = document.getElementById('cacheStatus');
  const reqBar = document.getElementById('reqBar');
  const tokBar = document.getElementById('tokBar');
  const srcSel = document.getElementById('srcLang');
  const destSel = document.getElementById('destLang');
  const diagBtn = document.getElementById('toDiagnostics');

  const languages = (window.qwenLanguages || []).slice();
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

  chrome.storage?.sync?.get({ sourceLanguage: 'auto', targetLanguage: 'en' }, cfg => {
    if (srcSel) srcSel.value = cfg.sourceLanguage;
    if (destSel) destSel.value = cfg.targetLanguage;
  });

  srcSel?.addEventListener('change', e => {
    chrome.storage?.sync?.set({ sourceLanguage: e.target.value });
    chrome.runtime.sendMessage({ action: 'set-config', config: { sourceLanguage: e.target.value } });
  });
  destSel?.addEventListener('change', e => {
    chrome.storage?.sync?.set({ targetLanguage: e.target.value });
    chrome.runtime.sendMessage({ action: 'set-config', config: { targetLanguage: e.target.value } });
  });

  quickBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'home:quick-translate' });
  });

  autoToggle?.addEventListener('change', e => {
    chrome.runtime.sendMessage({ action: 'home:auto-translate', enabled: e.target.checked });
  });

  diagBtn?.addEventListener('click', () => { location.href = 'diagnostics.html'; });

  chrome.runtime.sendMessage({ action: 'home:init' }, res => {
    if (!res) return;
    providerName.textContent = res.provider || '-';
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
  });

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
