/**
 * Message Handler for Background Service Worker
 * Handles cross-context communication and API request routing
 */

(function(root, factory) {
  const mod = factory(root || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.qwenMessageHandler = mod;
}(typeof self !== 'undefined' ? self : this, function(root) {

  const logger = (typeof self !== 'undefined' && self.qwenLogger?.create)
    ? self.qwenLogger.create('message-handler')
    : console;

  const errorHandler = (typeof self !== 'undefined' && self.qwenErrorHandler) ||
                      {
                        handle: (error, context = {}, fallback) => {
                          logger.error('Message handler error:', error, context);
                          return fallback !== undefined ? fallback : null;
                        },
                        handleAsync: async (promise, context = {}, fallback) => {
                          try {
                            return await promise;
                          } catch (error) {
                            logger.error('Message handler async error:', error, context);
                            return fallback !== undefined ? fallback : null;
                          }
                        }
                      };

  /**
   * Message Handler Class
   */
  class MessageHandler {
    constructor() {
      this.handlers = new Map();
      this.rateLimiter = this._createRateLimiter();
      this.securityValidator = this._createSecurityValidator();
      this.initialized = false;
    }

    /**
     * Initialize message handler
     */
    async initialize() {
      if (this.initialized) return;

      this._registerDefaultHandlers();
      this._setupMessageListeners();
      this.initialized = true;

      logger.info('Message handler initialized successfully');
    }

    /**
     * Create rate limiter
     */
    _createRateLimiter() {
      const requestCounts = new Map();
      const WINDOW_MS = 60 * 1000; // 1 minute
      const MAX_REQUESTS_PER_WINDOW = 1000;

      return (senderId) => {
        const now = Date.now();
        const windowStart = now - WINDOW_MS;

        if (!requestCounts.has(senderId)) {
          requestCounts.set(senderId, []);
        }

        const requests = requestCounts.get(senderId);
        const recentRequests = requests.filter(timestamp => timestamp > windowStart);
        requestCounts.set(senderId, recentRequests);

        if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
          return false;
        }

        recentRequests.push(now);
        return true;
      };
    }

    /**
     * Create security validator
     */
    _createSecurityValidator() {
      return {
        validateMessage: (message, sender) => {
          if (!message || typeof message !== 'object' || !message.action) {
            return { valid: false, error: 'Invalid message format' };
          }

          // Allow messages from active tabs OR trusted extension pages
          const isFromTab = !!(sender && sender.tab);
          const runtimeId = (typeof chrome !== 'undefined' && chrome.runtime?.id);
          const isFromExtensionPage = !!(
            sender && (
              (typeof sender.url === 'string' && sender.url.startsWith('chrome-extension://')) ||
              (typeof sender.origin === 'string' && sender.origin.startsWith('chrome-extension://')) ||
              (runtimeId && sender.id === runtimeId)
            )
          );

          if (!isFromTab && !isFromExtensionPage) {
            return { valid: false, error: 'Invalid sender context' };
          }

          return { valid: true };
        },

        validateTranslationRequest: (message, sender) => {
          if (message.action !== 'translate' || !message.opts) {
            return { valid: true }; // Not a translation request
          }

          const opts = message.opts;

          // Text length validation
          if (opts.text && opts.text.length > 50000) {
            return { valid: false, error: 'Text too long for security' };
          }

          // API endpoint validation
          if (opts.apiEndpoint) {
            try {
              const url = new URL(opts.apiEndpoint);
              const allowedHosts = [
                'dashscope-intl.aliyuncs.com',
                'api.deepl.com',
                'api-free.deepl.com',
                'generativelanguage.googleapis.com'
              ];

              if (!allowedHosts.includes(url.hostname)) {
                return { valid: false, error: 'Invalid API endpoint' };
              }
            } catch (error) {
              return { valid: false, error: 'Invalid API endpoint URL' };
            }
          }

          return { valid: true };
        }
      };
    }

    /**
     * Register a message handler
     */
    registerHandler(action, handler) {
      if (typeof handler !== 'function') {
        throw new Error('Handler must be a function');
      }

      this.handlers.set(action, handler);
      logger.debug(`Registered handler for action: ${action}`);
    }

    /**
     * Register default handlers
     */
    _registerDefaultHandlers() {
      // Health check
      this.registerHandler('ping', async () => {
        return { status: 'ok', timestamp: Date.now() };
      });

      // Provider status
      this.registerHandler('provider-status', async () => {
        const configManager = root.qwenConfigManager?.configManager;
        const storageManager = root.qwenStorageManager?.storageManager;

        if (!configManager || !storageManager) {
          return { error: 'Services not available' };
        }

        try {
          const config = await storageManager.getConfig(configManager.createDefault());
          const enabledProviders = configManager.getEnabledProviders(config);

          return {
            providers: enabledProviders.map(p => ({
              id: p.id,
              name: p.name,
              type: p.type,
              enabled: p.enabled,
              hasApiKey: !!p.apiKey
            })),
            strategy: config.translation?.strategy || 'smart'
          };
        } catch (error) {
          return { error: error.message };
        }
      });

      // Translation request
      this.registerHandler('translate', async (message, sender) => {
        const translator = root.qwenTranslate;
        if (!translator) {
          return { error: 'Translation service not available' };
        }

        try {
          const result = await translator(message.opts);
          return result;
        } catch (error) {
          return { error: error.message };
        }
      });

      // Configuration management
      this.registerHandler('get-config', async () => {
        const configManager = root.qwenConfigManager?.configManager;
        const storageManager = root.qwenStorageManager?.storageManager;

        if (!configManager || !storageManager) {
          return { error: 'Configuration service not available' };
        }

        try {
          const config = await storageManager.getConfig(configManager.createDefault());
          return { config };
        } catch (error) {
          return { error: error.message };
        }
      });

      this.registerHandler('set-config', async (message) => {
        const configManager = root.qwenConfigManager?.configManager;
        const storageManager = root.qwenStorageManager?.storageManager;

        if (!configManager || !storageManager) {
          return { error: 'Configuration service not available' };
        }

        try {
          const validatedConfig = configManager.validate(message.config);
          await storageManager.setConfig(validatedConfig);
          return { success: true };
        } catch (error) {
          return { error: error.message };
        }
      });

      // API key management
      this.registerHandler('set-provider-key', async (message) => {
        const storageManager = root.qwenStorageManager?.storageManager;

        if (!storageManager) {
          return { error: 'Storage service not available' };
        }

        try {
          const success = await storageManager.setProviderApiKey(
            message.providerId,
            message.apiKey
          );
          return { success };
        } catch (error) {
          return { error: error.message };
        }
      });

      this.registerHandler('get-provider-key', async (message) => {
        const storageManager = root.qwenStorageManager?.storageManager;

        if (!storageManager) {
          return { error: 'Storage service not available' };
        }

        try {
          const apiKey = await storageManager.getProviderApiKey(message.providerId);
          return { apiKey: apiKey || '' };
        } catch (error) {
          return { error: error.message };
        }
      });

      // Content script injection
      this.registerHandler('inject-content-script', async (message) => {
        try {
          const tabs = await this._queryTabs({ active: true, currentWindow: true });
          const [tab] = tabs || [];

          if (!tab?.id) {
            return { error: 'No active tab found' };
          }

          await this._injectContentScript(tab.id);
          return { success: true, tabId: tab.id };
        } catch (error) {
          return { error: error.message };
        }
      });

      // Usage statistics
      this.registerHandler('get-usage-stats', async () => {
        const storageManager = root.qwenStorageManager?.storageManager;

        if (!storageManager) {
          return { error: 'Storage service not available' };
        }

        try {
          const usageData = await storageManager.getUsageData('usage-history', []);
          const throttle = root.qwenThrottle;

          return {
            usage: throttle ? throttle.getUsage() : {},
            history: usageData
          };
        } catch (error) {
          return { error: error.message };
        }
      });
    }

    /**
     * Setup message listeners
     */
    _setupMessageListeners() {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          this._handleMessage(message, sender, sendResponse);
          return true; // Keep message channel open for async responses
        });
      }
    }

    /**
     * Handle incoming messages
     */
    async _handleMessage(message, sender, sendResponse) {
      try {
        // Rate limiting
        const senderId = sender.tab?.id || sender.id || 'unknown';
        if (!this.rateLimiter(senderId)) {
          sendResponse({ error: 'Rate limit exceeded' });
          return;
        }

        // Security validation
        const basicValidation = this.securityValidator.validateMessage(message, sender);
        if (!basicValidation.valid) {
          sendResponse({ error: basicValidation.error });
          return;
        }

        const translationValidation = this.securityValidator.validateTranslationRequest(message, sender);
        if (!translationValidation.valid) {
          sendResponse({ error: translationValidation.error });
          return;
        }

        // Find and execute handler
        const handler = this.handlers.get(message.action);
        if (!handler) {
          sendResponse({ error: `Unknown action: ${message.action}` });
          return;
        }

        const result = await errorHandler.handleAsync(
          handler(message, sender),
          { operation: 'messageHandler', action: message.action },
          { error: 'Handler execution failed' }
        );

        sendResponse(result);
      } catch (error) {
        logger.error('Message handling failed:', error);
        sendResponse({ error: 'Internal error' });
      }
    }

    /**
     * Query Chrome tabs
     */
    async _queryTabs(queryInfo) {
      if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
        return [];
      }

      return new Promise((resolve) => {
        chrome.tabs.query(queryInfo, (tabs) => {
          if (chrome.runtime.lastError) {
            logger.warn('Tab query failed:', chrome.runtime.lastError);
            resolve([]);
          } else {
            resolve(tabs || []);
          }
        });
      });
    }

    /**
     * Inject content script into tab
     */
    async _injectContentScript(tabId) {
      if (typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
        throw new Error('Script injection not available');
      }

      const files = [
        'lib/logger.js',
        'lib/messaging.js',
        'config.js',
        'throttle.js',
        'translator.js',
        'contentScript.js'
      ];

      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files
      });
    }

    /**
     * Send message to runtime
     */
    async sendMessage(message) {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        throw new Error('Runtime messaging not available');
      }

      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    }

    /**
     * Send message to tab
     */
    async sendMessageToTab(tabId, message) {
      if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) {
        throw new Error('Tab messaging not available');
      }

      return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    }
  }

  // Create singleton instance
  const messageHandler = new MessageHandler();

  return {
    MessageHandler,
    messageHandler
  };

}));