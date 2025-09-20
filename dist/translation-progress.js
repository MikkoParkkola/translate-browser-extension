/**
 * @fileoverview Real-time Translation Progress & Smart Error Recovery
 * Provides detailed progress tracking and intelligent error handling during translation
 */

(function() {
  // Prevent duplicate loading
  if (typeof window !== 'undefined' && window.TranslationProgress) {
    return;
  }

const TranslationProgress = {
  // Progress tracking
  currentSession: null,
  progressCallbacks: new Set(),
  
  // Error recovery system
  errorRecoveryStrategies: new Map(),
  failedRequests: [],
  
  // UI elements
  progressModal: null,
  progressElements: {},
  
  // Statistics
  stats: {
    totalElements: 0,
    processedElements: 0,
    successfulTranslations: 0,
    failedTranslations: 0,
    startTime: null,
    endTime: null,
    errors: []
  },

  // --------------------------------------------------------------------------
  // Initialization and Setup
  // --------------------------------------------------------------------------
  
  init() {
    this.setupErrorRecoveryStrategies();
    this.setupProgressTracking();
    this.bindEvents();
  },

  setupErrorRecoveryStrategies() {
    // Rate limit error recovery
    this.errorRecoveryStrategies.set('rate_limit', {
      detect: (error) => error.message.includes('rate limit') || error.status === 429,
      recover: async (error, context) => {
        const waitTime = this.calculateRateLimitWaitTime(error);
        await this.showRateLimitRecovery(waitTime, context);
        await this.delay(waitTime);
        return this.retryWithBackoff(context);
      },
      priority: 1
    });

    // API key error recovery
    this.errorRecoveryStrategies.set('api_key', {
      detect: (error) => error.message.includes('API key') || error.status === 401,
      recover: async (error, context) => {
        return await this.showApiKeyRecovery(context);
      },
      priority: 2
    });

    // Network error recovery
    this.errorRecoveryStrategies.set('network', {
      detect: (error) => error.message.includes('network') || error.message.includes('fetch'),
      recover: async (error, context) => {
        const retryCount = context.retryCount || 0;
        if (retryCount < 3) {
          await this.showNetworkRecovery(retryCount + 1);
          await this.delay(Math.pow(2, retryCount) * 1000); // Exponential backoff
          return this.retryWithBackoff({...context, retryCount: retryCount + 1});
        }
        return false;
      },
      priority: 3
    });

    // Provider unavailable recovery
    this.errorRecoveryStrategies.set('provider_unavailable', {
      detect: (error) => error.status === 503 || error.message.includes('unavailable'),
      recover: async (error, context) => {
        return await this.showProviderSwitchRecovery(context);
      },
      priority: 2
    });

    // Generic error recovery
    this.errorRecoveryStrategies.set('generic', {
      detect: () => true,
      recover: async (error, context) => {
        return await this.showGenericErrorRecovery(error, context);
      },
      priority: 10
    });
  },

  setupProgressTracking() {
    // Listen for translation events from content script
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'translation-progress') {
          this.updateProgress(message.data);
        } else if (message.action === 'translation-error') {
          this.handleTranslationError(message.error, message.context);
        } else if (message.action === 'translation-complete') {
          this.completeTranslation(message.data);
        }
      });
    }
  },

  bindEvents() {
    document.addEventListener('translationStart', (event) => {
      this.startTranslationSession(event.detail);
    });
    
    document.addEventListener('translationProgress', (event) => {
      this.updateProgress(event.detail);
    });
    
    document.addEventListener('translationError', (event) => {
      this.handleTranslationError(event.detail.error, event.detail.context);
    });
    
    document.addEventListener('translationComplete', (event) => {
      this.completeTranslation(event.detail);
    });
  },

  // --------------------------------------------------------------------------
  // Progress Tracking
  // --------------------------------------------------------------------------
  
  startTranslationSession(config = {}) {
    this.currentSession = {
      id: this.generateSessionId(),
      startTime: Date.now(),
      config,
      status: 'initializing'
    };

    this.stats = {
      totalElements: config.totalElements || 0,
      processedElements: 0,
      successfulTranslations: 0,
      failedTranslations: 0,
      startTime: Date.now(),
      endTime: null,
      errors: [],
      estimatedTimeRemaining: null,
      throughputRate: 0
    };

    this.showProgressModal();
    this.updateProgressUI();
    
    // Notify listeners
    this.notifyProgressCallbacks('session_start', this.stats);
  },

  updateProgress(data) {
    if (!this.currentSession) return;

    // Update statistics
    if (data.processed !== undefined) {
      this.stats.processedElements = data.processed;
    }
    if (data.successful !== undefined) {
      this.stats.successfulTranslations = data.successful;
    }
    if (data.failed !== undefined) {
      this.stats.failedTranslations = data.failed;
    }
    if (data.total !== undefined) {
      this.stats.totalElements = data.total;
    }

    // Calculate throughput and ETA
    this.calculatePerformanceMetrics();
    
    // Update UI
    this.updateProgressUI();
    
    // Notify listeners
    this.notifyProgressCallbacks('progress_update', this.stats);
  },

  calculatePerformanceMetrics() {
    const elapsed = Date.now() - this.stats.startTime;
    const processed = this.stats.processedElements;
    
    if (processed > 0 && elapsed > 0) {
      // Calculate throughput (elements per second)
      this.stats.throughputRate = (processed / elapsed) * 1000;
      
      // Estimate time remaining
      const remaining = this.stats.totalElements - processed;
      if (this.stats.throughputRate > 0) {
        this.stats.estimatedTimeRemaining = (remaining / this.stats.throughputRate) * 1000;
      }
    }
  },

  completeTranslation(data = {}) {
    if (!this.currentSession) return;

    this.stats.endTime = Date.now();
    this.currentSession.status = 'completed';
    
    // Final statistics update
    if (data.finalStats) {
      Object.assign(this.stats, data.finalStats);
    }

    // Show completion
    this.showTranslationComplete();
    
    // Notify listeners
    this.notifyProgressCallbacks('session_complete', this.stats);
    
    // Auto-hide progress modal after delay
    setTimeout(() => {
      this.hideProgressModal();
    }, 3000);
  },

  // --------------------------------------------------------------------------
  // Progress UI Management
  // --------------------------------------------------------------------------
  
  showProgressModal() {
    if (this.progressModal) {
      this.progressModal.remove();
    }

    this.progressModal = document.createElement('div');
    this.progressModal.className = 'translation-progress-modal';
    this.progressModal.innerHTML = this.getProgressModalHTML();
    
    document.body.appendChild(this.progressModal);
    
    // Cache UI elements
    this.progressElements = {
      progressBar: this.progressModal.querySelector('.progress-bar-fill'),
      elementCounter: this.progressModal.querySelector('.element-counter'),
      statusText: this.progressModal.querySelector('.status-text'),
      etaText: this.progressModal.querySelector('.eta-text'),
      throughputText: this.progressModal.querySelector('.throughput-text'),
      errorsList: this.progressModal.querySelector('.errors-list'),
      cancelButton: this.progressModal.querySelector('.cancel-button'),
      detailsToggle: this.progressModal.querySelector('.details-toggle'),
      detailsSection: this.progressModal.querySelector('.details-section')
    };

    // Bind events
    this.bindProgressModalEvents();
    
    // Animate in
    setTimeout(() => {
      this.progressModal.classList.add('visible');
    }, 10);
  },

  getProgressModalHTML() {
    return `
      <div class="progress-modal-backdrop"></div>
      <div class="progress-modal-content">
        <div class="progress-header">
          <div class="progress-title">
            <svg class="progress-icon" width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2"/>
              <polyline points="14,2 14,8 20,8" stroke="currentColor" stroke-width="2"/>
              <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="2"/>
              <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="2"/>
            </svg>
            <h3>Translating Page</h3>
          </div>
          <button class="cancel-button" title="Cancel translation">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2"/>
            </svg>
          </button>
        </div>

        <div class="progress-body">
          <div class="progress-bar-container">
            <div class="progress-bar">
              <div class="progress-bar-fill"></div>
            </div>
            <div class="progress-percentage">0%</div>
          </div>

          <div class="progress-stats">
            <div class="stat-item">
              <span class="stat-label">Elements:</span>
              <span class="element-counter">0 / 0</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Status:</span>
              <span class="status-text">Initializing...</span>
            </div>
          </div>

          <div class="progress-details">
            <div class="detail-item">
              <span class="detail-label">Time remaining:</span>
              <span class="eta-text">Calculating...</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Speed:</span>
              <span class="throughput-text">--</span>
            </div>
          </div>

          <button class="details-toggle">
            <span class="toggle-text">Show Details</span>
            <svg class="toggle-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2"/>
            </svg>
          </button>

          <div class="details-section" style="display: none;">
            <div class="errors-section">
              <h4>Errors</h4>
              <div class="errors-list">
                <div class="no-errors">No errors yet</div>
              </div>
            </div>
            
            <div class="performance-section">
              <h4>Performance Metrics</h4>
              <div class="metrics-grid">
                <div class="metric-item">
                  <span class="metric-label">Success Rate:</span>
                  <span class="success-rate">--</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">Avg Response Time:</span>
                  <span class="avg-response-time">--</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">Total Time:</span>
                  <span class="total-time">--</span>
                </div>
                <div class="metric-item">
                  <span class="metric-label">Data Processed:</span>
                  <span class="data-processed">--</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  updateProgressUI() {
    if (!this.progressModal || !this.progressElements) return;

    const { stats } = this;
    const percentage = stats.totalElements > 0 ? (stats.processedElements / stats.totalElements) * 100 : 0;
    
    // Update progress bar
    this.progressElements.progressBar.style.width = `${percentage}%`;
    
    // Update percentage
    const percentageElement = this.progressModal.querySelector('.progress-percentage');
    if (percentageElement) {
      percentageElement.textContent = `${Math.round(percentage)}%`;
    }
    
    // Update counters
    this.progressElements.elementCounter.textContent = `${stats.processedElements} / ${stats.totalElements}`;
    
    // Update status
    const status = this.getStatusText();
    this.progressElements.statusText.textContent = status;
    
    // Update ETA
    if (stats.estimatedTimeRemaining) {
      this.progressElements.etaText.textContent = this.formatTime(stats.estimatedTimeRemaining);
    } else {
      this.progressElements.etaText.textContent = 'Calculating...';
    }
    
    // Update throughput
    if (stats.throughputRate > 0) {
      this.progressElements.throughputText.textContent = `${stats.throughputRate.toFixed(1)} elements/sec`;
    } else {
      this.progressElements.throughputText.textContent = '--';
    }
    
    // Update errors
    this.updateErrorsList();
    
    // Update performance metrics
    this.updatePerformanceMetrics();
  },

  getStatusText() {
    if (!this.currentSession) return 'Idle';
    
    const { stats } = this;
    
    if (stats.processedElements === 0) {
      return 'Starting translation...';
    } else if (stats.processedElements < stats.totalElements) {
      if (stats.failedTranslations > 0) {
        return `Translating... (${stats.failedTranslations} errors)`;
      }
      return 'Translating...';
    } else {
      return 'Translation complete!';
    }
  },

  updateErrorsList() {
    if (!this.progressElements.errorsList) return;
    
    if (this.stats.errors.length === 0) {
      this.progressElements.errorsList.innerHTML = '<div class="no-errors">No errors yet</div>';
      return;
    }

    const errorsList = this.stats.errors.slice(-5).map(error => `
      <div class="error-item">
        <div class="error-type">${error.type || 'Unknown Error'}</div>
        <div class="error-message">${error.message}</div>
        <div class="error-time">${this.formatTime(Date.now() - error.timestamp)} ago</div>
      </div>
    `).join('');

    this.progressElements.errorsList.innerHTML = errorsList;
  },

  updatePerformanceMetrics() {
    const metricsElements = {
      successRate: this.progressModal.querySelector('.success-rate'),
      avgResponseTime: this.progressModal.querySelector('.avg-response-time'),
      totalTime: this.progressModal.querySelector('.total-time'),
      dataProcessed: this.progressModal.querySelector('.data-processed')
    };

    if (!metricsElements.successRate) return;

    const { stats } = this;
    const total = stats.processedElements;
    const successful = stats.successfulTranslations;
    const successRate = total > 0 ? (successful / total) * 100 : 0;
    
    metricsElements.successRate.textContent = `${successRate.toFixed(1)}%`;
    
    const elapsed = Date.now() - stats.startTime;
    metricsElements.totalTime.textContent = this.formatTime(elapsed);
    
    // These would be populated by actual metrics
    metricsElements.avgResponseTime.textContent = '--';
    metricsElements.dataProcessed.textContent = '--';
  },

  bindProgressModalEvents() {
    // Cancel button
    this.progressElements.cancelButton?.addEventListener('click', () => {
      this.cancelTranslation();
    });

    // Details toggle
    this.progressElements.detailsToggle?.addEventListener('click', () => {
      this.toggleProgressDetails();
    });

    // Close on backdrop click
    this.progressModal.querySelector('.progress-modal-backdrop')?.addEventListener('click', () => {
      if (this.currentSession?.status === 'completed') {
        this.hideProgressModal();
      }
    });
  },

  toggleProgressDetails() {
    const detailsSection = this.progressElements.detailsSection;
    const toggleText = this.progressModal.querySelector('.toggle-text');
    const toggleArrow = this.progressModal.querySelector('.toggle-arrow');
    
    if (!detailsSection) return;
    
    const isVisible = detailsSection.style.display !== 'none';
    
    detailsSection.style.display = isVisible ? 'none' : 'block';
    toggleText.textContent = isVisible ? 'Show Details' : 'Hide Details';
    toggleArrow.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
  },

  showTranslationComplete() {
    if (!this.progressModal) return;

    // Add completion styling
    this.progressModal.classList.add('completed');
    
    // Update header
    const title = this.progressModal.querySelector('.progress-title h3');
    if (title) {
      title.textContent = 'Translation Complete!';
    }

    // Show success message
    const statusText = this.progressElements.statusText;
    if (statusText) {
      statusText.textContent = `Successfully translated ${this.stats.successfulTranslations} elements`;
      statusText.classList.add('success');
    }

    // Add completion animation
    const progressBar = this.progressElements.progressBar;
    if (progressBar) {
      progressBar.classList.add('completed');
    }
  },

  hideProgressModal() {
    if (!this.progressModal) return;
    
    this.progressModal.classList.add('hiding');
    
    setTimeout(() => {
      if (this.progressModal) {
        this.progressModal.remove();
        this.progressModal = null;
        this.progressElements = {};
      }
    }, 300);
  },

  cancelTranslation() {
    if (!this.currentSession) return;
    
    // Send cancel message to content script
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'cancelTranslation' });
        }
      });
    }
    
    // Update status
    this.currentSession.status = 'cancelled';
    
    // Hide modal
    this.hideProgressModal();
    
    // Notify listeners
    this.notifyProgressCallbacks('session_cancelled', this.stats);
  },

  // --------------------------------------------------------------------------
  // Error Recovery
  // --------------------------------------------------------------------------
  
  async handleTranslationError(error, context = {}) {
    console.error('Translation error:', error);
    
    // Add to stats
    this.stats.errors.push({
      type: this.classifyError(error),
      message: error.message,
      timestamp: Date.now(),
      context
    });
    
    this.stats.failedTranslations++;
    
    // Try to recover
    const recovery = await this.attemptErrorRecovery(error, context);
    
    if (recovery.success) {
      // Recovery successful, continue translation
      this.notifyProgressCallbacks('error_recovered', { error, recovery });
    } else {
      // Recovery failed, may need user intervention
      this.notifyProgressCallbacks('error_unrecoverable', { error, context });
    }
    
    // Update UI
    this.updateProgressUI();
  },

  async attemptErrorRecovery(error, context) {
    // Find applicable recovery strategies
    const strategies = Array.from(this.errorRecoveryStrategies.values())
      .filter(strategy => strategy.detect(error))
      .sort((a, b) => a.priority - b.priority);

    for (const strategy of strategies) {
      try {
        const result = await strategy.recover(error, context);
        if (result) {
          return { success: true, strategy: strategy.name, result };
        }
      } catch (recoveryError) {
        console.warn('Recovery strategy failed:', recoveryError);
      }
    }

    return { success: false, error };
  },

  classifyError(error) {
    if (error.message.includes('rate limit') || error.status === 429) {
      return 'Rate Limit';
    } else if (error.message.includes('API key') || error.status === 401) {
      return 'Authentication';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      return 'Network';
    } else if (error.status === 503) {
      return 'Service Unavailable';
    } else {
      return 'Unknown';
    }
  },

  calculateRateLimitWaitTime(error) {
    // Try to extract wait time from error response
    if (error.headers && error.headers['retry-after']) {
      return parseInt(error.headers['retry-after']) * 1000;
    }
    
    // Default exponential backoff
    const attempt = this.failedRequests.length + 1;
    return Math.min(Math.pow(2, attempt) * 1000, 60000); // Max 1 minute
  },

  // --------------------------------------------------------------------------
  // Recovery UI Modals
  // --------------------------------------------------------------------------
  
  async showRateLimitRecovery(waitTime, context) {
    return new Promise((resolve) => {
      const modal = this.createRecoveryModal('Rate Limit Reached', `
        <div class="recovery-content">
          <div class="recovery-icon rate-limit">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <polyline points="12,6 12,12 16,14" stroke="currentColor" stroke-width="2"/>
            </svg>
          </div>
          <p>The translation service is temporarily rate limiting requests.</p>
          <p><strong>Waiting ${Math.ceil(waitTime / 1000)} seconds before retrying...</strong></p>
          
          <div class="countdown-bar">
            <div class="countdown-fill" style="animation: countdown ${waitTime}ms linear;"></div>
          </div>
          
          <div class="recovery-actions">
            <button class="btn-secondary" onclick="TranslationProgress.cancelRecovery('${context.sessionId}')">
              Cancel Translation
            </button>
            <button class="btn-primary" onclick="TranslationProgress.switchProvider('${context.sessionId}')">
              Switch Provider
            </button>
          </div>
        </div>
      `);
      
      setTimeout(() => {
        modal.remove();
        resolve(true);
      }, waitTime);
    });
  },

  async showApiKeyRecovery(context) {
    return new Promise((resolve) => {
      const modal = this.createRecoveryModal('API Key Issue', `
        <div class="recovery-content">
          <div class="recovery-icon error">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <line x1="12" y1="8" x2="12" y2="12" stroke="currentColor" stroke-width="2"/>
              <line x1="12" y1="16" x2="12.01" y2="16" stroke="currentColor" stroke-width="2"/>
            </svg>
          </div>
          <p>There's an issue with your API key. Please check your configuration.</p>
          
          <div class="recovery-actions">
            <button class="btn-secondary" onclick="TranslationProgress.cancelRecovery('${context.sessionId}')">
              Cancel
            </button>
            <button class="btn-secondary" onclick="TranslationProgress.openSettings()">
              Open Settings
            </button>
            <button class="btn-primary" onclick="TranslationProgress.switchProvider('${context.sessionId}')">
              Switch Provider
            </button>
          </div>
        </div>
      `);
      
      // Auto-resolve after 30 seconds
      setTimeout(() => {
        if (modal.parentNode) {
          modal.remove();
          resolve(false);
        }
      }, 30000);
    });
  },

  async showNetworkRecovery(retryCount) {
    return new Promise((resolve) => {
      const modal = this.createRecoveryModal('Network Error', `
        <div class="recovery-content">
          <div class="recovery-icon network">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <path d="M1 1l22 22M17 7l-1.5 1.5M8.5 8.5L7 7M2.5 2.5L5 5" stroke="currentColor" stroke-width="2"/>
              <path d="M8.5 16.5a5 5 0 0 1 7 0M5 12a9 9 0 0 1 14 0" stroke="currentColor" stroke-width="2"/>
            </svg>
          </div>
          <p>Network connection issue detected.</p>
          <p><strong>Retry attempt ${retryCount} of 3...</strong></p>
          
          <div class="loading-spinner"></div>
          
          <div class="recovery-actions">
            <button class="btn-secondary" onclick="TranslationProgress.cancelRecovery()">
              Cancel
            </button>
          </div>
        </div>
      `);
      
      setTimeout(() => {
        modal.remove();
        resolve(true);
      }, 3000);
    });
  },

  async showProviderSwitchRecovery(context) {
    return new Promise((resolve) => {
      const modal = this.createRecoveryModal('Provider Unavailable', `
        <div class="recovery-content">
          <div class="recovery-icon warning">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" stroke="currentColor" stroke-width="2"/>
            </svg>
          </div>
          <p>The current translation provider is temporarily unavailable.</p>
          
          <div class="provider-options">
            <h4>Switch to alternative provider:</h4>
            <div class="provider-list">
              <button class="provider-option" data-provider="google">Google Translate</button>
              <button class="provider-option" data-provider="deepl">DeepL</button>
              <button class="provider-option" data-provider="openai">OpenAI</button>
            </div>
          </div>
          
          <div class="recovery-actions">
            <button class="btn-secondary" onclick="TranslationProgress.cancelRecovery()">
              Cancel
            </button>
            <button class="btn-primary" onclick="TranslationProgress.retryCurrentProvider()">
              Retry Current Provider
            </button>
          </div>
        </div>
      `);
      
      // Handle provider selection
      modal.querySelectorAll('.provider-option').forEach(btn => {
        btn.addEventListener('click', () => {
          const providerId = btn.dataset.provider;
          modal.remove();
          resolve({ switchTo: providerId });
        });
      });
    });
  },

  async showGenericErrorRecovery(error, context) {
    return new Promise((resolve) => {
      const modal = this.createRecoveryModal('Translation Error', `
        <div class="recovery-content">
          <div class="recovery-icon error">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
              <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2"/>
              <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2"/>
            </svg>
          </div>
          <p>An unexpected error occurred during translation:</p>
          <div class="error-details">
            <code>${error.message}</code>
          </div>
          
          <div class="recovery-suggestions">
            <h4>Suggested actions:</h4>
            <ul>
              <li>Check your internet connection</li>
              <li>Verify your API key configuration</li>
              <li>Try switching to a different provider</li>
              <li>Contact support if the issue persists</li>
            </ul>
          </div>
          
          <div class="recovery-actions">
            <button class="btn-secondary" onclick="TranslationProgress.cancelRecovery()">
              Cancel
            </button>
            <button class="btn-secondary" onclick="TranslationProgress.openSettings()">
              Open Settings
            </button>
            <button class="btn-primary" onclick="TranslationProgress.retryTranslation()">
              Retry
            </button>
          </div>
        </div>
      `);
      
      // Auto-resolve as failure after timeout
      setTimeout(() => {
        if (modal.parentNode) {
          modal.remove();
          resolve(false);
        }
      }, 30000);
    });
  },

  createRecoveryModal(title, content) {
    const modal = document.createElement('div');
    modal.className = 'error-recovery-modal';
    modal.innerHTML = `
      <div class="recovery-backdrop"></div>
      <div class="recovery-modal-content">
        <div class="recovery-header">
          <h3>${title}</h3>
        </div>
        ${content}
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Animate in
    setTimeout(() => {
      modal.classList.add('visible');
    }, 10);
    
    return modal;
  },

  // --------------------------------------------------------------------------
  // Utility Functions
  // --------------------------------------------------------------------------
  
  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  },

  formatTime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  },

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  async retryWithBackoff(context) {
    const retryCount = context.retryCount || 0;
    const delay = Math.min(Math.pow(2, retryCount) * 1000, 30000); // Max 30 seconds
    
    await this.delay(delay);
    
    // Trigger retry
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, { 
            action: 'retryTranslation', 
            context: { ...context, retryCount: retryCount + 1 }
          });
        }
      });
    }
    
    return true;
  },

  notifyProgressCallbacks(event, data) {
    this.progressCallbacks.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        console.error('Progress callback error:', error);
      }
    });
  },

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------
  
  addProgressCallback(callback) {
    this.progressCallbacks.add(callback);
  },

  removeProgressCallback(callback) {
    this.progressCallbacks.delete(callback);
  },

  getCurrentStats() {
    return { ...this.stats };
  },

  getCurrentSession() {
    return this.currentSession ? { ...this.currentSession } : null;
  },

  // Recovery action handlers (called from modal buttons)
  cancelRecovery() {
    this.cancelTranslation();
    document.querySelectorAll('.error-recovery-modal').forEach(modal => modal.remove());
  },

  openSettings() {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.openOptionsPage();
    }
  },

  switchProvider(sessionId) {
    // Implementation would depend on how providers are managed
    console.log('Switching provider for session:', sessionId);
    document.querySelectorAll('.error-recovery-modal').forEach(modal => modal.remove());
  },

  retryCurrentProvider() {
    // Retry with current provider
    this.retryWithBackoff({ retryCount: 0 });
    document.querySelectorAll('.error-recovery-modal').forEach(modal => modal.remove());
  },

  retryTranslation() {
    // Retry the translation
    this.retryWithBackoff({ retryCount: 0 });
    document.querySelectorAll('.error-recovery-modal').forEach(modal => modal.remove());
  }
};

// Initialize when script loads
if (typeof window !== 'undefined') {
  window.TranslationProgress = TranslationProgress;
  
  // Auto-initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      TranslationProgress.init();
    });
  } else {
    TranslationProgress.init();
  }
}

// Export for testing
if (typeof module !== 'undefined') {
  module.exports = TranslationProgress;
}

})(); // End of IIFE