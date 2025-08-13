const create = tag => document.createElement(tag);

describe('popup cost display', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    const tagMap = {
      apiKey: 'input',
      apiEndpoint: 'input',
      model: 'input',
      requestLimit: 'input',
      tokenLimit: 'input',
      tokenBudget: 'input',
      tokensPerReq: 'input',
      retryDelay: 'input',
      'setup-apiKey': 'input',
      'setup-apiEndpoint': 'input',
      'setup-model': 'input',
      provider: 'select',
      'setup-provider': 'select',
      source: 'select',
      target: 'select',
      auto: 'input',
      debug: 'input',
      smartThrottle: 'input',
      dualMode: 'input',
      translate: 'button',
      test: 'button',
      clearCache: 'button',
      clearDomain: 'button',
      clearPair: 'button',
      toggleCalendar: 'button',
      progress: 'progress',
    };
    document.getElementById = id => {
      let el = document.querySelector('#' + id);
      if (!el) {
        el = create(tagMap[id] || 'div');
        el.id = id;
        document.body.appendChild(el);
        global[id] = el;
      }
      return el;
    };
    [
      'apiKey','apiEndpoint','model','requestLimit','tokenLimit','tokenBudget','tokensPerReq','retryDelay','setup-apiKey','setup-apiEndpoint','setup-model','provider','setup-provider',
      'source','target','auto','debug','smartThrottle','dualMode','translate','test','clearCache','clearDomain','clearPair','toggleCalendar',
      'cacheSizeLimit','cacheTTL','cacheSize','hitRate','costTurbo24h','costPlus24h','costTotal24h','costTurbo7d','costPlus7d','costTotal7d','costTurbo30d','costPlus30d','costTotal30d',
      'domainCounts','status','costCalendar','progress'
    ].forEach(id => document.getElementById(id));
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
    global.qwenGetCacheSize = () => 0;
    global.qwenGetCacheStats = () => ({ hits: 0, misses: 0, hitRate: 0 });
    global.qwenGetDomainCounts = () => ({});
    global.qwenClearCacheDomain = jest.fn();
    global.qwenClearCacheLangPair = jest.fn();
    global.qwenClearCache = jest.fn();
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
    global.formatCost = n => `$${n.toFixed(2)}`;
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
