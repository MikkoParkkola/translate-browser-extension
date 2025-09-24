// Modern Popup Controller - Simplified UI for Translation Extension

class TranslationPopup {
  constructor() {
    this.currentStrategy = 'smart';
    this.isAutoTranslateEnabled = false;
    this.usageData = {
      requests: { current: 0, limit: 100 },
      characters: { current: 0, limit: 50000 },
      cost: { today: 0, budget: 2.00 }
    };
    this.currentProvider = 'Qwen MT Turbo';
    this.providerStatus = 'Ready';

    this.initialize();
  }

  async initialize() {
    try {
      this.setupEventListeners();
      this.populateLanguageSelectors();
      await this.loadSettings();
      await this.updateUsageStats();
      this.updateProviderStatus();
      this.hideLoadingOverlay();
    } catch (error) {
      console.error('Failed to initialize popup:', error);
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
      { code: 'auto', name: '🌍 Auto Detect', flag: '🌍' },
      { code: 'en', name: '🇺🇸 English', flag: '🇺🇸' },
      { code: 'es', name: '🇪🇸 Spanish', flag: '🇪🇸' },
      { code: 'fr', name: '🇫🇷 French', flag: '🇫🇷' },
      { code: 'de', name: '🇩🇪 German', flag: '🇩🇪' },
      { code: 'it', name: '🇮🇹 Italian', flag: '🇮🇹' },
      { code: 'pt', name: '🇵🇹 Portuguese', flag: '🇵🇹' },
      { code: 'ru', name: '🇷🇺 Russian', flag: '🇷🇺' },
      { code: 'ja', name: '🇯🇵 Japanese', flag: '🇯🇵' },
      { code: 'ko', name: '🇰🇷 Korean', flag: '🇰🇷' },
      { code: 'zh', name: '🇨🇳 Chinese', flag: '🇨🇳' },
      { code: 'ar', name: '🇸🇦 Arabic', flag: '🇸🇦' },
      { code: 'hi', name: '🇮🇳 Hindi', flag: '🇮🇳' },
      { code: 'nl', name: '🇳🇱 Dutch', flag: '🇳🇱' },
      { code: 'sv', name: '🇸🇪 Swedish', flag: '🇸🇪' },
      { code: 'da', name: '🇩🇰 Danish', flag: '🇩🇰' },
      { code: 'no', name: '🇳🇴 Norwegian', flag: '🇳🇴' },
      { code: 'fi', name: '🇫🇮 Finnish', flag: '🇫🇮' },
      { code: 'pl', name: '🇵🇱 Polish', flag: '🇵🇱' },
      { code: 'tr', name: '🇹🇷 Turkish', flag: '🇹🇷' },
      { code: 'th', name: '🇹🇭 Thai', flag: '🇹🇭' },
      { code: 'vi', name: '🇻🇳 Vietnamese', flag: '🇻🇳' }
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
        'autoTranslateEnabled'
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

    } catch (error) {
      console.error('Failed to load settings:', error);
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
      console.error('Failed to save language settings:', error);
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
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'toggleAutoTranslate',
          enabled: enabled
        }).catch(() => {
          // Content script might not be injected yet
        });
      }
    } catch (error) {
      console.error('Failed to toggle auto-translate:', error);
    }
  }

  async translateSelection() {
    try {
      this.showLoadingOverlay('Translating selection...');

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found');
      }

      const sourceSelect = document.getElementById('source-language');
      const targetSelect = document.getElementById('target-language');

      const translationRequest = {
        type: 'translateSelection',
        sourceLanguage: sourceSelect?.value || 'auto',
        targetLanguage: targetSelect?.value || 'en',
        strategy: this.currentStrategy
      };

      const response = await chrome.tabs.sendMessage(tabs[0].id, translationRequest);

      if (response?.success) {
        this.showToast('Selection translated successfully');
        this.updateUsageStats();
      } else {
        throw new Error(response?.error || 'Translation failed');
      }

    } catch (error) {
      console.error('Selection translation failed:', error);
      this.showError('Failed to translate selection');
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

      const sourceSelect = document.getElementById('source-language');
      const targetSelect = document.getElementById('target-language');

      const translationRequest = {
        type: 'translatePage',
        sourceLanguage: sourceSelect?.value || 'auto',
        targetLanguage: targetSelect?.value || 'en',
        strategy: this.currentStrategy
      };

      const response = await chrome.tabs.sendMessage(tabs[0].id, translationRequest);

      if (response?.success) {
        this.showToast('Page translation started');
        this.updateUsageStats();
      } else {
        throw new Error(response?.error || 'Translation failed');
      }

    } catch (error) {
      console.error('Page translation failed:', error);
      this.showError('Failed to translate page');
    } finally {
      this.hideLoadingOverlay();
    }
  }

  async updateUsageStats() {
    try {
      // Get usage data from background script
      const response = await chrome.runtime.sendMessage({
        type: 'getUsageStats'
      });

      if (response?.success) {
        this.usageData = response.data;
        this.updateUsageUI();
      }
    } catch (error) {
      console.error('Failed to update usage stats:', error);
    }
  }

  updateUsageUI() {
    const usageSummary = document.getElementById('usage-summary');
    const requestsBar = document.getElementById('requests-bar');
    const charsBar = document.getElementById('chars-bar');
    const costToday = document.getElementById('cost-today');
    const budgetMonthly = document.getElementById('budget-monthly');

    if (usageSummary) {
      const requests = this.usageData.requests;
      const chars = this.usageData.characters;

      const charsFormatted = chars.current > 1000
        ? `${(chars.current / 1000).toFixed(1)}k`
        : chars.current;
      const charsLimitFormatted = chars.limit > 1000
        ? `${(chars.limit / 1000).toFixed(0)}k`
        : chars.limit;

      usageSummary.textContent = `${requests.current}/${requests.limit} req, ${charsFormatted}/${charsLimitFormatted} chars`;
    }

    if (requestsBar) {
      const percentage = Math.min((this.usageData.requests.current / this.usageData.requests.limit) * 100, 100);
      requestsBar.style.width = `${percentage}%`;
    }

    if (charsBar) {
      const percentage = Math.min((this.usageData.characters.current / this.usageData.characters.limit) * 100, 100);
      charsBar.style.width = `${percentage}%`;
    }

    if (costToday) {
      costToday.textContent = `$${this.usageData.cost.today.toFixed(2)}`;
    }

    if (budgetMonthly) {
      budgetMonthly.textContent = `$${this.usageData.cost.budget.toFixed(2)}`;
    }
  }

  updateProviderStatus() {
    const providerName = document.getElementById('current-provider');
    const providerStatus = document.getElementById('provider-status');

    if (providerName) {
      providerName.textContent = this.currentProvider;
    }

    if (providerStatus) {
      providerStatus.textContent = `🟢 ${this.providerStatus}`;
    }
  }

  openSettings() {
    chrome.runtime.openOptionsPage();
  }

  showLoadingOverlay(message = 'Processing...') {
    const overlay = document.getElementById('loading-overlay');
    const loadingText = overlay?.querySelector('.loading-text');

    if (loadingText) {
      loadingText.textContent = message;
    }

    if (overlay) {
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
    const errorToast = document.getElementById('error-toast');
    const errorMessage = document.getElementById('error-message');

    if (errorMessage) {
      errorMessage.textContent = message;
    }

    if (errorToast) {
      errorToast.style.display = 'block';

      // Auto-hide after 5 seconds
      setTimeout(() => {
        this.hideError();
      }, 5000);
    }
  }

  hideError() {
    const errorToast = document.getElementById('error-toast');
    if (errorToast) {
      errorToast.style.display = 'none';
    }
  }

  showToast(message) {
    // Create temporary toast for success messages
    const toast = document.createElement('div');
    toast.className = 'error-toast';
    toast.style.background = 'var(--color-green-500, #10b981)';
    toast.innerHTML = `
      <div class="error-content">
        <span class="error-text">${message}</span>
      </div>
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new TranslationPopup();
});

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TranslationPopup;
}