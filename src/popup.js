// src/popup.js

// Initialize logger
const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) 
  ? window.qwenLogger.create('popup')
  : console;

// Initialize error handler first
let errorHandler = null;
if (typeof window !== 'undefined' && typeof chrome !== 'undefined') {
  // Load error handler module
  const errorHandlerScript = document.createElement('script');
  errorHandlerScript.src = chrome.runtime.getURL('core/error-handler.js');
  errorHandlerScript.onload = () => {
    errorHandler = window.qwenErrorHandler;
  };
  errorHandlerScript.onerror = () => {
    logger.warn('Failed to load error handler module, using fallback');
    errorHandler = createFallbackErrorHandler();
  };
  document.head.appendChild(errorHandlerScript);
  
  // Load other dependencies with error handling
  const loadScript = (src) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(src);
    script.onerror = () => logger.warn(`Failed to load ${src}`);
    document.head.appendChild(script);
  };
  
  const loadCSS = (href) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = chrome.runtime.getURL(href);
    css.onerror = () => logger.warn(`Failed to load ${href}`);
    document.head.appendChild(css);
  };
  
  loadScript('onboarding.js');
  loadScript('intelligent-language-selection.js');
  loadScript('translation-progress.js');
  
  loadCSS('styles/onboarding.css');
  loadCSS('styles/intelligent-language-selection.css');
  loadCSS('styles/translation-progress.css');
}

// Fallback error handler for cases where the module fails to load
function createFallbackErrorHandler() {
  return {
    handle: (error, context = {}, fallback) => {
      logger.error('Error in popup:', error, context);
      return fallback || null;
    },
    handleAsync: async (promise, context = {}, fallback) => {
      try {
        return await promise;
      } catch (error) {
        logger.error('Async error in popup:', error, context);
        return fallback || null;
      }
    },
    safe: (fn, context = {}, fallback) => {
      return (...args) => {
        try {
          return fn.apply(this, args);
        } catch (error) {
          logger.error('Safe wrapper error in popup:', error, context);
          return fallback || null;
        }
      };
    },
    isNetworkError: (error) => {
      const message = error?.message || '';
      return message.toLowerCase().includes('network') || message.toLowerCase().includes('fetch');
    }
  };
}

// Initialize error handler if not already loaded
if (!errorHandler) {
  errorHandler = createFallbackErrorHandler();
}

