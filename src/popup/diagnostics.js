(async function () {
  const statusEl = document.getElementById('status');
  const usageEl = document.getElementById('usage');
  const cacheEl = document.getElementById('cache');
  const costsEl = document.getElementById('costs');
  const qualityEl = document.getElementById('quality');
  const providersEl = document.getElementById('providers');
  const backBtn = document.getElementById('back');
  const summaryEl = document.getElementById('usageSummary');
  const chartEl = document.getElementById('usageChart');
  let Chart;
  if (chartEl) {
    await new Promise((resolve, reject) => {
      if (window.Chart) { Chart = window.Chart; return resolve(); }
      const s = document.createElement('script');
      s.src = '../qa/chart.umd.js';
      s.onload = () => { Chart = window.Chart; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const ctx = chartEl && chartEl.getContext('2d');
  const chart = Chart && ctx && new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Tokens', data: [], borderColor: 'blue', yAxisID: 'y1' },
        { label: 'Latency (ms)', data: [], borderColor: 'red', yAxisID: 'y2' }
      ]
    },
    options: { scales: { y1: { type: 'linear', position: 'left' }, y2: { type: 'linear', position: 'right' } } }
  });
  const log = [];
  let metrics = {};
  let status = { active: false };

  function handleLastError(cb) {
    return (...args) => {
      const err = chrome.runtime.lastError;
      if (err && !err.message.includes('Receiving end does not exist')) console.debug(err);
      if (typeof cb === 'function') cb(...args);
    };
  }

  function updateSummary() {
    const requests = log.length;
    const tokens = log.reduce((s, e) => s + (e.tokens || 0), 0);
    const avgLatency = requests ? log.reduce((s, e) => s + (e.latency || 0), 0) / requests : 0;
    if (summaryEl) summaryEl.textContent = `Requests: ${requests} Tokens: ${tokens} Avg: ${avgLatency.toFixed(0)}ms`;
  }

  function addEntry(e) {
    log.push(e);
    if (chart) {
      const label = new Date(e.ts).toLocaleTimeString();
      chart.data.labels.push(label);
      chart.data.datasets[0].data.push(e.tokens);
      chart.data.datasets[1].data.push(e.latency);
      chart.update();
    }
    updateSummary();
  }

  chrome.storage?.local?.get({ usageLog: [] }, data => {
    (data.usageLog || []).forEach(addEntry);
  });

  function updateStatus() {
    if (statusEl) statusEl.textContent = status.active ? 'Translating…' : 'Idle';
  }

  chrome.runtime?.onMessage?.addListener(msg => {
    if (msg && msg.action === 'usage-metrics' && msg.data) {
      addEntry(msg.data);
    } else if (msg && msg.action === 'stats') {
      if (msg.usage || msg.cache || msg.tm) {
        metrics.usage = msg.usage || metrics.usage;
        metrics.cache = msg.cache || metrics.cache;
        metrics.tm = msg.tm || metrics.tm;
        render();
      }
    } else if (msg && msg.action === 'translation-status') {
      status = msg.status || { active: false };
      updateStatus();
    }
  });

  function render() {
    const u = metrics.usage || {};
    usageEl.textContent = `Requests ${u.requests || 0}/${u.requestLimit || 0} | Tokens ${u.tokens || 0}/${u.tokenLimit || 0}`;
    const q = metrics.quality || {};
    if (qualityEl) {
      const avg = Math.round(q.avgLatencyMs || 0);
      const p50 = Math.round(q.p50Ms || 0);
      const p95 = Math.round(q.p95Ms || 0);
      const eta = Math.round(q.etaSeconds || 0);
      qualityEl.textContent = `Latency avg ${avg}ms | P50 ${p50}ms | P95 ${p95}ms | ETA ${eta}s`;
    }
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
    metrics = await new Promise(resolve => chrome.runtime.sendMessage({ action: 'metrics-v1' }, handleLastError(m => {
      if (m && m.version === 1) return resolve(m);
      chrome.runtime.sendMessage({ action: 'metrics' }, handleLastError(resolve));
    })));
    // Load cost summary from legacy usage endpoint
    chrome.runtime.sendMessage({ action: 'usage' }, handleLastError(u => {
      try {
        const c = u && u.costs && u.costs.total || {};
        if (costsEl) costsEl.textContent = `Cost: 24h $${(c['24h']||0).toFixed ? c['24h'].toFixed(4) : c['24h']||0} | 7d $${(c['7d']||0).toFixed ? c['7d'].toFixed(4) : c['7d']||0}`;
      } catch {}
    }));
    status = await new Promise(resolve => chrome.runtime.sendMessage({ action: 'get-status' }, handleLastError(resolve)));
    render();
    updateStatus();
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
