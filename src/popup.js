// Main view elements
const apiKeyInput = document.getElementById('apiKey') || document.createElement('input');
const endpointInput = document.getElementById('apiEndpoint') || document.createElement('input');
const modelInput = document.getElementById('model') || document.createElement('input');
const plusFallbackCheckbox = document.getElementById('plusFallback') || document.createElement('input');
const sourceSelect = document.getElementById('source') || document.createElement('select');
const targetSelect = document.getElementById('target') || document.createElement('select');
const reqLimitInput = document.getElementById('requestLimit') || document.createElement('input');
const tokenLimitInput = document.getElementById('tokenLimit') || document.createElement('input');
const tokenBudgetInput = document.getElementById('tokenBudget') || document.createElement('input');
const memCacheMaxInput = document.getElementById('memCacheMax') || document.createElement('input');
const strategySelect = document.getElementById('strategy') || document.createElement('select');
const autoCheckbox = document.getElementById('auto') || document.createElement('input');
const debugCheckbox = document.getElementById('debug') || document.createElement('input');
const compactCheckbox = document.getElementById('compactMode') || document.createElement('input');
const lightModeCheckbox = document.getElementById('lightMode') || document.createElement('input');
const qualityCheckbox = document.getElementById('qualityVerify') || document.createElement('input');
const detectorSelect = document.getElementById('detector') || document.createElement('select');
const detectApiKeyInput = document.getElementById('detectApiKey') || document.createElement('input');
const sensitivityInput = document.getElementById('sensitivity') || document.createElement('input');
const sensitivityValueSpan = document.getElementById('sensitivityValue') || document.createElement('span');
const status = document.getElementById('status') || document.createElement('div');
const versionDiv = document.getElementById('version') || document.createElement('div');
const reqCount = document.getElementById('reqCount') || document.createElement('span');
const tokenCount = document.getElementById('tokenCount') || document.createElement('span');
const reqBar = document.getElementById('reqBar') || document.createElement('div');
const tokenBar = document.getElementById('tokenBar') || document.createElement('div');
const providerUsage = document.getElementById('providerUsage') || document.createElement('div');
const totalReq = document.getElementById('totalReq') || document.createElement('span');
const totalTok = document.getElementById('totalTok') || document.createElement('span');
const queueLen = document.getElementById('queueLen') || document.createElement('span');
const costSection = document.getElementById('costSection') || document.createElement('div');
const turboReqBar = document.getElementById('turboReqBar') || document.createElement('div');
const plusReqBar = document.getElementById('plusReqBar') || document.createElement('div');
const cacheStatsDiv = document.getElementById('cacheStats') || document.createElement('div');
const tmStatsDiv = document.getElementById('tmStats') || document.createElement('div');
const translateBtn = document.getElementById('translate') || document.createElement('button');
const testBtn = document.getElementById('test') || document.createElement('button');
const progressBar = document.getElementById('progress') || document.createElement('progress');
const providerCountSpan = document.getElementById('providerCount') || document.createElement('span');
const providerPreset = document.getElementById('providerPreset') || document.createElement('select');
const clearPairBtn = document.getElementById('clearPair') || document.createElement('button');
const statsReq = document.getElementById('statsRequests') || document.createElement('span');
const statsTok = document.getElementById('statsTokens') || document.createElement('span');
const statsLatency = document.getElementById('statsLatency') || document.createElement('span');
const statsEta = document.getElementById('statsEta') || document.createElement('span');
const statsQuality = document.getElementById('statsQuality') || document.createElement('span');
const statsDetails = document.getElementById('statsDetails') || document.createElement('details');
function setStatsSummary(eta) {
  if (!statsDetails) return;
  let summary = statsDetails.querySelector('summary');
  if (!summary) {
    summary = document.createElement('summary');
    statsDetails.prepend(summary);
  }
  summary.textContent = typeof eta === 'number' && !isNaN(eta)
    ? `Stats · ETA: ${eta.toFixed(1)} s`
    : 'Stats';
}
const reqSpark = document.getElementById('reqSpark') || document.createElement('canvas');
const tokSpark = document.getElementById('tokSpark') || document.createElement('canvas');
const calibrationStatus = document.getElementById('calibrationStatus') || document.createElement('div');
const recalibrateBtn = document.getElementById('recalibrate') || document.createElement('button');
const importGlossaryInput = document.getElementById('importGlossary') || document.createElement('input');
const exportGlossaryBtn = document.getElementById('exportGlossary') || document.createElement('button');
const benchmarkRec = document.getElementById('benchmarkRec') || document.createElement('div');

