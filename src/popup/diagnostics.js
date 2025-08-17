(async function () {
  const usageEl = document.getElementById('usage');
  const cacheEl = document.getElementById('cache');
  const providersEl = document.getElementById('providers');
  const backBtn = document.getElementById('back');
  let metrics = {};

  function render() {
    const u = metrics.usage || {};
    usageEl.textContent = `Requests ${u.requests || 0}/${u.requestLimit || 0} | Tokens ${u.tokens || 0}/${u.tokenLimit || 0}`;
    const c = metrics.cache || {};
    const tm = metrics.tm || {};
    cacheEl.textContent = `Cache ${c.size || 0}/${c.max || 0} | TM hits ${tm.hits || 0} misses ${tm.misses || 0}`;
    providersEl.innerHTML = '';
    Object.entries(metrics.providers || {}).forEach(([id, p]) => {
      const li = document.createElement('li');
      li.textContent = `${id}: ${p.apiKey ? 'configured' : 'missing key'}`;
      providersEl.appendChild(li);
    });
  }

  async function load() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    metrics = await new Promise(resolve => chrome.runtime.sendMessage({ action: 'metrics' }, resolve));
    render();
  }

  await load();

  backBtn?.addEventListener('click', () => { location.href = 'home.html'; });

  document.getElementById('copy').addEventListener('click', async () => {
    const report = {
      version: chrome.runtime?.getManifest?.().version,
      userAgent: navigator.userAgent,
      metrics,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      cacheEl.textContent += ' (copied)';
    } catch {}
  });
})();

