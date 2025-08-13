const create = tag => document.createElement(tag);

describe('popup cost display', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById = id => {
      let el = document.querySelector('#' + id);
      if (el) return el;
      let tag = 'div';
      if (['apiKey','apiEndpoint','model','requestLimit','tokenLimit','tokenBudget','tokensPerReq','retryDelay','setup-apiKey','setup-apiEndpoint','setup-model'].includes(id)) tag = 'input';
      if (['source','target'].includes(id)) tag = 'select';
      if (['auto','debug','smartThrottle','dualMode'].includes(id)) tag = 'input';
      if (['translate','test'].includes(id)) tag = 'button';
      if (id === 'progress') tag = 'progress';
      const e = create(tag);
      e.id = id;
      document.body.appendChild(e);
      return e;
    };
    global.chrome = {
      runtime: {
        sendMessage: jest.fn(),
        getManifest: () => ({ version: '1.0.0' }),
        onMessage: { addListener: jest.fn() },
      },
      tabs: { query: jest.fn(), sendMessage: jest.fn() },
    };
    global.qwenLanguages = [];
    global.qwenUsageColor = () => '#00ff00';
    global.qwenLoadConfig = () => Promise.resolve({
      apiKey: '',
      apiEndpoint: '',
      model: '',
      sourceLanguage: 'en',
      targetLanguage: 'es',
      requestLimit: 60,
      tokenLimit: 60,
      autoTranslate: false,
      smartThrottle: true,
    });
    global.qwenSaveConfig = jest.fn().mockResolvedValue();
    global.setInterval = jest.fn();
  });

  test('renders cost totals', async () => {
    const usage = {
      requests: 0,
      requestLimit: 1,
      tokens: 0,
      tokenLimit: 1,
      totalRequests: 0,
      totalTokens: 0,
      queue: 0,
      failedTotalRequests: 0,
      failedTotalTokens: 0,
      models: {},
      costs: {
        'qwen-mt-turbo': { '24h': 0.01, '7d': 0.02, '30d': 0.03 },
        'qwen-mt-plus': { '24h': 0.04, '7d': 0.05, '30d': 0.06 },
        total: { '24h': 0.05, '7d': 0.07, '30d': 0.09 },
        daily: [],
      },
    };
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg.action === 'usage') cb(usage);
      else if (typeof cb === 'function') cb({});
    });
    require('../src/popup.js');
    await new Promise(r => setTimeout(r, 0));
    expect(document.getElementById('costTotal7d').textContent).toBe('$0.07');
  });
});
