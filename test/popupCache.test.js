const create = tag => document.createElement(tag);

describe('popup cache controls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    const tagMap = {
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
      provider: 'select',
      'setup-provider': 'select',
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
      'apiKey','apiEndpoint','model','requestLimit','tokenLimit','tokenBudget','tokensPerReq','retryDelay','cacheSizeLimit','cacheTTL',
      'source','target','auto','debug','smartThrottle','dualMode','translate','test','clearCache','clearDomain','clearPair','toggleCalendar','provider','setup-provider','progress'
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
    global.qwenClearCache = jest.fn();
    global.qwenClearCacheDomain = jest.fn();
    global.qwenClearCacheLangPair = jest.fn();
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

  test.skip('clearPair sends message with selected languages', async () => {});

  test.skip('clearDomain clears cache for active tab domain', async () => {});
});
