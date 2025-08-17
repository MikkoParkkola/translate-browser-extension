// @jest-environment jsdom

describe('monitor summary and providers', () => {
  let listener;
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="usageSummary"></div>
      <canvas id="usageChart"></canvas>
      <div id="providerStatus"></div>
      <button id="toDiagnostics"></button>
    `;
    global.Chart = jest.fn(() => ({ data: { labels: [], datasets: [{ data: [] }, { data: [] }] }, update: jest.fn() }));
    global.chrome = {
      storage: { local: { get: jest.fn((_, cb) => cb({ usageLog: [{ ts: 1, tokens: 2, latency: 3 }] })), set: jest.fn() } },
      runtime: {
        sendMessage: jest.fn((msg, cb) => { if (msg.action === 'metrics') cb({ providers: { qwen: { apiKey: true } } }); }),
        onMessage: { addListener: fn => { listener = fn; } }
      }
    };
    require('../src/popup/monitor.js');
  });

  test('initialises summary and provider status', () => {
    expect(document.getElementById('usageSummary').textContent).toContain('Requests: 1');
    expect(document.getElementById('providerStatus').textContent).toContain('qwen');
  });

  test('updates on usage-metrics message', () => {
    listener({ action: 'usage-metrics', data: { ts: 2, tokens: 3, latency: 4 } });
    expect(document.getElementById('usageSummary').textContent).toContain('Requests: 2');
  });
});
