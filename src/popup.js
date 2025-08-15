// Main view elements
const apiKeyInput = document.getElementById('apiKey') || document.createElement('input');
const endpointInput = document.getElementById('apiEndpoint') || document.createElement('input');
const modelInput = document.getElementById('model') || document.createElement('input');
const sourceSelect = document.getElementById('source') || document.createElement('select');
const targetSelect = document.getElementById('target') || document.createElement('select');
const reqLimitInput = document.getElementById('requestLimit') || document.createElement('input');
const tokenLimitInput = document.getElementById('tokenLimit') || document.createElement('input');
const tokenBudgetInput = document.getElementById('tokenBudget') || document.createElement('input');
const autoCheckbox = document.getElementById('auto') || document.createElement('input');
const debugCheckbox = document.getElementById('debug') || document.createElement('input');
const detectorSelect = document.getElementById('detector') || document.createElement('select');
const detectApiKeyInput = document.getElementById('detectApiKey') || document.createElement('input');
const status = document.getElementById('status') || document.createElement('div');
const versionDiv = document.getElementById('version') || document.createElement('div');
const reqCount = document.getElementById('reqCount') || document.createElement('span');
const tokenCount = document.getElementById('tokenCount') || document.createElement('span');
const reqBar = document.getElementById('reqBar') || document.createElement('div');
const tokenBar = document.getElementById('tokenBar') || document.createElement('div');
const totalReq = document.getElementById('totalReq') || document.createElement('span');
const totalTok = document.getElementById('totalTok') || document.createElement('span');
const queueLen = document.getElementById('queueLen') || document.createElement('span');
const costSection = document.getElementById('costSection') || document.createElement('div');
const translateBtn = document.getElementById('translate') || document.createElement('button');
const testBtn = document.getElementById('test') || document.createElement('button');
const progressBar = document.getElementById('progress') || document.createElement('progress');
const providerPreset = document.getElementById('providerPreset') || document.createElement('select');
const clearPairBtn = document.getElementById('clearPair') || document.createElement('button');

// Setup view elements
const setupApiKeyInput = document.getElementById('setup-apiKey') || document.createElement('input');
const setupApiEndpointInput = document.getElementById('setup-apiEndpoint') || document.createElement('input');
const setupModelInput = document.getElementById('setup-model') || document.createElement('input');

const viewContainer = document.getElementById('viewContainer') || document.body;

let saveTimeout;

function saveConfig() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    if (!window.qwenSaveConfig) {
      status.textContent = 'Config library not loaded.';
      return;
    }
    const cfg = {
      apiKey: apiKeyInput.value.trim(),
      detectApiKey: detectApiKeyInput ? detectApiKeyInput.value.trim() : '',
      apiEndpoint: endpointInput.value.trim(),
      model: modelInput.value.trim(),
      sourceLanguage: sourceSelect.value,
      targetLanguage: targetSelect.value,
      detector: detectorSelect ? detectorSelect.value : 'local',
      requestLimit: parseInt(reqLimitInput.value, 10) || 60,
      tokenLimit: parseInt(tokenLimitInput.value, 10) || 100000,
      tokenBudget: parseInt(tokenBudgetInput.value, 10) || 0,
      autoTranslate: autoCheckbox.checked,
      debug: debugCheckbox.checked,
    };
    window.qwenSaveConfig(cfg).then(() => {
      status.textContent = 'Settings saved.';
      updateView(cfg); // Re-check the view after saving
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
  // Offer auto-detect for Source (recommended)
  const autoOpt = document.createElement('option');
  autoOpt.value = 'auto';
  autoOpt.textContent = 'Auto-detect (recommended)';
  sourceSelect.appendChild(autoOpt);
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
        let txt = `Translating ${s.request || 0}/${s.requests || 0}`;
        if (s.sample) txt += `: ${s.sample.slice(0, 60)}`;
        if (typeof s.elapsedMs === 'number') txt += ` · ${(s.elapsedMs / 1000).toFixed(1)}s`;
        if (typeof s.etaMs === 'number') txt += ` · ETA ${(s.etaMs / 1000).toFixed(1)}s`;
        status.textContent = txt;
      } else {
        const { phase, page, total } = s;
        const parts = [];
        if (phase) parts.push(phase.charAt(0).toUpperCase() + phase.slice(1));
        if (page && total) parts.push(`${page}/${total}`);
        status.textContent = parts.join(' ');
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

clearPairBtn.addEventListener('click', () => {
  const src = sourceSelect.value;
  const tgt = targetSelect.value;
  if (typeof window.qwenClearCacheLangPair === 'function') {
    window.qwenClearCacheLangPair(src, tgt);
  }
  if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ action: 'clear-cache-pair', source: src, target: tgt }, () => {});
  }
});

