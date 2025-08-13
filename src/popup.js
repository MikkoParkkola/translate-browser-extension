// Main view elements
const apiKeyInput = document.getElementById('apiKey');
const endpointInput = document.getElementById('apiEndpoint');
const modelInput = document.getElementById('model');
const providerSelect = document.getElementById('provider');
const sourceSelect = document.getElementById('source');
const targetSelect = document.getElementById('target');
const reqLimitInput = document.getElementById('requestLimit');
const tokenLimitInput = document.getElementById('tokenLimit');
const tokenBudgetInput = document.getElementById('tokenBudget');
const autoCheckbox = document.getElementById('auto');
const debugCheckbox = document.getElementById('debug');
const smartThrottleInput = document.getElementById('smartThrottle');
const tokensPerReqInput = document.getElementById('tokensPerReq');
const retryDelayInput = document.getElementById('retryDelay');
const status = document.getElementById('status');
const versionDiv = document.getElementById('version');
const reqCount = document.getElementById('reqCount');
const tokenCount = document.getElementById('tokenCount');
const reqBar = document.getElementById('reqBar');
const tokenBar = document.getElementById('tokenBar');
const reqRemaining = document.getElementById('reqRemaining');
const tokenRemaining = document.getElementById('tokenRemaining');
const providerError = document.getElementById('providerError');
const reqRemainingBar = document.getElementById('reqRemainingBar');
const tokenRemainingBar = document.getElementById('tokenRemainingBar');
const turboReq = document.getElementById('turboReq');
const plusReq = document.getElementById('plusReq');
const turboReqBar = document.getElementById('turboReqBar');
const plusReqBar = document.getElementById('plusReqBar');
const totalReq = document.getElementById('totalReq');
const totalTok = document.getElementById('totalTok');
const queueLen = document.getElementById('queueLen');
const failedReq = document.getElementById('failedReq');
const failedTok = document.getElementById('failedTok');
const translateBtn = document.getElementById('translate');
const testBtn = document.getElementById('test');
const progressBar = document.getElementById('progress');
const clearCacheBtn = document.getElementById('clearCache');
const clearDomainBtn = document.getElementById('clearDomain');
const clearPairBtn = document.getElementById('clearPair');
const forceCheckbox = document.getElementById('force');
const cacheSizeLabel = document.getElementById('cacheSize');
const hitRateLabel = document.getElementById('hitRate');
const cacheLimitInput = document.getElementById('cacheSizeLimit');
const cacheTTLInput = document.getElementById('cacheTTL');
const clearDomainBtn = document.getElementById('clearDomain');
const clearPairBtn = document.getElementById('clearPair');
const reqRemaining = document.getElementById('reqRemaining');
const tokenRemaining = document.getElementById('tokenRemaining');
const reqRemainingBar = document.getElementById('reqRemainingBar');
const tokenRemainingBar = document.getElementById('tokenRemainingBar');
const providerError = document.getElementById('providerError');

if (sourceSelect && !sourceSelect.options.length) {
  ['en', 'fr'].forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    sourceSelect.appendChild(opt.cloneNode(true));
    if (targetSelect) targetSelect.appendChild(opt);
  });
}

const applyProviderConfig =
  (window.qwenProviderConfig && window.qwenProviderConfig.applyProviderConfig) ||
  (typeof require !== 'undefined'
    ? require('./providerConfig').applyProviderConfig
    : () => {});

// Setup view elements
const setupApiKeyInput = document.getElementById('setup-apiKey');
const setupApiEndpointInput = document.getElementById('setup-apiEndpoint');
const setupModelInput = document.getElementById('setup-model');
const setupProviderInput = document.getElementById('setup-provider');

const viewContainer = document.getElementById('viewContainer');

const modelTokenLimits = (window.qwenModelTokenLimits) || { 'qwen-mt-turbo': 31980, 'qwen-mt-plus': 23797 };

function getDefaultTokenLimit(model) {
  return modelTokenLimits[model] || modelTokenLimits['qwen-mt-turbo'];
}

let saveTimeout;
let currentCfg = {};
let lastQuotaCheck = 0;

