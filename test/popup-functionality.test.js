// @jest-environment jsdom

const fs = require('fs');
const path = require('path');

// Mock chrome API
const mockChrome = {
  storage: {
    local: {
      get: jest.fn().mockImplementation((defaults, callback) => {
        if (typeof callback === 'function') {
          callback({ theme: 'modern' });
        }
        return Promise.resolve({ theme: 'modern' });
      }),
      set: jest.fn()
    },
    sync: {
      get: jest.fn().mockImplementation((defaults, callback) => {
        if (typeof callback === 'function') {
          callback(defaults);
        }
        return Promise.resolve(defaults);
      })
    }
  },
  runtime: {
    getURL: jest.fn((url) => url),
    sendMessage: jest.fn((message) => {
      if (message.action === 'getProviders') {
        return Promise.resolve({
          providers: [
            { id: 'qwen', name: 'Qwen' },
            { id: 'google', name: 'Google' },
            { id: 'deepl', name: 'DeepL' },
            { id: 'openai', name: 'OpenAI' }
          ]
        });
      }
      return Promise.resolve({});
    }),
    openOptionsPage: jest.fn(),
    lastError: null
  },
  tabs: {
    query: jest.fn(() => Promise.resolve([{ id: 1 }])),
    sendMessage: jest.fn(() => Promise.resolve())
  }
};

global.chrome = mockChrome;

// Mock fetch API
global.fetch = jest.fn((url) => {
  if (url === 'i18n/languages.json') {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        'en': 'English',
        'es': 'Spanish',
        'fr': 'French'
      })
    });
  }
  return Promise.reject(new Error('Not found'));
});

// Mock window.close
global.close = jest.fn();

