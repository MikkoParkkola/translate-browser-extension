// src/options.js

document.addEventListener('DOMContentLoaded', () => {
  const sourceLanguageSelect = document.getElementById('source-language');

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  async function initialize() {
    await loadLanguages();
    await loadSettings();
    setupEventListeners();
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
      for (const [code, name] of Object.entries(languages)) {
        const option = document.createElement('option');
        option.value = code;
        option.textContent = name;
        sourceLanguageSelect.appendChild(option);
      }
    } catch (error) {
      console.error('Failed to load languages:', error);
    }
  }

  async function loadSettings() {
    const { sourceLanguage } = await chrome.storage.local.get({ sourceLanguage: 'auto' });
    sourceLanguageSelect.value = sourceLanguage;
  }

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    sourceLanguageSelect.addEventListener('change', () => {
      chrome.storage.local.set({ sourceLanguage: sourceLanguageSelect.value });
    });
  }

  initialize();
});
