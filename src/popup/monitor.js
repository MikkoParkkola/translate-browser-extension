(function () {
  const chartEl = document.getElementById('usageChart');
  const summaryEl = document.getElementById('usageSummary');
  const providersEl = document.getElementById('providerStatus');
  const diagBtn = document.getElementById('toDiagnostics');

  const ctx = chartEl && chartEl.getContext('2d');
  const chart = ctx && new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Tokens', data: [], borderColor: 'blue', yAxisID: 'y1' },
        { label: 'Latency (ms)', data: [], borderColor: 'red', yAxisID: 'y2' }
      ]
    },
    options: {
      scales: { y1: { type: 'linear', position: 'left' }, y2: { type: 'linear', position: 'right' } }
    }
  });

  const log = [];

  function updateSummary() {
    const requests = log.length;
    const tokens = log.reduce((s, e) => s + (e.tokens || 0), 0);
    const avgLatency = log.length ? log.reduce((s, e) => s + (e.latency || 0), 0) / log.length : 0;
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

  chrome.storage.local.get({ usageLog: [] }, data => {
    (data.usageLog || []).forEach(addEntry);
  });

  chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.action === 'usage-metrics' && msg.data) {
      addEntry(msg.data);
    }
  });

  chrome.runtime.sendMessage({ action: 'metrics' }, res => {
    if (res && res.providers && providersEl) {
      providersEl.textContent = Object.entries(res.providers)
        .map(([id, p]) => `${id}: ${p.apiKey ? '✓' : '✗'}`)
        .join(' ');
    }
  });

  diagBtn?.addEventListener('click', () => {
    location.href = 'diagnostics.html';
  });
})();