describe('Popup Functionality', () => {
  let Popup;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create a basic DOM structure
    document.body.innerHTML = `
      <div class="container fade-in">
        <header class="header">
          <h1>Translate</h1>
          <div class="nav-icons">
            <select id="theme-selector">
              <option value="modern">Modern</option>
              <option value="apple">Apple</option>
              <option value="cyberpunk">Cyberpunk</option>
            </select>
            <button id="settings-button" aria-label="Settings">
              <svg></svg>
            </button>
          </div>
        </header>
        <main>
          <div id="provider-grid" class="provider-grid"></div>
          <div class="form-group">
            <label for="source-language">Source Language</label>
            <select id="source-language">
              <option value="auto">Auto Detect</option>
            </select>
          </div>
          <div class="form-group">
            <label for="target-language">Target Language</label>
            <select id="target-language"></select>
          </div>
          <button id="translate-button" class="button-primary">Translate Page</button>
        </main>
      </div>
      <div id="loading-overlay" class="loading-overlay" style="display: none;">
        <div class="spinner"></div>
      </div>
    `;
    
    // Load the popup module
    Popup = require('../src/popup.js');
    
    // Initialize popup properties
    Popup.themeSelector = document.getElementById('theme-selector');
    Popup.settingsButton = document.getElementById('settings-button');
    Popup.providerGrid = document.getElementById('provider-grid');
    Popup.sourceLanguageSelect = document.getElementById('source-language');
    Popup.targetLanguageSelect = document.getElementById('target-language');
    Popup.translateButton = document.getElementById('translate-button');
    Popup.loadingOverlay = document.getElementById('loading-overlay');
    Popup.activeProvider = null;
  });

  test('should load and display providers', async () => {
    await Popup.loadProviders();
    
    // Check that providers were loaded
    expect(Popup.providerGrid.children.length).toBeGreaterThan(0);
    
    // Check that provider cards were created
    const providerCards = Popup.providerGrid.querySelectorAll('.provider-card');
    expect(providerCards.length).toBe(4);
    
    // Check that the first provider card has the correct content
    const firstCard = providerCards[0];
    expect(firstCard.dataset.provider).toBe('qwen');
    expect(firstCard.querySelector('h2').textContent).toBe('Qwen');
  });

  test('should load and display languages', async () => {
    // Mock the language data
    const mockLanguages = [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' }
    ];
    
    Popup.populateLanguageSelects(mockLanguages);
    
    // Check that languages were loaded
    expect(Popup.sourceLanguageSelect.children.length).toBe(4); // auto + 3 languages
    expect(Popup.targetLanguageSelect.children.length).toBe(3); // just 3 languages
    
    // Check that the first language option is correct
    const firstSourceOption = Popup.sourceLanguageSelect.children[0];
    expect(firstSourceOption.value).toBe('auto');
    expect(firstSourceOption.textContent).toBe('Auto Detect');
    
    const firstTargetOption = Popup.targetLanguageSelect.children[0];
    expect(firstTargetOption.value).toBe('en');
    expect(firstTargetOption.textContent).toBe('English');
  });

  test('should handle provider selection', async () => {
    await Popup.loadProviders();
    Popup.setupEventListeners(); // Set up event listeners
    
    // Click on the first provider card
    const firstCard = Popup.providerGrid.querySelector('.provider-card');
    const clickEvent = new MouseEvent('click', {
      bubbles: true,
      cancelable: true
    });
    firstCard.dispatchEvent(clickEvent);
    
    // Check that the provider is now active
    expect(Popup.activeProvider).toBe('qwen');
  });

  test('should handle theme changes', async () => {
    Popup.loadTheme();
    
    // Change theme
    Popup.themeSelector.value = 'cyberpunk';
    Popup.handleThemeChange();
    
    // Check that the theme was saved
    expect(mockChrome.storage.local.set).toHaveBeenCalledWith({ theme: 'cyberpunk' });
  });

  test('should handle translate button click', async () => {
    await Popup.loadProviders();
    await Popup.loadLanguages();
    
    // Select a provider first
    Popup.setActiveProvider('qwen');
    
    // Set up source language
    Popup.sourceLanguageSelect.innerHTML = '<option value="auto">Auto Detect</option>';
    Popup.targetLanguageSelect.innerHTML = '<option value="en">English</option>';
    
    // Call handleTranslate
    await Popup.handleTranslate();
    
    // Check that the translation message was sent
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      {
        action: 'translatePage',
        provider: 'qwen',
        sourceLanguage: 'auto',
        targetLanguage: 'en',
      }
    );
  });

  test('should show error when trying to translate without selecting provider', async () => {
    // Mock alert
    const alertMock = jest.spyOn(window, 'alert').mockImplementation();
    
    // Call handleTranslate without selecting provider
    await Popup.handleTranslate();
    
    // Check that alert was shown
    expect(alertMock).toHaveBeenCalledWith('Please select a translation provider.');
    
    // Restore alert
    alertMock.mockRestore();
  });

  test('should handle fetch errors gracefully', async () => {
    // Test fallback language loading
    Popup.populateLanguageSelectsWithFallback();
    
    // Check that languages still loaded (from fallback)
    expect(Popup.sourceLanguageSelect.children.length).toBe(11); // auto + 10 languages
    expect(Popup.targetLanguageSelect.children.length).toBe(10); // just 10 languages
    
    // Load providers with fallback
    await Popup.loadProviders();
    
    // Check that providers still loaded (from fallback)
    expect(Popup.providerGrid.children.length).toBe(4); // 4 default providers
  });
  
  test('should apply theme correctly', () => {
    // Test modern theme (no additional stylesheet)
    Popup.applyTheme('modern');
    expect(document.querySelectorAll('link[data-theme]').length).toBe(0);
    expect(document.body.classList.contains('dark')).toBe(false);
    
    // Test cyberpunk theme (adds stylesheet and dark class)
    Popup.applyTheme('cyberpunk');
    expect(document.querySelectorAll('link[data-theme]').length).toBe(1);
    expect(document.body.classList.contains('dark')).toBe(true);
    
    // Test apple theme (adds stylesheet but no dark class)
    Popup.applyTheme('apple');
    expect(document.querySelectorAll('link[data-theme]').length).toBe(1);
    expect(document.body.classList.contains('dark')).toBe(false);
  });
});