function saveConfig() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (!window.qwenSaveConfig) {
      status.textContent = 'Config library not loaded.';
      return;
    }
    const model = modelInput.value.trim() || 'qwen-mt-turbo';
    const cfg = {
      ...currentCfg,
      apiKey: apiKeyInput.value.trim(),
      apiEndpoint: endpointInput.value.trim(),
      model,
      sourceLanguage: sourceSelect.value,
      targetLanguage: targetSelect.value,
      requestLimit: parseInt(reqLimitInput.value, 10) || 60,
      tokenLimit: parseInt(tokenLimitInput.value, 10) || getDefaultTokenLimit(model),
      tokenBudget: parseInt(tokenBudgetInput.value, 10) || 0,
      smartThrottle: smartThrottleInput.checked,
      tokensPerReq: parseInt(tokensPerReqInput.value, 10) || 0,
      retryDelay: parseInt(retryDelayInput.value, 10) || 0,
      autoTranslate: autoCheckbox.checked,
      debug: debugCheckbox.checked,
      cacheMaxEntries: parseInt(cacheLimitInput.value, 10) || 1000,
      cacheTTL: (parseInt(cacheTTLInput.value, 10) || 30) * 24 * 60 * 60 * 1000,
    };
    if (window.qwenSetCacheLimit) window.qwenSetCacheLimit(cfg.cacheMaxEntries);
    if (window.qwenSetCacheTTL) window.qwenSetCacheTTL(cfg.cacheTTL);
    window.qwenSaveConfig(cfg).then(() => {
      status.textContent = 'Settings saved.';
      updateView(cfg); // Re-check the view after saving
      if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ action: 'config-changed' }, () => {});
      }
      refreshUsage();
      setTimeout(() => { if (status.textContent === 'Settings saved.') status.textContent = ''; }, 2000);
    });
  }, 500); // Debounce saves by 500ms
}

function syncInputs(from, to) {
  if (from && to) {
    to.value = from.value;
  }
}

function updateView(cfg) {
  if (!viewContainer) return;
  if (cfg.apiKey && cfg.apiEndpoint && cfg.model) {
    viewContainer.classList.remove('show-setup');
    viewContainer.classList.add('show-main');
  } else {
    viewContainer.classList.remove('show-main');
    viewContainer.classList.add('show-setup');
  }
}

function safeFetch(url, opts) {
  return fetch(url, opts).catch(err => {
    console.warn('Failed to fetch', url, err.message);
    throw err;
  });
}

function populateLanguages() {
  window.qwenLanguages.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.code; opt.textContent = l.name;
    sourceSelect.appendChild(opt.cloneNode(true));
    targetSelect.appendChild(opt);
  });
}

populateLanguages();
function populateProviders() {
  const list = (window.qwenProviders && window.qwenProviders.listProviders()) || [];
  const opts = list.length ? list : [{ name: 'qwen', label: 'Qwen' }];
  opts.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.label || p.name;
    providerSelect.appendChild(opt.cloneNode(true));
    setupProviderInput.appendChild(opt);
  });
}

populateProviders();

function updateProviderFields() {
  const prov =
    (window.qwenProviders && window.qwenProviders.getProvider(providerSelect.value)) || {};
  applyProviderConfig(prov, document);
}

function setWorking(w) {
  [translateBtn, testBtn].forEach(b => { if (b) b.disabled = w; });
}

