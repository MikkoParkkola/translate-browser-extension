/**
 * Content Script Coordinator - Main orchestrator for content script functionality
 * 
 * Coordinates DOM scanning, UI management, batching, and translation processing
 * for optimal page translation experience.
 */

class ContentScriptCoordinator {
  constructor() {
    this.logger = null;
    this.security = null;
    this.errorHandler = null;
    
    // Core components
    this.domScanner = null;
    this.uiManager = null;
    this.translationBatcher = null;
    this.translationProcessor = null;
    
    // State management
    this.isActive = false;
    this.config = null;
    this.observing = false;
    this.mutationObserver = null;
    
    // Performance tracking
    this.scanCount = 0;
    this.translationCount = 0;
    this.lastScanTime = 0;
    
    // Event handlers (bound once)
    this.handleMessage = this.handleMessage.bind(this);
    this.handleMutation = this.handleMutation.bind(this);
    this.handleSelection = this.handleSelection.bind(this);
  }

  /**
   * Initialize coordinator with configuration
   * @param {Object} config - Translation configuration
   */
  async initialize(config) {
    this.config = config;
    
    // Initialize logging
    this.logger = {
      debug: config.debug ? console.log.bind(console, '[Qwen]') : () => {},
      warn: console.warn.bind(console, '[Qwen]'),
      error: console.error.bind(console, '[Qwen]'),
    };
    
    // Initialize security and error handling
    this.security = window.qwenSecurity || null;
    this.errorHandler = window.qwenErrorHandler || {
      handleError: (error, context) => {
        this.logger.error(`Error in ${context}:`, error);
      }
    };
    
    // Initialize core components
    this.domScanner = new (window.qwenDOMScanner || self.qwenDOMScanner)(
      this.logger, 
      this.security
    );
    
    this.uiManager = new (window.qwenUIManager || self.qwenUIManager)(
      this.logger
    );
    
    this.translationBatcher = new (window.qwenTranslationBatcher || self.qwenTranslationBatcher)(
      this.logger, 
      config
    );
    
    this.translationProcessor = new (window.qwenTranslationProcessor || self.qwenTranslationProcessor)(
      this.logger, 
      this.security, 
      this.errorHandler
    );
    
    // Initialize components
    await this.translationProcessor.initialize(config);
    
    // Set up UI theme
    this.uiManager.ensureThemeCss(config.style || 'default');
    
    // Set up message listener
    chrome.runtime.onMessage.addListener(this.handleMessage);
    
    // Set up mutation observer
    this.setupMutationObserver();
    
    // Set up selection listener
    document.addEventListener('selectionchange', this.handleSelection);
    
    this.isActive = true;
    this.logger.debug('Content script coordinator initialized');
  }

