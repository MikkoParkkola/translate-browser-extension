// @jest-environment jsdom

describe('diagnostics chart', () => {
  let listener;
  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="status"></div>
      <div id="usage"></div>
      <div id="usageSummary"></div>
      <canvas id="usageChart"></canvas>
      <div id="cache"></div>
      <ul id="providers"></ul>
      <button id="back"></button>
      <button id="copy"></button>
    `;
    global.Chart = jest.fn(() => ({ data: { labels: [], datasets: [{ data: [] }, { data: [] }] }, update: jest.fn() }));
    global.chrome = {
      storage: { local: { get: jest.fn((_, cb) => cb({ usageLog: [{ ts: 1, tokens: 2, latency: 3 }] })) } },
      runtime: {
        sendMessage: jest.fn((msg, cb) => {
          if (msg.action === 'metrics') cb({ providers: { qwen: { apiKey: true } }, usage: {}, cache: {}, tm: {} });
          else if (msg.action === 'get-status') cb({ active: false });
        }),
        onMessage: { addListener: fn => { listener = fn; } }
      }
    };
    require('../src/popup/diagnostics.js');
  });

  test('initialises summary', () => {
    expect(document.getElementById('usageSummary').textContent).toContain('Requests: 1');
  });

  test('updates on usage-metrics message', () => {
    listener({ action: 'usage-metrics', data: { ts: 2, tokens: 3, latency: 4 } });
    expect(document.getElementById('usageSummary').textContent).toContain('Requests: 2');
  });

  test('updates on stats and translation-status messages', () => {
    listener({ action: 'stats', usage: { requests: 5, requestLimit: 10, tokens: 20, tokenLimit: 100 }, cache: { size: 1, max: 2 }, tm: { hits: 3, misses: 4 } });
    expect(document.getElementById('usage').textContent).toContain('Requests 5/10');
    expect(document.getElementById('cache').textContent).toContain('TM hits 3');
    listener({ action: 'translation-status', status: { active: true } });
    expect(document.getElementById('status').textContent).toBe('Translating…');
  });
});
