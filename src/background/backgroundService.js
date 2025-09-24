/**
 * Main Background Service
 * Orchestrates all background functionality with modular architecture
 */

import { logger } from '../lib/logger.js';
import { secureLogger, logConfig, logAPIRequest } from '../lib/secureLogging.js';
import { initializeCSP } from '../lib/contentSecurityPolicy.js';
import { getTracker, startTimer, endTimer } from '../lib/performanceTracker.js';
import { MessageRouter, createLoggingMiddleware, createRateLimitMiddleware } from './messageRouter.js';
import { TranslationService } from './translationService.js';
import { ConfigManager } from './configManager.js';

class BackgroundService {
  constructor() {
    this.version = '2.0.0';
    this.isInitialized = false;
    this.startTime = Date.now();

    // Core services
    this.messageRouter = new MessageRouter();
    this.translationService = new TranslationService();
    this.configManager = new ConfigManager();

    // Service status
    this.services = {
      messageRouter: 'pending',
      translationService: 'pending',
      configManager: 'pending',
      performanceTracker: 'pending'
    };

    logger.info('BackgroundService', `Background Service v${this.version} starting...`);
  }

  // Initialize all services
  async initialize() {
    const initTimerId = startTimer('backgroundInit');

    try {
      logger.info('BackgroundService', 'Initializing background services...');

      // Initialize configuration manager first
      await this.initializeConfigManager();

      // Initialize translation service
      await this.initializeTranslationService();

      // Initialize message router and handlers
      await this.initializeMessageRouter();

      // Initialize performance tracking
      await this.initializePerformanceTracking();

      // Initialize security systems
      await this.initializeSecurity();

      // Setup Chrome extension event listeners
      this.setupExtensionListeners();

      // Setup context menu
      await this.setupContextMenu();

      this.isInitialized = true;
      const initDuration = endTimer(initTimerId);

      logger.info('BackgroundService',
        `Background service initialized successfully in ${initDuration?.toFixed(0)}ms`);

      // Log service status
      this.logServiceStatus();

    } catch (error) {
      endTimer(initTimerId, { success: false, error: error.message });
      logger.error('BackgroundService', 'Failed to initialize background service:', error);
      this.services.overall = 'error';
      throw error;
    }
  }

  // Initialize configuration manager
  async initializeConfigManager() {
    try {
      await this.configManager.initialize();
      this.services.configManager = 'ready';
      secureLogger.debug('BackgroundService', 'ConfigManager initialized');
    } catch (error) {
      this.services.configManager = 'error';
      secureLogger.error('BackgroundService', 'Failed to initialize ConfigManager:', error);
      throw error;
    }
  }

  // Initialize security systems
  async initializeSecurity() {
    try {
      // Initialize Content Security Policy
      initializeCSP();

      this.services.security = 'ready';
      secureLogger.debug('BackgroundService', 'Security systems initialized');
    } catch (error) {
      this.services.security = 'error';
      secureLogger.error('BackgroundService', 'Failed to initialize security systems:', error);
      // Don't throw - security is important but not critical for basic operation
    }
  }

  // Initialize translation service
  async initializeTranslationService() {
    try {
      // Translation service initializes synchronously, but we might add async init later
      this.services.translationService = 'ready';
      logger.debug('BackgroundService', 'TranslationService initialized');
    } catch (error) {
      this.services.translationService = 'error';
      logger.error('BackgroundService', 'Failed to initialize TranslationService:', error);
      throw error;
    }
  }

  // Initialize message router and register handlers
  async initializeMessageRouter() {
    try {
      // Add middleware
      this.messageRouter.use(createLoggingMiddleware());
      this.messageRouter.use(createRateLimitMiddleware(100)); // 100 requests per minute

      // Register message handlers
      this.registerMessageHandlers();

      // Set up Chrome message listener
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        // Use async wrapper to handle promises properly
        this.messageRouter.route(request, sender, sendResponse);
        return true; // Keep message channel open for async responses
      });