  /**
   * Set up mutation observer for dynamic content
   */
  setupMutationObserver() {
    if (!this.config.observeMutations) return;
    
    this.mutationObserver = new MutationObserver(this.handleMutation);
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: true,
    });
    
    this.observing = true;
    this.logger.debug('Mutation observer started');
  }

  /**
   * Handle runtime messages
   * @param {Object} message - Message from extension
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   */
  handleMessage(message, sender, sendResponse) {
    if (!this.isActive) return;
    
    switch (message.action) {
      case 'translate':
        this.startTranslation()
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ 
            success: false, 
            error: error.message 
          }));
        return true; // Async response
        
      case 'stop':
        this.stopTranslation();
        sendResponse({ success: true });
        break;
        
      case 'configure':
        this.updateConfiguration(message.config)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ 
            success: false, 
            error: error.message 
          }));
        return true; // Async response
        
      case 'getStats':
        sendResponse(this.getStats());
        break;
        
      default:
        this.logger.warn('Unknown message action:', message.action);
    }
  }

  /**
   * Handle DOM mutations
   * @param {MutationRecord[]} mutations - DOM mutations
   */
  handleMutation(mutations) {
    if (!this.isActive || !this.config.autoTranslate) return;
    
    let hasNewNodes = false;
    
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Check if any added nodes contain translatable text
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            hasNewNodes = true;
            break;
          }
        }
      }
      
      if (hasNewNodes) break;
    }
    
    if (hasNewNodes) {
      // Debounce mutation handling
      clearTimeout(this.mutationTimeout);
      this.mutationTimeout = setTimeout(() => {
        this.scanAndTranslate();
      }, 500);
    }
  }

  /**
   * Handle text selection
   */
  handleSelection() {
    if (!this.config.enableSelectionTranslation) return;
    
    const selection = window.getSelection();
    if (selection.toString().trim()) {
      this.uiManager.handleSelection(selection);
    } else {
      this.uiManager.removeSelectionBubble();
    }
  }

  /**
   * Start full page translation
   */
  async startTranslation() {
    try {
      this.uiManager.setStatus('Starting translation...');
      
      // Scan entire page
      await this.scanAndTranslate();
      
      this.uiManager.setStatus('Translation complete');
      this.uiManager.clearStatus();
      
    } catch (error) {
      this.errorHandler.handleError(error, 'startTranslation');
      this.uiManager.showError(`Translation failed: ${error.message}`);
    }
  }

  /**
   * Stop all translation activities
   */
  stopTranslation() {
    // Abort ongoing translations
    this.translationProcessor.abortAll();
    
    // Stop batcher
    this.translationBatcher.stop();
    
    // Clear UI
    this.uiManager.clearStatus();
    
    this.logger.debug('Translation stopped');
  }

  /**
   * Scan page and translate found nodes
   */
  async scanAndTranslate() {
    const startTime = performance.now();
    
    try {
      // Clear visibility cache for fresh scan
      this.domScanner.clearCache();
      
      // Scan for translatable nodes
      const nodes = this.domScanner.scan();
      this.scanCount++;
      
      if (nodes.length === 0) {
        this.logger.debug('No translatable nodes found');
        return;
      }
      
      this.logger.debug(`Found ${nodes.length} translatable nodes`);
      
      // Update progress tracking
      this.uiManager.updateProgress({ total: nodes.length, done: 0 });
      
      // Create batches
      const batches = this.translationBatcher.batchNodes(nodes);
      
      // Process batches with progress updates
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        
        try {
          const result = await this.translationProcessor.processBatch({
            nodes: batch,
            id: `scan_${this.scanCount}_batch_${i + 1}`,
            enqueued: Date.now(),
          });
          
          // Update progress
          const totalProcessed = batches.slice(0, i + 1)
            .reduce((sum, b) => sum + b.length, 0);
          
          this.uiManager.updateProgress({ 
            total: nodes.length, 
            done: totalProcessed 
          });
          
          this.translationCount += result.applied || 0;
          
        } catch (error) {
          this.logger.error(`Batch ${i + 1} failed:`, error);
          // Continue with other batches
        }
      }
      
      const duration = performance.now() - startTime;
      this.lastScanTime = duration;
      
      this.logger.debug(`Scan complete: ${duration.toFixed(1)}ms`);
      
    } catch (error) {
      this.errorHandler.handleError(error, 'scanAndTranslate');
      throw error;
    }
  }

  /**
   * Update configuration
   * @param {Object} newConfig - New configuration
   */
  async updateConfiguration(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Update components
    await this.translationProcessor.initialize(this.config);
    this.translationBatcher.updateConfig(this.config);
    this.uiManager.ensureThemeCss(this.config.style || 'default');
    
    // Update mutation observer
    if (this.config.observeMutations && !this.observing) {
      this.setupMutationObserver();
    } else if (!this.config.observeMutations && this.observing) {
      this.mutationObserver?.disconnect();
      this.observing = false;
    }
    
    this.logger.debug('Configuration updated');
  }

  /**
   * Get coordinator statistics
   * @returns {Object} - Statistics
   */
  getStats() {
    return {
      isActive: this.isActive,
      scanCount: this.scanCount,
      translationCount: this.translationCount,
      lastScanTime: this.lastScanTime,
      observing: this.observing,
      domScanner: this.domScanner?.getCacheStats() || {},
      uiManager: this.uiManager?.getState() || {},
      translationBatcher: this.translationBatcher?.getStats() || {},
      translationProcessor: this.translationProcessor?.getStats() || {},
    };
  }

  /**
   * Clean up coordinator resources
   */
  cleanup() {
    this.isActive = false;
    
    // Remove event listeners
    chrome.runtime.onMessage.removeListener(this.handleMessage);
    document.removeEventListener('selectionchange', this.handleSelection);
    
    // Stop mutation observer
    this.mutationObserver?.disconnect();
    this.observing = false;
    
    // Clean up components
    this.translationProcessor?.cleanup();
    this.translationBatcher?.stop();
    this.uiManager?.cleanup();
    this.domScanner?.clearCache();
    
    // Clear timers
    clearTimeout(this.mutationTimeout);
    
    this.logger.debug('Content script coordinator cleaned up');
  }
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContentScriptCoordinator;
} else {
  self.qwenContentScriptCoordinator = ContentScriptCoordinator;
}