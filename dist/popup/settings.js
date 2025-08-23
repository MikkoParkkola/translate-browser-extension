// src/popup/settings.js

document.addEventListener('DOMContentLoaded', () => {
  const themeSelector = document.getElementById('theme-selector');
  const usageStats = document.getElementById('usageStats');
  const tmMetrics = document.getElementById('tmMetrics');
  const cacheStats = document.getElementById('cacheStats');
  const quotaStats = document.getElementById('quotaStats');

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  async function initialize() {
    await loadTheme();
    setupEventListeners();
    updateStats();
  }

  // --------------------------------------------------------------------------
  // Theme Management
  // --------------------------------------------------------------------------
  async function loadTheme() {
    const { theme } = await chrome.storage.local.get({ theme: 'modern' });
    themeSelector.value = theme;
  }

  function handleThemeChange() {
    const newTheme = themeSelector.value;
    chrome.runtime.sendMessage({ action: 'settings:theme-change', theme: newTheme });
  }

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    themeSelector.addEventListener('change', handleThemeChange);
  }

  // --------------------------------------------------------------------------
  // Core Logic
  // --------------------------------------------------------------------------
  async function updateStats() {
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

  initialize();
});