function updateThrottleInputs() {
  const manual = !smartThrottleInput.checked;
  [reqLimitInput, tokenLimitInput, tokensPerReqInput, retryDelayInput].forEach(el => {
    if (!el) return;
    el.disabled = !manual;
    if (!manual) {
      el.placeholder = el.dataset.auto || '';
      el.value = '';
    } else {
      el.placeholder = '';
    }
  });
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'popup-status') {
    status.textContent = msg.text || '';
    setWorking(true);
  }
  if (msg.action === 'translation-status' && msg.status) {
    const s = msg.status;
    if (s.active) {
      if (s.progress && typeof s.progress.total === 'number') {
        progressBar.max = s.progress.total || 1;
        progressBar.value = s.progress.done || 0;
        progressBar.style.display = 'block';
      }
      if (s.phase === 'translate') {
        let txt = `Translating paragraph ${s.progress ? s.progress.done : 0} of ${s.progress ? s.progress.total : 0}`;
        if (s.sample) txt += `: ${s.sample.slice(0, 60)}`;
        if (typeof s.elapsedMs === 'number') txt += ` · ${(s.elapsedMs / 1000).toFixed(1)}s`;
        if (typeof s.etaMs === 'number') txt += ` · ETA ${(s.etaMs / 1000).toFixed(1)}s`;
        status.textContent = txt;
      } else if (s.phase === 'retry') {
        status.textContent = `Rate limit reached. Retrying in ${(s.delayMs / 1000).toFixed(1)}s...`;
      } else if (s.phase === 'finalize') {
        status.textContent = 'Finalizing page...';
      } else {
        const { phase, page, total } = s;
        const parts = [];
        if (phase) parts.push(phase.charAt(0).toUpperCase() + phase.slice(1));
        if (page && total) parts.push(`${page}/${total}`);
        status.textContent = parts.join(' ');
      }
      if (s.usage) {
        reqCount.textContent = `${s.usage.requests}/${s.usage.requestLimit}`;
        tokenCount.textContent = `${s.usage.tokens}/${s.usage.tokenLimit}`;
        setBar(reqBar, s.usage.requests / s.usage.requestLimit);
        setBar(tokenBar, s.usage.tokens / s.usage.tokenLimit);
        totalReq.textContent = s.usage.totalRequests;
        totalTok.textContent = s.usage.totalTokens;
        failedReq.textContent = s.usage.failedTotalRequests;
        failedTok.textContent = s.usage.failedTotalTokens;
        queueLen.textContent = s.usage.queue;
      }
      setWorking(true);
    } else {
      progressBar.style.display = 'none';
      progressBar.value = 0;
      progressBar.max = 1;
      if (s.summary) {
        const t = s.summary;
        const bits = [
          `Done in ${(t.elapsedMs / 1000).toFixed(1)}s`,
          `${t.words} words`,
          `${t.requests} req`,
          `${t.tokens} tokens`,
          `${t.wordsPerSecond.toFixed(1)} w/s`,
          `${t.wordsPerRequest.toFixed(1)} w/req`,
        ];
        status.textContent = bits.join(', ');
      } else {
        status.textContent = '';
      }
      setWorking(false);
    }
  }
});

chrome.runtime.sendMessage({ action: 'get-status' }, s => {
  if (s && s.active) {
    if (s.progress && typeof s.progress.total === 'number') {
      progressBar.max = s.progress.total || 1;
      progressBar.value = s.progress.done || 0;
      progressBar.style.display = 'block';
    }
    if (s.phase === 'translate') {
      let txt = `Translating ${s.request || 0}/${s.requests || 0}`;
      if (s.sample) txt += `: ${s.sample.slice(0, 60)}`;
      status.textContent = txt;
    } else {
      const { phase, page, total } = s;
      const parts = [];
      if (phase) parts.push(phase.charAt(0).toUpperCase() + phase.slice(1));
      if (page && total) parts.push(`${page}/${total}`);
      status.textContent = parts.join(' ');
    }
    setWorking(true);
  }
});

