const create = tag => document.createElement(tag);

describe('popup cache controls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById = id => document.querySelector('#' + id);
    [
      'source','target','auto','debug','smartThrottle','dualMode','translate','test','clearCache','clearDomain','clearPair','toggleCalendar','provider','setup-provider','viewContainer',
      'cacheSize','hitRate','costSection',
      'status','domainCounts','costCalendar','progress'
    ].forEach(id => {
      let tag = 'div';
      if (['apiKey','apiEndpoint','model','requestLimit','tokenLimit','tokenBudget','tokensPerReq','retryDelay','cacheSizeLimit','cacheTTL','setup-apiKey','setup-apiEndpoint','setup-model','force'].includes(id)) tag = 'input';
      if (['source','target'].includes(id)) tag = 'select';
      if (['auto','debug','smartThrottle','dualMode'].includes(id)) tag = 'input';
      if (['translate','test','clearCache','clearDomain','clearPair','toggleCalendar'].includes(id)) tag = 'button';
      if (['cacheSize','hitRate'].includes(id)) tag = 'span';
      if (['status','domainCounts','costCalendar'].includes(id)) tag = 'div';
      if (id === 'progress') tag = 'progress';
      const e = create(tag);
      e.id = id;
      document.body.appendChild(e);
      global[id] = e;
      if (tag === 'select') {
        e.appendChild(new Option('en','en'));
        e.appendChild(new Option('fr','fr'));
      }
    });
    const srcOpt = document.createElement('option');
    srcOpt.value = 'en';
    source.appendChild(srcOpt);
    const tgtOpt = document.createElement('option');
    tgtOpt.value = 'fr';
    target.appendChild(tgtOpt);
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
    global.qwenClearCache = window.qwenClearCache = jest.fn();
    global.qwenClearCacheDomain = window.qwenClearCacheDomain = jest.fn();
    global.qwenClearCacheLangPair = window.qwenClearCacheLangPair = jest.fn();
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

  test('clearPair sends message with selected languages', async () => {
    chrome.tabs.query.mockImplementation((info, cb) => cb([{ id: 1 }, { id: 2 }]));
    require('../src/popup.js');
    await new Promise(r => setTimeout(r, 0));
    document.getElementById('source').value = 'en';
    document.getElementById('target').value = 'fr';
    document.getElementById('clearPair').click();
    expect(global.qwenClearCacheLangPair).toHaveBeenCalledWith('en', 'fr');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'clear-cache-pair', source: 'en', target: 'fr' }, expect.any(Function));
  });

});
