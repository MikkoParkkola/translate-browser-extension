// src/popup.js

// Export functions for testing
const Popup = {
  themeSelector: null,
  settingsButton: null,
  providerGrid: null,
  sourceLanguageSelect: null,
  targetLanguageSelect: null,
  translateButton: null,
  loadingOverlay: null,
  activeProvider: null,

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  async initialize() {
    this.themeSelector = document.getElementById('theme-selector');
    this.settingsButton = document.getElementById('settings-button');
    this.providerGrid = document.getElementById('provider-grid');
    this.sourceLanguageSelect = document.getElementById('source-language');
    this.targetLanguageSelect = document.getElementById('target-language');
    this.translateButton = document.getElementById('translate-button');
    this.loadingOverlay = document.getElementById('loading-overlay');

    await this.loadTheme();
    await this.loadLanguages();
    await this.loadProviders();
    await this.loadSettings();
    this.setupEventListeners();
  },

  // --------------------------------------------------------------------------
  // Theme Management
  // --------------------------------------------------------------------------
  async loadTheme() {
    const { theme } = await chrome.storage.local.get({ theme: 'modern' });
    this.themeSelector.value = theme;
    this.applyTheme(theme);
  },

  applyTheme(theme) {
    document.querySelectorAll('link[data-theme]').forEach(link => link.remove());
    if (theme !== 'modern') {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL(`styles/${theme}.css`);
      link.dataset.theme = theme;
      document.head.appendChild(link);
    }
    if (theme === 'cyberpunk') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  },

  handleThemeChange() {
    const newTheme = this.themeSelector.value;
    this.applyTheme(newTheme);
    chrome.storage.local.set({ theme: newTheme });
  },

  // --------------------------------------------------------------------------
  // Data Loading
  // --------------------------------------------------------------------------
  async loadLanguages() {
    try {
      // Try to load comprehensive language list from the extension
      const languagesUrl = chrome.runtime.getURL('languages.js');
      // Since we can't directly import the JS file, we'll use a fallback approach
      // and load from our internal language list
      if (typeof window !== 'undefined' && window.qwenLanguages) {
        this.populateLanguageSelects(window.qwenLanguages);
      } else {
        // Fallback to basic language list
        this.populateLanguageSelectsWithFallback();
      }
    } catch (error) {
      console.error('Failed to load comprehensive language list:', error);
      // Fallback to basic language list
      this.populateLanguageSelectsWithFallback();
    }
  },

  populateLanguageSelects(langs) {
    // Clear existing options (except the auto option in source)
    while (this.sourceLanguageSelect.firstChild) {
      if (this.sourceLanguageSelect.firstChild.value === 'auto') {
        break;
      }
      this.sourceLanguageSelect.removeChild(this.sourceLanguageSelect.firstChild);
    }
    
    this.targetLanguageSelect.innerHTML = '';
    
    // Add all languages to both selects
    langs.forEach(lang => {
      // Add to source language select
      const sourceOption = document.createElement('option');
      sourceOption.value = lang.code;
      sourceOption.textContent = lang.name;
      this.sourceLanguageSelect.appendChild(sourceOption);
      
      // Add to target language select
      const targetOption = document.createElement('option');
      targetOption.value = lang.code;
      targetOption.textContent = lang.name;
      this.targetLanguageSelect.appendChild(targetOption);
    });
  },

  populateLanguageSelectsWithFallback() {
    const languages = [
      { code: 'auto', name: 'Auto Detect' },
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
      { code: 'it', name: 'Italian' },
      { code: 'pt', name: 'Portuguese' },
      { code: 'ru', name: 'Russian' },
      { code: 'zh', name: 'Chinese' },
      { code: 'ja', name: 'Japanese' },
      { code: 'ko', name: 'Korean' }
    ];
    
    // Clear existing options
    this.sourceLanguageSelect.innerHTML = '';
    this.targetLanguageSelect.innerHTML = '';
    
    // Add fallback options
    languages.forEach(lang => {
      const sourceOption = document.createElement('option');
      sourceOption.value = lang.code;
      sourceOption.textContent = lang.name;
      this.sourceLanguageSelect.appendChild(sourceOption);
      
      if (lang.code !== 'auto') {
        const targetOption = document.createElement('option');
        targetOption.value = lang.code;
        targetOption.textContent = lang.name;
        this.targetLanguageSelect.appendChild(targetOption);
      }
    });
  },

  async loadProviders() {
    try {
      // Load providers from the background script
      const response = await chrome.runtime.sendMessage({ action: 'getProviders' });
      if (response && response.providers) {
        this.renderProviders(response.providers);
      } else {
        // Fallback: create default providers
        const defaultProviders = [
          { id: 'qwen', name: 'Qwen' },
          { id: 'google', name: 'Google' },
          { id: 'deepl', name: 'DeepL' },
          { id: 'openai', name: 'OpenAI' }
        ];
        this.renderProviders(defaultProviders);
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
      // Fallback: create default providers
      const defaultProviders = [
        { id: 'qwen', name: 'Qwen' },
        { id: 'google', name: 'Google' },
        { id: 'deepl', name: 'DeepL' },
        { id: 'openai', name: 'OpenAI' }
      ];
      this.renderProviders(defaultProviders);
    }
  },

  async loadSettings() {
    try {
      const { sourceLanguage, targetLanguage } = await chrome.storage.local.get({ 
        sourceLanguage: 'auto',
        targetLanguage: 'en'
      });
      
      this.sourceLanguageSelect.value = sourceLanguage;
      this.targetLanguageSelect.value = targetLanguage;
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  },

  renderProviders(providers) {
    this.providerGrid.innerHTML = '';
    providers.forEach(provider => {
      const card = document.createElement('div');
      card.className = 'provider-card';
      card.dataset.provider = provider.id;
      card.innerHTML = `<h2>${provider.name}</h2>`;
      this.providerGrid.appendChild(card);
    });
  },

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------
  setupEventListeners() {
    this.themeSelector.addEventListener('change', () => this.handleThemeChange());
    
    // Settings button now opens in the same window (popup context)
    this.settingsButton.addEventListener('click', () => {
      // Instead of opening in a new tab, we could show settings inline
      // or open options page in a new tab but with better UX
      chrome.runtime.openOptionsPage();
    });

    this.providerGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.provider-card');
      if (card) {
        this.setActiveProvider(card.dataset.provider);
      }
    });

    this.translateButton.addEventListener('click', () => this.handleTranslate());

    // Save language preferences when changed
    this.sourceLanguageSelect.addEventListener('change', () => {
      chrome.storage.local.set({ sourceLanguage: this.sourceLanguageSelect.value });
    });
    
    this.targetLanguageSelect.addEventListener('change', () => {
      chrome.storage.local.set({ targetLanguage: this.targetLanguageSelect.value });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.close();
      if (e.ctrlKey && e.key === ',') chrome.runtime.openOptionsPage();
    });
  },

  // --------------------------------------------------------------------------
  // Core Logic
  // --------------------------------------------------------------------------
  setActiveProvider(providerId) {
    this.activeProvider = providerId;
    const cards = this.providerGrid.querySelectorAll('.provider-card');
    cards.forEach(card => {
      card.classList.toggle('active', card.dataset.provider === providerId);
    });
  },

  async handleTranslate() {
    if (!this.activeProvider) {
      alert('Please select a translation provider.');
      return;
    }

    this.loadingOverlay.style.display = 'flex';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, {
        action: 'translatePage',
        provider: this.activeProvider,
        sourceLanguage: this.sourceLanguageSelect.value,
        targetLanguage: this.targetLanguageSelect.value,
      });
      window.close();
    } catch (error) {
      console.error('Translation failed:', error);
      alert('Failed to send translation request. Please check the console for details.');
    } finally {
      this.loadingOverlay.style.display = 'none';
    }
  }
};

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  Popup.initialize();
});

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = Popup;
}