// src/popup.js

document.addEventListener('DOMContentLoaded', () => {
  const settingsButton = document.getElementById('settings-button');
  const sourceLanguageSelect = document.getElementById('source-language');
  const targetLanguageSelect = document.getElementById('target-language');
  const translateButton = document.getElementById('translate-button');
  const autoTranslateToggle = document.getElementById('auto-translate-toggle');
  const statsChart = document.getElementById('stats-chart');

  async function initialize() {
    await loadLanguages();
    await loadSettings();
    setupEventListeners();
    updateStats();
  }

  async function loadLanguages() {
    try {
      const response = await fetch('i18n/languages.json');
      if (!response.ok) throw new Error('Failed to load languages');
      const languages = await response.json();
      
      for (const [code, name] of Object.entries(languages)) {
        const option = new Option(name, code);
        sourceLanguageSelect.add(option.cloneNode(true));
        targetLanguageSelect.add(option);
      }
    } catch (error) {
      console.error(error);
      targetLanguageSelect.add(new Option('English', 'en'));
    }
  }

  async function loadSettings() {
    const { autoTranslate, sourceLanguage, targetLanguage } = await chrome.storage.local.get({
      autoTranslate: false,
      sourceLanguage: 'auto',
      targetLanguage: 'en'
    });
    autoTranslateToggle.checked = autoTranslate;
    sourceLanguageSelect.value = sourceLanguage;
    targetLanguageSelect.value = targetLanguage;
  }

  function setupEventListeners() {
    settingsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());
    translateButton.addEventListener('click', handleTranslate);
    autoTranslateToggle.addEventListener('change', handleAutoTranslateToggle);
    sourceLanguageSelect.addEventListener('change', () => chrome.storage.local.set({ sourceLanguage: sourceLanguageSelect.value }));
    targetLanguageSelect.addEventListener('change', () => chrome.storage.local.set({ targetLanguage: targetLanguageSelect.value }));
  }

  async function handleTranslate() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, {
      action: 'translatePage',
      sourceLanguage: sourceLanguageSelect.value,
      targetLanguage: targetLanguageSelect.value,
    });
    window.close();
  }

  function handleAutoTranslateToggle() {
    chrome.storage.local.set({ autoTranslate: autoTranslateToggle.checked });
  }

  function updateStats() {
    chrome.runtime.sendMessage({ action: 'metrics' }, response => {
      if (chrome.runtime.lastError) {
        console.error(chrome.runtime.lastError);
        return;
      }
      renderStatsChart(response.usage || {});
    });
  }

  function renderStatsChart(usage) {
    statsChart.innerHTML = '';
    for (const [key, value] of Object.entries(usage)) {
      const barContainer = document.createElement('div');
      barContainer.className = 'bar-container';
      
      const barLabel = document.createElement('div');
      barLabel.className = 'bar-label';
      barLabel.textContent = key;

      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.width = `${value}%`;

      const barValue = document.createElement('div');
      barValue.className = 'bar-value';
      barValue.textContent = value;

      barContainer.append(barLabel, bar, barValue);
      statsChart.appendChild(barContainer);
    }
  }

  initialize();
});