window.qwenLoadConfig().then(cfg => {
  currentCfg = cfg;
  // Populate main view
  if (apiKeyInput) apiKeyInput.value = cfg.apiKey || '';
  if (endpointInput) endpointInput.value = cfg.apiEndpoint || '';
  if (modelInput) modelInput.value = cfg.model || '';
  if (providerSelect) providerSelect.value = cfg.provider || 'qwen';
  if (sourceSelect) sourceSelect.value = cfg.sourceLanguage;
  if (targetSelect) targetSelect.value = cfg.targetLanguage;
  if (reqLimitInput) reqLimitInput.value = cfg.requestLimit;
  if (tokenLimitInput) tokenLimitInput.value = cfg.tokenLimit;
  if (tokenBudgetInput) tokenBudgetInput.value = cfg.tokenBudget || '';
  if (autoCheckbox) autoCheckbox.checked = cfg.autoTranslate;
  if (debugCheckbox) debugCheckbox.checked = !!cfg.debug;
  if (smartThrottleInput) smartThrottleInput.checked = cfg.smartThrottle !== false;
  if (tokensPerReqInput) tokensPerReqInput.value = cfg.tokensPerReq || '';
  if (retryDelayInput) retryDelayInput.value = cfg.retryDelay || '';
  if (cacheLimitInput) cacheLimitInput.value = cfg.cacheMaxEntries || '';
  if (cacheTTLInput) cacheTTLInput.value = Math.floor((cfg.cacheTTL || 30 * 24 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));

  // Populate setup view
  if (setupApiKeyInput) setupApiKeyInput.value = cfg.apiKey || '';
  if (setupApiEndpointInput) setupApiEndpointInput.value = cfg.apiEndpoint || '';
  if (setupModelInput) setupModelInput.value = cfg.model || '';
  if (setupProviderInput) setupProviderInput.value = cfg.provider || 'qwen';

  updateView(cfg);
  updateProviderFields();

  // Add event listeners for auto-saving and syncing
  const allInputs = [
    { main: apiKeyInput, setup: setupApiKeyInput, event: 'input' },
    { main: endpointInput, setup: setupApiEndpointInput, event: 'input' },
    { main: modelInput, setup: setupModelInput, event: 'change' },
  ];

  allInputs.forEach(({ main, setup, event }) => {
    if (main) {
      main.addEventListener(event, () => {
        syncInputs(main, setup);
        saveConfig();
        if (event === 'change') refreshUsage();
      });
    }
    if (setup) {
      setup.addEventListener(event, () => {
        syncInputs(setup, main);
        saveConfig();
        if (event === 'change') refreshUsage();
      });
    }
  });

  if (providerSelect) providerSelect.addEventListener('change', updateProviderFields);
  if (setupProviderInput) setupProviderInput.addEventListener('change', updateProviderFields);

  updateThrottleInputs();
  [reqLimitInput, tokenLimitInput, tokenBudgetInput, tokensPerReqInput, retryDelayInput, cacheLimitInput, cacheTTLInput].forEach(el => {
    if (el) el.addEventListener('input', saveConfig);
  });
  [sourceSelect, targetSelect, autoCheckbox, debugCheckbox, smartThrottleInput].forEach(el => {
    if (el) el.addEventListener('change', () => { updateThrottleInputs(); saveConfig(); });
  });
  if (window.qwenSetCacheLimit) window.qwenSetCacheLimit(cfg.cacheMaxEntries || 1000);
  if (window.qwenSetCacheTTL) window.qwenSetCacheTTL(cfg.cacheTTL || 30 * 24 * 60 * 60 * 1000);
  updateCacheInfo();
});

if (versionDiv) versionDiv.textContent = `v${chrome.runtime.getManifest().version}`;

function setBar(el, ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  el.style.width = r * 100 + '%';
  el.style.backgroundColor = window.qwenUsageColor ? window.qwenUsageColor(r) : 'var(--green)';
}

function formatCost(n) {
  return `$${n.toFixed(2)}`;
}

function updateCacheSize() {
  if (cacheSizeLabel && window.qwenGetCacheSize) {
    cacheSizeLabel.textContent = `Cache: ${window.qwenGetCacheSize()}`;
  }
  if (hitRateLabel && window.qwenGetCacheStats) {
    const s = window.qwenGetCacheStats();
    const rate = s.hits + s.misses ? ((s.hits / (s.hits + s.misses)) * 100).toFixed(1) : '0.0';
    hitRateLabel.textContent = `Hit Rate: ${rate}%`;
  }
  if (domainCountsDiv && window.qwenGetDomainCounts) {
    const counts = window.qwenGetDomainCounts();
    const parts = Object.entries(counts).map(([d, c]) => `${d}: ${c}`);
    domainCountsDiv.textContent = parts.length ? parts.join(', ') : '';
  }
}

