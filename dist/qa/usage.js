const metrics = [];

function handleLastError(cb) {
  return (...args) => {
    const err = chrome.runtime.lastError;
    if (err && !err.message.includes('Receiving end does not exist')) console.debug(err);
    if (typeof cb === 'function') cb(...args);
  };
}

const ctx = document.getElementById('usageChart').getContext('2d');
const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Tokens',
        data: [],
        borderColor: 'blue',
        yAxisID: 'y1'
      },
      {
        label: 'Latency (ms)',
        data: [],
        borderColor: 'red',
        yAxisID: 'y2'
      }
    ]
  },
  options: {
    scales: {
      y1: { type: 'linear', position: 'left' },
      y2: { type: 'linear', position: 'right' }
    }
  }
});

function addMetric(m) {
  metrics.push(m);
  const label = new Date(m.ts).toLocaleTimeString();
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(m.tokens);
  chart.data.datasets[1].data.push(m.latency);
  chart.update();
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg && msg.action === 'usage-metrics' && msg.data) {
    addMetric(msg.data);
  }
});

chrome.runtime.sendMessage({ action: 'get-usage-log' }, handleLastError(resp => {
  if (resp && Array.isArray(resp.log)) {
    resp.log.forEach(addMetric);
  }
}));

document.getElementById('exportBtn').onclick = () => {
  const rows = [['timestamp','tokens','latency']];
  metrics.forEach(m => {
    rows.push([new Date(m.ts).toISOString(), m.tokens, m.latency]);
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'usage_metrics.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
