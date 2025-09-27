// Lightweight popup controller to support unit tests and runtime basics

const DEFAULT_LANGUAGES = [
  { code: 'auto', name: 'Auto Detect' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'zh', name: 'Chinese' }
];

function isPromise(value) {
  return value && typeof value.then === 'function';
}

async function callChrome(fn, ...args) {
  if (typeof fn !== 'function') return undefined;
  const result = fn(...args);
  if (isPromise(result)) {
    return await result;
  }
  return result;
}

const Popup = {
  initialized: false,
  currentTheme: 'light',

  async initialize() {
    if (this.initialized) return;
    this.cacheDom();
    this.bindEvents();
    this.populateLanguageSelectsWithFallback();
    await Promise.all([this.loadLanguages(), this.loadTheme()]);
    if (this.translationStatusText && !this.translationStatusText.textContent) {
      this.translationStatusText.textContent = 'Ready';
    }
    this.initialized = true;
  },

  cacheDom() {
    this.translateSelectionButton = document.getElementById('translate-selection-button');
    this.translatePageButton = document.getElementById('translate-page-button');
    this.sourceLanguageSelect = document.getElementById('source-language');
    this.targetLanguageSelect = document.getElementById('target-language');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.translationStatusText = document.getElementById('translation-status-text');
    this.autoTranslateToggle = document.getElementById('auto-translate-toggle');
    this.themeToggle = document.getElementById('theme-toggle');
    this.statsRefreshButton = document.getElementById('stats-refresh');
  },

  bindEvents() {
    if (this.translatePageButton) {
      this.translatePageButton.addEventListener('click', () => this.handleTranslate());
    }
    if (this.translateSelectionButton) {
      this.translateSelectionButton.addEventListener('click', () => this.handleTranslateSelection());
    }
    if (this.autoTranslateToggle) {
      this.autoTranslateToggle.addEventListener('change', () => {
        const enabled = !!this.autoTranslateToggle.checked;
        this.handleAutoTranslateMessage({ enabled });
      });
    }
    if (this.themeToggle) {
      this.themeToggle.addEventListener('click', () => this.handleThemeToggle());
    }
  },

  async loadLanguages() {
    if (!this.sourceLanguageSelect || !this.targetLanguageSelect) return;
    try {
      const response = await fetch('i18n/languages.json');
      if (!response.ok) throw new Error('Language fetch failed');
      const data = await response.json();
      if (!data || typeof data !== 'object') throw new Error('Invalid language data');
      this.populateLanguageSelects(data);
    } catch (_) {
      // Fallback already populated in initialize
    }
  },

  populateLanguageSelects(languageMap) {
    if (!this.sourceLanguageSelect || !this.targetLanguageSelect) return;
    this.sourceLanguageSelect.innerHTML = '';
    this.targetLanguageSelect.innerHTML = '';

    const autoOption = document.createElement('option');
    autoOption.value = 'auto';
    autoOption.textContent = 'Auto Detect';
    this.sourceLanguageSelect.appendChild(autoOption);

    const entries = Object.entries(languageMap);
    entries.forEach(([code, name]) => {
      if (code === 'auto') return;
      const sourceOption = document.createElement('option');
      sourceOption.value = code;
      sourceOption.textContent = name;
      this.sourceLanguageSelect.appendChild(sourceOption);

      if (code !== 'auto' && this.targetLanguageSelect) {
        const targetOption = document.createElement('option');
        targetOption.value = code;
        targetOption.textContent = name;
        this.targetLanguageSelect.appendChild(targetOption);
      }
    });

    if (this.sourceLanguageSelect && !this.sourceLanguageSelect.value) {
      this.sourceLanguageSelect.value = 'auto';
    }
    if (this.targetLanguageSelect && !this.targetLanguageSelect.value && this.targetLanguageSelect.options.length) {
      this.targetLanguageSelect.selectedIndex = 0;
    }
  },

  populateLanguageSelectsWithFallback() {
    if (!this.sourceLanguageSelect || !this.targetLanguageSelect) return;
    this.sourceLanguageSelect.innerHTML = '';
    this.targetLanguageSelect.innerHTML = '';

    DEFAULT_LANGUAGES.forEach(({ code, name }) => {
      const sourceOption = document.createElement('option');
      sourceOption.value = code;
      sourceOption.textContent = name;
      this.sourceLanguageSelect.appendChild(sourceOption);

      if (code !== 'auto') {
        const targetOption = document.createElement('option');
        targetOption.value = code;
        targetOption.textContent = name;
        this.targetLanguageSelect.appendChild(targetOption);
      }
    });

    this.sourceLanguageSelect.value = 'auto';
    if (this.targetLanguageSelect.options.length) {
      this.targetLanguageSelect.selectedIndex = 0;
    }
  },

  async loadTheme() {
    if (!chrome?.storage?.local?.get) {
      this.applyTheme('light');
      return;
    }
    const data = await new Promise(resolve => {
      const result = chrome.storage.local.get({ theme: 'light' }, resolve);
      if (isPromise(result)) {
        result.then(resolve);
      }
    });
    const theme = data?.theme || 'light';
    this.currentTheme = theme;
    this.applyTheme(theme);
  },

  applyTheme(theme) {
    this.currentTheme = theme;
    document.body.classList.toggle('dark', theme === 'dark');
    if (this.themeToggle) {
      const lightIcon = this.themeToggle.querySelector('.theme-icon-light');
      const darkIcon = this.themeToggle.querySelector('.theme-icon-dark');
      if (lightIcon && darkIcon) {
        lightIcon.style.display = theme === 'dark' ? 'none' : '';
        darkIcon.style.display = theme === 'dark' ? '' : 'none';
      }
    }
  },

  async handleThemeToggle() {
    const nextTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme(nextTheme);
    if (chrome?.storage?.local?.set) {
      const result = chrome.storage.local.set({ theme: nextTheme }, () => {});
      if (isPromise(result)) await result;
    }
  },

  setStatusText(text) {
    if (this.translationStatusText) {
      this.translationStatusText.textContent = text;
    }
  },

  showLoading(show) {
    if (!this.loadingOverlay) return;
    this.loadingOverlay.style.display = show ? 'flex' : 'none';
  },

  async handleTranslate() {
    try {
      this.showLoading(true);
      const payload = { action: 'home:quick-translate' };
      if (chrome?.runtime?.sendMessage) {
        await new Promise(resolve => {
          const maybePromise = chrome.runtime.sendMessage(payload, resolve);
          if (isPromise(maybePromise)) maybePromise.then(resolve);
        });
      }
      if (window?.TranslationProgress?.startTranslationSession) {
        window.TranslationProgress.startTranslationSession({ context: 'quick' });
      }
    } finally {
      this.showLoading(false);
    }
  },

  async handleTranslateSelection() {
    const tabs = await new Promise(resolve => {
      if (!chrome?.tabs?.query) return resolve([]);
      const maybePromise = chrome.tabs.query({}, resolve);
      if (isPromise(maybePromise)) maybePromise.then(resolve);
    });

    const activeTab = Array.isArray(tabs) ? tabs[0] : null;
    if (!activeTab || !chrome?.tabs?.sendMessage) return;

    await new Promise(resolve => {
      const maybePromise = chrome.tabs.sendMessage(activeTab.id, { action: 'translate-selection' }, {}, resolve);
      if (isPromise(maybePromise)) maybePromise.then(resolve);
    });

    if (window?.TranslationProgress?.startTranslationSession) {
      window.TranslationProgress.startTranslationSession({ context: 'selection' });
    }

    this.setStatusText('Ready');
  },

  handleUsageUpdate(payload = {}) {
    this.updateStatusBadgeFromUsage(payload);
  },

  updateStatusBadgeFromUsage({ usage = {}, active = false } = {}) {
    if (!this.translationStatusText) return;
    if (active) {
      const requests = usage.requests ?? 0;
      const requestLimit = usage.requestLimit ?? 0;
      this.translationStatusText.textContent = `Translation in progress (${requests}/${requestLimit} requests)`;
    } else {
      this.translationStatusText.textContent = 'Ready';
    }
  },

  async handleAutoTranslateMessage({ enabled }) {
    if (this.autoTranslateToggle) {
      this.autoTranslateToggle.checked = !!enabled;
    }
    this.setStatusText(enabled ? 'Auto-translate enabled' : 'Auto-translate disabled');
    if (chrome?.storage?.sync?.set) {
      const maybePromise = chrome.storage.sync.set({ autoTranslate: !!enabled }, () => {});
      if (isPromise(maybePromise)) await maybePromise;
    }

    if (chrome?.tabs?.query && chrome?.tabs?.sendMessage) {
      const tabs = await new Promise(resolve => {
        const maybePromise = chrome.tabs.query({}, resolve);
        if (isPromise(maybePromise)) maybePromise.then(resolve);
      });
      (tabs || []).forEach(tab => {
        chrome.tabs.sendMessage(tab.id, { action: enabled ? 'start' : 'stop' }, {}, () => {});
      });
    }
  }
};

if (typeof chrome !== 'undefined' && chrome?.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.action) return;
    if (message.action === 'home:auto-translate') {
      Popup.handleAutoTranslateMessage(message).then(() => sendResponse && sendResponse());
      return true;
    }
    if (message.action === 'usage') {
      Popup.handleUsageUpdate(message);
      sendResponse && sendResponse();
    }
  });
}

if (typeof window !== 'undefined') {
  window.Popup = Popup;
}

module.exports = Popup;