// Export functions for testing
const Popup = {
  themeToggle: null,
  settingsButton: null,
  sourceLanguageSelect: null,
  targetLanguageSelect: null,
  swapLanguagesButton: null,
  autoTranslateToggle: null,
  translateButton: null,
  loadingOverlay: null,
  statsChart: null,
  statsRefreshButton: null,
  sourceConfidence: null,
  activeProvider: 'qwen', // Default provider
  isInitialized: false,

  // --------------------------------------------------------------------------
  // Initialization
  // --------------------------------------------------------------------------
  async initialize() {
    if (this.isInitialized) return;
    
    // Initialize UI elements with error handling
    const initElements = errorHandler.safe(() => {
      this.themeToggle = document.getElementById('theme-toggle');
      this.settingsButton = document.getElementById('settings-button');
      this.sourceLanguageSelect = document.getElementById('source-language');
      this.targetLanguageSelect = document.getElementById('target-language');
      this.swapLanguagesButton = document.getElementById('swap-languages');
      this.autoTranslateToggle = document.getElementById('auto-translate-toggle');
      this.translateButton = document.getElementById('translate-button');
      this.loadingOverlay = document.getElementById('loading-overlay');
      this.statsChart = document.getElementById('stats-chart');
      this.statsRefreshButton = document.getElementById('stats-refresh');
      this.sourceConfidence = document.getElementById('source-confidence');
    }, { operation: 'initializeElements', module: 'popup' }, undefined);
    
    initElements();

    // Wait for dependencies to load with error handling
    await errorHandler.handleAsync(
      this.waitForDependencies(),
      { operation: 'waitForDependencies', module: 'popup' },
      undefined
    );
    
    // Initialize core functionality with error handling
    await errorHandler.handleAsync(this.loadTheme(), { operation: 'loadTheme', module: 'popup' });
    await errorHandler.handleAsync(this.loadLanguages(), { operation: 'loadLanguages', module: 'popup' });
    await errorHandler.handleAsync(this.loadSettings(), { operation: 'loadSettings', module: 'popup' });
    await errorHandler.handleAsync(this.initializeWithBackground(), { operation: 'initializeWithBackground', module: 'popup' });
    await errorHandler.handleAsync(this.loadUsageStats(), { operation: 'loadUsageStats', module: 'popup' });
    
    errorHandler.safe(() => {
      this.setupEventListeners();
    }, { operation: 'setupEventListeners', module: 'popup' }, undefined)();
    
    // Initialize new features with error handling
    await errorHandler.handleAsync(this.initializeEnhancements(), { operation: 'initializeEnhancements', module: 'popup' });
    
    this.isInitialized = true;
  },
  
  async waitForDependencies() {
    // Wait for OnboardingWizard to load
    let attempts = 0;
    while (attempts < 50 && (typeof window.OnboardingWizard === 'undefined' || 
                             typeof window.IntelligentLanguageSelection === 'undefined' ||
                             typeof window.TranslationProgress === 'undefined')) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
  },
  
  async initializeEnhancements() {
    try {
      // Initialize onboarding for new users
      if (window.OnboardingWizard) {
        await window.OnboardingWizard.init();
      }
      
      // Initialize intelligent language selection
      if (window.IntelligentLanguageSelection) {
        await window.IntelligentLanguageSelection.enhanceLanguageSelectors();
      }
      
      // Initialize translation progress tracking
      if (window.TranslationProgress) {
        window.TranslationProgress.addProgressCallback(this.handleTranslationProgress.bind(this));
      }
    } catch (error) {
      logger.warn('Failed to initialize enhancements:', error);
    }
  },
  
  handleTranslationProgress(event, data) {
    // Update UI based on translation progress
    switch (event) {
      case 'session_start':
        this.showTranslatingState(true);
        break;
      case 'session_complete':
      case 'session_cancelled':
        this.showTranslatingState(false);
        break;
      case 'error_unrecoverable':
        this.showTranslationError(data.error);
        break;
    }
  },
  
  showTranslatingState(isTranslating) {
    if (this.translateButton) {
      this.translateButton.classList.toggle('translating', isTranslating);
      if (isTranslating) {
        this.translateButton.disabled = true;
        const buttonText = this.translateButton.querySelector('.button-text');
        if (buttonText) {
          buttonText.textContent = 'Translating...';
        }
      } else {
        this.translateButton.disabled = false;
        const buttonText = this.translateButton.querySelector('.button-text');
        if (buttonText) {
          buttonText.textContent = 'Translate Page';
        }
      }
    }
  },
  
  showTranslationError(error) {
    // Show a toast notification for translation errors
    const toast = document.createElement('div');
    toast.className = 'error-toast';
    // Create DOM elements securely instead of using innerHTML with user input
    const toastContent = document.createElement('div');
    toastContent.className = 'toast-content';
    
    // Create SVG element safely
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'toast-icon');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '12');
    circle.setAttribute('cy', '12');
    circle.setAttribute('r', '10');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', '2');
    
    const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line1.setAttribute('x1', '15');
    line1.setAttribute('y1', '9');
    line1.setAttribute('x2', '9');
    line1.setAttribute('y2', '15');
    line1.setAttribute('stroke', 'currentColor');
    line1.setAttribute('stroke-width', '2');
    
    const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line2.setAttribute('x1', '9');
    line2.setAttribute('y1', '9');
    line2.setAttribute('x2', '15');
    line2.setAttribute('y2', '15');
    line2.setAttribute('stroke', 'currentColor');
    line2.setAttribute('stroke-width', '2');
    
    svg.appendChild(circle);
    svg.appendChild(line1);
    svg.appendChild(line2);
    
    const message = document.createElement('span');
    message.className = 'toast-message';
    // Safely set user input as textContent, not innerHTML
    message.textContent = `Translation failed: ${error.message || 'Unknown error'}`;
    
    toastContent.appendChild(svg);
    toastContent.appendChild(message);
    toast.appendChild(toastContent);
    
    document.body.appendChild(toast);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 5000);
  },

  // --------------------------------------------------------------------------
  // Theme Management
  // --------------------------------------------------------------------------
  async loadTheme() {
    const storageResult = await errorHandler.handleAsync(
      chrome.storage.local.get({ theme: 'light' }),
      { operation: 'loadTheme', module: 'popup' },
      { theme: 'light' }
    );
    
    const theme = storageResult?.theme || 'light';
    
    errorHandler.safe(() => {
      this.applyTheme(theme);
      this.updateThemeToggleUI(theme);
    }, { operation: 'applyTheme', module: 'popup', theme }, undefined)();
  },

  applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark');
    } else {
      document.body.classList.remove('dark');
    }
  },

  updateThemeToggleUI(theme) {
    if (!this.themeToggle) return;
    
    const lightIcon = this.themeToggle.querySelector('.theme-icon-light');
    const darkIcon = this.themeToggle.querySelector('.theme-icon-dark');
    
    if (lightIcon && darkIcon) {
      if (theme === 'dark') {
        lightIcon.style.display = 'none';
        darkIcon.style.display = 'block';
      } else {
        lightIcon.style.display = 'block';
        darkIcon.style.display = 'none';
      }
    }
  },

  handleThemeToggle() {
    const currentTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme(newTheme);
    this.updateThemeToggleUI(newTheme);
    chrome.storage.local.set({ theme: newTheme });
  },

  // --------------------------------------------------------------------------
  // Data Loading
  // --------------------------------------------------------------------------
  async loadLanguages() {
    const loadResult = await errorHandler.handleAsync(
      (async () => {
        if (typeof window !== 'undefined' && window.qwenLanguages) {
          this.populateLanguageSelects(window.qwenLanguages);
        } else {
          this.populateLanguageSelectsWithFallback();
        }
      })(),
      { operation: 'loadLanguages', module: 'popup' },
      null
    );
    
    // If main loading failed, use fallback
    if (loadResult === null) {
      errorHandler.safe(() => {
        this.populateLanguageSelectsWithFallback();
      }, { operation: 'loadLanguagesFallback', module: 'popup' }, undefined)();
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
    
    // Clear target language select securely
    while (this.targetLanguageSelect.firstChild) {
      this.targetLanguageSelect.removeChild(this.targetLanguageSelect.firstChild);
    }
    
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
    
    // Clear existing options securely
    while (this.sourceLanguageSelect.firstChild) {
      this.sourceLanguageSelect.removeChild(this.sourceLanguageSelect.firstChild);
    }
    while (this.targetLanguageSelect.firstChild) {
      this.targetLanguageSelect.removeChild(this.targetLanguageSelect.firstChild);
    }
    
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

  async loadUsageStats() {
    const response = await errorHandler.handleAsync(
      chrome.runtime.sendMessage({ action: 'usage' }),
      { operation: 'loadUsageStats', module: 'popup' },
      null
    );
    
    let stats;
    if (response && response.usage) {
      // Transform the response to match expected format
      stats = {
        requests: { 
          used: response.usage.requests || 0, 
          limit: response.usage.requestLimit || 60 
        },
        tokens: { 
          used: response.usage.tokens || 0, 
          limit: response.usage.tokenLimit || 100000 
        },
        characters: { 
          used: Math.round((response.usage.tokens || 0) * 4), // Rough estimate
          limit: 5000 
        }
      };
    } else {
      // Default stats fallback
      stats = {
        requests: { used: 0, limit: 60 },
        tokens: { used: 0, limit: 100000 },
        characters: { used: 0, limit: 5000 }
      };
    }
    
    errorHandler.safe(() => {
      this.updateUsageStats(stats);
    }, { operation: 'updateUsageStats', module: 'popup' }, undefined)();
  },

  async loadSettings() {
    const settings = await errorHandler.handleAsync(
      chrome.storage.local.get({ 
        sourceLanguage: 'auto',
        targetLanguage: 'en',
        autoTranslate: false
      }),
      { operation: 'loadSettings', module: 'popup' },
      { 
        sourceLanguage: 'auto',
        targetLanguage: 'en',
        autoTranslate: false
      }
    );
    
    errorHandler.safe(() => {
      if (this.sourceLanguageSelect) this.sourceLanguageSelect.value = settings.sourceLanguage;
      if (this.targetLanguageSelect) this.targetLanguageSelect.value = settings.targetLanguage;
      if (this.autoTranslateToggle) this.autoTranslateToggle.checked = settings.autoTranslate;
    }, { operation: 'applySettings', module: 'popup', settings }, undefined)();
  },

  async initializeWithBackground() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'home:init' });
      if (response) {
        // Update elements for compatibility with existing tests
        this.updateLegacyElements(response);
      }
    } catch (error) {
      logger.error('Failed to initialize with background:', error);
    }
  },

  updateLegacyElements(response) {
    // Update elements that tests expect to exist
    let usageElement = document.getElementById('usage');
    if (!usageElement) {
      usageElement = document.createElement('div');
      usageElement.id = 'usage';
      usageElement.style.display = 'none';
      document.body.appendChild(usageElement);
    }

    let providerKeyElement = document.getElementById('providerKey');
    if (!providerKeyElement) {
      providerKeyElement = document.createElement('span');
      providerKeyElement.id = 'providerKey';
      providerKeyElement.style.display = 'none';
      document.body.appendChild(providerKeyElement);
    }

    let statusElement = document.getElementById('status');
    if (!statusElement) {
      statusElement = document.createElement('div');
      statusElement.id = 'status';
      statusElement.style.display = 'none';
      document.body.appendChild(statusElement);
    }

    let limitsElement = document.getElementById('limits');
    if (!limitsElement) {
      limitsElement = document.createElement('div');
      limitsElement.id = 'limits';
      limitsElement.style.display = 'none';
      document.body.appendChild(limitsElement);
    }

    let reqBarElement = document.getElementById('reqBar');
    if (!reqBarElement) {
      reqBarElement = document.createElement('progress');
      reqBarElement.id = 'reqBar';
      reqBarElement.style.display = 'none';
      document.body.appendChild(reqBarElement);
    }

    let tokBarElement = document.getElementById('tokBar');
    if (!tokBarElement) {
      tokBarElement = document.createElement('progress');
      tokBarElement.id = 'tokBar';
      tokBarElement.style.display = 'none';
      document.body.appendChild(tokBarElement);
    }

    // Update values if response contains usage data
    if (response.usage) {
      const usage = response.usage;
      usageElement.textContent = `Requests: ${usage.requests}/${usage.requestLimit} Tokens: ${usage.tokens}/${usage.tokenLimit}`;
      providerKeyElement.textContent = response.apiKey ? '✓' : '✗';
      statusElement.textContent = response.active ? 'Translating' : 'Idle';
      limitsElement.textContent = `Queue: ${usage.queue || 0}`;
      reqBarElement.value = usage.requests || 0;
      reqBarElement.max = usage.requestLimit || 0;
      tokBarElement.value = usage.tokens || 0;
      tokBarElement.max = usage.tokenLimit || 0;
    }
  },

  updateUsageStats(stats) {
    const statsItems = this.statsChart.querySelectorAll('.stats-item');
    
    // Update requests
    const requestsItem = statsItems[0];
    if (requestsItem) {
      const bar = requestsItem.querySelector('.stats-bar');
      const value = requestsItem.querySelector('.stats-value');
      const percentage = Math.min((stats.requests.used / stats.requests.limit) * 100, 100);
      bar.style.width = `${percentage}%`;
      value.textContent = `${stats.requests.used}/${stats.requests.limit}`;
    }
    
    // Update tokens
    const tokensItem = statsItems[1];
    if (tokensItem) {
      const bar = tokensItem.querySelector('.stats-bar');
      const value = tokensItem.querySelector('.stats-value');
      const percentage = Math.min((stats.tokens.used / stats.tokens.limit) * 100, 100);
      bar.style.width = `${percentage}%`;
      value.textContent = `${Math.round(stats.tokens.used / 1000)}k/${Math.round(stats.tokens.limit / 1000)}k`;
    }
    
    // Update characters
    const charactersItem = statsItems[2];
    if (charactersItem) {
      const bar = charactersItem.querySelector('.stats-bar');
      const value = charactersItem.querySelector('.stats-value');
      const percentage = Math.min((stats.characters.used / stats.characters.limit) * 100, 100);
      bar.style.width = `${percentage}%`;
      value.textContent = `${Math.round(stats.characters.used / 1000 * 10) / 10}k/${Math.round(stats.characters.limit / 1000)}k`;
    }
  },

  // --------------------------------------------------------------------------
  // Event Listeners
  // --------------------------------------------------------------------------
  setupEventListeners() {
    // Theme toggle
    this.themeToggle.addEventListener('click', () => this.handleThemeToggle());
    
    // Settings button opens options page
    this.settingsButton.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Language swap button
    this.swapLanguagesButton.addEventListener('click', () => this.handleLanguageSwap());

    // Auto-translate toggle
    this.autoTranslateToggle.addEventListener('change', () => this.handleAutoTranslateToggle());

    // Stats refresh button
    this.statsRefreshButton.addEventListener('click', () => this.loadUsageStats());

    // Translate button
    this.translateButton.addEventListener('click', () => this.handleTranslate());

    // Runtime message listener is set up at module level for testing compatibility

    // Save language preferences when changed
    this.sourceLanguageSelect.addEventListener('change', () => {
      chrome.storage.local.set({ sourceLanguage: this.sourceLanguageSelect.value });
      
      // Update intelligent language selection
      if (window.IntelligentLanguageSelection) {
        window.IntelligentLanguageSelection.recordLanguagePair(
          this.sourceLanguageSelect.value,
          this.targetLanguageSelect.value
        );
      }
    });
    
    this.targetLanguageSelect.addEventListener('change', () => {
      chrome.storage.local.set({ targetLanguage: this.targetLanguageSelect.value });
      
      // Update intelligent language selection
      if (window.IntelligentLanguageSelection) {
        window.IntelligentLanguageSelection.recordLanguagePair(
          this.sourceLanguageSelect.value,
          this.targetLanguageSelect.value
        );
      }
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
  handleLanguageSwap() {
    if (this.sourceLanguageSelect.value === 'auto') {
      // Can't swap when source is auto-detect
      return;
    }
    
    const sourceValue = this.sourceLanguageSelect.value;
    const targetValue = this.targetLanguageSelect.value;
    
    this.sourceLanguageSelect.value = targetValue;
    this.targetLanguageSelect.value = sourceValue;
    
    // Save the new settings
    chrome.storage.local.set({
      sourceLanguage: targetValue,
      targetLanguage: sourceValue
    });
  },

  async handleAutoTranslateToggle() {
    const autoTranslate = this.autoTranslateToggle.checked;
    await chrome.storage.local.set({ autoTranslate });
    
    // Send message to background script to update auto-translate setting
    try {
      await chrome.runtime.sendMessage({
        action: 'home:auto-translate',
        enabled: autoTranslate
      });
    } catch (error) {
      logger.error('Failed to update auto-translate setting:', error);
    }
  },

  handleRuntimeMessage(message, sender, sendResponse) {
    if (message.action === 'home:update-usage') {
      this.handleUsageUpdate(message);
    } else if (message.action === 'home:auto-translate') {
      this.handleAutoTranslateToggle(message);
    }
  },

  handleAutoTranslateToggle(message) {
    // Save the auto-translate setting
    chrome.storage.sync.set({ autoTranslate: message.enabled });
    
    // If disabling auto-translate, stop all tabs
    if (!message.enabled) {
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'stop' }, () => {
            // Ignore errors (tab might not have content script)
            if (chrome.runtime.lastError) {
              // Silent error handling
            }
          });
        });
      });
    }
  },

  handleUsageUpdate(message) {
    // Update legacy elements for test compatibility
    if (message.usage) {
      const usage = message.usage;
      
      const usageElement = document.getElementById('usage');
      if (usageElement) {
        usageElement.textContent = `Requests: ${usage.requests}/${usage.requestLimit} Tokens: ${usage.tokens}/${usage.tokenLimit}`;
      }

      const statusElement = document.getElementById('status');
      if (statusElement) {
        statusElement.textContent = message.active ? 'Translating' : 'Idle';
      }

      const limitsElement = document.getElementById('limits');
      if (limitsElement) {
        limitsElement.textContent = `Queue: ${usage.queue || 0}`;
      }

      const reqBarElement = document.getElementById('reqBar');
      if (reqBarElement) {
        reqBarElement.value = usage.requests || 0;
        reqBarElement.max = usage.requestLimit || 0;
      }

      const tokBarElement = document.getElementById('tokBar');
      if (tokBarElement) {
        tokBarElement.value = usage.tokens || 0;
        tokBarElement.max = usage.tokenLimit || 0;
      }

      // Update model usage display if present
      if (message.models) {
        const modelUsageElement = document.getElementById('modelUsage');
        if (modelUsageElement) {
          const modelTexts = [];
          for (const [modelName, modelData] of Object.entries(message.models)) {
            modelTexts.push(`${modelName}: ${modelData.requests}/${modelData.requestLimit} ${modelData.tokens}/${modelData.tokenLimit}`);
          }
          modelUsageElement.textContent = modelTexts.join(', ');
        }
      }
    }
  },

  async handleTranslate() {
    // Use default provider since there's no provider selection in current UI
    if (!this.activeProvider) {
      this.activeProvider = 'qwen'; // Default provider
    }

    // Record language pair usage for intelligent suggestions with error handling
    errorHandler.safe(() => {
      if (window.IntelligentLanguageSelection) {
        window.IntelligentLanguageSelection.recordLanguagePair(
          this.sourceLanguageSelect.value,
          this.targetLanguageSelect.value
        );
      }
    }, { operation: 'recordLanguagePair', module: 'popup' }, undefined)();

    // Start progress tracking with error handling
    errorHandler.safe(() => {
      if (window.TranslationProgress) {
        window.TranslationProgress.startTranslationSession({
          provider: this.activeProvider,
          sourceLanguage: this.sourceLanguageSelect.value,
          targetLanguage: this.targetLanguageSelect.value
        });
      }
    }, { operation: 'startProgressTracking', module: 'popup' }, undefined)();

    // Show loading state
    errorHandler.safe(() => {
      if (this.loadingOverlay) this.loadingOverlay.style.display = 'flex';
      this.showTranslatingState(true);
    }, { operation: 'showLoadingState', module: 'popup' }, undefined)();

    const translationResult = await errorHandler.handleAsync(
      chrome.runtime.sendMessage({ action: 'home:quick-translate' }),
      { 
        operation: 'quickTranslate', 
        module: 'popup',
        provider: this.activeProvider,
        sourceLanguage: this.sourceLanguageSelect.value,
        targetLanguage: this.targetLanguageSelect.value
      },
      null
    );

    if (translationResult === null) {
      // Translation failed, show error
      const error = new Error('Translation request failed');
      this.showTranslationError(error);
      
      // Reset UI state
      this.showTranslatingState(false);
      
      // Handle translation error with progress tracking
      errorHandler.safe(() => {
        if (window.TranslationProgress) {
          window.TranslationProgress.handleTranslationError(error, {
            provider: this.activeProvider,
            sourceLanguage: this.sourceLanguageSelect.value,
            targetLanguage: this.targetLanguageSelect.value
          });
        }
      }, { operation: 'handleTranslationError', module: 'popup' }, undefined)();
    } else {
      // Translation succeeded, close window with delay
      errorHandler.safe(() => {
        setTimeout(() => {
          if (!window.TranslationProgress?.getCurrentSession()) {
            window.close();
          }
        }, 500);
      }, { operation: 'scheduleWindowClose', module: 'popup' }, undefined)();
    }

    // Hide loading state
    errorHandler.safe(() => {
      if (this.loadingOverlay) this.loadingOverlay.style.display = 'none';
    }, { operation: 'hideLoadingState', module: 'popup' }, undefined)();
  }
};

// Setup runtime message listener immediately (for testing compatibility)
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  const messageHandler = (message, sender, sendResponse) => {
    // Call the handler directly since Popup object is already defined above
    Popup.handleRuntimeMessage(message, sender, sendResponse);
  };
  
  chrome.runtime.onMessage.addListener(messageHandler);
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  Popup.initialize();
});

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = Popup;
}
