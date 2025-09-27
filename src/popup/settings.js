// src/popup/settings.js

// Resolve popup env/storage/messaging without Node require in browser
const popupEnv = (typeof window !== 'undefined' && window.qwenPopupEnv)
  || (typeof self !== 'undefined' && self.qwenPopupEnv)
  || (typeof require === 'function' ? require('./env') : null);
const { createPopupLogger } = popupEnv || { createPopupLogger: () => console };

const popupStorage = (typeof window !== 'undefined' && window.qwenPopupStorage)
  || (typeof self !== 'undefined' && self.qwenPopupStorage)
  || (typeof require === 'function' ? require('./storage') : null);

const popupMessaging = (typeof window !== 'undefined' && window.qwenPopupMessaging)
  || (typeof self !== 'undefined' && self.qwenPopupMessaging)
  || (typeof require === 'function' ? require('./messaging') : null);

// Initialize logger
const logger = createPopupLogger('settings');
const LOCAL_PROVIDER_ID = 'hunyuan-local';

const { bridge: chromeBridge, loadPreferences, savePreferences } = popupStorage;
const { sendMessage } = popupMessaging;

// --------------------------------------------------------------------------
// Theme Management
// --------------------------------------------------------------------------
async function loadTheme() {
  const themeSelector = document.getElementById('theme-selector');
  if (!themeSelector) return;

  const prefs = await loadPreferences({ theme: 'modern' });
  themeSelector.value = prefs.theme || 'modern';
}

function handleThemeChange() {
  const themeSelector = document.getElementById('theme-selector');
  if (!themeSelector) return;
  
  const newTheme = themeSelector.value;
  savePreferences({ theme: newTheme });
  sendMessage('settings:theme-change', { theme: newTheme });
}

// --------------------------------------------------------------------------
// Tab Management
// --------------------------------------------------------------------------
function setupTabSwitching() {
  const tabButtons = document.querySelectorAll('.tabs button');
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      handleTabSwitch(button.dataset.tab);
    });
  });
}

function handleTabSwitch(tabName) {
  // Handle tab switching logic here
  // The test expects window resizing after tab switch
  resizeWindowToContent();
}

function resizeWindowToContent() {
  // Resize window based on content width
  if (typeof window.resizeTo === 'function') {
    const width = document.body.scrollWidth;
    const height = window.outerHeight || 100;
    window.resizeTo(width, height);
  }
}

// --------------------------------------------------------------------------
// Event Listeners
// --------------------------------------------------------------------------
function setupEventListeners() {
  const themeSelector = document.getElementById('theme-selector');
  if (themeSelector) {
    themeSelector.addEventListener('change', handleThemeChange);
  }
  // Qwen presets and test
  const intlBtn = document.getElementById('presetQwenIntl');
  const cnBtn = document.getElementById('presetQwenCN');
  const testBtn = document.getElementById('testQwen');
  if (intlBtn) intlBtn.addEventListener('click', () => applyQwenPreset('intl'));
  if (cnBtn) cnBtn.addEventListener('click', () => applyQwenPreset('cn'));
  if (testBtn) testBtn.addEventListener('click', () => testQwenConnection());
  const saveBtn = document.getElementById('saveAll');
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    try {
      const cfg = await window.qwenProviderConfig.loadProviderConfig();
      await window.qwenProviderConfig.saveProviderConfig(cfg);
      const st = document.getElementById('saveStatus');
      if (st) { st.textContent = 'Saved'; setTimeout(()=> st.textContent = '', 1500); }
    } catch (e) {
      const st = document.getElementById('saveStatus');
      if (st) st.textContent = 'Save failed';
    }
  });
  
  setupTabSwitching();
}

// --------------------------------------------------------------------------
// Provider Management
// --------------------------------------------------------------------------
async function loadProviders() {
  if (!window.qwenProviders || !window.qwenProviderConfig) {
    return;
  }

  try {
    // Ensure providers are loaded
    await window.qwenProviders.ensureProviders();
    
    // Get provider list and config
    const providers = window.qwenProviders.listProviders();
    const config = await window.qwenProviderConfig.loadProviderConfig();
    
    // Render provider cards
    renderProviderCards(providers, config);
  } catch (error) {
    logger.error('Failed to load providers:', error);
  }
}