// Collapsible sections
const sectionIds = ['providerSection', 'limitSection', 'detectionSection', 'cacheSection', 'glossarySection'];

  document.body.classList.add('qwen-bg-animated');
  if (translateBtn) translateBtn.classList.add('primary-glow');

let translating = false;
let progressTimeout;
let reqSparkChart;
let tokSparkChart;
const providerChars = {};
const modelQuotas = {};

function refreshBenchmarkRec() {
  if (!chrome.storage || !chrome.storage.sync || !benchmarkRec) return;
  chrome.storage.sync.get({ benchmark: null, providerOrder: [] }, ({ benchmark }) => {
    benchmarkRec.innerHTML = '';
    if (!benchmark || !benchmark.results) return;

    const entries = Object.entries(benchmark.results);
    entries.sort((a, b) => {
      const ar = a[1];
      const br = b[1];
      if (ar.error && !br.error) return 1;
      if (br.error && !ar.error) return -1;
      if (ar.cost !== br.cost) return ar.cost - br.cost;
      return ar.latency - br.latency;
    });

    const table = document.createElement('table');
    table.className = 'benchmark-table';
    const header = document.createElement('tr');
    ['Provider', 'Latency (ms)', 'Cost'].forEach(h => {
      const th = document.createElement('th');
      th.textContent = h;
      header.appendChild(th);
    });
    table.appendChild(header);

    for (const [name, data] of entries) {
      const tr = document.createElement('tr');
      if (benchmark.recommendation === name) tr.classList.add('recommended');
      const tdName = document.createElement('td');
      tdName.textContent = name;
      const tdLatency = document.createElement('td');
      tdLatency.textContent = data.error ? '-' : String(data.latency);
      const tdCost = document.createElement('td');
      tdCost.textContent = data.error ? '-' : data.cost.toFixed(6);
      tr.appendChild(tdName);
      tr.appendChild(tdLatency);
      tr.appendChild(tdCost);
      table.appendChild(tr);
    }

    benchmarkRec.appendChild(table);

    if (benchmark.recommendation) {
      const btn = document.createElement('button');
      btn.textContent = 'Apply Recommendation';
      btn.addEventListener('click', () => {
        const sorted = entries.map(([n]) => n);
        chrome.storage.sync.set({ providerOrder: sorted }, () => {
          btn.disabled = true;
        });
      });
      benchmarkRec.appendChild(btn);
    }
  });
}

function initSectionToggles() {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) return;
  chrome.storage.sync.get({ openSections: {} }, ({ openSections }) => {
    sectionIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (openSections[id]) el.open = true;
      el.addEventListener('toggle', () => {
        chrome.storage.sync.get({ openSections: {} }, data => {
          const store = data.openSections || {};
          if (el.open) store[id] = true; else delete store[id];
          chrome.storage.sync.set({ openSections: store });
        });
      });
    });
  });
}

initSectionToggles();

