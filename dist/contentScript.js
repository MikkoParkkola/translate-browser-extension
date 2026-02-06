/**
 * Content Script Entry Point
 * Modular architecture using separated concerns
 */

import { ContentObserver } from './content/contentObserver.js';
import { AdvancedLanguageDetector } from './content/languageDetector.js';
import { TranslationService } from './content/translationService.js';
import { Logger } from './lib/logger.js';

// Wrap everything in an IIFE to allow early returns and prevent conflicts
(function() {
  'use strict';

  const logger = new Logger({ component: 'ContentScript' });

  // Prevent multiple script injections by checking if we're already initialized
  if (window.translationExtensionInitialized) {
    logger.debug('Extension already initialized, skipping duplicate injection...');
    return;
  }

  // Mark this instance as the active one
  window.translationExtensionInitialized = true;
  window.translationExtensionInitTime = Date.now();

  // Clean up any stale instances
  if (window.translationScriptInstance) {
    try {
      if (window.translationScriptInstance.cleanup) {
        window.translationScriptInstance.cleanup();
      }
      delete window.translationScriptInstance;
    } catch (error) {
      logger.warn('Error cleaning up previous instance:', error);
    }
  }

  // Make classes available globally for compatibility
  window.ContentObserver = ContentObserver;
  window.AdvancedLanguageDetector = AdvancedLanguageDetector;

  logger.info('Modular classes loaded successfully');

  // Main script execution wrapped in try-catch for context invalidation
  try {

    class ContentScriptCoordinator {
      constructor() {
        this.translationService = null;
        this.contentObserver = null;
        this.languageDetector = null;
        this.isInitialized = false;

        // Initialize with delay to allow scripts to load
        setTimeout(() => this.initialize(), 100);
      }

      async initialize() {
        if (this.isInitialized) return;

        logger.info('Initializing modular content script...');

        try {
          // Check if extension context is still valid
          if (!(await this.isExtensionContextValid())) {
            logger.error('Extension context is invalid, cannot initialize');
            this.handleContextInvalidation();
            return;
          }

          // Initialize translation service
          this.translationService = new TranslationService();

          // Initialize language detector
          this.languageDetector = new AdvancedLanguageDetector();

          // Set up content observer for dynamic content
          this.setupDynamicContentObserver();

          // Set up message listener
          chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open
          });

          // Initialize progress indicator if needed
          this.initializeProgressIndicator();

          this.isInitialized = true;
          logger.info('Modular content script initialized successfully');

        } catch (error) {
          logger.error('Failed to initialize:', error);
          if (error.message?.includes('Extension context invalidated')) {
            this.handleContextInvalidation();
          }
        }
      }

      async isExtensionContextValid() {
        try {
          const id = chrome.runtime.id;
          return !!id;
        } catch (error) {
          logger.warn('Extension context invalid:', error.message);
          return false;
        }
      }

      setupDynamicContentObserver() {
        if (this.contentObserver) {
          this.contentObserver.disconnect();
        }

        this.contentObserver = new ContentObserver((nodes, metadata) => {
          this.handleNewContent(nodes, metadata);
        }, {
          enableSmartFiltering: true,
          batchDelay: 500,
          maxBatchSize: 30
        });

        // Start observing with a small delay to avoid initial page load noise
        setTimeout(() => {
          if (document.body) {
            this.contentObserver.startObserving(document.body);
            logger.info('Content observer started');
          }
        }, 1000);
      }

      async handleNewContent(nodes, metadata = {}) {
        if (!this.translationService || !nodes || nodes.length === 0) return;

        logger.debug(`New content detected: ${nodes.length} nodes (source: ${metadata.source})`);

        // Check if auto-translation is enabled
        try {
          const settings = await this.sendMessageWithRetry({ type: 'getSettings' });
          if (settings && settings.success && settings.data.autoTranslate) {
            // Auto-translate new content with rate limiting
            if (this.translationService.autoTranslateCount < this.translationService.maxAutoTranslates) {
              this.translationService.autoTranslateCount++;
              await this.translationService.translateNodes(nodes);
            } else {
              logger.warn('Auto-translate limit reached, skipping new content');
            }
          }
        } catch (error) {
          logger.warn('Failed to handle new content:', error);
        }
      }

      async handleMessage(request, sender, sendResponse) {
        try {
          logger.debug('Received message:', request.type);

          // Delegate to translation service
          if (this.translationService) {
            await this.translationService.handleMessage(request, sender, sendResponse);
          } else {
            sendResponse({ error: 'Translation service not initialized' });
          }

        } catch (error) {
          logger.error('Message handler error:', error);
          sendResponse({ error: error.message });
        }
      }

      async sendMessageWithRetry(message, maxRetries = 3) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            return await chrome.runtime.sendMessage(message);
          } catch (error) {
            logger.warn(`Message attempt ${attempt}/${maxRetries} failed:`, error.message);

            if (attempt === maxRetries) {
              if (error.message?.includes('Extension context invalidated')) {
                this.handleContextInvalidation();
              }
              throw error;
            }

            await new Promise(resolve => setTimeout(resolve, 100 * attempt));
          }
        }
      }

      initializeProgressIndicator() {
        // Create a simple progress indicator for translations
        if (document.getElementById('qwen-progress-indicator')) return;

        const progressIndicator = document.createElement('div');
        progressIndicator.id = 'qwen-progress-indicator';
        progressIndicator.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          background: rgba(0, 123, 255, 0.9);
          color: white;
          padding: 8px 12px;
          border-radius: 4px;
          font-family: Arial, sans-serif;
          font-size: 12px;
          z-index: 10000;
          display: none;
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        `;
        progressIndicator.textContent = 'Translating...';

        document.body?.appendChild(progressIndicator);
        this.progressIndicator = progressIndicator;

        logger.debug('Progress indicator initialized');
      }

      showProgress(show = true) {
        if (this.progressIndicator) {
          this.progressIndicator.style.display = show ? 'block' : 'none';
        }
      }

      handleContextInvalidation() {
        logger.warn('Extension context invalidated, cleaning up...');
        this.cleanup();

        // Mark the global flag as false so a new instance can be created when extension reloads
        window.translationExtensionInitialized = false;

        // Show user notification
        this.showContextInvalidationNotice();
      }

      showContextInvalidationNotice() {
        const notice = document.createElement('div');
        notice.style.cssText = `
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: #ff6b35;
          color: white;
          padding: 12px 20px;
          border-radius: 8px;
          font-family: Arial, sans-serif;
          font-size: 14px;
          z-index: 10001;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
        `;
        notice.textContent = 'Translation extension reloaded. Please refresh the page to continue translating.';

        document.body?.appendChild(notice);

        // Auto-remove after 10 seconds
        setTimeout(() => notice.remove(), 10000);
      }

      cleanup() {
        if (this.contentObserver) {
          this.contentObserver.disconnect();
          this.contentObserver = null;
        }

        if (this.translationService) {
          this.translationService.cleanup();
          this.translationService = null;
        }

        if (this.progressIndicator) {
          this.progressIndicator.remove();
          this.progressIndicator = null;
        }

        this.isInitialized = false;
      }
    }

    // Initialize the coordinating script
    const coordinator = new ContentScriptCoordinator();

    // Store reference globally for cleanup
    window.translationScriptInstance = coordinator;

    // Add to global scope for debugging
    window.contentScriptDebug = {
      coordinator,
      ContentObserver,
      AdvancedLanguageDetector,
      TranslationService
    };

    logger.info('Content script coordinator initialized');

  } catch (extensionError) {
    logger.error('Critical initialization error:', extensionError);
    // Mark as not initialized so reload can try again
    window.translationExtensionInitialized = false;
  }

})(); // End of IIFE