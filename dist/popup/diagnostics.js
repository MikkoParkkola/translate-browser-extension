(async function () {
  // Initialize logger
  const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) 
    ? window.qwenLogger.create('diagnostics')
    : console;
  const statusTextEl = document.getElementById('statusText');
  const usageMetricsEl = document.getElementById('usageMetrics');
  const cacheMetricsEl = document.getElementById('cacheMetrics');
  const providersListEl = document.getElementById('providerList');
  const cacheEl = document.getElementById('cache');
  const backBtn = document.getElementById('back');
  const summaryEl = document.getElementById('usageSummary');
  const chartEl = document.getElementById('usageChart');
  const histEl = document.getElementById('latencyHistogram');
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
  const latencies = [];
  let metrics = {};
  let status = { active: false };

  function handleLastError(cb) {
    return (...args) => {
      const err = chrome.runtime.lastError;
      if (err && !err.message.includes('Receiving end does not exist')) logger.debug(err);
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
    if (typeof e.latency === 'number' && e.latency >= 0 && Number.isFinite(e.latency)) {
      latencies.push(e.latency);
      if (latencies.length > 200) latencies.shift();
    }
    if (chart) {
      const label = new Date(e.ts).toLocaleTimeString();
      chart.data.labels.push(label);
      chart.data.datasets[0].data.push(e.tokens);
      chart.data.datasets[1].data.push(e.latency);
      chart.update();
    }
    drawHistogram();
    updateSummary();
  }

  function drawHistogram() {
    if (!histEl) return;
    const ctx = histEl.getContext('2d');
    const w = histEl.width || histEl.clientWidth || 320;
    const h = histEl.height || histEl.clientHeight || 80;
    ctx.clearRect(0, 0, w, h);
    if (!latencies.length) return;
    const min = Math.min(...latencies);
    const max = Math.max(...latencies);
    const bins = Math.min(20, Math.max(5, Math.ceil(Math.sqrt(latencies.length))));
    const counts = new Array(bins).fill(0);
    const range = max - min || 1;
    latencies.forEach(v => {
      let idx = Math.floor(((v - min) / range) * bins);
      if (idx >= bins) idx = bins - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    });
    const maxCount = Math.max(...counts, 1);
    const barW = (w - 2) / bins;
    ctx.fillStyle = '#0d6efd';
    counts.forEach((c, i) => {
      const barH = Math.round((c / maxCount) * (h - 4));
      const x = Math.round(i * barW) + 1;
      const y = h - barH - 2;
      ctx.fillRect(x, y, Math.max(1, Math.floor(barW) - 1), barH);
    });
  }

  chrome.storage?.local?.get({ usageLog: [] }, data => {
    (data.usageLog || []).forEach(addEntry);
    drawHistogram();
  });

  function updateStatus() {
    if (statusTextEl) statusTextEl.textContent = status.active ? 'Translating…' : 'Idle';
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
    if (usageMetricsEl) {
      usageMetricsEl.innerHTML = `
        <dt>Requests</dt><dd>${u.requests || 0}/${u.requestLimit || 0}</dd>
        <dt>Tokens</dt><dd>${u.tokens || 0}/${u.tokenLimit || 0}</dd>`;
    }
    const c = metrics.cache || {};
    const tm = metrics.tm || {};
    if (cacheMetricsEl) {
      cacheMetricsEl.innerHTML = `
        <dt>Entries</dt><dd>${c.size || 0}/${c.max || 0}</dd>
        <dt>TM hits</dt><dd>${tm.hits || 0}</dd>
        <dt>TM misses</dt><dd>${tm.misses || 0}</dd>`;
    }
    if (providersListEl) {
      providersListEl.innerHTML = '';
      Object.entries(metrics.providers || {}).forEach(([id, p]) => {
        const li = document.createElement('li');
        li.textContent = `${id}: ${p.apiKey ? 'configured' : 'missing key'}`;
        providersListEl.appendChild(li);
      });
    }
  }

  async function load() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    metrics = await new Promise(resolve => chrome.runtime.sendMessage({ action: 'metrics-v1' }, handleLastError(m => {
      if (m && m.version === 1) return resolve(m);
      chrome.runtime.sendMessage({ action: 'metrics' }, handleLastError(resolve));
    })));
    // Load cost summary from usage endpoint
    chrome.runtime.sendMessage({ action: 'usage' }, handleLastError(u => {
      try {
        const costsEl = document.getElementById('costs');
        const c = u && u.costs && u.costs.total || {};
        if (costsEl) costsEl.textContent = `Cost: 24h $${Number(c['24h']||0).toFixed(4)} | 7d $${Number(c['7d']||0).toFixed(4)}`;
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
