/**
 * Simple Popup Controller for Translation Extension
 * Compatible with the simple background script
 */

// Simple logger for popup
const logger = {
  info: (...args) => console.log('[Popup]', ...args),
  warn: (...args) => console.warn('[Popup]', ...args),
  error: (...args) => console.error('[Popup]', ...args),
  debug: (...args) => console.debug('[Popup]', ...args)
};

const INJECTION_FILES = [
  'i18n/index.js',
  'lib/logger.js',
  'lib/messaging.js',
  'lib/batchDelim.js',
  'lib/providers.js',
  'core/provider-loader.js',
  'core/dom-optimizer.js',
  'lib/glossary.js',
  'lib/tm.js',
  'lib/detect.js',
  'lib/feedback.js',
  'lib/offline.js',
  'config.js',
  'throttle.js',
  'translator.js',
  'contentScript.js'
];

class SimpleTranslationPopup {
  constructor() {
    this.currentStrategy = 'smart';
    this.isAutoTranslateEnabled = false;
    this.currentProvider = 'google-free';
    this.currentApiKeyStored = false;
    this.apiKeyVisible = false;
    this.providerOptions = [
      {
        value: 'google-free',
        label: 'Google (public)',
        description: 'Public Google Translate endpoint. No API key required.',
        requiresKey: false,
      },
      {
        value: 'qwen-mt-turbo',
        label: 'DashScope · Qwen MT Turbo',
        description: 'High quality Alibaba Qwen model via DashScope. Requires API key.',
        requiresKey: true,
      },
      {
        value: 'deepl-free',
        label: 'DeepL Free',
        description: 'DeepL free tier (500k characters/month). Requires API key.',
        requiresKey: true,
      },
      {
        value: 'deepl-pro',
        label: 'DeepL Pro',
        description: 'DeepL Pro account. Requires API key.',
        requiresKey: true,
      },
      {
        value: 'hunyuan-local',
        label: 'Hunyuan Local (offline)',
        description: 'Runs locally using the downloaded Hunyuan MT model. No API key required.',
        requiresKey: false,
      },
    ];
    this.stats = { requests: 0, tokens: 0, errors: 0 };

    this.initialize();
  }

  async initialize() {
    try {
      logger.info('Initializing...');

      this.cacheDom();
      this.populateProviderSelect();
      this.setupEventListeners();
      this.populateLanguageSelectors();
      await this.loadSettings();
      await this.updateStats();
      this.hideLoadingOverlay();

      logger.info('Initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize:', error);
      this.showError('Failed to initialize extension');
    }
  }

  cacheDom() {
    this.providerSelect = document.getElementById('provider-select');
    this.providerHint = document.getElementById('provider-hint');
    this.apiKeyGroup = document.getElementById('api-key-group');
    this.apiKeyInput = document.getElementById('api-key-input');
    this.apiKeyToggle = document.getElementById('toggle-api-key');
    this.apiKeySave = document.getElementById('save-api-key');
  }

