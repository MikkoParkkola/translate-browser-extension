// @jest-environment jsdom

describe('diagnostics chart', () => {
  let listener;
  beforeEach(async () => {
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
    HTMLCanvasElement.prototype.getContext = () => ({
      fillRect: jest.fn(),
      clearRect: jest.fn(),
      getImageData: jest.fn(() => ({ data: [] })),
      putImageData: jest.fn(),
      createImageData: jest.fn(),
      setTransform: jest.fn(),
      drawImage: jest.fn(),
      save: jest.fn(),
      fillText: jest.fn(),
      restore: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      stroke: jest.fn(),
      translate: jest.fn(),
      scale: jest.fn(),
      rotate: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      measureText: jest.fn(() => ({ width: 0 })),
      transform: jest.fn(),
      rect: jest.fn(),
      clip: jest.fn()
    });
    global.Chart = jest.fn(() => ({
      data: { labels: [], datasets: [{ data: [] }, { data: [] }] },
      update: jest.fn()
    }));
    global.chrome = {
      storage: { local: { get: jest.fn((_, cb) => cb({ usageLog: [{ ts: 1, tokens: 2, latency: 3 }] })) } },
      runtime: {
        sendMessage: jest.fn((msg, cb) => {
          if (msg.action === 'metrics-v1') cb({ version: 1, providers: { qwen: { apiKey: true } }, usage: {}, cache: {}, tm: {} });
          else if (msg.action === 'usage') cb({ costs: { total: {} } });
          else if (msg.action === 'get-status') cb({ active: false });
          else if (msg.action === 'metrics') cb({ providers: { qwen: { apiKey: true } }, usage: {}, cache: {}, tm: {} });
        }),
        onMessage: { addListener: fn => { listener = fn; } }
      }
    };
    require('../src/popup/diagnostics.js');
    await Promise.resolve();
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

  test('renders chart with sample data', () => {
    const chartInstance = global.Chart.mock.results[0].value;
    expect(global.Chart).toHaveBeenCalled();
    expect(chartInstance.data.datasets[0].data).toEqual([2]);
    expect(chartInstance.data.datasets[1].data).toEqual([3]);
    expect(chartInstance.update).toHaveBeenCalledTimes(1);
  });

  describe('with empty usage data', () => {
    beforeEach(async () => {
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
      HTMLCanvasElement.prototype.getContext = () => ({
        fillRect: jest.fn(),
        clearRect: jest.fn(),
        getImageData: jest.fn(() => ({ data: [] })),
        putImageData: jest.fn(),
        createImageData: jest.fn(),
        setTransform: jest.fn(),
        drawImage: jest.fn(),
        save: jest.fn(),
        fillText: jest.fn(),
        restore: jest.fn(),
        beginPath: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        closePath: jest.fn(),
        stroke: jest.fn(),
        translate: jest.fn(),
        scale: jest.fn(),
        rotate: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        measureText: jest.fn(() => ({ width: 0 })),
        transform: jest.fn(),
        rect: jest.fn(),
        clip: jest.fn()
      });
      global.Chart = jest.fn(() => ({
        data: { labels: [], datasets: [{ data: [] }, { data: [] }] },
        update: jest.fn()
      }));
      global.chrome = {
        storage: { local: { get: jest.fn((_, cb) => cb({ usageLog: [] })) } },
        runtime: {
          sendMessage: jest.fn((msg, cb) => {
            if (msg.action === 'metrics-v1') cb({ version: 1, providers: {}, usage: {}, cache: {}, tm: {} });
            else if (msg.action === 'usage') cb({ costs: { total: {} } });
            else if (msg.action === 'get-status') cb({ active: false });
            else if (msg.action === 'metrics') cb({ providers: {}, usage: {}, cache: {}, tm: {} });
          }),
          onMessage: { addListener: fn => { listener = fn; } }
        }
      };
      require('../src/popup/diagnostics.js');
      await Promise.resolve();
    });

    test('handles empty dataset gracefully', () => {
      const chartInstance = global.Chart.mock.results[0].value;
      expect(global.Chart).toHaveBeenCalled();
      expect(chartInstance.data.datasets[0].data).toEqual([]);
      expect(chartInstance.data.datasets[1].data).toEqual([]);
      expect(chartInstance.update).not.toHaveBeenCalled();
    });
  });
});