function refreshUsage() {
  chrome.runtime.sendMessage({ action: 'usage' }, res => {
    if (chrome.runtime.lastError || !res) return;
    if (reqCount) reqCount.textContent = `${res.requests}/${res.requestLimit}`;
    if (tokenCount) tokenCount.textContent = `${res.tokens}/${res.tokenLimit}`;
    if (reqBar) setBar(reqBar, res.requests / res.requestLimit);
    if (tokenBar) setBar(tokenBar, res.tokens / res.tokenLimit);
    if (totalReq) totalReq.textContent = res.totalRequests;
    if (totalTok) totalTok.textContent = res.totalTokens;
    if (queueLen) queueLen.textContent = res.queue;
    if (failedReq) failedReq.textContent = res.failedTotalRequests;
    if (failedTok) failedTok.textContent = res.failedTotalTokens;
    if (res.models) {
      const turbo = res.models['qwen-mt-turbo'] || { requests: 0, requestLimit: 0 };
      const plus = res.models['qwen-mt-plus'] || { requests: 0, requestLimit: 0 };
      if (turboReq) turboReq.textContent = `${turbo.requests}/${turbo.requestLimit}`;
      if (plusReq) plusReq.textContent = `${plus.requests}/${plus.requestLimit}`;
      if (turboReqBar) setBar(turboReqBar, turbo.requestLimit ? turbo.requests / turbo.requestLimit : 0);
      if (plusReqBar) setBar(plusReqBar, plus.requestLimit ? plus.requests / plus.requestLimit : 0);
    }
    if (res.costs) {
      const turbo = res.costs['qwen-mt-turbo'];
      const plus = res.costs['qwen-mt-plus'];
      const total = res.costs.total;
      if (costTurbo24h) costTurbo24h.textContent = formatCost(turbo['24h'] || 0);
      if (costPlus24h) costPlus24h.textContent = formatCost(plus['24h'] || 0);
      if (costTotal24h) costTotal24h.textContent = formatCost(total['24h'] || 0);
      if (costTurbo7d) costTurbo7d.textContent = formatCost(turbo['7d'] || 0);
      if (costPlus7d) costPlus7d.textContent = formatCost(plus['7d'] || 0);
      if (costTotal7d) costTotal7d.textContent = formatCost(total['7d'] || 0);
      if (costTurbo30d) costTurbo30d.textContent = formatCost(turbo['30d'] || 0);
      if (costPlus30d) costPlus30d.textContent = formatCost(plus['30d'] || 0);
      if (costTotal30d) costTotal30d.textContent = formatCost(total['30d'] || 0);
      if (res.costs.daily && costCalendar) {
        costCalendar.innerHTML = '';
        res.costs.daily.forEach(d => {
          const div = document.createElement('div');
          div.textContent = `${d.date}: ${formatCost(d.cost)}`;
          costCalendar.appendChild(div);
        });
      }
    }
    if (reqLimitInput) reqLimitInput.dataset.auto = res.requestLimit;
    if (tokenLimitInput) tokenLimitInput.dataset.auto = res.tokenLimit;
    if (tokensPerReqInput) tokensPerReqInput.dataset.auto = Math.floor(res.tokenLimit / res.requestLimit || 0);
    if (smartThrottleInput && smartThrottleInput.checked) {
      if (reqLimitInput) reqLimitInput.placeholder = reqLimitInput.dataset.auto;
      if (tokenLimitInput) tokenLimitInput.placeholder = tokenLimitInput.dataset.auto;
      if (tokensPerReqInput) tokensPerReqInput.placeholder = tokensPerReqInput.dataset.auto;
    }
  });

  const now = Date.now();
  if (providerSelect && endpointInput && apiKeyInput && modelInput && debugCheckbox && now - lastQuotaCheck > 60000) {
    lastQuotaCheck = now;
    const prov =
      (window.qwenProviders && window.qwenProviders.getProvider(providerSelect.value)) || {};
    if (prov.getQuota) {
      prov
        .getQuota({
          endpoint: endpointInput.value.trim(),
          apiKey: apiKeyInput.value.trim(),
          model: modelInput.value.trim(),
          debug: debugCheckbox.checked,
        })
        .then(q => {
          if (typeof q.requests === 'number' && reqRemaining) {
            reqRemaining.textContent = q.requests;
            currentCfg.remainingRequests = q.requests;
          }
          if (typeof q.tokens === 'number' && tokenRemaining) {
            tokenRemaining.textContent = q.tokens;
            currentCfg.remainingTokens = q.tokens;
          }
          if (q.error) {
            if (providerError) providerError.textContent = q.error;
            currentCfg.providerError = q.error;
          } else {
            if (providerError) providerError.textContent = '';
            currentCfg.providerError = '';
          }
          providerError.textContent = warn;
          currentCfg.providerError = warn;
          const snapshot = { time: Date.now(), ...q };
          currentCfg.quotaHistory = [...(currentCfg.quotaHistory || []), snapshot];
          if (window.qwenSaveConfig) window.qwenSaveConfig(currentCfg);
        })
        .catch(err => {
          if (providerError) providerError.textContent = err.message;
          currentCfg.providerError = err.message;
          if (window.qwenSaveConfig) window.qwenSaveConfig(currentCfg);
        });
    }
  }
}

