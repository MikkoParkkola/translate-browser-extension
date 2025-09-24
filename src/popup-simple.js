/**
 * Simple Popup Controller for Translation Extension
 * Compatible with the simple background script
 */

class SimpleTranslationPopup {
  constructor() {
    this.currentStrategy = 'smart';
    this.isAutoTranslateEnabled = false;
    this.currentProvider = 'qwen-mt-turbo';
    this.stats = { requests: 0, tokens: 0, errors: 0 };

    this.initialize();
  }

  async initialize() {
    try {
      console.log('[Popup] Initializing...');

      this.setupEventListeners();
      this.populateLanguageSelectors();
      await this.loadSettings();
      await this.updateStats();
      this.hideLoadingOverlay();

      console.log('[Popup] Initialized successfully');
    } catch (error) {
      console.error('[Popup] Failed to initialize:', error);
      this.showError('Failed to initialize extension');
    }
  }

  setupEventListeners() {
    // Settings button
    const settingsButton = document.getElementById('settings-button');
    if (settingsButton) {
      settingsButton.addEventListener('click', () => this.openSettings());
    }

    // Language swap button
    const swapButton = document.getElementById('swap-languages');
    if (swapButton) {
      swapButton.addEventListener('click', () => this.swapLanguages());
    }

    // Strategy buttons
    const strategyButtons = document.querySelectorAll('.strategy-button');
    strategyButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const strategy = e.target.dataset.strategy;
        this.setStrategy(strategy);
      });
    });

    // Auto-translate toggle
    const autoTranslateToggle = document.getElementById('auto-translate-toggle');
    if (autoTranslateToggle) {
      autoTranslateToggle.addEventListener('change', (e) => {
        this.toggleAutoTranslate(e.target.checked);
      });
    }

    // Action buttons
    const translateSelectionButton = document.getElementById('translate-selection-button');
    if (translateSelectionButton) {
      translateSelectionButton.addEventListener('click', () => this.translateSelection());
    }

    const translatePageButton = document.getElementById('translate-page-button');
    if (translatePageButton) {
      translatePageButton.addEventListener('click', () => this.translatePage());
    }

    // Error toast close
    const errorClose = document.getElementById('error-close');
    if (errorClose) {
      errorClose.addEventListener('click', () => this.hideError());
    }

    // Language change handlers
    const sourceLanguage = document.getElementById('source-language');
    const targetLanguage = document.getElementById('target-language');

    if (sourceLanguage) {
      sourceLanguage.addEventListener('change', () => this.saveLanguageSettings());
    }

    if (targetLanguage) {
      targetLanguage.addEventListener('change', () => this.saveLanguageSettings());
    }
  }

  populateLanguageSelectors() {
    const languages = [
      { code: 'auto', name: '🌍 Auto Detect' },
      { code: 'en', name: '🇺🇸 English' },
      { code: 'es', name: '🇪🇸 Spanish' },
      { code: 'fr', name: '🇫🇷 French' },
      { code: 'de', name: '🇩🇪 German' },
      { code: 'it', name: '🇮🇹 Italian' },
      { code: 'pt', name: '🇵🇹 Portuguese' },
      { code: 'ru', name: '🇷🇺 Russian' },
      { code: 'ja', name: '🇯🇵 Japanese' },
      { code: 'ko', name: '🇰🇷 Korean' },
      { code: 'zh', name: '🇨🇳 Chinese' },
      { code: 'ar', name: '🇸🇦 Arabic' },
      { code: 'hi', name: '🇮🇳 Hindi' },
      { code: 'nl', name: '🇳🇱 Dutch' },
      { code: 'sv', name: '🇸🇪 Swedish' },
      { code: 'da', name: '🇩🇰 Danish' },
      { code: 'no', name: '🇳🇴 Norwegian' },
      { code: 'fi', name: '🇫🇮 Finnish' },
      { code: 'pl', name: '🇵🇱 Polish' },
      { code: 'tr', name: '🇹🇷 Turkish' },
      { code: 'th', name: '🇹🇭 Thai' },
      { code: 'vi', name: '🇻🇳 Vietnamese' }
    ];

    const sourceSelect = document.getElementById('source-language');
    const targetSelect = document.getElementById('target-language');

    if (sourceSelect) {
      sourceSelect.innerHTML = languages.map(lang =>
        `<option value="${lang.code}">${lang.name}</option>`
      ).join('');
    }

    if (targetSelect) {
      // Target doesn't include auto-detect
      const targetLanguages = languages.filter(lang => lang.code !== 'auto');
      targetSelect.innerHTML = targetLanguages.map(lang =>
        `<option value="${lang.code}">${lang.name}</option>`
      ).join('');
    }
  }

  async loadSettings() {
    try {
      // Load settings from chrome.storage
      const result = await chrome.storage.sync.get([
        'sourceLanguage',
        'targetLanguage',
        'translationStrategy',
        'autoTranslateEnabled',
        'provider',
        'apiKey'
      ]);

      // Set language selections
      const sourceSelect = document.getElementById('source-language');
      const targetSelect = document.getElementById('target-language');

      if (sourceSelect && result.sourceLanguage) {
        sourceSelect.value = result.sourceLanguage;
      }

      if (targetSelect && result.targetLanguage) {
        targetSelect.value = result.targetLanguage;
      } else if (targetSelect) {
        targetSelect.value = 'en'; // Default to English
      }

      // Set strategy
      if (result.translationStrategy) {
        this.setStrategy(result.translationStrategy);
      }

      // Set auto-translate toggle
      const autoToggle = document.getElementById('auto-translate-toggle');
      if (autoToggle) {
        autoToggle.checked = result.autoTranslateEnabled || false;
        this.isAutoTranslateEnabled = autoToggle.checked;
      }

      // Set provider info
      this.currentProvider = result.provider || 'qwen-mt-turbo';
      this.updateProviderDisplay();

      // Show API key status
      this.updateApiKeyStatus(!!result.apiKey);

    } catch (error) {
      console.error('[Popup] Failed to load settings:', error);
    }
  }

  async saveLanguageSettings() {
    try {
      const sourceSelect = document.getElementById('source-language');
      const targetSelect = document.getElementById('target-language');

      const settings = {
        sourceLanguage: sourceSelect?.value || 'auto',
        targetLanguage: targetSelect?.value || 'en'
      };

      await chrome.storage.sync.set(settings);
    } catch (error) {
      console.error('[Popup] Failed to save language settings:', error);
    }
  }

  setStrategy(strategy) {
    this.currentStrategy = strategy;

    // Update UI
    document.querySelectorAll('.strategy-button').forEach(button => {
      button.classList.remove('active');
    });

    const activeButton = document.querySelector(`[data-strategy="${strategy}"]`);
    if (activeButton) {
      activeButton.classList.add('active');
    }

    // Save to storage
    chrome.storage.sync.set({ translationStrategy: strategy }).catch(console.error);
  }

  swapLanguages() {
    const sourceSelect = document.getElementById('source-language');
    const targetSelect = document.getElementById('target-language');

    if (sourceSelect && targetSelect) {
      const sourceValue = sourceSelect.value;
      const targetValue = targetSelect.value;

      // Don't swap if source is auto-detect
      if (sourceValue === 'auto') {
        this.showError('Cannot swap when source is auto-detect');
        return;
      }

      sourceSelect.value = targetValue;
      targetSelect.value = sourceValue;

      this.saveLanguageSettings();
    }
  }

  async toggleAutoTranslate(enabled) {
    this.isAutoTranslateEnabled = enabled;

    try {
      await chrome.storage.sync.set({ autoTranslateEnabled: enabled });

      // Send message to content script
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {

        // If enabling auto-translate, immediately translate the current page
        if (enabled) {
          console.log('[Popup] Auto-translate enabled - triggering immediate translation');

          // First inject the content script
          try {
            await chrome.scripting.executeScript({
              target: { tabId: tabs[0].id, allFrames: true },
              files: ['contentScript-simple.js']
            });

            // Wait a moment for injection
            await new Promise(resolve => setTimeout(resolve, 200));

            // Then trigger translation
            const response = await chrome.tabs.sendMessage(tabs[0].id, {
              type: 'translatePage'
            });

            if (response?.success) {
              this.showToast('Auto-translate enabled and page translated');
            } else {
              console.log('[Popup] Translation response:', response);
              this.showToast('Auto-translate enabled');
            }
          } catch (error) {
            console.warn('[Popup] Failed to immediately translate:', error.message);
            // Still send the toggle message even if immediate translation fails
          }
        }

        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'toggleAutoTranslate',
          enabled: enabled
        }).catch(() => {
          // Content script might not be injected yet
        });
      }
    } catch (error) {
      console.error('[Popup] Failed to toggle auto-translate:', error);
    }
  }

  async translateSelection() {
    try {
      this.showLoadingOverlay('Translating selection...');

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      // First inject the content script into ALL frames (including cross-origin iframes)
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id, allFrames: true },
        files: ['contentScript-simple.js']
      });

      // Wait longer for content script to initialize and set up listeners
      await new Promise(resolve => setTimeout(resolve, 500));

      const response = await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'translateSelection'
      });

      if (response?.success) {
        this.showToast('Selection translated successfully');
        this.updateStats();
      } else {
        throw new Error(response?.error || 'Translation failed');
      }

    } catch (error) {
      console.error('[Popup] Selection translation failed:', error);

      // Show more helpful error messages
      let errorMessage = error.message;
      if (errorMessage.includes('API key not configured')) {
        errorMessage = 'API key required! Click the ⚙️ settings button to configure your translation provider.';
      } else if (errorMessage.includes('Extension context invalidated')) {
        errorMessage = 'Extension needs reload. Please refresh the page and try again.';
      }

      this.showError('Selection translation failed: ' + errorMessage);
    } finally {
      this.hideLoadingOverlay();
    }
  }

  async translatePage() {
    try {
      this.showLoadingOverlay('Translating page...');

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      // First inject the content script into ALL frames (including cross-origin iframes)
      await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id, allFrames: true },
        files: ['contentScript-simple.js']
      });

      // Wait a moment for injection
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'translatePage'
      });

      if (response?.success) {
        this.showToast('Page translation started');
        this.updateStats();
      } else {
        throw new Error(response?.error || 'Translation failed');
      }

    } catch (error) {
      console.error('[Popup] Page translation failed:', error);

      // Show more helpful error messages
      let errorMessage = error.message;
      if (errorMessage.includes('API key not configured')) {
        errorMessage = 'API key required! Click the ⚙️ settings button to configure your translation provider.';
      } else if (errorMessage.includes('Extension context invalidated')) {
        errorMessage = 'Extension needs reload. Please refresh the page and try again.';
      }

      this.showError('Translation failed: ' + errorMessage);
    } finally {
      this.hideLoadingOverlay();
    }
  }

  async updateStats() {
    try {
      // Get stats from background script
      const response = await chrome.runtime.sendMessage({
        type: 'getStats'
      });

      if (response?.success) {
        this.stats = response.stats;
        this.updateStatsDisplay();
      } else {
        // Background script may not be ready yet, use default stats
        console.warn('[Popup] Stats not available from background, using defaults');
        this.stats = { requests: 0, tokens: 0, errors: 0 };
        this.updateStatsDisplay();
      }
    } catch (error) {
      console.warn('[Popup] Background script not ready, using default stats:', error.message);
      // Use default stats if background isn't ready
      this.stats = { requests: 0, tokens: 0, errors: 0 };
      this.updateStatsDisplay();
    }
  }

  updateStatsDisplay() {
    // Update the usage summary
    const usageSummary = document.getElementById('usage-summary');
    if (usageSummary) {
      const requests = this.stats.requests || 0;
      const tokens = this.stats.tokens || 0;
      const errors = this.stats.errors || 0;

      // Format tokens in K for readability
      const tokensDisplay = tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens;

      let summaryText = `${requests} req, ${tokensDisplay} chars`;
      if (errors > 0) {
        summaryText += `, ${errors} errors`;
      }

      // Add Translation Memory hit rate if available
      if (this.stats.translationMemory) {
        const tm = this.stats.translationMemory;
        const hitRate = Math.round(tm.hitRate * 100);
        summaryText += ` • TM: ${tm.cacheSize} entries, ${hitRate}% hit rate`;
      }

      usageSummary.textContent = summaryText;
    }

    // Update cost display if available
    const costToday = document.getElementById('cost-today');
    if (costToday && this.stats.tokens) {
      // Rough cost calculation: $1 per 1M tokens
      const estimatedCost = (this.stats.tokens / 1000000);
      costToday.textContent = `$${estimatedCost.toFixed(3)}`;
    }
  }

  updateProviderDisplay() {
    const providerElement = document.getElementById('current-provider');
    if (providerElement) {
      const providerNames = {
        'qwen-mt-turbo': 'Qwen MT Turbo',
        'qwen-mt': 'Qwen MT',
        'deepl-free': 'DeepL Free',
        'deepl-pro': 'DeepL Pro',
        'hunyuan-local': 'Hunyuan Local 🏠'
      };
      providerElement.textContent = providerNames[this.currentProvider] || this.currentProvider;
    }

    // Update provider status for local model
    if (this.currentProvider === 'hunyuan-local') {
      this.updateLocalModelStatus();
    }
  }

  async updateLocalModelStatus() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'localModel:status'
      });

      if (response.success) {
        const status = response.status;
        const statusElement = document.getElementById('provider-status');

        if (statusElement) {
          if (status.downloading) {
            statusElement.textContent = `⬇️ Downloading ${Math.round(status.progress)}%`;
          } else if (status.available && status.ready) {
            statusElement.textContent = '🏠 Ready (Local)';
          } else if (status.available) {
            statusElement.textContent = '💤 Available (Loading...)';
          } else {
            statusElement.textContent = '❓ Not Downloaded';
          }
        }
      }
    } catch (error) {
      console.warn('[Popup] Failed to get local model status:', error);
      const statusElement = document.getElementById('provider-status');
      if (statusElement) {
        statusElement.textContent = '❌ Error';
      }
    }
  }

  updateApiKeyStatus(hasKey) {
    const statusElement = document.getElementById('api-key-status');
    if (statusElement) {
      statusElement.textContent = hasKey ? '✅ API Key Configured' : '❌ API Key Required';
      statusElement.className = hasKey ? 'status-good' : 'status-error';
    }
  }

  openSettings() {
    chrome.runtime.openOptionsPage();
  }

  showLoadingOverlay(message = 'Loading...') {
    const overlay = document.getElementById('loading-overlay');
    const text = document.getElementById('loading-text');

    if (overlay && text) {
      text.textContent = message;
      overlay.style.display = 'flex';
    }
  }

  hideLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  showError(message) {
    const toast = document.getElementById('error-toast');
    const text = document.getElementById('error-message');

    if (toast && text) {
      text.textContent = message;
      toast.style.display = 'block';

      // Auto-hide after 5 seconds
      setTimeout(() => {
        this.hideError();
      }, 5000);
    }
  }

  hideError() {
    const toast = document.getElementById('error-toast');
    if (toast) {
      toast.style.display = 'none';
    }
  }

  showToast(message) {
    // Simple notification
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: #28a745;
      color: white;
      padding: 10px;
      border-radius: 4px;
      z-index: 1000;
      font-size: 12px;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 3000);
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  try {
    console.log('[Popup] DOM content loaded, initializing popup...');
    new SimpleTranslationPopup();
  } catch (error) {
    console.error('[Popup] Critical initialization error:', error);
    // Show fallback UI
    document.body.innerHTML = `
      <div style="padding: 20px; color: red; font-family: Arial;">
        <h3>Extension Error</h3>
        <p>Failed to initialize popup: ${error.message}</p>
        <p>Check console for details.</p>
      </div>
    `;
  }
});

// Additional debugging
console.log('[Popup] Script loaded successfully');

// Check if all required APIs are available
if (typeof chrome === 'undefined') {
  console.error('[Popup] Chrome extension APIs not available');
} else {
  console.log('[Popup] Chrome extension APIs available');
}

// Test that we can access storage API
if (chrome && chrome.storage && chrome.storage.sync) {
  console.log('[Popup] Storage API available');
} else {
  console.error('[Popup] Storage API not available');
}