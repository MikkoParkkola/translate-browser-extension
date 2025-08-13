// Main view elements
const apiKeyInput = document.getElementById('apiKey');
const endpointInput = document.getElementById('apiEndpoint');
const modelInput = document.getElementById('model');
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
const totalReq = document.getElementById('totalReq');
const totalTok = document.getElementById('totalTok');
const queueLen = document.getElementById('queueLen');
const failedReq = document.getElementById('failedReq');
const failedTok = document.getElementById('failedTok');
const translateBtn = document.getElementById('translate');
const testBtn = document.getElementById('test');
const progressBar = document.getElementById('progress');
const clearCacheBtn = document.getElementById('clearCache');
const forceCheckbox = document.getElementById('force');

// Setup view elements
const setupApiKeyInput = document.getElementById('setup-apiKey');
const setupApiEndpointInput = document.getElementById('setup-apiEndpoint');
const setupModelInput = document.getElementById('setup-model');

const viewContainer = document.getElementById('viewContainer');

const modelTokenLimits = (window.qwenModelTokenLimits) || { 'qwen-mt-turbo': 31980, 'qwen-mt-plus': 23797 };

function getDefaultTokenLimit(model) {
  return modelTokenLimits[model] || modelTokenLimits['qwen-mt-turbo'];
}

let saveTimeout;

function saveConfig() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (!window.qwenSaveConfig) {
      status.textContent = 'Config library not loaded.';
      return;
    }
    const model = modelInput.value.trim() || 'qwen-mt-turbo';
    const cfg = {
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
    };
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
  to.value = from.value;
}

function updateView(cfg) {
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

function setWorking(w) {
  [translateBtn, testBtn].forEach(b => { if (b) b.disabled = w; });
}

function updateThrottleInputs() {
  const manual = !smartThrottleInput.checked;
  [reqLimitInput, tokenLimitInput, tokensPerReqInput, retryDelayInput].forEach(el => {
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
  // Populate main view
  apiKeyInput.value = cfg.apiKey || '';
  endpointInput.value = cfg.apiEndpoint || '';
  modelInput.value = cfg.model || '';
  sourceSelect.value = cfg.sourceLanguage;
  targetSelect.value = cfg.targetLanguage;
  reqLimitInput.value = cfg.requestLimit;
  tokenLimitInput.value = cfg.tokenLimit;
  tokenBudgetInput.value = cfg.tokenBudget || '';
  autoCheckbox.checked = cfg.autoTranslate;
  debugCheckbox.checked = !!cfg.debug;
  smartThrottleInput.checked = cfg.smartThrottle !== false;
  tokensPerReqInput.value = cfg.tokensPerReq || '';
  retryDelayInput.value = cfg.retryDelay || '';

  // Populate setup view
  setupApiKeyInput.value = cfg.apiKey || '';
  setupApiEndpointInput.value = cfg.apiEndpoint || '';
  setupModelInput.value = cfg.model || '';

  updateView(cfg);

  // Add event listeners for auto-saving and syncing
  const allInputs = [
    { main: apiKeyInput, setup: setupApiKeyInput, event: 'input' },
    { main: endpointInput, setup: setupApiEndpointInput, event: 'input' },
    { main: modelInput, setup: setupModelInput, event: 'change' },
  ];

  allInputs.forEach(({main, setup, event}) => {
    main.addEventListener(event, () => {
      syncInputs(main, setup);
      saveConfig();
      if (event === 'change') refreshUsage();
    });
    setup.addEventListener(event, () => {
      syncInputs(setup, main);
      saveConfig();
      if (event === 'change') refreshUsage();
    });
  });

  updateThrottleInputs();
  [reqLimitInput, tokenLimitInput, tokenBudgetInput, tokensPerReqInput, retryDelayInput].forEach(el => el.addEventListener('input', saveConfig));
  [sourceSelect, targetSelect, autoCheckbox, debugCheckbox, smartThrottleInput].forEach(el => el.addEventListener('change', () => { updateThrottleInputs(); saveConfig(); }));
});

versionDiv.textContent = `v${chrome.runtime.getManifest().version}`;

function setBar(el, ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  el.style.width = r * 100 + '%';
  el.style.backgroundColor = window.qwenUsageColor ? window.qwenUsageColor(r) : 'var(--green)';
}

function refreshUsage() {
  chrome.runtime.sendMessage({ action: 'usage' }, res => {
    if (chrome.runtime.lastError || !res) return;
    reqCount.textContent = `${res.requests}/${res.requestLimit}`;
    tokenCount.textContent = `${res.tokens}/${res.tokenLimit}`;
    setBar(reqBar, res.requests / res.requestLimit);
    setBar(tokenBar, res.tokens / res.tokenLimit);
    totalReq.textContent = res.totalRequests;
    totalTok.textContent = res.totalTokens;
    queueLen.textContent = res.queue;
    failedReq.textContent = res.failedTotalRequests;
    failedTok.textContent = res.failedTotalTokens;
    reqLimitInput.dataset.auto = res.requestLimit;
    tokenLimitInput.dataset.auto = res.tokenLimit;
    tokensPerReqInput.dataset.auto = Math.floor(res.tokenLimit / res.requestLimit || 0);
    if (smartThrottleInput.checked) {
      reqLimitInput.placeholder = reqLimitInput.dataset.auto;
      tokenLimitInput.placeholder = tokenLimitInput.dataset.auto;
      tokensPerReqInput.placeholder = tokensPerReqInput.dataset.auto;
    }
  });
}

setInterval(refreshUsage, 1000);
refreshUsage();

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
    if (window.qwenClearCache) window.qwenClearCache();
    chrome.runtime.sendMessage({ action: 'clear-cache' }, () => {});
    chrome.tabs.query({}, tabs => {
      tabs.forEach(t => chrome.tabs.sendMessage(t.id, { action: 'clear-cache' }, () => {}));
    });
    status.textContent = 'Cache cleared.';
    setTimeout(() => {
      if (status.textContent === 'Cache cleared.') status.textContent = '';
    }, 2000);
  });
}

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

  if (allOk) {
    status.appendChild(document.createTextNode('All tests passed.'));
  } else {
    status.appendChild(document.createTextNode('Some tests failed. See above.'));
  }

  log('QTDEBUG: configuration test finished');
});