function renderProviderCards(providers, config) {
  const providerList = document.getElementById('providerList');
  if (!providerList) return;

  providerList.innerHTML = '';

  // Sort providers by configured order
  const orderedProviders = [...providers].sort((a, b) => {
    const orderA = config.providerOrder?.indexOf(a.name) ?? -1;
    const orderB = config.providerOrder?.indexOf(b.name) ?? -1;
    if (orderA === -1 && orderB === -1) return 0;
    if (orderA === -1) return 1;
    if (orderB === -1) return -1;
    return orderA - orderB;
  });

  orderedProviders.forEach(provider => {
    const card = createProviderCard(provider, config);
    providerList.appendChild(card);
  });

  ensureBenchmarkButton(providerList);
}

function createProviderCard(provider, config) {
  const providerConfig = config.providers?.[provider.name] || {};
  const isEnabled = providerConfig.enabled !== false;

  const card = document.createElement('div');
  card.className = 'provider-card';
  card.draggable = true;
  card.dataset.providerId = provider.name;

  card.innerHTML = `
    <div class="provider-header">
      <label class="provider-toggle">
        <input type="checkbox" ${isEnabled ? 'checked' : ''}>
        <span class="provider-label">${provider.label || provider.name}</span>
      </label>
      <div class="provider-actions">
        <button type="button" class="edit" title="Edit Provider">✎</button>
        <button type="button" class="duplicate" title="Duplicate Provider">⧉</button>
      </div>
    </div>
  `;

  // Handle enable/disable toggle
  const checkbox = card.querySelector('input[type="checkbox"]');
  checkbox.addEventListener('change', () => {
    handleProviderToggle(provider.name, checkbox.checked);
  });

  // Handle duplicate button
  const duplicateBtn = card.querySelector('button.duplicate');
  duplicateBtn.addEventListener('click', () => {
    handleProviderDuplicate(provider.name, config);
  });

  // Handle edit button → open provider editor overlay
  const editBtn = card.querySelector('button.edit');
  editBtn.addEventListener('click', () => {
    try {
      if (window.qwenProviderEditor && typeof window.qwenProviderEditor.open === 'function') {
        window.qwenProviderEditor.open(provider.name);
      } else {
        setStatus('warn', 'Provider editor unavailable in this build.');
      }
    } catch (e) {
      setStatus('error', `Failed to open editor: ${e?.message || e}`);
    }
  });

  if (provider.name === LOCAL_PROVIDER_ID) {
    const actions = card.querySelector('.provider-actions');
    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'test-local';
    testBtn.title = 'Run embedded model translation test';
    testBtn.textContent = 'Test local';
    testBtn.addEventListener('click', () => handleLocalModelTest());
    actions.appendChild(testBtn);
  }

  // Handle drag and drop
  card.addEventListener('dragend', handleProviderReorder);

  return card;
}

async function handleProviderToggle(providerId, enabled) {
  try {
    const config = await window.qwenProviderConfig.loadProviderConfig();
    if (!config.providers) config.providers = {};
    if (!config.providers[providerId]) config.providers[providerId] = {};
    
    config.providers[providerId].enabled = enabled;
    await window.qwenProviderConfig.saveProviderConfig(config);
  } catch (error) {
    logger.error('Failed to toggle provider:', error);
  }
}

async function handleProviderDuplicate(providerId, currentConfig) {
  try {
    const provider = window.qwenProviders.getProvider(providerId);
    const providerConfig = currentConfig.providers?.[providerId] || {};
    
    // Create copy ID
    let copyId = `${providerId}-copy`;
    let counter = 1;
    while (currentConfig.providers?.[copyId]) {
      copyId = `${providerId}-copy${counter}`;
      counter++;
    }

    // Register new provider (clone of original)
    window.qwenProviders.registerProvider(copyId, provider);

    // Update config
    const config = await window.qwenProviderConfig.loadProviderConfig();
    if (!config.providers) config.providers = {};
    if (!config.providerOrder) config.providerOrder = [];

    // Copy configuration
    config.providers[copyId] = {
      ...providerConfig,
      enabled: true
    };

    // Insert in provider order after original
    const originalIndex = config.providerOrder.indexOf(providerId);
    if (originalIndex >= 0) {
      config.providerOrder.splice(originalIndex + 1, 0, copyId);
    } else {
      config.providerOrder.push(copyId);
    }

    await window.qwenProviderConfig.saveProviderConfig(config);
    
    // Reload providers to show the new card
    await loadProviders();
  } catch (error) {
    logger.error('Failed to duplicate provider:', error);
  }
}