  populateProviderSelect() {
    if (!this.providerSelect) return;
    this.providerSelect.innerHTML = this.providerOptions.map(option => `
      <option value="${option.value}" data-requires-key="${option.requiresKey ? '1' : '0'}">
        ${option.label}
      </option>
    `).join('');
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
    const translateSelectionButton = document.getElementById('translate-button');
    if (translateSelectionButton) {
      translateSelectionButton.addEventListener('click', () => this.translateSelection());
    }

    const translatePageButton = document.getElementById('translate-page-button');
    if (translatePageButton) {
      translatePageButton.addEventListener('click', () => this.translatePage());
    }

    if (this.providerSelect) {
      this.providerSelect.addEventListener('change', async (event) => {
        await this.onProviderChange(event.target.value);
      });
    }

    if (this.apiKeyToggle) {
      this.apiKeyToggle.addEventListener('click', () => this.toggleApiKeyVisibility());
    }

    if (this.apiKeySave) {
      this.apiKeySave.addEventListener('click', () => this.saveApiKey());
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
      this.currentProvider = result.provider || 'google-free';
      if (this.providerSelect) {
        this.providerSelect.value = this.currentProvider;
      }
      await this.refreshApiKeyState(this.currentProvider, result);
      this.updateProviderDisplay();

    } catch (error) {
      logger.error('Failed to load settings:', error);
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
      logger.error('Failed to save language settings:', error);
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
    chrome.storage.sync.set({ translationStrategy: strategy }).catch(logger.error);
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
          logger.info('Auto-translate enabled - triggering immediate translation');

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
              logger.info('Translation response:', response);
              this.showToast('Auto-translate enabled');
            }
          } catch (error) {
            logger.warn('Failed to immediately translate:', error.message);
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
      logger.error('Failed to toggle auto-translate:', error);
    }
  }

  async translateSelection() {
    try {
      this.showLoadingOverlay('Translating selection...');

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      await this.injectContentScripts(tabs[0].id);

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
      logger.error('Selection translation failed:', error);

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

      await this.injectContentScripts(tabs[0].id);

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
      logger.error('Page translation failed:', error);

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

  async injectContentScripts(tabId) {
    try {
      await chrome.scripting.insertCSS({
        target: { tabId, allFrames: true },
        files: ['styles/apple.css']
      });
    } catch (error) {
      logger.debug('CSS injection failed:', error);
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: INJECTION_FILES
      });
      // Give scripts a brief moment to register message listeners.
      await new Promise(resolve => setTimeout(resolve, 150));
    } catch (error) {
      logger.error('Script injection failed:', error);
      throw error;
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
        logger.warn('Stats not available from background, using defaults');
        this.stats = { requests: 0, tokens: 0, errors: 0 };
        this.updateStatsDisplay();
      }
    } catch (error) {
      logger.warn('Background script not ready, using default stats:', error.message);
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
        'google-free': 'Google Translate (public)',
        'qwen-mt-turbo': 'DashScope · Qwen MT Turbo',
        'qwen-mt': 'DashScope · Qwen MT',
        'qwen': 'DashScope · Qwen',
        'dashscope': 'DashScope',
        'deepl-free': 'DeepL Free',
        'deepl-pro': 'DeepL Pro',
        'hunyuan-local': 'Hunyuan Local 🏠'
      };
      providerElement.textContent = providerNames[this.currentProvider] || this.currentProvider;
    }

    const statusElement = document.getElementById('provider-status');
    if (statusElement) {
      statusElement.textContent = this.getProviderStatusLabel();
    }

    if (this.currentProvider === 'hunyuan-local') {
      this.updateLocalModelStatus();
    }

    this.updateProviderHint();
  }

  async updateLocalModelStatus() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'localModel:status'
      });

      if (response && response.success) {
        const statusElement = document.getElementById('provider-status');
        if (!statusElement) return;

        const downloadProgress = typeof response.downloadProgress === 'number' ? response.downloadProgress : 0;

        if (response.ready) {
          statusElement.textContent = '🏠 Ready (Local)';
        } else if (downloadProgress > 0 && downloadProgress < 100) {
          statusElement.textContent = `⬇️ Downloading ${Math.round(downloadProgress)}%`;
        } else if (response.loaded || response.available) {
          statusElement.textContent = '💤 Available (Initializing)';
        } else {
          statusElement.textContent = '❓ Not Downloaded';
        }
      }
    } catch (error) {
      logger.warn('Failed to get local model status:', error);
      const statusElement = document.getElementById('provider-status');
      if (statusElement) {
        statusElement.textContent = '❌ Error';
      }
    }
  }

  updateApiKeyStatus(hasKey) {
    const statusElement = document.getElementById('api-key-status');
    if (statusElement) {
      const providerNoKey = !this.providerRequiresKey(this.currentProvider);
      if (providerNoKey) {
        statusElement.textContent = '✅ No API key required';
        statusElement.className = 'status-good';
      } else {
        statusElement.textContent = hasKey ? '✅ API Key Configured' : '❌ API Key Required';
        statusElement.className = hasKey ? 'status-good' : 'status-error';
      }
    }
  }

  providerRequiresKey(provider) {
    const meta = this.getProviderMeta(provider);
    return meta ? !!meta.requiresKey : false;
  }

  getProviderMeta(provider) {
    return this.providerOptions.find(option => option.value === provider);
  }

  updateProviderHint() {
    if (!this.providerHint) return;
    const meta = this.getProviderMeta(this.currentProvider);
    this.providerHint.textContent = meta ? meta.description : '';
  }

  async onProviderChange(provider) {
    this.currentProvider = provider;
    await this.saveProviderSelection(provider);
    await this.refreshApiKeyState(provider);
    this.updateProviderDisplay();
    this.updateApiKeyStatus(this.currentApiKeyStored);
  }

  async saveProviderSelection(provider) {
    try {
      const stored = await this.getStoredConfig();
      const currentOrder = Array.isArray(stored.providerOrder) ? stored.providerOrder : [];
      const providerOrder = this.buildProviderOrder(provider, currentOrder);
      const providers = stored.providers || {};
      if (!providers[provider]) {
        providers[provider] = {};
      }

      await this.setStoredConfig({
        provider,
        providerOrder,
        providers,
      });

      await this.notifyConfigChanged();
    } catch (error) {
      logger.error('Failed to save provider selection:', error);
      this.showError('Failed to save provider: ' + error.message);
    }
  }

  buildProviderOrder(primary, existingOrder = []) {
    const seen = new Set();
    const order = [];
    const push = (id) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      order.push(id);
    };

    push(primary);
    existingOrder.forEach(push);
    ['google-free', 'hunyuan-local', 'qwen-mt-turbo', 'deepl-free', 'deepl-pro'].forEach(push);
    return order;
  }

  async refreshApiKeyState(provider, cachedSettings) {
    try {
      const config = cachedSettings || await this.getStoredConfig();
      const providers = config.providers || {};
      const providerEntry = providers[provider] || {};
      const topLevelKey = config.provider === provider ? config.apiKey : '';
      const storedKey = providerEntry.apiKey || topLevelKey || '';
      this.currentApiKeyStored = !!(storedKey && storedKey.trim());

      if (this.apiKeyInput) {
        this.apiKeyInput.value = '';
        this.apiKeyInput.placeholder = this.currentApiKeyStored ? 'API key stored' : 'Enter API key';
      }

      this.updateApiKeyVisibility(provider);
    } catch (error) {
      logger.warn('Failed to refresh API key state:', error);
      this.currentApiKeyStored = false;
      this.updateApiKeyVisibility(provider);
    }
  }

  updateApiKeyVisibility(provider) {
    const requiresKey = this.providerRequiresKey(provider);
    if (this.apiKeyGroup) {
      this.apiKeyGroup.style.display = requiresKey ? 'flex' : 'none';
    }
    this.updateApiKeyStatus(requiresKey ? this.currentApiKeyStored : true);
  }

  toggleApiKeyVisibility() {
    if (!this.apiKeyInput || !this.apiKeyToggle) return;
    this.apiKeyVisible = !this.apiKeyVisible;
    this.apiKeyInput.type = this.apiKeyVisible ? 'text' : 'password';
    this.apiKeyToggle.textContent = this.apiKeyVisible ? 'Hide' : 'Show';
  }

  async saveApiKey() {
    if (!this.providerRequiresKey(this.currentProvider)) {
      this.showToast('Selected provider does not require an API key.');
      return;
    }

    const key = (this.apiKeyInput?.value || '').trim();

    try {
      const config = await this.getStoredConfig();
      const providers = config.providers || {};
      const entry = { ...(providers[this.currentProvider] || {}) };
      entry.apiKey = key;
      providers[this.currentProvider] = entry;

      const updates = { providers };
      if (config.provider === this.currentProvider) {
        updates.apiKey = key;
      }

      await this.setStoredConfig(updates);
      await this.notifyConfigChanged();

      this.currentApiKeyStored = !!key;

      if (this.apiKeyInput) {
        this.apiKeyInput.value = '';
        this.apiKeyInput.placeholder = this.currentApiKeyStored ? 'API key stored' : 'Enter API key';
      }

      this.updateApiKeyStatus(this.currentApiKeyStored);
      this.showToast(key ? 'API key saved' : 'API key cleared');
    } catch (error) {
      logger.error('Failed to save API key:', error);
      this.showError('Failed to save API key: ' + error.message);
    }
  }

  async getStoredConfig() {
    return await new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.get({
          provider: 'google-free',
          providerOrder: ['google-free'],
          providers: {},
          apiKey: '',
        }, resolve);
      } catch (error) {
        reject(error);
      }
    });
  }

  async setStoredConfig(updates) {
    return await new Promise((resolve, reject) => {
      try {
        chrome.storage.sync.set(updates, () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async notifyConfigChanged() {
    try {
      await chrome.runtime.sendMessage({ type: 'config:reload' });
    } catch (error) {
      logger.debug?.('config:reload message failed', error);
    }
  }

  getProviderStatusLabel() {
    if (!this.providerRequiresKey(this.currentProvider)) {
      if (this.currentProvider === 'hunyuan-local') {
        return '🏠 Offline (local model)';
      }
      return '🌐 Public (no key)';
    }

    return this.currentApiKeyStored ? '⚡ Hosted (API key set)' : '⚠️ API key required';
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
    logger.info('DOM content loaded, initializing popup...');
    new SimpleTranslationPopup();
  } catch (error) {
    logger.error('Critical initialization error:', error);
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
logger.info('Script loaded successfully');

// Check if all required APIs are available
if (typeof chrome === 'undefined') {
  logger.error('Chrome extension APIs not available');
} else {
  logger.info('Chrome extension APIs available');
}

// Test that we can access storage API
if (chrome && chrome.storage && chrome.storage.sync) {
  logger.info('Storage API available');
} else {
  logger.error('Storage API not available');
}
