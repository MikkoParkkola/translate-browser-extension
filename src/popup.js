// src/popup.js

document.addEventListener('DOMContentLoaded', () => {
  const themeSelector = document.getElementById('theme-selector');
  const settingsButton = document.getElementById('settings-button');
  const providerGrid = document.getElementById('provider-grid');
  const targetLanguageSelect = document.getElementById('target-language');
  const translateButton = document.getElementById('translate-button');
  const loadingOverlay = document.getElementById('loading-overlay');

  let activeProvider = null;

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  async function initialize() {
    await loadTheme();
    await loadLanguages();
    await loadProviders();
    setupEventListeners();
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

  async function loadProviders() {
    try {
      const response = await fetch('providers.json');
      const providers = await response.json();
      providerGrid.innerHTML = '';
      providers.forEach(provider => {
        const card = document.createElement('div');
        card.className = 'provider-card';
        card.dataset.provider = provider.id;
        card.innerHTML = `<h2>${provider.name}</h2>`;
        providerGrid.appendChild(card);
      });
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  }

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    themeSelector.addEventListener('change', handleThemeChange);
    settingsButton.addEventListener('click', () => chrome.runtime.openOptionsPage());

    providerGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.provider-card');
      if (card) {
        setActiveProvider(card.dataset.provider);
      }
    });

    translateButton.addEventListener('click', handleTranslate);

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.close();
      if (e.ctrlKey && e.key === ',') chrome.runtime.openOptionsPage();
    });
  }

  // --------------------------------------------------------------------------
  // Core Logic
  // --------------------------------------------------------------------------
  function setActiveProvider(providerId) {
    activeProvider = providerId;
    const cards = providerGrid.querySelectorAll('.provider-card');
    cards.forEach(card => {
      card.classList.toggle('active', card.dataset.provider === providerId);
    });
  }

  async function handleTranslate() {
    if (!activeProvider) {
      alert('Please select a translation provider.');
      return;
    }

    loadingOverlay.style.display = 'flex';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.tabs.sendMessage(tab.id, {
        action: 'translatePage',
        provider: activeProvider,
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

  initialize();
});