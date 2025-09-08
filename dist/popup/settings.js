// src/popup/settings.js

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
// Event Listeners
// --------------------------------------------------------------------------
function setupEventListeners() {
  const themeSelector = document.getElementById('theme-selector');
  if (!themeSelector) return;
  
  themeSelector.addEventListener('change', handleThemeChange);
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
    console.error('Failed to load providers:', error);
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
    console.error('Failed to toggle provider:', error);
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
    console.error('Failed to duplicate provider:', error);
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
    console.error('Failed to reorder providers:', error);
  }
}

// --------------------------------------------------------------------------
// Core Logic
// --------------------------------------------------------------------------
async function updateStats() {
  const usageStats = document.getElementById('usageStats');
  const tmMetrics = document.getElementById('tmMetrics');
  const cacheStats = document.getElementById('cacheStats');
  const quotaStats = document.getElementById('quotaStats');
  
  if (!usageStats || !tmMetrics || !cacheStats || !quotaStats) return;
  
  chrome.runtime.sendMessage({ action: 'settings:get-metrics' }, response => {
    if (chrome.runtime.lastError) {
      console.error('Failed to get metrics:', chrome.runtime.lastError);
      usageStats.textContent = 'Error loading stats.';
      return;
    }
    
    if (response) {
      if (response.usage) {
        usageStats.textContent = JSON.stringify(response.usage, null, 2);
      }
      if (response.tm) {
        tmMetrics.textContent = JSON.stringify(response.tm, null, 2);
      }
      if (response.cache) {
        cacheStats.textContent = JSON.stringify(response.cache, null, 2);
      }
      if (response.providersUsage) {
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
    }
  });
}

// --------------------------------------------------------------------------
// Initialization
// --------------------------------------------------------------------------
async function initialize() {
  await loadTheme();
  setupEventListeners();
  await loadProviders();
  updateStats();
}

document.addEventListener('DOMContentLoaded', () => {
  initialize().catch(error => {
    console.error('Initialize error:', error);
  });
});

// For testing purposes - ensure initialization happens even if DOM is already loaded
if (document.readyState !== 'loading') {
  // DOM is already ready, run immediately
  setTimeout(() => {
    initialize().catch(error => {
      console.error('Initialize error (immediate):', error);
    });
  }, 0);
}