function renderSparklines() {
  if (typeof Chart === 'undefined' || !chrome.storage || !chrome.storage.local) return;
  const now = Date.now();
  chrome.storage.local.get({ usageHistory: [] }, ({ usageHistory }) => {
    const hist = (usageHistory || []).filter(r => now - (r.ts || 0) <= 86400000);
    hist.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const labels = hist.map(r => new Date(r.ts).toLocaleTimeString());
    const reqData = hist.map(r => r.requests || r.req || 0);
    const tokData = hist.map(r => r.tokens || r.tok || 0);
    if (reqSpark && reqSpark.getContext) {
      if (!reqSparkChart) {
        reqSparkChart = new Chart(reqSpark.getContext('2d'), {
          type: 'line',
          data: { labels, datasets: [{ data: reqData, borderColor: 'var(--green)', borderWidth: 1, pointRadius: 0, tension: 0.3 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
        });
      } else {
        reqSparkChart.data.labels = labels;
        reqSparkChart.data.datasets[0].data = reqData;
        reqSparkChart.update();
      }
    }
    if (tokSpark && tokSpark.getContext) {
      if (!tokSparkChart) {
        tokSparkChart = new Chart(tokSpark.getContext('2d'), {
          type: 'line',
          data: { labels, datasets: [{ data: tokData, borderColor: 'var(--yellow)', borderWidth: 1, pointRadius: 0, tension: 0.3 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false } } }
        });
      } else {
        tokSparkChart.data.labels = labels;
        tokSparkChart.data.datasets[0].data = tokData;
        tokSparkChart.update();
      }
    }
  });
}

if (importGlossaryInput) {
  importGlossaryInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!chrome.storage || !chrome.storage.sync) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result || '{}');
        chrome.storage.sync.set({ glossary: data }, () => {
          status.textContent = 'Glossary imported.';
          setTimeout(() => { if (status.textContent === 'Glossary imported.') status.textContent = ''; }, 2000);
        });
      } catch {
        status.textContent = 'Invalid glossary file.';
        setTimeout(() => { if (status.textContent === 'Invalid glossary file.') status.textContent = ''; }, 2000);
      }
    };
    reader.readAsText(file);
    importGlossaryInput.value = '';
  });
}
if (exportGlossaryBtn) {
  exportGlossaryBtn.addEventListener('click', () => {
    if (!chrome.storage || !chrome.storage.sync) return;
    chrome.storage.sync.get({ glossary: {} }, data => {
      const blob = new Blob([JSON.stringify(data.glossary || {}, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'glossary.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  });
}

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
      sensitivity: sensitivityInput.valueAsNumber || 0,
      requestLimit: parseInt(reqLimitInput.value, 10) || 60,
      tokenLimit: parseInt(tokenLimitInput.value, 10) || (window.qwenDefaultConfig && window.qwenDefaultConfig.tokenLimit) || 0,
      tokenBudget: parseInt(tokenBudgetInput.value, 10) || 0,
      memCacheMax: parseInt(memCacheMaxInput.value, 10) || 0,
      autoTranslate: autoCheckbox.checked,
      debug: debugCheckbox.checked,
      qualityVerify: qualityCheckbox.checked,
      compact: compactCheckbox.checked,
      theme: lightModeCheckbox.checked ? 'light' : 'dark',
      calibratedAt: (window.qwenConfig && window.qwenConfig.calibratedAt) || 0,
      strategy: strategySelect.value || 'balanced',
    };
    if (plusFallbackCheckbox.checked) {
      if (cfg.model === 'qwen-mt-turbo') {
        cfg.secondaryModel = 'qwen-mt-plus';
        cfg.models = ['qwen-mt-turbo', 'qwen-mt-plus'];
      } else if (cfg.model === 'qwen-mt-plus') {
        cfg.secondaryModel = 'qwen-mt-turbo';
        cfg.models = ['qwen-mt-plus', 'qwen-mt-turbo'];
      } else {
        cfg.secondaryModel = '';
        cfg.models = cfg.model ? [cfg.model] : [];
      }
    } else {
      cfg.secondaryModel = '';
      cfg.models = cfg.model ? [cfg.model] : [];
    }
    cfg.charLimit = (window.qwenConfig && window.qwenConfig.charLimit) || 0;
    window.qwenSaveConfig(cfg).then(() => {
      window.qwenConfig = cfg;
      chrome.runtime.sendMessage({ action: 'set-config', config: { memCacheMax: cfg.memCacheMax, requestLimit: cfg.requestLimit, tokenLimit: cfg.tokenLimit, qualityVerify: cfg.qualityVerify } }, () => {});
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

const pLogger = (window.qwenLogger && window.qwenLogger.create) ? window.qwenLogger.create('popup') : console;
function safeFetch(url, opts) {
  return fetch(url, opts).catch(err => {
    pLogger.warn('Failed to fetch', url, err.message);
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
  if (testBtn) testBtn.disabled = w;
  if (translateBtn) translateBtn.disabled = !translating && w;
}

chrome.runtime.onMessage.addListener(msg => {
  if (msg.action === 'popup-status') {
    status.textContent = msg.text || '';
    setWorking(true);
  }
  if (msg.action === 'translation-status' && msg.status) {
    const s = msg.status;
    if (s.active) {
      translating = true;
      if (translateBtn) translateBtn.textContent = 'Stop Translation';
      if (s.progress && typeof s.progress.total === 'number') {
        progressBar.max = s.progress.total || 1;
        progressBar.value = s.progress.done || 0;
        if (!progressTimeout) {
          progressTimeout = setTimeout(() => {
            progressBar.style.display = 'block';
          }, 1000);
        }
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
      translating = false;
      if (translateBtn) translateBtn.textContent = 'Translate Page';
      if (progressTimeout) { clearTimeout(progressTimeout); progressTimeout = null; }
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
  if (msg.action === 'stats' && msg.stats) {
    const { requests, tokens, eta, avgLatency, quality } = msg.stats;
    statsReq.textContent = requests;
    statsTok.textContent = tokens;
    statsLatency.textContent = typeof avgLatency === 'number' ? avgLatency.toFixed(0) : '0';
    statsQuality.textContent = typeof quality === 'number' ? quality.toFixed(2) : '0';
    if (statsEta) statsEta.textContent = typeof eta === 'number' ? eta.toFixed(1) : '0';
    setStatsSummary(eta);
    renderSparklines();
  }
  if (msg.action === 'calibration-result' && msg.result) {
    const { requestLimit, tokenLimit, calibratedAt } = msg.result;
    reqLimitInput.value = requestLimit;
    tokenLimitInput.value = tokenLimit;
    calibrationStatus.textContent = calibratedAt
      ? `Calibrated ${new Date(calibratedAt).toLocaleString()}`
      : 'Not calibrated';
    if (window.qwenConfig) {
      window.qwenConfig.requestLimit = requestLimit;
      window.qwenConfig.tokenLimit = tokenLimit;
      window.qwenConfig.calibratedAt = calibratedAt;
    }
    status.textContent = 'Calibration complete.';
    setTimeout(() => { if (status.textContent === 'Calibration complete.') status.textContent = ''; }, 2000);
  }
});

chrome.runtime.sendMessage({ action: 'get-status' }, s => {
  if (s && s.active) {
    translating = true;
    if (translateBtn) translateBtn.textContent = 'Stop Translation';
    if (s.progress && typeof s.progress.total === 'number') {
      progressBar.max = s.progress.total || 1;
      progressBar.value = s.progress.done || 0;
      if (!progressTimeout) {
        progressTimeout = setTimeout(() => {
          progressBar.style.display = 'block';
        }, 1000);
      }
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
  } else if (translateBtn) translateBtn.textContent = 'Translate Page';
});

chrome.runtime.sendMessage({ action: 'get-stats' }, res => {
  if (res) {
    statsReq.textContent = res.requests || 0;
    statsTok.textContent = res.tokens || 0;
    statsLatency.textContent = typeof res.avgLatency === 'number' ? res.avgLatency.toFixed(0) : '0';
    statsQuality.textContent = typeof res.quality === 'number' ? res.quality.toFixed(2) : '0';
    if (statsEta) statsEta.textContent = typeof res.eta === 'number' ? res.eta.toFixed(1) : '0';
    setStatsSummary(res.eta);
    renderSparklines();
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

recalibrateBtn.addEventListener('click', () => {
  status.textContent = 'Recalibrating...';
  chrome.runtime.sendMessage({ action: 'recalibrate' }, () => {});
});

window.qwenLoadConfig().then(cfg => {
  window.qwenConfig = cfg;
  providerCountSpan.textContent = Object.keys(cfg.providers || {}).length;
  // Populate main view
  apiKeyInput.value = cfg.apiKey || '';
  if (detectApiKeyInput) detectApiKeyInput.value = cfg.detectApiKey || '';
  if (detectorSelect) detectorSelect.value = cfg.detector || 'local';
  if (sensitivityInput) {
    sensitivityInput.value = cfg.sensitivity;
    if (sensitivityValueSpan) sensitivityValueSpan.textContent = sensitivityInput.valueAsNumber.toFixed(1);
  }
  endpointInput.value = cfg.apiEndpoint || '';
  modelInput.value = cfg.model || '';
  plusFallbackCheckbox.checked = Array.isArray(cfg.models) && cfg.models.includes('qwen-mt-plus');
  sourceSelect.value = cfg.sourceLanguage;
  targetSelect.value = cfg.targetLanguage;
  // Sensible defaults if unset: auto source, target from browser UI language
  if (!sourceSelect.value) sourceSelect.value = 'auto';
  if (!targetSelect.value) {
    const nav = (navigator.language || 'en').split('-')[0].toLowerCase();
    const match = Array.from(targetSelect.options).find(o => String(o.value).toLowerCase() === nav);
    if (match) targetSelect.value = match.value;
  }
  strategySelect.value = cfg.strategy || 'balanced';
  reqLimitInput.value = cfg.requestLimit;
  tokenLimitInput.value = cfg.tokenLimit;
  tokenBudgetInput.value = cfg.tokenBudget || '';
  memCacheMaxInput.value = cfg.memCacheMax || '';
  autoCheckbox.checked = cfg.autoTranslate;
  debugCheckbox.checked = !!cfg.debug;
  qualityCheckbox.checked = !!cfg.qualityVerify;
  compactCheckbox.checked = !!cfg.compact;
  document.body.classList.toggle('qwen-compact', compactCheckbox.checked);
  refreshBenchmarkRec();
  lightModeCheckbox.checked = cfg.theme === 'light';
  document.documentElement.setAttribute('data-qwen-color', lightModeCheckbox.checked ? 'light' : 'dark');
  calibrationStatus.textContent = cfg.calibratedAt ? `Calibrated ${new Date(cfg.calibratedAt).toLocaleString()}` : 'Not calibrated';

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

  const tokenLimits = typeof modelTokenLimits === 'object' ? modelTokenLimits : {};
  const fixedModels = new Set(['qwen-mt-turbo', 'qwen-mt-plus']);
  [modelInput, setupModelInput].forEach(input => {
    input.addEventListener('change', () => {
      const model = input.value.trim();
      const limit = tokenLimits[model];
      if (!limit || fixedModels.has(model)) return;
      tokenLimitInput.value = limit;
      saveConfig();
    });
  });

  [reqLimitInput, tokenLimitInput, tokenBudgetInput, memCacheMaxInput, strategySelect].forEach(el => el.addEventListener('input', saveConfig));
  if (sensitivityInput && sensitivityValueSpan) {
    const updateSensitivityValue = () => {
      sensitivityValueSpan.textContent = sensitivityInput.valueAsNumber.toFixed(1);
    };
    sensitivityInput.addEventListener('input', () => {
      updateSensitivityValue();
      saveConfig();
    });
    updateSensitivityValue();
  }
  [sourceSelect, targetSelect, autoCheckbox, debugCheckbox, qualityCheckbox, plusFallbackCheckbox]
    .forEach(el => el.addEventListener('change', saveConfig));
  compactCheckbox.addEventListener('change', () => {
    document.body.classList.toggle('qwen-compact', compactCheckbox.checked);
    saveConfig();
  });
  lightModeCheckbox.addEventListener('change', () => {
    document.documentElement.setAttribute('data-qwen-color', lightModeCheckbox.checked ? 'light' : 'dark');
    saveConfig();
  });
  // If user toggles Auto, request permission/start or stop current tab
  autoCheckbox.addEventListener('change', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) return;
      if (autoCheckbox.checked) {
        chrome.runtime.sendMessage({ action: 'ensure-start', tabId: tab.id, url: tab.url }, () => {});
      } else {
        chrome.tabs.sendMessage(tab.id, { action: 'stop' }, () => {});
      }
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
        openrouter:{ endpoint: 'https://openrouter.ai/api/v1',               model: 'gpt-4o-mini' },
        deepl:     { endpoint: 'https://api.deepl.com/v2',                    model: 'deepl' },
        ollama:    { endpoint: 'http://localhost:11434',                     model: 'qwen2:latest' }
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
      else if (v.includes('openrouter')) inferred = 'openrouter';
      else if (v.includes('deepl')) inferred = 'deepl';
      else if (v.includes('dashscope')) inferred = 'dashscope';
      else if (v.includes('11434') || v.includes('ollama')) inferred = 'ollama';
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

function renderProviderUsage(cfg, stats = {}) {
  if (!providerUsage) return;
  providerUsage.innerHTML = '';
  const provs = cfg.providers || {};
  Object.entries(provs).forEach(([id, p]) => {
    const limit = p.charLimit || cfg.charLimit || 0;
    const used = stats[id] || 0;
    const item = document.createElement('div');
    item.className = 'usage-item';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    bar.appendChild(fill);
    setBar(fill, limit ? used / limit : 0);
    const label = document.createElement('span');
    label.textContent = `${id}: ${used}${limit ? '/' + limit : ''}`;
    item.appendChild(label);
    item.appendChild(bar);
    providerUsage.appendChild(item);
  });
}

function refreshQuota() {
  ['qwen-mt-turbo', 'qwen-mt-plus'].forEach(model => {
    chrome.runtime.sendMessage({ action: 'quota', model }, res => {
      if (chrome.runtime.lastError || !res) return;
      const rem = res.remaining || {};
      const used = res.used || {};
      modelQuotas[model] = {
        requests: (used.requests || 0) + (rem.requests || 0),
        tokens: (used.tokens || 0) + (rem.tokens || 0),
      };
    });
  });
}

let quotaInterval;
function scheduleQuota() {
  if (quotaInterval) clearInterval(quotaInterval);
  refreshQuota();
  quotaInterval = setInterval(refreshQuota, 30000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    scheduleQuota();
  } else if (quotaInterval) {
    clearInterval(quotaInterval);
    quotaInterval = null;
  }
});

function refreshUsage() {
  chrome.runtime.sendMessage({ action: 'usage' }, res => {
    if (chrome.runtime.lastError || !res) return;
    totalReq.textContent = res.totalRequests;
    totalTok.textContent = res.totalTokens;
    queueLen.textContent = res.queue;
    if (costSection) {
      const total7d = res.costs && res.costs.total && res.costs.total['7d'];
      costSection.textContent = total7d != null ? `Total 7d: $${total7d.toFixed(2)}` : '';
    }
    const cfg = window.qwenConfig || {};
    const reqTotal = cfg.requestLimit || 0;
    const tokTotal = cfg.tokenLimit || 0;
    const reqUsed = res.requests != null ? res.requests : res.totalRequests;
    const tokUsed = res.tokens != null ? res.tokens : res.totalTokens;
    setBar(reqBar, reqTotal ? reqUsed / reqTotal : 0);
    setBar(tokenBar, tokTotal ? tokUsed / tokTotal : 0);
    reqCount.textContent = reqTotal ? `${reqUsed}/${reqTotal}` : `${reqUsed}`;
    tokenCount.textContent = tokTotal ? `${tokUsed}/${tokTotal}` : `${tokUsed}`;
    reqBar.title = `Requests: ${reqCount.textContent}`;
    tokenBar.title = `Tokens: ${tokenCount.textContent}`;
    ['qwen-mt-turbo', 'qwen-mt-plus'].forEach(model => {
      const bar = model === 'qwen-mt-turbo' ? turboReqBar : plusReqBar;
      const m = res.models && res.models[model] || {};
      const limit = modelQuotas[model] || {};
      const usedReq = m.requests || 0;
      setBar(bar, limit.requests ? usedReq / limit.requests : 0);
      bar.textContent = `${usedReq}r ${m.tokens || 0}t`;
    });
    const prov = res.providers || {};
    Object.entries(prov).forEach(([id, s]) => {
      const used = (s && (s.characters && s.characters.used)) ?? s.chars ?? 0;
      if (typeof used === 'number' && !isNaN(used)) {
        providerChars[id] = used;
      }
    });
    renderProviderUsage(cfg, providerChars);
  });
}

scheduleQuota();
setInterval(refreshUsage, 1000);
refreshUsage();

function refreshMetrics() {
  chrome.runtime.sendMessage({ action: 'debug' }, res => {
    if (chrome.runtime.lastError || !res) return;
    if (cacheStatsDiv) {
      const c = res.cache || {};
      cacheStatsDiv.textContent = c.max ? `Mem cache ${c.size}/${c.max}` : `Mem cache ${c.size}`;
    }
    if (tmStatsDiv) {
      const t = res.tm || {};
      tmStatsDiv.textContent = `TM ${t.entries || 0} entries h:${t.hits || 0} m:${t.misses || 0}`;
    }
  });
}

setInterval(refreshMetrics, 3000);
refreshMetrics();

translateBtn.addEventListener('click', () => {
  if (translating) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) return;
      chrome.tabs.sendMessage(tab.id, { action: 'stop' }, () => {});
    });
    return;
  }
  const debug = debugCheckbox.checked;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) return;
    if (debug) pLogger.debug('requesting ensure-start', { id: tab.id, url: tab.url });
    chrome.runtime.sendMessage({ action: 'ensure-start', tabId: tab.id, url: tab.url }, res => {
      if (debug) pLogger.debug('ensure-start result', res);
      if (!res || res.error) {
        status.textContent = `Start failed: ${(res && res.error) || 'unknown error'}`;
      }
    });
  });
});

testBtn.addEventListener('click', async () => {
  status.textContent = 'Testing...';
  chrome.runtime.sendMessage({ action: 'run-benchmark' }, () => refreshBenchmarkRec());
  const tabs = await new Promise(r => chrome.tabs.query({ active: true, currentWindow: true }, r));
  const tab = tabs && tabs[0];
  if (tab) {
    await new Promise(res => chrome.runtime.sendMessage({ action: 'ensure-start', tabId: tab.id, url: tab.url }, () => res()));
  }
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

  function log(...args) { if (cfg.debug) pLogger.debug(...args); }
  pLogger.info('configuration test started');
  log('starting configuration test', cfg);

  async function run(name, fn) {
    const item = document.createElement('li');
    item.textContent = `${name}: ...`;
    list.appendChild(item);
    pLogger.info('diagnostic step started', name);
    try {
      await fn();
      item.textContent = `${name}: ✓`;
      pLogger.info('diagnostic step succeeded', name);
      return true;
    } catch (e) {
      item.textContent = `${name}: ✗ ${e.message}`;
      item.title = e.stack || e.message;
      pLogger.error(`${name} failed`, e);
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
    log('active tab for tab translation test', { id: tab.id, url: tab.url });
    const sample = cfg.source && cfg.source.toLowerCase().startsWith('fi')
      ? 'Hei maailma'
      : 'Hello world';
    const resp = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pLogger.error('tab translation timed out', { id: tab.id, url: tab.url });
        reject(new Error('timeout waiting for tab response'));
      }, 15000);
      log('sending test-e2e request to tab', tab.id);
      const cfgSend = { ...cfg };
      chrome.tabs.sendMessage(tab.id, { action: 'test-e2e', cfg: cfgSend, original: sample }, res => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          pLogger.error('tab message failed', chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          log('tab responded', res);
          resolve(res);
        }
      });
    });
    if (!resp || resp.error) {
      const err = new Error(resp ? resp.error : 'no response');
      if (resp && resp.stack) err.stack = resp.stack;
      pLogger.error('tab returned error', err.message);
      throw err;
    }
    if (!resp.text || resp.text.toLowerCase() === sample.toLowerCase()) {
      throw new Error('translation failed');
    }
    log('tab translation succeeded', resp.text);
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

  pLogger.info('configuration test finished', { allOk });
  log('configuration test finished');
});
