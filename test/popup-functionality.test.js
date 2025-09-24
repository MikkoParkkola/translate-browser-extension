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
    sendMessage: jest.fn((message, cb) => {
      let result = {};
      if (message.action === 'getProviders') {
        result = {
          providers: [
            { id: 'qwen', name: 'Qwen' },
            { id: 'google', name: 'Google' },
            { id: 'deepl', name: 'DeepL' },
            { id: 'openai', name: 'OpenAI' }
          ]
        };
      } else if (message.action === 'home:quick-translate') {
        result = { success: true };
      }
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    }),
    openOptionsPage: jest.fn(),
    lastError: null
  },
  tabs: {
    query: jest.fn((queryInfo, cb) => {
      const result = [{ id: 1 }];
      if (typeof cb === 'function') cb(result);
      return Promise.resolve(result);
    }),
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
          <div class="translate-actions">
            <div class="translate-actions__buttons">
              <button id="translate-selection-button" class="translate-button">
                <span class="button-text">Translate Selection</span>
              </button>
              <button id="translate-page-button" class="translate-button translate-button--secondary">
                <span class="button-text">Translate Page</span>
              </button>
            </div>
            <p id="translation-status-text" class="translation-status-text">Ready</p>
          </div>
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
    expect(Popup.translateSelectionButton).toBeTruthy();
    expect(Popup.translatePageButton).toBeTruthy();
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
    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'home:quick-translate' }, expect.any(Function));
    
    // Check that progress tracking was started
    expect(global.window.TranslationProgress.startTranslationSession).toHaveBeenCalled();
  });

  test('should update status text when usage updates', () => {
    const spy = jest.spyOn(Popup, 'updateStatusBadgeFromUsage');
    Popup.handleUsageUpdate({
      usage: { requests: 2, requestLimit: 10, tokens: 20, tokenLimit: 100 },
      active: true,
      providers: { qwen: { model: 'qwen-mt-turbo' } },
    });
    expect(spy).toHaveBeenCalled();
    expect(Popup.translationStatusText.textContent).toContain('Translation in progress');
    spy.mockRestore();
  });

  test('should reflect auto-translate runtime updates', () => {
    Popup.autoTranslateToggle.checked = false;
    Popup.handleAutoTranslateMessage({ enabled: true });
    expect(Popup.autoTranslateToggle.checked).toBe(true);
    expect(Popup.translationStatusText.textContent).toMatch(/Auto-translate enabled/i);
  });

  test('should translate selected text', async () => {
    mockChrome.tabs.sendMessage.mockResolvedValueOnce({});
    await Popup.handleTranslateSelection();
    const [tabId, payload] = mockChrome.tabs.sendMessage.mock.calls[0];
    expect(tabId).toBe(1);
    expect(payload).toEqual(expect.objectContaining({ action: 'translate-selection' }));
    expect(global.window.TranslationProgress.startTranslationSession).toHaveBeenCalledWith(expect.objectContaining({ context: 'selection' }));
    expect(Popup.translationStatusText.textContent).toBe('Ready');
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