setInterval(refreshUsage, 1000);
refreshUsage();

if (toggleCalendar) {
  toggleCalendar.addEventListener('click', () => {
    costCalendar.style.display =
      costCalendar.style.display === 'none' ? 'block' : 'none';
  });
}

translateBtn.addEventListener('click', () => {
  const debug = debugCheckbox.checked;
  const force = forceCheckbox && forceCheckbox.checked;
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (!tabs[0]) return;
    if (debug) console.log('QTDEBUG: sending start message to tab', tabs[0].id);
    chrome.tabs.sendMessage(tabs[0].id, { action: 'start', force });
  });
});

if (clearCacheBtn) {
  clearCacheBtn.addEventListener('click', () => {
    if (typeof qwenClearCache === 'function') qwenClearCache();
    chrome.runtime.sendMessage({ action: 'clear-cache' }, () => {});
    chrome.tabs.query({}, tabs => {
      tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'clear-cache' }, () => {}));
    });
    status.textContent = 'Cache cleared.';
    updateCacheInfo();
    setTimeout(() => {
      if (status.textContent === 'Cache cleared.') status.textContent = '';
    }, 2000);
  });
}

document.addEventListener('click', e => {
  if (e.target && e.target.id === 'clearPair') {
    const srcElem = document.getElementById('source');
    const trgElem = document.getElementById('target');
    const source = srcElem && (srcElem.value || srcElem.getAttribute('value') || 'en');
    const target = trgElem && (trgElem.value || trgElem.getAttribute('value') || 'fr');
    const fn = globalThis.qwenClearCacheLangPair;
    if (typeof fn === 'function') fn(source, target);
    chrome.runtime.sendMessage({ action: 'clear-cache-pair', source, target }, () => {});
  }
  if (e.target && e.target.id === 'clearDomain') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const url = tabs[0] && tabs[0].url;
      const m = url && url.match(/^https?:\/\/([^/]+)/i);
      const domain = m && m[1];
      if (!domain) return;
      const fn = globalThis.qwenClearCacheDomain;
      if (typeof fn === 'function') fn(domain);
      chrome.runtime.sendMessage({ action: 'clear-cache-domain', domain }, () => {});
    });
  }
});

