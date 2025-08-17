(function () {
  const quickBtn = document.getElementById('quickTranslate');
  const autoToggle = document.getElementById('autoTranslate');
  const providerName = document.getElementById('providerName');
  const usageEl = document.getElementById('usage');

  quickBtn?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'home:quick-translate' });
  });

  autoToggle?.addEventListener('change', e => {
    chrome.runtime.sendMessage({ action: 'home:auto-translate', enabled: e.target.checked });
  });

  chrome.runtime.sendMessage({ action: 'home:init' }, res => {
    if (!res) return;
    providerName.textContent = res.provider || '-';
    const u = res.usage || {};
    usageEl.textContent = `Requests: ${u.requests || 0} Tokens: ${u.tokens || 0}`;
    autoToggle.checked = !!res.auto;
  });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.action === 'home:update-usage') {
      const u = msg.usage || {};
      usageEl.textContent = `Requests: ${u.requests || 0} Tokens: ${u.tokens || 0}`;
    }
  });
})();
