
(function(root){
  const TARGET_PROVIDERS = ['hunyuan-local', 'openai', 'claude', 'gemini', 'mistral'];
  const COST_RATES = {
    'hunyuan-local': 0,
    openai: 0.000002,
    claude: 0.000003,
    gemini: 0.0000015,
    mistral: 0.000001,
  };
  const ACCEPTABLE_LATENCY = 2000;

  async function runBenchmark() {
    if (!chrome?.storage?.sync) return { error: 'no storage' };
    const { providerOrder = [], providers = {} } = await new Promise(r => {
      chrome.storage.sync.get({ providerOrder: [], providers: {} }, r);
    });
    const order = providerOrder.length ? providerOrder : Object.keys(providers);
    const results = {};
    for (const name of order) {
      if (!TARGET_PROVIDERS.includes(name)) continue;
      const cfg = { ...(providers[name] || {}) };
      if (name === 'hunyuan-local') {
        cfg.apiEndpoint = cfg.apiEndpoint || 'local://hunyuan-mt-7b';
        cfg.model = cfg.model || 'Hunyuan-MT-7B.i1-Q4_K_M.gguf';
        cfg.enabled = cfg.enabled !== false;
        if (!cfg.enabled) continue;
      }
      if (!cfg.apiEndpoint || !cfg.model) continue;
      if (name !== 'hunyuan-local' && !cfg.apiKey) continue;
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
        const costIn = (cfg.costPerInputToken ?? cfg.costPerToken ?? COST_RATES[name]) || 0;
        const costOut = (cfg.costPerOutputToken ?? cfg.costPerToken) || 0;
        const costPerToken = costIn + costOut;
        const cost = tokens * costPerToken;
        const throughput = latency > 0 ? (tokens * 1000) / latency : 0;
        results[name] = { latency, throughput, cost, costPerToken };
      } catch (e) {
        results[name] = { error: e.message };
      }
    }
    let recommendation = null;
    for (const [name, data] of Object.entries(results)) {
      if (data.error) continue;
      if (data.latency > ACCEPTABLE_LATENCY) continue;
      if (!recommendation || data.costPerToken < recommendation.costPerToken || (data.costPerToken === recommendation.costPerToken && data.latency < recommendation.latency)) {
        recommendation = { provider: name, costPerToken: data.costPerToken, latency: data.latency };
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
