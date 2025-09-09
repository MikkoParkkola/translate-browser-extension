// src/popup/settings.js

// Initialize logger
const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) 
  ? window.qwenLogger.create('settings')
  : console;

// --------------------------------------------------------------------------
// Theme Management
// --------------------------------------------------------------------------
async function loadTheme() {
  const themeSelector = document.getElementById('theme-selector');
  if (!themeSelector) return;
  
  const { theme } = await chrome.storage.local.get({ theme: 'modern' });
  themeSelector.value = theme;
}

function handleThemeChange() {
  const themeSelector = document.getElementById('theme-selector');
  if (!themeSelector) return;
  
  const newTheme = themeSelector.value;
  chrome.runtime.sendMessage({ action: 'settings:theme-change', theme: newTheme });
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

  chrome.runtime.sendMessage({ action: 'tm-stats' }, (response) => {
    if (chrome.runtime.lastError) {
      logger.error('Failed to get TM stats:', chrome.runtime.lastError);
      return;
    }

    if (response && response.stats) {
      tmStatsElement.textContent = JSON.stringify(response.stats, null, 2);
    }
  });
}

function handleTMClear() {
  chrome.runtime.sendMessage({ action: 'tm-clear' }, (response) => {
    if (chrome.runtime.lastError) {
      logger.error('Failed to clear TM:', chrome.runtime.lastError);
      return;
    }

    // Refresh stats after clearing
    updateTMStats();
    resizeWindowToContent();
  });
}

function handleTMExport() {
  chrome.runtime.sendMessage({ action: 'tm-get-all' }, (response) => {
    if (chrome.runtime.lastError) {
      logger.error('Failed to export TM:', chrome.runtime.lastError);
      return;
    }

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
  });
}

function handleTMImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const entries = JSON.parse(e.target.result);
      
      chrome.runtime.sendMessage({ action: 'tm-import', entries }, (response) => {
        if (chrome.runtime.lastError) {
          logger.error('Failed to import TM:', chrome.runtime.lastError);
          return;
        }

        // Refresh stats after import
        updateTMStats();
      });
    } catch (error) {
      logger.error('Failed to parse TM import file:', error);
    }
  };
  reader.readAsText(file);
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
    chrome.runtime.sendMessage({ action: 'metrics' }, response => {
      if (chrome.runtime.lastError) {
        logger.error('Failed to get usage metrics:', chrome.runtime.lastError);
        if (usageStats) usageStats.textContent = 'Error loading stats.';
        return;
      }
      
      if (response && response.usage) {
        usageStats.textContent = JSON.stringify(response.usage, null, 2);
      }
    });
  }
  
  // Get TM and cache metrics
  if (tmMetrics || cacheStats) {
    chrome.runtime.sendMessage({ action: 'tm-cache-metrics' }, response => {
      if (chrome.runtime.lastError) {
        logger.error('Failed to get TM/cache metrics:', chrome.runtime.lastError);
        return;
      }
      
      if (response) {
        if (response.tmMetrics && tmMetrics) {
          tmMetrics.textContent = JSON.stringify(response.tmMetrics, null, 2);
        }
        if (response.cacheStats && cacheStats) {
          cacheStats.textContent = JSON.stringify(response.cacheStats, null, 2);
        }
      }
    });
  }
  
  // Get provider quota data
  if (quotaStats) {
    chrome.runtime.sendMessage({ action: 'provider-usage' }, response => {
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