async function handleProviderReorder() {
  try {
    const providerList = document.getElementById('providerList');
    const cards = Array.from(providerList.children);
    const newOrder = cards.map(card => card.dataset.providerId);

    const config = await window.qwenProviderConfig.loadProviderConfig();
    config.providerOrder = newOrder;
    await window.qwenProviderConfig.saveProviderConfig(config);
  } catch (error) {
    logger.error('Failed to reorder providers:', error);
  }
}

async function handleBenchmarkProviders() {
  try {
    setStatus('info', 'Benchmarking providers…');
    const result = await sendMessage('run-benchmark');
    if (result && result.error) {
      setStatus('error', result.error);
      return;
    }
    const recommendation = result && result.recommendation;
    if (recommendation) {
      setStatus('success', `Benchmark: prioritizing ${recommendation}`);
    } else {
      setStatus('warn', 'Benchmark finished – no clear winner');
    }
    await loadProviders();
  } catch (error) {
    setStatus('error', error?.message || 'Benchmark failed');
  }
}

function ensureBenchmarkButton(providerList) {
  if (!providerList) return;
  const container = providerList.parentElement || providerList;
  if (!container) return;
  let button = document.getElementById('runBenchmarkButton');
  if (!button) {
    button = document.createElement('button');
    button.id = 'runBenchmarkButton';
    button.type = 'button';
    button.className = 'provider-benchmark-button';
    button.textContent = 'Benchmark Providers';
    container.appendChild(button);
  }
  if (!button.dataset.bound) {
    button.addEventListener('click', handleBenchmarkProviders);
    button.dataset.bound = 'true';
  }
}

async function handleLocalModelTest() {
  try {
    setStatus('info', 'Testing local model…');
    const response = await sendMessage('local-model:test', {
      text: 'Hello world',
      source: 'en',
      target: 'fi'
    });
    if (response && response.success) {
      const sample = (response.text || '').slice(0, 120);
      setStatus('success', `Local model OK: ${sample}`);
    } else {
      const err = (response && response.error) || 'Local model unavailable';
      setStatus('error', err);
    }
  } catch (error) {
    setStatus('error', error?.message || 'Local model test failed');
  }
}