testBtn.addEventListener('click', async () => {
  status.textContent = 'Testing...';
  if (!window.qwenTranslate || !window.qwenTranslateStream) {
    status.textContent = 'Translation library not loaded. This may happen if the script was blocked.';
    return;
  }
  const list = document.createElement('ul');
  list.style.margin = '0';
  list.style.paddingLeft = '20px';
  status.innerHTML = '';
  status.appendChild(list);

  const cfg = {
    endpoint: endpointInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim(),
    source: sourceSelect.value,
    target: targetSelect.value,
    debug: debugCheckbox.checked,
  };
  if (dualModeInput.checked) {
    cfg.models = [
      cfg.model,
      cfg.model === 'qwen-mt-plus' ? 'qwen-mt-turbo' : 'qwen-mt-plus',
    ];
  }

  function log(...args) { if (cfg.debug) console.log(...args); }
  log('QTDEBUG: starting configuration test', cfg);

  async function run(name, fn) {
    const item = document.createElement('li');
    item.textContent = `${name}: ...`;
    list.appendChild(item);
    try {
      await fn();
      item.textContent = `${name}: ✓`;
      return true;
    } catch (e) {
      item.textContent = `${name}: ✗ ${e.message}`;
      item.title = e.stack || e.message;
      log(`QTERROR: ${name} failed`, e);
      return false;
    }
  }

  let allOk = true;

  allOk = (await run('Connect to API', async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    try {
      await safeFetch(cfg.endpoint, { method: 'GET', signal: controller.signal });
    } finally { clearTimeout(t); }
  })) && allOk;

  const transUrl = cfg.endpoint.replace(/\/?$/, '/') + 'services/aigc/text-generation/generation';

  allOk = (await run('Preflight', async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    try {
      await safeFetch(transUrl, { method: 'OPTIONS', signal: controller.signal });
    } finally { clearTimeout(t); }
  })) && allOk;

  allOk = (await run('Direct translation', async () => {
    const res = await window.qwenTranslate({ ...cfg, text: 'hello', stream: false, noProxy: true });
    if (!res.text) throw new Error('empty response');
  })) && allOk;

  allOk = (await run('Background ping', async () => {
    const resp = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'ping', debug: cfg.debug }, res => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(res);
        }
      });
    });
    if (!resp || !resp.ok) throw new Error('no response');
  })) && allOk;

  allOk = (await run('Background translation', async () => {
    const res = await window.qwenTranslate({ ...cfg, text: 'hello', stream: false });
    if (!res.text) throw new Error('empty response');
  })) && allOk;

  allOk = (await run('Streaming translation', async () => {
    let out = '';
    await window.qwenTranslateStream({ ...cfg, text: 'world', stream: true }, c => { out += c; });
    if (!out) throw new Error('no data');
  })) && allOk;

  allOk = (await run('Read active tab', async () => {
    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    if (!tabs[0]) throw new Error('no tab');
    const tab = tabs[0];
    const url = tab.url || '';
    if (!/^https?:/i.test(url)) {
      throw new Error('active tab not accessible; open a regular web page');
    }
    const resp = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { action: 'test-read' }, res => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(res);
        }
      });
    });
    if (!resp || typeof resp.title !== 'string') throw new Error('no response');
  })) && allOk;

  allOk = (await run('Tab translation', async () => {
    const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
    if (!tabs[0]) throw new Error('no tab');
    const tab = tabs[0];
    log('QTDEBUG: active tab for tab translation test', { id: tab.id, url: tab.url });
    const sample = cfg.source && cfg.source.toLowerCase().startsWith('fi')
      ? 'Hei maailma'
      : 'Hello world';
    const resp = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        log('QTERROR: tab translation timed out', { id: tab.id, url: tab.url });
        reject(new Error('timeout waiting for tab response'));
      }, 15000);
      log('QTDEBUG: sending test-e2e request to tab', tab.id);
      chrome.tabs.sendMessage(tab.id, { action: 'test-e2e', cfg, original: sample }, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          log('QTERROR: tab message failed', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          log('QTDEBUG: tab responded', res);
          resolve(res);
        }
      });
    });
    if (!resp || resp.error) {
      const err = new Error(resp ? resp.error : 'no response');
      if (resp && resp.stack) err.stack = resp.stack;
      log('QTERROR: tab returned error', err.message);
      throw err;
    }
    if (!resp.text || resp.text.toLowerCase() === sample.toLowerCase()) {
      throw new Error('translation failed');
    }
    log('QTDEBUG: tab translation succeeded', resp.text);
  })) && allOk;

  allOk = (await run('Storage access', async () => {
    const key = 'qwen-test-' + Date.now();
    await chrome.storage.sync.set({ [key]: '1' });
    const result = await new Promise(resolve => chrome.storage.sync.get([key], resolve));
    if (result[key] !== '1') throw new Error('write failed');
    await chrome.storage.sync.remove([key]);
  })) && allOk;

  allOk = (await run('Determine token limit', async () => {
    const limit = await window.qwenLimitDetector.detectTokenLimit(text =>
      window.qwenTranslate({ ...cfg, text, stream: false, noProxy: true })
    );
    await chrome.storage.sync.set({ tokenLimit: limit });
    tokenLimitInput.value = limit;
  })) && allOk;

  allOk = (await run('Determine request limit', async () => {
    const limit = await window.qwenLimitDetector.detectRequestLimit(() =>
      window.qwenTranslate({ ...cfg, text: 'ping', stream: false, noProxy: true })
    );
    await chrome.storage.sync.set({ requestLimit: limit });
    reqLimitInput.value = limit;
  })) && allOk;

  if (allOk) {
    status.appendChild(document.createTextNode('All tests passed.'));
  } else {
    status.appendChild(document.createTextNode('Some tests failed. See above.'));
  }

  log('QTDEBUG: configuration test finished');
});
