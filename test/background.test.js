describe('background icon plus indicator', () => {
  let updateBadge, setUsingPlus, _setActiveTranslations, handleTranslate, recordCost, getCostStats;
  beforeEach(() => {
    jest.resetModules();
    global.chrome = {
      action: {
        setBadgeText: jest.fn(),
        setBadgeBackgroundColor: jest.fn(),
        setIcon: jest.fn(),
      },
      runtime: { onInstalled: { addListener: jest.fn() }, onMessage: { addListener: jest.fn() } },
      contextMenus: { create: jest.fn(), onClicked: { addListener: jest.fn() } },
      tabs: { onUpdated: { addListener: jest.fn() } },
      storage: { sync: { get: (_, cb) => cb({ requestLimit: 60, tokenLimit: 60 }) } },
    };
    global.importScripts = () => {};
    global.setInterval = () => {};
    global.OffscreenCanvas = class {
      constructor() {
        this.ctx = {
          clearRect: jest.fn(),
          lineWidth: 0,
          strokeStyle: '',
          beginPath: jest.fn(),
          arc: jest.fn(),
          stroke: jest.fn(),
          fillStyle: '',
          fill: jest.fn(),
          getImageData: () => ({}),
        };
      }
      getContext() { return this.ctx; }
    };
    global.qwenThrottle = {
      configure: jest.fn(),
      getUsage: () => ({ requests: 0, requestLimit: 60, tokens: 0, tokenLimit: 60 }),
      approxTokens: t => t.length,
    };
    global.qwenUsageColor = () => '#00ff00';
    ({ updateBadge, setUsingPlus, _setActiveTranslations, handleTranslate, recordCost, getCostStats } = require('../src/background.js'));
    chrome.action.setBadgeText.mockClear();
  });

  test('shows P badge when plus model active', () => {
    setUsingPlus(true);
    _setActiveTranslations(1);
    updateBadge();
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: 'P' });
  });

  test('reports per-model usage', async () => {
    global.qwenTranslate = jest.fn().mockResolvedValue({ text: 'ok' });
    await handleTranslate({
      endpoint: 'https://e/',
      apiKey: 'k',
      model: 'qwen-mt-plus',
      text: 'hi',
      source: 'en',
      target: 'es',
    });
    const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const usage = await new Promise(resolve => listener({ action: 'usage' }, null, resolve));
    expect(usage.models['qwen-mt-plus'].requests).toBe(1);
  });

  test('aggregates cost over time windows', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 40 * day;
    recordCost('qwen-mt-turbo', 1_000_000, 1_000_000, now - day / 2);
    recordCost('qwen-mt-plus', 1_000_000, 1_000_000, now - 3 * day);
    recordCost('qwen-mt-plus', 1_000_000, 1_000_000, now - 10 * day);
    recordCost('qwen-mt-plus', 1_000_000, 1_000_000, now - 40 * day);
    const stats = getCostStats(now);
    expect(stats.day.total).toBeCloseTo(0.65);
    expect(stats.week.total).toBeCloseTo(0.65 + 9.83);
    expect(stats.month.total).toBeCloseTo(0.65 + 9.83 + 9.83);
    const today = new Date(now - day / 2).toISOString().slice(0, 10);
    const threeDays = new Date(now - 3 * day).toISOString().slice(0, 10);
    const tenDays = new Date(now - 10 * day).toISOString().slice(0, 10);
    const cal = Object.fromEntries(stats.calendar.map(d => [d.date, d.total]));
    expect(cal[today]).toBeCloseTo(0.65);
    expect(cal[threeDays]).toBeCloseTo(9.83);
    expect(cal[tenDays]).toBeCloseTo(9.83);
  });
});
