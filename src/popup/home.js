// src/popup/home.js

document.addEventListener('DOMContentLoaded', () => {
  const targetLanguageSelect = document.getElementById('target-language');
  const translateButton = document.getElementById('translate-button');
  const autoTranslateToggle = document.getElementById('auto-translate-toggle');
  const statsDisplay = document.getElementById('stats-display');

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  async function initialize() {
    await loadLanguages();
    await loadSettings();
    setupEventListeners();
    updateStats();
  }

  // --------------------------------------------------------------------------
  // Data Loading
  // --------------------------------------------------------------------------
  async function loadLanguages() {
    try {
      const response = await fetch('../i18n/languages.json');
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
    translateButton.addEventListener('click', handleTranslate);
    autoTranslateToggle.addEventListener('change', handleAutoTranslateToggle);
  }

  // --------------------------------------------------------------------------
  // Core Logic
  // --------------------------------------------------------------------------
  async function handleTranslate() {
    chrome.runtime.sendMessage({
      action: 'home:quick-translate',
      targetLanguage: targetLanguageSelect.value,
    });
  }

  function handleAutoTranslateToggle() {
    chrome.runtime.sendMessage({
      action: 'home:auto-translate',
      enabled: autoTranslateToggle.checked,
    });
  }

  async function updateStats() {
    chrome.runtime.sendMessage({ action: 'home:get-usage' }, response => {
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