      this.services.messageRouter = 'ready';
      logger.debug('BackgroundService', 'MessageRouter initialized');
    } catch (error) {
      this.services.messageRouter = 'error';
      logger.error('BackgroundService', 'Failed to initialize MessageRouter:', error);
      throw error;
    }
  }

  // Initialize performance tracking
  async initializePerformanceTracking() {
    try {
      // Performance tracker is initialized globally, just mark as ready
      const tracker = getTracker();
      if (tracker) {
        this.services.performanceTracker = 'ready';
        logger.debug('BackgroundService', 'Performance tracking initialized');
      }
    } catch (error) {
      this.services.performanceTracker = 'error';
      logger.warn('BackgroundService', 'Performance tracking initialization failed:', error);
      // Don't throw - performance tracking is non-critical
    }
  }

  // Register all message handlers
  registerMessageHandlers() {
    // Translation handlers
    this.messageRouter.registerHandler('translate', async (request) => {
      return await this.translationService.translate(
        request.text,
        request.sourceLanguage,
        request.targetLanguage,
        request.options || {}
      );
    });

    this.messageRouter.registerHandler('batchTranslate', async (request) => {
      const results = [];
      for (const item of request.items) {
        try {
          const translation = await this.translationService.translate(
            item.text,
            request.sourceLanguage,
            request.targetLanguage,
            request.options || {}
          );
          results.push({ success: true, translation });
        } catch (error) {
          results.push({ success: false, error: error.message });
        }
      }
      return results;
    });

    // Configuration handlers
    this.messageRouter.registerHandler('getConfig', async (request) => {
      if (request.key) {
        return this.configManager.get(request.key);
      }
      return this.configManager.getAll();
    });

    this.messageRouter.registerHandler('setConfig', async (request) => {
      await this.configManager.set(request.key, request.value);
      return { success: true };
    });

    this.messageRouter.registerHandler('updateConfig', async (request) => {
      await this.configManager.update(request.updates);
      return { success: true };
    });

    // Usage and stats handlers
    this.messageRouter.registerHandler('getUsageStats', async () => {
      return this.translationService.getUsageStats();
    });

    this.messageRouter.registerHandler('getPerformanceData', async () => {
      const tracker = getTracker();
      return tracker ? tracker.getDashboardData() : null;
    });

    // Service status handlers
    this.messageRouter.registerHandler('getServiceStatus', async () => {
      return {
        version: this.version,
        initialized: this.isInitialized,
        uptime: Date.now() - this.startTime,
        services: this.services
      };
    });

    this.messageRouter.registerHandler('ping', async () => {
      return { pong: Date.now(), version: this.version };
    });

    // Testing and debugging handlers
    this.messageRouter.registerHandler('testProvider', async (request) => {
      return await this.translationService.testProvider(request.provider);
    });

    this.messageRouter.registerHandler('clearCache', async () => {
      this.translationService.clearCache();
      return { success: true };
    });

    // Content script communication
    this.messageRouter.registerHandler('contentScriptReady', async (request, sender) => {
      const tabId = sender.tab?.id;
      secureLogger.debug('BackgroundService', `Content script ready on tab ${tabId}`);
      const config = this.configManager.getAll();

      return {
        success: true,
        config: config, // Config is automatically sanitized by secureLogger when logged
        version: this.version
      };
    });

    logger.debug('BackgroundService', 'Message handlers registered');
  }

  // Setup Chrome extension event listeners
  setupExtensionListeners() {
    // Handle extension installation/update
    chrome.runtime.onInstalled.addListener((details) => {
      logger.info('BackgroundService', `Extension ${details.reason}:`, details);

      if (details.reason === 'install') {
        this.handleFirstInstall();
      } else if (details.reason === 'update') {
        this.handleUpdate(details.previousVersion);
      }
    });

    // Handle extension startup
    chrome.runtime.onStartup.addListener(() => {
      logger.info('BackgroundService', 'Extension startup');
    });

    // Handle tab updates for auto-translation
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        this.handleTabUpdate(tabId, tab);
      }
    });

    // Handle service worker suspend/resume
    chrome.runtime.onSuspend?.addListener(() => {
      logger.info('BackgroundService', 'Service worker suspending');
      this.handleSuspend();
    });

    logger.debug('BackgroundService', 'Extension listeners setup complete');
  }

  // Setup context menu items
  async setupContextMenu() {
    try {
      // Remove existing context menu items
      chrome.contextMenus.removeAll();

      // Create context menu for selected text
      chrome.contextMenus.create({
        id: 'translate-selection',
        title: 'Translate "%s"',
        contexts: ['selection'],
        documentUrlPatterns: ['http://*/*', 'https://*/*']
      });

      // Context menu click handler
      chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId === 'translate-selection' && info.selectionText) {
          this.handleContextMenuTranslation(info.selectionText, tab);
        }
      });

      logger.debug('BackgroundService', 'Context menu setup complete');
    } catch (error) {
      logger.warn('BackgroundService', 'Context menu setup failed:', error);
    }
  }

  // Handle first installation
  handleFirstInstall() {
    logger.info('BackgroundService', 'First installation - setting up defaults');

    // Set initial configuration
    this.configManager.resetToDefaults();

    // Open welcome/setup page
    chrome.tabs.create({
      url: chrome.runtime.getURL('pages/welcome.html')
    });
  }

  // Handle extension update
  handleUpdate(previousVersion) {
    logger.info('BackgroundService', `Updated from version ${previousVersion} to ${this.version}`);

    // Perform any necessary migration
    this.performMigration(previousVersion);
  }

  // Handle tab updates for auto-translation
  async handleTabUpdate(tabId, tab) {
    try {
      const autoTranslate = this.configManager.get('autoTranslate', false);
      if (!autoTranslate) return;

      // Check if this site should be auto-translated
      const autoLanguages = this.configManager.get('autoTranslateLanguages', []);
      if (autoLanguages.length === 0) return;

      // Inject content script and trigger auto-translation
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['contentScript.js']
      });

    } catch (error) {
      logger.error('BackgroundService', 'Auto-translation setup failed:', error);
    }
  }

  // Handle context menu translation
  async handleContextMenuTranslation(selectionText, tab) {
    try {
      const sourceLanguage = this.configManager.get('sourceLanguage', 'auto');
      const targetLanguage = this.configManager.get('targetLanguage', 'en');

      const translation = await this.translationService.translate(
        selectionText,
        sourceLanguage,
        targetLanguage
      );

      // Show translation in a popup or notification
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (original, translated) => {
          // Simple popup implementation
          const popup = document.createElement('div');
          popup.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 10000;
            background: white; border: 2px solid #0066cc; border-radius: 8px;
            padding: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-width: 300px; font-family: sans-serif; font-size: 14px;
          `;
          popup.innerHTML = `
            <div><strong>Translation:</strong></div>
            <div style="margin: 8px 0; padding: 8px; background: #f5f5f5; border-radius: 4px;">
              ${translated}
            </div>
            <button onclick="this.parentElement.remove()" style="background: #0066cc; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer;">Close</button>
          `;
          document.body.appendChild(popup);

          // Auto-remove after 10 seconds
          setTimeout(() => popup.remove(), 10000);
        },
        args: [selectionText, translation]
      });

    } catch (error) {
      secureLogger.error('BackgroundService', 'Context menu translation failed:', error);
    }
  }

  // Handle service worker suspension
  handleSuspend() {
    // Save any pending state
    try {
      this.configManager.saveConfig();
    } catch (error) {
      logger.error('BackgroundService', 'Failed to save state on suspend:', error);
    }
  }

  // Perform version migration
  performMigration(previousVersion) {
    // Example migration logic
    if (previousVersion && previousVersion < '2.0.0') {
      logger.info('BackgroundService', 'Performing v2.0.0 migration');
      // Add any migration logic here
    }
  }

  // Log service status for debugging
  logServiceStatus() {
    const status = {
      version: this.version,
      initialized: this.isInitialized,
      uptime: Date.now() - this.startTime,
      services: this.services,
      handlers: this.messageRouter.getHandlerInfo()
    };

    logger.info('BackgroundService', 'Service status:', status);
  }

  // Get service health check
  getHealthCheck() {
    const allServicesReady = Object.values(this.services).every(status => status === 'ready');

    return {
      healthy: this.isInitialized && allServicesReady,
      version: this.version,
      uptime: Date.now() - this.startTime,
      services: this.services,
      lastCheck: Date.now()
    };
  }

  // Shutdown service (for testing)
  async shutdown() {
    try {
      logger.info('BackgroundService', 'Shutting down background service');

      // Save final state
      await this.configManager.saveConfig();

      // Clear handlers
      this.messageRouter.clearHandlers();

      this.isInitialized = false;
      logger.info('BackgroundService', 'Background service shutdown complete');

    } catch (error) {
      logger.error('BackgroundService', 'Error during shutdown:', error);
    }
  }
}

export { BackgroundService };