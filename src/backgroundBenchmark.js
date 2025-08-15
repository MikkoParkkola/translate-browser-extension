(function(root){
  const COST_RATES = { 'qwen-mt-turbo': 0.00000016, 'google-nmt': 0.00002 };

  async function runBenchmark() {
    if (!chrome?.storage?.sync) return { error: 'no storage' };
    const { providerOrder = [], providers = {} } = await new Promise(r => chrome.storage.sync.get({ providerOrder: [], providers: {} }, r));
    const order = providerOrder.length ? providerOrder : Object.keys(providers);
    const results = {};
    for (const name of order) {
      const cfg = providers[name];
      if (!cfg || !cfg.apiKey || !cfg.apiEndpoint || !cfg.model) continue;
      const start = Date.now();
      try {
        await root.qwenTranslate({
          endpoint: cfg.apiEndpoint,
          apiKey: cfg.apiKey,
          model: cfg.model,
          text: 'hello world',
          source: 'en',
          target: 'es',
          stream: false,
          noProxy: true,
          provider: name,
        });
        const latency = Date.now() - start;
        const tokens = root.qwenThrottle ? root.qwenThrottle.approxTokens('hello world') : 0;
        const cost = tokens * (COST_RATES[cfg.model] || 0);
        results[name] = { latency, cost };
      } catch (e) {
        results[name] = { error: e.message };
      }
    }
    let recommendation = null;
    for (const [name, data] of Object.entries(results)) {
      if (data.error) continue;
      if (!recommendation || data.cost < recommendation.cost || (data.cost === recommendation.cost && data.latency < recommendation.latency)) {
        recommendation = { provider: name, cost: data.cost, latency: data.latency };
      }
    }
    const store = { benchmark: { results, recommendation: recommendation ? recommendation.provider : null, ts: Date.now() } };
    chrome.storage.sync.set(store, () => {});
    return store.benchmark;
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === 'run-benchmark') {
        runBenchmark().then(r => sendResponse(r)).catch(e => sendResponse({ error: e.message }));
        return true;
      }
      return false;
    });
  }

  root.qwenRunBenchmark = runBenchmark;
})(typeof self !== 'undefined' ? self : this);