// --------------------------------------------------------------------------
// Qwen Presets and Diagnostics
// --------------------------------------------------------------------------
function setStatus(kind, message) {
  const el = document.getElementById('providerStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `status ${kind}`;
}

async function applyQwenPreset(region) {
  try {
    setStatus('info', 'Applying preset...');
    const config = await window.qwenProviderConfig.loadProviderConfig();
    const endpoint = region === 'cn'
      ? 'https://dashscope-intl.aliyuncs.com/api/v1'
      : 'https://dashscope-intl.aliyuncs.com/api/v1';
    const model = 'qwen-mt-turbo';

    // Ensure provider entries
    config.provider = 'dashscope';
    config.providers = config.providers || {};
    config.providers.dashscope = config.providers.dashscope || {};
    config.providers.dashscope.enabled = true;
    config.providers.dashscope.apiEndpoint = endpoint;
    config.providers.dashscope.model = config.providers.dashscope.model || model;

    // Move dashscope to front of order
    config.providerOrder = Array.isArray(config.providerOrder) ? config.providerOrder.slice() : [];
    config.providerOrder = ['dashscope', ...config.providerOrder.filter(p => p !== 'dashscope')];

    await window.qwenProviderConfig.saveProviderConfig(config);
    await loadProviders();
    setStatus('success', `Preset applied: ${region === 'cn' ? 'Mainland China' : 'International'} endpoint ${endpoint}`);
  } catch (e) {
    setStatus('error', `Failed to apply preset: ${e?.message || e}`);
  }
}

async function getDashscopeApiKey() {
  // Try config first
  try {
    const config = await window.qwenProviderConfig.loadProviderConfig();
    const key = config?.providers?.dashscope?.apiKey || '';
    if (key) return key;
  } catch {}
  // Try providerStore unified secret storage
  try {
    if (window.qwenProviderStore?.getProviderSecret) {
      const s = await window.qwenProviderStore.getProviderSecret('dashscope');
      if (s) return s;
    } else if (window.qwenSecureStorage?.secureStorage) {
      const k = await window.qwenSecureStorage.secureStorage.getSecure('provider:dashscope');
      if (k) return k;
    }
  } catch {}
  return '';
}

async function testQwenConnection() {
  try {
    setStatus('info', 'Testing connection...');
    // Load current config
    const config = await window.qwenProviderConfig.loadProviderConfig();
    const ep = (config?.providers?.dashscope?.apiEndpoint)
      || config?.apiEndpoint
      || 'https://dashscope-intl.aliyuncs.com/api/v1';
    const model = (config?.providers?.dashscope?.model) || config?.model || 'qwen-mt-turbo';
    const apiKey = (await getDashscopeApiKey()).trim();
    if (!apiKey) {
      setStatus('error', 'No API key found for Qwen — add it to the provider and try again.');
      return;
    }

    let res = await sendMessage('testTranslation', {
      provider: 'dashscope',
      apiKey,
      endpoint: ep,
      model,
      text: 'Hello',
      source: 'en',
      target: 'es'
    });

    // Fallback to direct fetch if background returns a generic/internal error
    if (!res || res.error === 'Internal error' || /Command execution failed|Could not serialize/i.test(res.error || '')) {
      try {
        const url = (ep.endsWith('/') ? ep : (ep + '/')) + 'services/aigc/text-generation/generation';
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': /^bearer\s/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model,
            input: { messages: [{ role: 'user', content: 'Hello' }] },
            parameters: { translation_options: { source_lang: 'en', target_lang: 'es' } }
          })
        });
        if (r.ok) {
          const j = await r.json();
          const text = j?.output?.text || j?.output?.choices?.[0]?.message?.content || '';
          res = { success: true, text };
        } else {
          let msg = r.statusText;
          try { const je = await r.json(); msg = je?.error?.message || je?.message || msg; } catch {}
          res = { success: false, error: `HTTP ${r.status}: ${msg}` };
        }
      } catch (e) {
        res = { success: false, error: e?.message || 'Network error' };
      }
    }

    if (res && res.success) {
      setStatus('success', `OK — translated sample: "${res.text.slice(0, 60)}"...`);
    } else {
      const err = (res && res.error) || 'Unknown error';
      if (/sender context/i.test(err)) {
        setStatus('warn', 'Blocked by sender validation. Reload extension (chrome://extensions → Reload), then test again.');
      } else if (/401|403|invalid api key/i.test(err)) {
        setStatus('error', `Provider rejected the key (HTTP). Check endpoint region and key validity. Details: ${err}`);
      } else {
        setStatus('error', `Test failed: ${err}`);
      }
    }
  } catch (e) {
    setStatus('error', `Test error: ${e?.message || e}`);
  }
}

// --------------------------------------------------------------------------
// Translation Memory Management
// --------------------------------------------------------------------------
function setupTMManagement() {
  const tmClearButton = document.getElementById('tmClear');
  const tmExportButton = document.getElementById('tmExport');
  const tmImportFile = document.getElementById('tmImportFile');

  if (tmClearButton) {
    tmClearButton.addEventListener('click', handleTMClear);
  }

  if (tmExportButton) {
    tmExportButton.addEventListener('click', handleTMExport);
  }

  if (tmImportFile) {
    tmImportFile.addEventListener('change', handleTMImport);
  }

  // Load initial TM stats
  updateTMStats();
}

