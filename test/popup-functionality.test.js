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
      if (message.action === 'home:quick-translate') {
        return Promise.resolve({ success: true });
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

// Mock popup dependencies
global.window.OnboardingWizard = {
  init: jest.fn().mockResolvedValue()
};
global.window.IntelligentLanguageSelection = {
  enhanceLanguageSelectors: jest.fn().mockResolvedValue(),
  recordLanguagePair: jest.fn()
};
global.window.TranslationProgress = {
  addProgressCallback: jest.fn(),
  startTranslationSession: jest.fn(),
  getCurrentSession: jest.fn().mockReturnValue(null),
  handleTranslationError: jest.fn()
};

describe('Popup Functionality', () => {
  let Popup;
  
  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create DOM structure matching the actual popup.html
    document.body.innerHTML = `
      <div id="loading-overlay" class="loading-overlay" style="display: none;">
        <div class="loading-content">
          <div class="loading-spinner"></div>
          <div class="loading-text">Translating...</div>
        </div>
      </div>
      <div class="popup-container">
        <header class="popup-header">
          <div class="popup-title">
            <h1>Translator</h1>
          </div>
          <div class="popup-actions">
            <button id="theme-toggle" class="icon-button" aria-label="Toggle theme">
              <svg class="theme-icon-light" width="20" height="20"></svg>
              <svg class="theme-icon-dark" width="20" height="20" style="display: none;"></svg>
            </button>
            <button id="settings-button" class="icon-button" aria-label="Settings">
              <svg></svg>
            </button>
          </div>
        </header>
        <main class="popup-main">
          <div class="language-selection">
            <select id="source-language" class="language-select">
              <option value="auto">Auto Detect</option>
            </select>
            <button id="swap-languages" class="swap-button"></button>
            <select id="target-language" class="language-select"></select>
          </div>
          <div class="feature-toggle">
            <label class="modern-toggle">
              <input type="checkbox" id="auto-translate-toggle">
              <span class="toggle-slider"></span>
            </label>
          </div>
          <button id="translate-button" class="translate-button">
            <span class="button-text">Translate Page</span>
          </button>
          <div class="stats-section">
            <button id="stats-refresh" class="stats-refresh-btn"></button>
            <div id="stats-chart" class="stats-chart"></div>
          </div>
          <div id="source-confidence" style="display: none;"></div>
        </main>
      </div>
    `;
    
    // Load the popup module
    Popup = require('../src/popup.js');
    
    // Initialize the popup (this will set up element references)
    await Popup.initialize();
  });

  test('should initialize popup elements', async () => {
    // Check that popup was initialized and elements were found
    expect(Popup.translateButton).toBeTruthy();
    expect(Popup.sourceLanguageSelect).toBeTruthy();
    expect(Popup.targetLanguageSelect).toBeTruthy();
    expect(Popup.loadingOverlay).toBeTruthy();
  });

  test('should load languages from fallback', async () => {
    // The popup should load languages during initialization
    await Popup.loadLanguages();
    
    // Check that languages were loaded (fallback should have basic languages)
    const sourceOptions = Popup.sourceLanguageSelect.children;
    const targetOptions = Popup.targetLanguageSelect.children;
    
    expect(sourceOptions.length).toBeGreaterThan(1); // at least auto + some languages
    expect(targetOptions.length).toBeGreaterThan(0); // at least some languages
    
    // Check that auto detect is available for source
    const autoOption = Array.from(sourceOptions).find(opt => opt.value === 'auto');
    expect(autoOption).toBeTruthy();
  });

  test('should handle theme toggle', async () => {
    // Theme should be initialized during popup init
    await Popup.loadTheme();
    
    // Toggle theme
    Popup.handleThemeToggle();
    
    // Check that the theme was saved (should toggle from light to dark or vice versa)
    expect(mockChrome.storage.local.set).toHaveBeenCalled();
    const setCall = mockChrome.storage.local.set.mock.calls[0][0];
    expect(setCall.theme).toBeDefined();
    expect(['light', 'dark'].includes(setCall.theme)).toBe(true);
  });

  test('should handle translate button click', async () => {
    // Set up languages
    Popup.sourceLanguageSelect.innerHTML = '<option value="auto" selected>Auto Detect</option>';
    Popup.targetLanguageSelect.innerHTML = '<option value="en" selected>English</option>';
    
    // Call handleTranslate
    await Popup.handleTranslate();
    
    // Check that the translation message was sent to background script
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'home:quick-translate' });
    
    // Check that progress tracking was started
    expect(global.window.TranslationProgress.startTranslationSession).toHaveBeenCalled();
  });

  test('should handle fallback language loading', async () => {
    // Test fallback language loading
    Popup.populateLanguageSelectsWithFallback();
    
    // Check that languages were loaded from fallback
    expect(Popup.sourceLanguageSelect.children.length).toBeGreaterThan(1);
    expect(Popup.targetLanguageSelect.children.length).toBeGreaterThan(0);
    
    // Check that basic languages are present
    const sourceOptions = Array.from(Popup.sourceLanguageSelect.children);
    const autoOption = sourceOptions.find(opt => opt.value === 'auto');
    expect(autoOption).toBeTruthy();
  });
  
  test('should apply theme correctly', () => {
    // Test light theme (default)
    Popup.applyTheme('light');
    expect(document.body.classList.contains('dark')).toBe(false);
    
    // Test dark theme
    Popup.applyTheme('dark');
    expect(document.body.classList.contains('dark')).toBe(true);
  });
});