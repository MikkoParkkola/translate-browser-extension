(function () {
  const quickBtn = document.getElementById('quickTranslate');
  const autoToggle = document.getElementById('autoTranslate');
  const providerName = document.getElementById('providerName');
  const providerKey = document.getElementById('providerKey');
  const usageEl = document.getElementById('usage');
  const offlineBanner = document.getElementById('offlineBanner');
  const limitsEl = document.getElementById('limits');
  const cacheEl = document.getElementById('cacheStatus');
  const providersWrap = document.getElementById('providers');
  const statusEl = document.getElementById('status');
  const modelUsageEl = document.getElementById('modelUsage');
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
    if (cacheEl) {
      const hits = (t && t.hits) || 0;
      const misses = (t && t.misses) || 0;
      const lookups = hits + misses;
      const saved = lookups ? Math.round((hits / lookups) * 100) : 0;
      cacheEl.textContent = `Cache: ${c.size || 0}/${c.max || 0} TM: ${hits}/${misses}`;
      cacheEl.title = `Approx. API saved by TM: ${saved}%`;
    }
    renderProviders(res.providers, usage);
    // Query current status to set offline banner
    chrome.runtime.sendMessage({ action: 'get-status' }, handleLastError(st => {
      try { if (offlineBanner) offlineBanner.style.display = st && st.offline ? '' : 'none'; } catch {}
    }));
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
    if (statusEl) statusEl.textContent = res.active ? 'Translating' : 'Idle';
    if (modelUsageEl) modelUsageEl.textContent = '';
  }));

  function renderProviders(providers, usage) {
    if (!providersWrap) return;
    providersWrap.innerHTML = '';
    if (!providers || !Object.keys(providers).length) return;
    Object.entries(providers).forEach(([name, p]) => {
      const card = document.createElement('div');
      card.className = 'provider-card';

      const header = document.createElement('div');
      header.className = 'provider-card-title';
      const avatar = document.createElement('span');
      avatar.className = 'provider-avatar';
      avatar.textContent = name.slice(0, 1).toUpperCase();
      const title = document.createElement('span');
      title.textContent = name;
      header.appendChild(avatar);
      header.appendChild(title);
      const req = document.createElement('div');
      req.textContent = `Requests ${p.requests || 0}/${usage.requestLimit || 0}`;
      const reqBar = document.createElement('progress');
      reqBar.max = usage.requestLimit || 0;
      reqBar.value = p.requests || 0;
      if (self.qwenUsageColor) {
        reqBar.style.accentColor = self.qwenUsageColor(reqBar.value / (reqBar.max || 1));
      }
      const tok = document.createElement('div');
      tok.textContent = `Tokens ${p.tokens || 0}/${usage.tokenLimit || 0}`;
      const tokBar = document.createElement('progress');
      tokBar.max = usage.tokenLimit || 0;
      tokBar.value = p.tokens || 0;
      if (self.qwenUsageColor) {
        tokBar.style.accentColor = self.qwenUsageColor(tokBar.value / (tokBar.max || 1));
      }
      const small = document.createElement('div');
      small.className = 'stats';
      const total = `Total ${p.totalRequests || 0} req • ${p.totalTokens || 0} tok`;
      const avoid = `Saved ${p.avoidedRequests || 0} req • ${p.avoidedTokens || 0} tok`;
      small.textContent = `${total} • ${avoid}`;
      card.appendChild(header);
      card.appendChild(req);
      card.appendChild(reqBar);
      card.appendChild(tok);
      card.appendChild(tokBar);
      card.appendChild(small);
      providersWrap.appendChild(card);
    });
  }

  chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.action === 'home:update-usage') {
      const u = msg.usage || {};
      usageEl.textContent = `Requests: ${u.requests || 0}/${u.requestLimit || 0} Tokens: ${u.tokens || 0}/${u.tokenLimit || 0}`;
      if (limitsEl) limitsEl.textContent = `Queue: ${u.queue || 0}`;
      if (statusEl) statusEl.textContent = msg.active ? 'Translating' : 'Idle';
      if (modelUsageEl) {
        const parts = Object.entries(msg.models || {}).map(([name, m]) =>
          `${name}: ${m.requests || 0}/${m.requestLimit || 0} ${m.tokens || 0}/${m.tokenLimit || 0}`
        );
        modelUsageEl.textContent = parts.join(' | ');
      }
      renderProviders(msg.providers, u);
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
    } else if (msg && msg.action === 'translation-status') {
      try { if (offlineBanner) offlineBanner.style.display = msg.status && msg.status.offline ? '' : 'none'; } catch {}
    }
  });
})();
