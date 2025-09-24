/**
 * @fileoverview Smart Onboarding Wizard for first-time users
 * Provides guided 3-step setup with provider recommendations and API validation
 */

(function() {
  // Prevent duplicate loading
  if (typeof window !== 'undefined' && window.OnboardingWizard) {
    return;
  }

const OnboardingWizard = {
  currentStep: 1,
  totalSteps: 3,
  userData: {},
  modal: null,

  // --------------------------------------------------------------------------
  // Initialization and Modal Management
  // --------------------------------------------------------------------------
  
  async init() {
    // Check if user has completed onboarding
    const { hasCompletedOnboarding } = await chrome.storage.local.get({ hasCompletedOnboarding: false });
    
    if (!hasCompletedOnboarding) {
      this.show();
    }
  },

  show() {
    this.createModal();
    this.renderStep(1);
  },

  start() {
    this.show();
  },

  showSettings() {
    this.createModal();
    this.renderStep(2);
  },

  hide() {
    if (this.modal) {
      this.modal.classList.add('onboarding-fade-out');
      setTimeout(() => {
        if (this.modal && this.modal.parentNode) {
          this.modal.remove();
          this.modal = null;
        }
      }, 300);
      // Mark as completed when user closes to avoid repeated prompts
      try { chrome.storage.local.set({ hasCompletedOnboarding: true }); } catch {}
    }
  },

  createModal() {
    if (this.modal) {
      // Ensure modal is visible if it already exists
      this.modal.classList.remove('onboarding-fade-out');
      this.modal.style.display = '';
      return;
    }

    this.modal = document.createElement('div');
    this.modal.className = 'onboarding-modal';
    this.modal.innerHTML = `
      <div class="onboarding-backdrop" data-action="hide"></div>
      <div class="onboarding-container">
        <div class="onboarding-header">
          <div class="onboarding-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: 33%"></div>
            </div>
            <div class="progress-text">Step <span class="current-step">1</span> of <span class="total-steps">3</span></div>
          </div>
          <button class="btn btn--ghost btn--icon onboarding-close" data-action="hide">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2"/>
            </svg>
          </button>
        </div>
        <div class="onboarding-content">
          <!-- Content will be dynamically rendered -->
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
    this.setupEventListeners();
  },

  setupEventListeners() {
    if (!this.modal) return;
    
    // Use event delegation to handle all button clicks
    this.modal.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (!target) return;
      
      const action = target.getAttribute('data-action');
      event.preventDefault();
      
      switch (action) {
        case 'hide':
          this.hide();
          break;
        case 'nextStep':
          this.nextStep();
          break;
        case 'prevStep':
          this.prevStep();
          break;
        case 'complete':
          this.complete();
          break;
        case 'runTest':
          this.runTest();
          break;
        case 'toggleApiKeyVisibility':
          this.toggleApiKeyVisibility();
          break;
        default:
          console.warn('Unknown action:', action);
      }
    });
  },

  // --------------------------------------------------------------------------
  // Step Management
  // --------------------------------------------------------------------------
  
  renderStep(stepNumber) {
    this.currentStep = stepNumber;
    const content = this.modal.querySelector('.onboarding-content');
    const progressFill = this.modal.querySelector('.progress-fill');
    const currentStepSpan = this.modal.querySelector('.current-step');
    
    // Update progress
    progressFill.style.width = `${(stepNumber / this.totalSteps) * 100}%`;
    currentStepSpan.textContent = stepNumber;
    
    switch (stepNumber) {
      case 1:
        content.innerHTML = this.renderWelcomeStep();
        this.setupWelcomeListeners();
        break;
      case 2:
        content.innerHTML = this.renderProviderStep();
        this.setupProviderListeners();
        break;
      case 3:
        content.innerHTML = this.renderTestStep();
        this.setupTestListeners();
        break;
      default:
        this.complete();
    }
  },

  // --------------------------------------------------------------------------
  // Step 1: Welcome & Language Detection
  // --------------------------------------------------------------------------
  
  renderWelcomeStep() {
    const browserLang = navigator.language || navigator.userLanguage || 'en';
    const detectedLanguage = this.getLanguageFromCode(browserLang.split('-')[0]);
    
    return `
      <div class="onboarding-step">
        <div class="step-icon welcome">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7v10c0 5.55 3.84 9.74 9 11 5.16-1.26 9-5.45 9-11V7l-10-5z" stroke="currentColor" stroke-width="2"/>
            <path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2"/>
          </svg>
        </div>
        <h2>Welcome to TRANSLATE! by Mikko</h2>
        <p class="step-description">Let's set up your translation preferences in just 3 easy steps.</p>
        
        <div class="language-detection">
          <h3>🌐 Language Preferences</h3>
          <p class="detection-info">We detected your browser language as <strong>${detectedLanguage}</strong></p>
          
          <div class="language-selection-step1">
            <div class="language-input-group">
              <label for="primary-language">What language do you primarily read?</label>
              <select id="primary-language" class="language-select-modern">
                ${this.generateLanguageOptions(browserLang.split('-')[0])}
              </select>
            </div>
            
            <div class="language-input-group">
              <label for="translate-to-language">What language should we translate to?</label>
              <select id="translate-to-language" class="language-select-modern">
                ${this.generateLanguageOptions('en')}
              </select>
            </div>
          </div>
          
          <div class="usage-pattern">
            <h4>🕐 When do you typically browse?</h4>
            <div class="usage-options">
              <label class="usage-option">
                <input type="radio" name="usage-time" value="work">
                <span class="checkmark"></span>
                During work hours (9-5)
              </label>
              <label class="usage-option">
                <input type="radio" name="usage-time" value="evening">
                <span class="checkmark"></span>
                Evenings and weekends
              </label>
              <label class="usage-option">
                <input type="radio" name="usage-time" value="mixed" checked>
                <span class="checkmark"></span>
                Mixed throughout the day
              </label>
            </div>
          </div>
        </div>
        
        <div class="step-actions">
          <button class="btn btn--secondary" data-action="hide">Skip Setup</button>
          <button class="btn btn--primary" data-action="nextStep" id="welcome-next">
            Continue <span class="btn-arrow">→</span>
          </button>
        </div>
      </div>
    `;
  },

  setupWelcomeListeners() {
    const primaryLang = document.getElementById('primary-language');
    const translateTo = document.getElementById('translate-to-language');
    const usageInputs = document.querySelectorAll('input[name="usage-time"]');
    
    // Save user selections
    primaryLang.addEventListener('change', () => {
      this.userData.primaryLanguage = primaryLang.value;
      this.userData.sourceLanguage = primaryLang.value;
    });
    
    translateTo.addEventListener('change', () => {
      this.userData.targetLanguage = translateTo.value;
    });
    
    usageInputs.forEach(input => {
      input.addEventListener('change', () => {
        if (input.checked) {
          this.userData.usagePattern = input.value;
        }
      });
    });

    // Initialize with current values
    this.userData.sourceLanguage = primaryLang.value;
    this.userData.targetLanguage = translateTo.value;
    this.userData.usagePattern = 'mixed';
  },

  // --------------------------------------------------------------------------
  // Step 2: Provider Selection & Recommendations
  // --------------------------------------------------------------------------
  
  renderProviderStep() {
    const recommendedProviders = this.getRecommendedProviders();
    
    return `
      <div class="onboarding-step">
        <div class="step-icon provider">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="2"/>
          </svg>
        </div>
        <h2>Choose Your Translation Provider</h2>
        <p class="step-description">Based on your location and language preferences, we recommend these providers:</p>
        
        <div class="provider-recommendations">
          ${recommendedProviders.map(provider => this.renderProviderCard(provider)).join('')}
        </div>
        
        <div class="api-key-setup" style="display: none;">
          <h3>🔑 API Key Setup</h3>
          <p class="api-info">Enter your API key for <span class="selected-provider-name"></span>:</p>
          
          <div class="api-input-group">
            <input type="password" id="api-key-input" class="api-key-input" placeholder="Enter your API key...">
            <button class="btn btn--ghost btn--icon" data-action="toggleApiKeyVisibility">
              <svg class="eye-open" width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
              </svg>
              <svg class="eye-closed" width="20" height="20" viewBox="0 0 24 24" fill="none" style="display: none;">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94l12.88 12.88z" stroke="currentColor" stroke-width="2"/>
                <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19l-6.04-6.04a3 3 0 10-4.24-4.24z" stroke="currentColor" stroke-width="2"/>
                <path d="M1 1l22 22" stroke="currentColor" stroke-width="2"/>
              </svg>
            </button>
          </div>
          
          <div class="api-key-help">
            <a href="#" class="help-link" id="get-api-key-link" target="_blank">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
                <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" stroke="currentColor" stroke-width="2"/>
                <path d="M12 17h.01" stroke="currentColor" stroke-width="2"/>
              </svg>
              How to get an API key
            </a>
          </div>
          
          <div class="api-validation" id="api-validation" style="display: none;">
            <div class="validation-spinner">
              <div class="spinner-small"></div>
              <span>Validating API key...</span>
            </div>
            <div class="validation-result">
              <!-- Validation result will be shown here -->
            </div>
          </div>
        </div>
        
        <div class="step-actions">
          <button class="btn btn--secondary" data-action="prevStep">← Back</button>
          <button class="btn btn--primary" data-action="nextStep" id="provider-next" disabled>
            Continue <span class="btn-arrow">→</span>
          </button>
        </div>
      </div>
    `;
  },

  setupProviderListeners() {
    const providerCards = document.querySelectorAll('.provider-card');
    const apiKeySetup = document.querySelector('.api-key-setup');
    const apiKeyInput = document.getElementById('api-key-input');
    const nextButton = document.getElementById('provider-next');
    let validationTimeout;

    providerCards.forEach(card => {
      card.addEventListener('click', () => {
        // Remove active class from all cards
        providerCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        
        const providerId = card.dataset.provider;
        this.userData.selectedProvider = providerId;
        
        // Show API key setup
        apiKeySetup.style.display = 'block';
        const providerName = card.querySelector('.provider-name').textContent;
        document.querySelector('.selected-provider-name').textContent = providerName;
        
        // Update help link
        const helpLink = document.getElementById('get-api-key-link');
        helpLink.href = this.getApiKeyHelpUrl(providerId);
        
        // Focus on API key input
        setTimeout(() => apiKeyInput.focus(), 100);
      });
    });

    // Real-time API key validation
    apiKeyInput.addEventListener('input', () => {
      clearTimeout(validationTimeout);
      const apiKey = apiKeyInput.value.trim();
      
      if (apiKey.length > 10) { // Basic length check
        validationTimeout = setTimeout(() => {
          this.validateApiKey(apiKey);
        }, 500);
      } else {
        this.hideValidationResult();
        nextButton.disabled = true;
      }
    });
  },

  async validateApiKey(apiKey) {
    const validationDiv = document.getElementById('api-validation');
    const validationResult = validationDiv.querySelector('.validation-result');
    const nextButton = document.getElementById('provider-next');
    
    validationDiv.style.display = 'block';
    validationDiv.querySelector('.validation-spinner').style.display = 'flex';
    validationResult.innerHTML = '';
    
    try {
      // Test API key with a small translation request
      const testResult = await this.testProviderConnection(this.userData.selectedProvider, apiKey);
      
      validationDiv.querySelector('.validation-spinner').style.display = 'none';
      
      if (testResult.success) {
        validationResult.innerHTML = `
          <div class="validation-success">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="#10B981"/>
              <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2"/>
            </svg>
            <span>API key validated successfully!</span>
          </div>
        `;
        this.userData.apiKey = apiKey;
        nextButton.disabled = false;
      } else {
        validationResult.innerHTML = `
          <div class="validation-error">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" fill="#EF4444"/>
              <path d="M15 9l-6 6M9 9l6 6" stroke="white" stroke-width="2"/>
            </svg>
            <span>Invalid API key: ${testResult.error}</span>
          </div>
        `;
        nextButton.disabled = true;
      }
    } catch (error) {
      validationDiv.querySelector('.validation-spinner').style.display = 'none';
      validationResult.innerHTML = `
        <div class="validation-error">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#EF4444"/>
            <path d="M15 9l-6 6M9 9l6 6" stroke="white" stroke-width="2"/>
          </svg>
          <span>Connection error. Please check your internet connection.</span>
        </div>
      `;
      nextButton.disabled = true;
    }
  },

  hideValidationResult() {
    const validationDiv = document.getElementById('api-validation');
    validationDiv.style.display = 'none';
  },

  // --------------------------------------------------------------------------
  // Step 3: Test Translation
  // --------------------------------------------------------------------------
  
  renderTestStep() {
    return `
      <div class="onboarding-step">
        <div class="step-icon test">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2"/>
            <polyline points="14,2 14,8 20,8" stroke="currentColor" stroke-width="2"/>
            <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="2"/>
            <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="2"/>
            <polyline points="10,9 9,9 8,9" stroke="currentColor" stroke-width="2"/>
          </svg>
        </div>
        <h2>Test Your Setup</h2>
        <p class="step-description">Let's test your translation setup with a sample text to make sure everything works perfectly!</p>
        
        <div class="test-translation">
          <div class="test-input">
            <label for="test-text">Test Text (${this.getLanguageFromCode(this.userData.sourceLanguage)}):</label>
            <textarea id="test-text" class="test-textarea" placeholder="Enter some text to translate...">${this.getTestText(this.userData.sourceLanguage)}</textarea>
          </div>
          
          <div class="translation-arrow">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M7 13l3 3 7-7" stroke="currentColor" stroke-width="2"/>
              <path d="M21 12H3" stroke="currentColor" stroke-width="2"/>
            </svg>
          </div>
          
          <div class="test-output">
            <label>Translation (${this.getLanguageFromCode(this.userData.targetLanguage)}):</label>
            <div class="test-result" id="test-result">
              <div class="result-placeholder">
                Click "Test Translation" to see the result
              </div>
            </div>
          </div>
        </div>
        
        <div class="test-controls">
          <button class="btn btn--secondary" data-action="runTest" id="test-button">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <polygon points="5,3 19,12 5,21" fill="currentColor"/>
            </svg>
            Test Translation
          </button>
        </div>
        
        <div class="setup-summary">
          <h3>📋 Setup Summary</h3>
          <div class="summary-grid">
            <div class="summary-item">
              <span class="summary-label">Provider:</span>
              <span class="summary-value" id="summary-provider">${this.getProviderDisplayName(this.userData.selectedProvider)}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">From:</span>
              <span class="summary-value" id="summary-from">${this.getLanguageFromCode(this.userData.sourceLanguage)}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">To:</span>
              <span class="summary-value" id="summary-to">${this.getLanguageFromCode(this.userData.targetLanguage)}</span>
            </div>
          </div>
        </div>
        
        <div class="step-actions">
          <button class="btn btn--secondary" data-action="prevStep">← Back</button>
          <button class="btn btn--primary" data-action="complete" id="complete-setup">
            Complete Setup <span class="btn-arrow">🎉</span>
          </button>
        </div>
      </div>
    `;
  },

  setupTestListeners() {
    const testButton = document.getElementById('test-button');
    const testTextarea = document.getElementById('test-text');
    
    // Auto-resize textarea
    testTextarea.addEventListener('input', () => {
      testTextarea.style.height = 'auto';
      testTextarea.style.height = testTextarea.scrollHeight + 'px';
    });
  },

  async runTest() {
    const testButton = document.getElementById('test-button');
    const testResult = document.getElementById('test-result');
    const testText = document.getElementById('test-text').value.trim();
    
    if (!testText) {
      testResult.innerHTML = '<div class="result-error">Please enter some text to translate.</div>';
      return;
    }
    
    testButton.disabled = true;
    testButton.innerHTML = `
      <div class="spinner-small"></div>
      Testing...
    `;
    
    testResult.innerHTML = '<div class="result-loading">Translating...</div>';
    
    try {
      const result = await this.testProviderConnection(
        this.userData.selectedProvider, 
        this.userData.apiKey, 
        testText,
        this.userData.sourceLanguage,
        this.userData.targetLanguage
      );
      
      if (result.success) {
        testResult.innerHTML = `
          <div class="result-success">
            <div class="translation-text">${result.translatedText}</div>
            <div class="result-meta">
              <span class="confidence">Confidence: ${Math.round(result.confidence * 100)}%</span>
              <span class="provider">${this.getProviderDisplayName(this.userData.selectedProvider)}</span>
            </div>
          </div>
        `;
      } else {
        testResult.innerHTML = `
          <div class="result-error">
            <strong>Translation failed:</strong> ${result.error}
          </div>
        `;
      }
    } catch (error) {
      testResult.innerHTML = `
        <div class="result-error">
          <strong>Error:</strong> ${error.message}
        </div>
      `;
    }
    
    testButton.disabled = false;
    testButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <polygon points="5,3 19,12 5,21" fill="currentColor"/>
      </svg>
      Test Translation
    `;
  },

  // --------------------------------------------------------------------------
  // Navigation
  // --------------------------------------------------------------------------
  
  nextStep() {
    if (this.currentStep < this.totalSteps) {
      this.renderStep(this.currentStep + 1);
    } else {
      this.complete();
    }
  },

  prevStep() {
    if (this.currentStep > 1) {
      this.renderStep(this.currentStep - 1);
    }
  },

  async complete() {
    // Save configuration
    await this.saveConfiguration();
    
    // Mark onboarding as completed
    await chrome.storage.local.set({ hasCompletedOnboarding: true });
    
    // Show success animation
    this.showCompletionAnimation();
    
    // Hide modal after animation
    setTimeout(() => {
      this.hide();
      // Reload popup to show new configuration
      if (window.Popup && window.Popup.loadProviders) {
        window.Popup.loadProviders();
        window.Popup.loadSettings();
      }
    }, 2000);
  },

  showCompletionAnimation() {
    const content = this.modal.querySelector('.onboarding-content');
    content.innerHTML = `
      <div class="completion-animation">
        <div class="success-checkmark">
          <svg width="80" height="80" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#10B981" class="check-circle"/>
            <path d="M9 12l2 2 4-4" stroke="white" stroke-width="2" stroke-linecap="round" class="check-path"/>
          </svg>
        </div>
        <h2>Setup Complete! 🎉</h2>
        <p>Your TRANSLATE! extension is ready to use. You can now translate web pages with ease!</p>
        <div class="next-steps">
          <h3>What's next?</h3>
          <ul>
            <li>Visit any webpage and click the translate button</li>
            <li>Select text to get instant translations</li>
            <li>Adjust settings anytime from the popup</li>
          </ul>
        </div>
      </div>
    `;
  },

  // --------------------------------------------------------------------------
  // Helper Functions
  // --------------------------------------------------------------------------
  
  generateLanguageOptions(selectedCode) {
    const languages = [
      { code: 'auto', name: 'Auto Detect' },
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
      { code: 'fr', name: 'French' },
      { code: 'de', name: 'German' },
      { code: 'it', name: 'Italian' },
      { code: 'pt', name: 'Portuguese' },
      { code: 'ru', name: 'Russian' },
      { code: 'zh', name: 'Chinese (Simplified)' },
      { code: 'zh-TW', name: 'Chinese (Traditional)' },
      { code: 'ja', name: 'Japanese' },
      { code: 'ko', name: 'Korean' },
      { code: 'ar', name: 'Arabic' },
      { code: 'hi', name: 'Hindi' }
    ];

    return languages.map(lang => 
      `<option value="${lang.code}" ${lang.code === selectedCode ? 'selected' : ''}>${lang.name}</option>`
    ).join('');
  },

  getLanguageFromCode(code) {
    const langMap = {
      'auto': 'Auto Detect',
      'en': 'English',
      'es': 'Spanish', 
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'zh': 'Chinese (Simplified)',
      'zh-TW': 'Chinese (Traditional)',
      'ja': 'Japanese',
      'ko': 'Korean',
      'ar': 'Arabic',
      'hi': 'Hindi'
    };
    return langMap[code] || code;
  },

  getRecommendedProviders() {
    // Smart recommendations based on user location and preferences
    const browserLang = (navigator.language || 'en').split('-')[0];
    const userRegion = Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    const providers = [
      {
        id: 'qwen',
        name: 'Qwen (Alibaba Cloud)',
        description: 'Fast, accurate translations with support for 100+ languages',
        features: ['High accuracy', 'Fast processing', 'Cost-effective'],
        recommended: true,
        free: false,
        apiUrl: 'https://dashscope.console.aliyun.com/'
      },
      {
        id: 'google',
        name: 'Google Translate',
        description: 'Industry-leading translation with broad language support',
        features: ['Most languages', 'Reliable', 'Well-established'],
        recommended: userRegion.includes('America') || userRegion.includes('Europe'),
        free: false,
        apiUrl: 'https://console.cloud.google.com/apis/library/translate.googleapis.com'
      },
      {
        id: 'deepl',
        name: 'DeepL',
        description: 'Premium quality translations for European languages',
        features: ['Highest quality', 'Natural language', 'European focus'],
        recommended: ['de', 'fr', 'es', 'it', 'pt'].includes(browserLang),
        free: true,
        apiUrl: 'https://www.deepl.com/pro-api'
      },
      {
        id: 'openai',
        name: 'OpenAI GPT',
        description: 'AI-powered translations with context awareness',
        features: ['Context-aware', 'Creative translations', 'Latest AI'],
        recommended: false,
        free: false,
        apiUrl: 'https://platform.openai.com/api-keys'
      }
    ];

    return providers.sort((a, b) => b.recommended - a.recommended);
  },

  renderProviderCard(provider) {
    return `
      <div class="provider-card ${provider.recommended ? 'recommended' : ''}" data-provider="${provider.id}">
        <div class="provider-header">
          <div class="provider-info">
            <div class="provider-name">${provider.name}</div>
            ${provider.recommended ? '<div class="recommended-badge">Recommended</div>' : ''}
            ${provider.free ? '<div class="free-badge">Free Tier</div>' : ''}
          </div>
          <div class="provider-radio">
            <div class="radio-button"></div>
          </div>
        </div>
        <div class="provider-description">${provider.description}</div>
        <div class="provider-features">
          ${provider.features.map(feature => `<span class="feature-tag">${feature}</span>`).join('')}
        </div>
      </div>
    `;
  },

  getApiKeyHelpUrl(providerId) {
    const urls = {
      'qwen': 'https://dashscope.console.aliyun.com/',
      'google': 'https://console.cloud.google.com/apis/library/translate.googleapis.com',
      'deepl': 'https://www.deepl.com/pro-api',
      'openai': 'https://platform.openai.com/api-keys'
    };
    return urls[providerId] || '#';
  },

  getProviderDisplayName(providerId) {
    const names = {
      'qwen': 'Qwen (Alibaba Cloud)',
      'google': 'Google Translate',
      'deepl': 'DeepL',
      'openai': 'OpenAI GPT'
    };
    return names[providerId] || providerId;
  },

  getTestText(languageCode) {
    const testTexts = {
      'en': 'Hello, how are you today? This is a test translation.',
      'es': '¡Hola! ¿Cómo estás hoy? Esta es una traducción de prueba.',
      'fr': 'Bonjour, comment allez-vous aujourd\'hui? Ceci est un test de traduction.',
      'de': 'Hallo, wie geht es dir heute? Dies ist ein Übersetzungstest.',
      'zh': '你好，你今天怎么样？这是一个测试翻译。',
      'ja': 'こんにちは、今日はいかがですか？これはテスト翻訳です。',
      'ko': '안녕하세요, 오늘 어떠세요? 이것은 테스트 번역입니다.',
      'auto': 'Hello, how are you today? This is a test translation.'
    };
    return testTexts[languageCode] || testTexts['en'];
  },

  async testProviderConnection(providerId, apiKey, testText = 'Hello', sourceLanguage = 'en', targetLanguage = 'es') {
    try {
      // Try background command first
      const response = await chrome.runtime.sendMessage({
        action: 'testTranslation',
        provider: providerId,
        apiKey: apiKey,
        text: testText,
        source: sourceLanguage,
        target: targetLanguage
      });

      if (response && response.success) {
        return {
          success: true,
          translatedText: response.text,
          confidence: response.confidence || 0.9
        };
      }

      // If dispatcher reported a generic/internal error, fall back to direct fetch
      const errMsg = (response && response.error) || '';
      if (errMsg === 'Internal error' || /Command execution failed|Could not serialize/i.test(errMsg)) {
        const endpoint = 'https://dashscope-intl.aliyuncs.com/api/v1';
        try {
          const r = await fetch(`${endpoint}/services/aigc/text-generation/generation`, {
            method: 'POST',
            headers: {
              'Authorization': /^bearer\s/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'qwen-mt-turbo',
              input: { messages: [{ role: 'user', content: testText }] },
              parameters: { translation_options: { source_lang: sourceLanguage, target_lang: targetLanguage } }
            })
          });
          if (r.ok) {
            const j = await r.json();
            const text = j?.output?.text || j?.output?.choices?.[0]?.message?.content || '';
            return { success: true, translatedText: text, confidence: 0.9 };
          } else {
            let msg = r.statusText;
            try { const je = await r.json(); msg = je?.error?.message || je?.message || msg; } catch {}
            return { success: false, error: `HTTP ${r.status}: ${msg}` };
          }
        } catch (e) {
          return { success: false, error: e?.message || 'Network error' };
        }
      }

      return { success: false, error: errMsg || 'Unknown error' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  async saveConfiguration() {
    const providerId = this.userData.selectedProvider || 'dashscope';
    const endpoint = this.userData.endpoint || 'https://dashscope-intl.aliyuncs.com/api/v1';
    const model = this.userData.model || 'qwen-mt-turbo';

    // Persist provider configuration (without secrets)
    try {
      if (window.qwenProviderConfig) {
        const cfg = await window.qwenProviderConfig.loadProviderConfig();
        cfg.provider = providerId;
        cfg.providers = cfg.providers || {};
        cfg.providers[providerId] = Object.assign({}, cfg.providers[providerId] || {}, {
          enabled: true,
          apiEndpoint: endpoint,
          model,
        });
        cfg.providerOrder = Array.isArray(cfg.providerOrder) ? cfg.providerOrder : [];
        cfg.providerOrder = [providerId, ...cfg.providerOrder.filter(p => p !== providerId)];
        await window.qwenProviderConfig.saveProviderConfig(cfg);
      }
    } catch (e) {
      console.warn('Failed to save provider config during onboarding:', e);
    }

    // Persist secret in secure storage or provider store
    try {
      const key = String(this.userData.apiKey || '').trim();
      if (key) {
        if (window.qwenProviderStore && typeof window.qwenProviderStore.setProviderSecret === 'function') {
          await window.qwenProviderStore.setProviderSecret(providerId, key);
        } else if (window.qwenSecureStorage?.secureStorage) {
          await window.qwenSecureStorage.secureStorage.setSecure(`provider_${providerId}_apiKey`, key);
          if (window.qwenSecureStorage?.setSecureApiKey) {
            await window.qwenSecureStorage.setSecureApiKey(key);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to save API key securely during onboarding:', e);
    }

    // Save basic preferences
    const prefs = {
      sourceLanguage: this.userData.sourceLanguage,
      targetLanguage: this.userData.targetLanguage,
      selectedProvider: providerId,
      usagePattern: this.userData.usagePattern,
      autoTranslate: false,
      hasCompletedOnboarding: true,
    };
    try { await chrome.storage.local.set(prefs); } catch {}
    try { await chrome.storage.sync.set({ sourceLanguage: prefs.sourceLanguage, targetLanguage: prefs.targetLanguage }); } catch {}
  },

  toggleApiKeyVisibility() {
    const input = document.getElementById('api-key-input');
    const eyeOpen = document.querySelector('.eye-open');
    const eyeClosed = document.querySelector('.eye-closed');
    
    if (input.type === 'password') {
      input.type = 'text';
      eyeOpen.style.display = 'none';
      eyeClosed.style.display = 'block';
    } else {
      input.type = 'password';
      eyeOpen.style.display = 'block';
      eyeClosed.style.display = 'none';
    }
  }
};

// Initialize onboarding when page loads
if (typeof window !== 'undefined') {
  window.OnboardingWizard = OnboardingWizard;
  window.onboardingWizard = OnboardingWizard;
}

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = OnboardingWizard;
}

})(); // End of IIFE
