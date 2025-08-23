// src/popup.js

document.addEventListener('DOMContentLoaded', () => {
  const themeSelector = document.getElementById('theme-selector');
  const settingsButton = document.getElementById('settings-button');
  const targetLanguageSelect = document.getElementById('target-language');
  const translateButton = document.getElementById('translate-button');
  const loadingOverlay = document.getElementById('loading-overlay');
  const autoTranslateToggle = document.getElementById('auto-translate-toggle');
  const statsDisplay = document.getElementById('stats-display');

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  async function initialize() {
    await loadTheme();
    await loadLanguages();
    await loadSettings();
    setupEventListeners();
    updateStats();
  }

  // --------------------------------------------------------------------------
  // Theme Management
  // --------------------------------------------------------------------------
  async function loadTheme() {
    const { theme } = await chrome.storage.local.get({ theme: 'modern' });
    themeSelector.value = theme;
    applyTheme(theme);
  }

  function applyTheme(theme) {
    document.querySelectorAll('link[data-theme]').forEach(link => link.remove());
    if (theme !== 'modern') {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `styles/${theme}.css`;
      link.dataset.theme = theme;
      document.head.appendChild(link);
    }
    if (theme === 'cyberpunk') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  }

  function handleThemeChange() {
    const newTheme = themeSelector.value;
    applyTheme(newTheme);
    chrome.storage.local.set({ theme: newTheme });
  }

  // --------------------------------------------------------------------------
  // Data Loading
  // --------------------------------------------------------------------------
  async function loadLanguages() {
    try {
      const response = await fetch('i18n/languages.json');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const languages = await response.json();
      targetLanguageSelect.innerHTML = ''; // Clear existing options
      for (const [code, name] of Object.entries(languages)) {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = name;
        targetLanguageSelect.appendChild(option);
      }
    } catch (error) {
      console.error('Failed to load languages:', error);
      // Add a fallback option
      const option = document.createElement('option');
      option.value = 'en';
      option.textContent = 'English';
      targetLanguageSelect.appendChild(option);
    }
  }

  async function loadSettings() {
    const { autoTranslate, targetLanguage } = await chrome.storage.local.get({ autoTranslate: false, targetLanguage: 'en' });
    autoTranslateToggle.checked = autoTranslate;
    targetLanguageSelect.value = targetLanguage;
  }

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    themeSelector.addEventListener('change', handleThemeChange);
    settingsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());
    translateButton.addEventListener('click', handleTranslate);
    autoTranslateToggle.addEventListener('change', handleAutoTranslateToggle);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.close();
      if (e.ctrlKey && e.key === ',') chrome.runtime.openOptionsPage();
    });
  }

  // --------------------------------------------------------------------------
  // Core Logic
  // --------------------------------------------------------------------------
  async function handleTranslate() {
    loadingOverlay.style.display = 'flex';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, {
        action: 'translatePage',
        targetLanguage: targetLanguageSelect.value,
      });
      window.close();
    } catch (error) {
      console.error('Translation failed:', error);
      alert('Failed to send translation request. Please check the console for details.');
    } finally {
      loadingOverlay.style.display = 'none';
    }
  }

  function handleAutoTranslateToggle() {
    chrome.storage.local.set({ autoTranslate: autoTranslateToggle.checked });
  }

  async function updateStats() {
    chrome.runtime.sendMessage({ action: 'metrics' }, response => {
      if (chrome.runtime.lastError) {
        console.error('Failed to get metrics:', chrome.runtime.lastError);
        statsDisplay.textContent = 'Error loading stats.';
        return;
      }
      
      if (response && response.usage) {
        statsDisplay.textContent = JSON.stringify(response.usage, null, 2);
      } else {
        statsDisplay.textContent = 'No usage data available.';
      }
    });
  }

  initialize();
});