window.qwenLoadConfig().then(cfg => {
  // Populate main view
  apiKeyInput.value = cfg.apiKey || '';
  if (detectApiKeyInput) detectApiKeyInput.value = cfg.detectApiKey || '';
  if (detectorSelect) detectorSelect.value = cfg.detector || 'local';
  endpointInput.value = cfg.apiEndpoint || '';
  modelInput.value = cfg.model || '';
  sourceSelect.value = cfg.sourceLanguage;
  targetSelect.value = cfg.targetLanguage;
  // Sensible defaults if unset: auto source, target from browser UI language
  if (!sourceSelect.value) sourceSelect.value = 'auto';
  if (!targetSelect.value) {
    const nav = (navigator.language || 'en').split('-')[0].toLowerCase();
    const match = Array.from(targetSelect.options).find(o => String(o.value).toLowerCase() === nav);
    if (match) targetSelect.value = match.value;
  }
  reqLimitInput.value = cfg.requestLimit;
  tokenLimitInput.value = cfg.tokenLimit;
  tokenBudgetInput.value = cfg.tokenBudget || '';
  autoCheckbox.checked = cfg.autoTranslate;
  debugCheckbox.checked = !!cfg.debug;

  // Populate setup view
  setupApiKeyInput.value = cfg.apiKey || '';
  setupApiEndpointInput.value = cfg.apiEndpoint || '';
  setupModelInput.value = cfg.model || '';

  updateView(cfg);

  // Add event listeners for auto-saving and syncing
  const allInputs = [
    { main: apiKeyInput, setup: setupApiKeyInput, event: 'input' },
    { main: endpointInput, setup: setupApiEndpointInput, event: 'input' },
    { main: modelInput, setup: setupModelInput, event: 'input' },
  ];

  allInputs.forEach(({main, setup, event}) => {
    main.addEventListener(event, () => {
      syncInputs(main, setup);
      saveConfig();
    });
    setup.addEventListener(event, () => {
      syncInputs(setup, main);
      saveConfig();
    });
  });

  [reqLimitInput, tokenLimitInput, tokenBudgetInput].forEach(el => el.addEventListener('input', saveConfig));
  [sourceSelect, targetSelect, autoCheckbox, debugCheckbox].forEach(el => el.addEventListener('change', saveConfig));
  // If user turns on Auto, request permission and start on current tab immediately
  autoCheckbox.addEventListener('change', () => {
    if (!autoCheckbox.checked) return;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) return;
      chrome.runtime.sendMessage({ action: 'ensure-start', tabId: tab.id, url: tab.url }, () => {});
    });
  });
  if (detectApiKeyInput) detectApiKeyInput.addEventListener('input', saveConfig);
  if (detectorSelect) detectorSelect.addEventListener('change', saveConfig);
  if (providerPreset) {
    providerPreset.addEventListener('change', () => {
      const v = providerPreset.value;
      if (!v) return;
      const presets = {
        dashscope: { endpoint: 'https://dashscope-intl.aliyuncs.com/api/v1', model: 'qwen-mt-turbo' },
        openai:    { endpoint: 'https://api.openai.com/v1',                   model: 'gpt-4o-mini' },
        deepl:     { endpoint: 'https://api.deepl.com/v2',                    model: 'deepl' }
      };
      const p = presets[v];
      if (p) {
        endpointInput.value = p.endpoint;
        modelInput.value = p.model;
        if (apiKeyInput) apiKeyInput.focus();
        status.textContent = 'Preset applied. Paste your API key and continue.';
        saveConfig();
      }
    });
  }
  // Infer preset when user pastes endpoint (helps automation)
  if (endpointInput) {
    endpointInput.addEventListener('blur', () => {
      const v = (endpointInput.value || '').toLowerCase();
      let inferred = '';
      if (v.includes('openai')) inferred = 'openai';
      else if (v.includes('deepl')) inferred = 'deepl';
      else if (v.includes('dashscope')) inferred = 'dashscope';
      if (inferred && providerPreset) {
        providerPreset.value = inferred;
        providerPreset.dispatchEvent(new Event('change'));
      }
    });
  }
});

{
  const manifest = chrome.runtime.getManifest();
  const ver = manifest.version || '';
  const vn = manifest.version_name || '';
  let date = '';
  if (vn) {
    const m = String(vn).match(/(\d{4}-\d{2}-\d{2})/);
    if (m) date = m[1];
  }
  versionDiv.textContent = date ? `v${ver} • ${date}` : `v${ver}`;
}

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
    reqBar.title = `Requests: ${res.requests}/${res.requestLimit}`;
    tokenBar.title = `Tokens: ${res.tokens}/${res.tokenLimit}`;
    totalReq.textContent = res.totalRequests;
    totalTok.textContent = res.totalTokens;
    queueLen.textContent = res.queue;
    if (costSection) {
      const total7d = res.costs && res.costs.total && res.costs.total['7d'];
      costSection.textContent = total7d != null ? `Total 7d: $${total7d.toFixed(2)}` : '';
    }
  });
}

setInterval(refreshUsage, 1000);
refreshUsage();

translateBtn.addEventListener('click', () => {
  const debug = debugCheckbox.checked;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) return;
    if (debug) console.log('QTDEBUG: requesting ensure-start', { id: tab.id, url: tab.url });
    chrome.runtime.sendMessage({ action: 'ensure-start', tabId: tab.id, url: tab.url }, res => {
      if (debug) console.log('QTDEBUG: ensure-start result', res);
      if (!res || res.error) {
        status.textContent = `Start failed: ${(res && res.error) || 'unknown error'}`;
      }
    });
  });
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
    model: modelInput.value.trim(),
    source: sourceSelect.value,
    target: targetSelect.value,
    detector: detectorSelect ? detectorSelect.value : 'local',
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

  const base = cfg.endpoint.replace(/\/?$/, '/');
  const epLower = base.toLowerCase();
  let transPath = 'services/aigc/text-generation/generation';
  if (epLower.includes('openai')) transPath = 'chat/completions';
  else if (epLower.includes('deepl')) transPath = 'translate';
  const transUrl = base + transPath;

  allOk = (await run('Preflight', async () => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    try {
      await safeFetch(transUrl, { method: 'OPTIONS', signal: controller.signal });
    } finally { clearTimeout(t); }
  })) && allOk;

  allOk = (await run('Direct translation', async () => {
    const res = await window.qwenTranslate({ ...cfg, text: 'hello', stream: false });
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
      const cfgSend = { ...cfg };
      chrome.tabs.sendMessage(tab.id, { action: 'test-e2e', cfg: cfgSend, original: sample }, res => {
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