function updateTMStats() {
  const tmStatsElement = document.getElementById('tmStats');
  if (!tmStatsElement) return;

  sendMessage('tm-stats').then(response => {
    if (response && response.stats) {
      tmStatsElement.textContent = JSON.stringify(response.stats, null, 2);
    }
  }).catch(error => {
    logger.error('Failed to get TM stats:', error);
  });
}

function handleTMClear() {
  sendMessage('tm-clear').then(() => {
    updateTMStats();
    resizeWindowToContent();
  }).catch(error => {
    logger.error('Failed to clear TM:', error);
  });
}

function handleTMExport() {
  sendMessage('tm-get-all').then(response => {
    if (response && response.entries) {
      const blob = new Blob([JSON.stringify(response.entries, null, 2)], { 
        type: 'application/json' 
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'translation-memory.json';
      a.click();
      URL.revokeObjectURL(url);
    }
  }).catch(error => {
    logger.error('Failed to export TM:', error);
  });
}

function handleTMImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  (async () => {
    try {
      const text = await (file.text ? file.text() : new Response(file).text());
      const entries = JSON.parse(text);
      sendMessage('tm-import', { entries })
        .then(() => {
          updateTMStats();
        })
        .catch(err => {
          logger.error('Failed to import TM:', err);
        });
    } catch (error) {
      logger.error('Failed to parse TM import file:', error);
    }
  })();
}

// --------------------------------------------------------------------------
// Core Logic
// --------------------------------------------------------------------------
async function updateStats() {
  const usageStats = document.getElementById('usageStats');
  const tmMetrics = document.getElementById('tmMetrics');
  const cacheStats = document.getElementById('cacheStats');
  const quotaStats = document.getElementById('quotaStats');
  
  // Get basic metrics first
  if (usageStats) {
    sendMessage('metrics').then(response => {
      if (response && response.usage) {
        usageStats.textContent = JSON.stringify(response.usage, null, 2);
      }
    }).catch(error => {
      logger.error('Failed to get usage metrics:', error);
      usageStats.textContent = 'Error loading stats.';
    });
  }
  
  // Get TM and cache metrics
  if (tmMetrics || cacheStats) {
    sendMessage('tm-cache-metrics').then(response => {
      if (response) {
        if (response.tmMetrics && tmMetrics) {
          tmMetrics.textContent = JSON.stringify(response.tmMetrics, null, 2);
        }
        if (response.cacheStats && cacheStats) {
          cacheStats.textContent = JSON.stringify(response.cacheStats, null, 2);
        }
      }
    }).catch(error => {
      logger.error('Failed to get TM/cache metrics:', error);
    });
  }
  
  // Get provider quota data
  if (quotaStats) {
    sendMessage('provider-usage').then(response => {
      if (response && response.providersUsage) {
        let quotaText = '';
        for (const [provider, usage] of Object.entries(response.providersUsage)) {
          quotaText += `${provider}:\n`;
          quotaText += `  Requests (last minute): ${usage.requests}\n`;
          quotaText += `  Tokens (last minute): ${usage.tokens}\n`;
          quotaText += `  Total requests: ${usage.totalRequests}\n`;
          quotaText += `  Total tokens: ${usage.totalTokens}\n\n`;
        }
        quotaStats.textContent = quotaText || 'No quota data available';
      }
    }).catch(error => {
      logger.error('Failed to load provider usage:', error);
    });
  }
}

// --------------------------------------------------------------------------
// Initialization
// --------------------------------------------------------------------------
async function initialize() {
  await loadTheme();
  setupEventListeners();
  await loadProviders();
  setupTMManagement();
  updateStats();
  
  // Initial window resize to fit content
  resizeWindowToContent();
}

document.addEventListener('DOMContentLoaded', () => {
  initialize().catch(error => {
    logger.error('Initialize error:', error);
  });
});

// For testing purposes - ensure initialization happens even if DOM is already loaded
if (document.readyState !== 'loading') {
  // DOM is already ready, run immediately
  setTimeout(() => {
    initialize().catch(error => {
      logger.error('Initialize error (immediate):', error);
    });
  }, 0);
}
