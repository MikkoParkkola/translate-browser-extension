/**
 * Simplified Background Service Worker
 * Integrates all core components for provider-agnostic translation
 */

(() => {
  // Import all required modules
  const modules = [
    // Core system modules
    'lib/logger.js',
    'core/error-handler.js',
    'core/config-manager.js',
    'core/storage-manager.js',
    'core/message-handler.js',

    // Translation modules
    'config.js',
    'throttle.js',
    'translator.js',

    // Utility modules
    'lib/providers.js',
    'usageColor.js'
  ];

  // Import all modules
  if (typeof importScripts === 'function') {
    importScripts(...modules);
  }

  // Initialize logger
  const logger = (self.qwenLogger?.create) ? self.qwenLogger.create('background') : console;

  // Initialize error handler
  const errorHandler = self.qwenErrorHandler || {
    handle: (error, context = {}, fallback) => {
      logger.error('Error:', error, context);
      return fallback !== undefined ? fallback : null;
    },
    handleAsync: async (promise, context = {}, fallback) => {
      try {
        return await promise;
      } catch (error) {
        logger.error('Async error:', error, context);
        return fallback !== undefined ? fallback : null;
      }
    }
  };

  /**
   * Background Service Worker Main Class
   */
  class BackgroundService {
    constructor() {
      this.configManager = self.qwenConfigManager?.configManager;
      this.storageManager = self.qwenStorageManager?.storageManager;
      this.messageHandler = self.qwenMessageHandler?.messageHandler;
      this.activeTranslations = 0;
      this.initialized = false;
      this.usageStats = {
        requests: 0,
        tokens: 0,
        providers: new Map()
      };
    }

    /**
     * Initialize the background service
     */
    async initialize() {
      if (this.initialized) return;

      try {
        logger.info('Initializing background service...');

        // Initialize core components
        if (this.storageManager) {
          await this.storageManager.initialize();
        }

        if (this.messageHandler) {
          await this.messageHandler.initialize();
          this._registerMessageHandlers();
        }

        // Initialize throttling
        await this._initializeThrottling();

        // Setup event listeners
        this._setupEventListeners();

        // Initialize context menus
        this._createContextMenus();

        // Setup icon and badge
        this._updateIcon();

        // Migrate legacy data if needed
        await this._migrateLegacyData();

        this.initialized = true;
        logger.info('Background service initialized successfully');

      } catch (error) {
        logger.error('Background service initialization failed:', error);
        throw error;
      }
    }

    /**
     * Register additional message handlers
     */
    _registerMessageHandlers() {
      if (!this.messageHandler) return;

      // Translation handler with provider selection
      this.messageHandler.registerHandler('translate-smart', async (message, sender) => {
        return this._handleSmartTranslation(message.opts);
      });

      // Provider management
      this.messageHandler.registerHandler('get-providers', async () => {
        return this._getProvidersStatus();
      });

      this.messageHandler.registerHandler('test-provider', async (message) => {
        return this._testProvider(message.providerId, message.apiKey);
      });

      // Auto-translate management
      this.messageHandler.registerHandler('auto-translate', async (message) => {
        return this._handleAutoTranslate(message.enabled);
      });

      // Page translation
      this.messageHandler.registerHandler('translate-page', async (message, sender) => {
        return this._handlePageTranslation(sender.tab?.id);
      });
    }

    /**
     * Handle smart translation with provider selection
     */
    async _handleSmartTranslation(opts) {
      try {
        if (!this.configManager || !this.storageManager) {
          throw new Error('Core services not available');
        }

        this.activeTranslations++;
        this._updateIcon();

        // Get current configuration
        const config = await this.storageManager.getConfig(this.configManager.createDefault());

        // Select best provider
        const textLength = opts.text ? opts.text.length : 0;
        const strategy = opts.strategy || config.translation?.strategy || 'smart';
        const selectedProvider = this.configManager.selectProvider(config, strategy, textLength);

        if (!selectedProvider) {
          throw new Error('No providers available');
        }

        // Get API key for selected provider
        const apiKey = await this.storageManager.getProviderApiKey(selectedProvider.id);
        if (!apiKey) {
          throw new Error(`No API key configured for provider: ${selectedProvider.name}`);
        }

        // Update options with selected provider
        const translationOpts = {
          ...opts,
          provider: selectedProvider.id,
          endpoint: selectedProvider.endpoint,
          model: selectedProvider.model,
          apiKey
        };

        // Perform translation
        const result = await self.qwenTranslate(translationOpts);

        // Update usage statistics
        this._updateUsageStats(selectedProvider.id, textLength, result);

        return {
          ...result,
          provider: selectedProvider.id,
          providerName: selectedProvider.name
        };

      } catch (error) {
        logger.error('Smart translation failed:', error);
        return { error: error.message };
      } finally {
        this.activeTranslations--;
        this._updateIcon();
      }
    }

    /**
     * Get providers status
     */
    async _getProvidersStatus() {
      try {
        if (!this.configManager || !this.storageManager) {
          throw new Error('Core services not available');
        }

        const config = await this.storageManager.getConfig(this.configManager.createDefault());
        const providers = [];

        for (const [providerId, provider] of Object.entries(config.providers || {})) {
          const apiKey = await this.storageManager.getProviderApiKey(providerId);
          const usageStats = this.usageStats.providers.get(providerId) || {
            requests: 0,
            tokens: 0,
            errors: 0
          };

          providers.push({
            id: providerId,
            name: provider.name,
            type: provider.type,
            enabled: provider.enabled,
            hasApiKey: !!apiKey,
            endpoint: provider.endpoint,
            features: provider.features,
            limits: provider.limits,
            priority: provider.priority,
            usage: usageStats
          });
        }

        return { providers };
      } catch (error) {
        logger.error('Failed to get providers status:', error);
        return { error: error.message };
      }
    }

    /**
     * Test provider configuration
     */
    async _testProvider(providerId, apiKey) {
      try {
        if (!this.configManager) {
          throw new Error('Configuration manager not available');
        }

        const provider = this.configManager.getProviderConfig({
          providers: { [providerId]: this.configManager.PROVIDER_DEFAULTS[providerId] }
        }, providerId);

        if (!provider) {
          throw new Error(`Unknown provider: ${providerId}`);
        }

        // Test translation
        const testOpts = {
          provider: providerId,
          endpoint: provider.endpoint,
          model: provider.model,
          apiKey,
          text: 'Hello',
          source: 'en',
          target: 'es',
          stream: false,
          noProxy: true
        };

        const result = await self.qwenTranslate(testOpts);

        if (result && result.text) {
          return {
            success: true,
            text: result.text,
            provider: providerId
          };
        } else {
          return {
            success: false,
            error: 'No translation result'
          };
        }
      } catch (error) {
        logger.error(`Provider test failed for ${providerId}:`, error);
        return {
          success: false,
          error: error.message
        };
      }
    }

    /**
     * Handle auto-translate toggle
     */
    async _handleAutoTranslate(enabled) {
      try {
        if (!this.storageManager) {
          throw new Error('Storage manager not available');
        }

        await this.storageManager.setConfig({ autoTranslate: enabled });

        if (enabled) {
          // Inject content script into active tab
          const tabs = await this._queryTabs({ active: true, currentWindow: true });
          const [activeTab] = tabs || [];
          if (activeTab?.id) {
            await this._injectAndStartContentScript(activeTab.id);
          }
        } else {
          // Stop translation in all tabs
          const tabs = await this._queryTabs({});
          for (const tab of tabs || []) {
            if (tab.id) {
              this._sendTabMessage(tab.id, { action: 'stop' });
            }
          }
        }

        return { success: true, autoTranslate: enabled };
      } catch (error) {
        logger.error('Auto-translate toggle failed:', error);
        return { error: error.message };
      }
    }

    /**
     * Handle page translation
     */
    async _handlePageTranslation(tabId) {
      try {
        if (!tabId) {
          throw new Error('No tab ID provided');
        }

        await this._injectAndStartContentScript(tabId);
        return { success: true, tabId };
      } catch (error) {
        logger.error('Page translation failed:', error);
        return { error: error.message };
      }
    }

    /**
     * Initialize throttling system
     */
    async _initializeThrottling() {
      if (!self.qwenThrottle || !this.storageManager) return;

      try {
        const config = await this.storageManager.getConfig({
          requestLimit: 100,
          tokenLimit: 50000
        });

        self.qwenThrottle.configure({
          requestLimit: config.requestLimit,
          tokenLimit: config.tokenLimit,
          windowMs: 60000
        });

        logger.info('Throttling initialized');
      } catch (error) {
        logger.warn('Throttling initialization failed:', error);
      }
    }

    /**
     * Setup event listeners
     */
    _setupEventListeners() {
      // Extension lifecycle
      if (chrome.runtime?.onInstalled) {
        chrome.runtime.onInstalled.addListener(this._handleInstall.bind(this));
      }

      if (chrome.runtime?.onStartup) {
        chrome.runtime.onStartup.addListener(this._handleStartup.bind(this));
      }

      // Tab events
      if (chrome.tabs?.onUpdated) {
        chrome.tabs.onUpdated.addListener(this._handleTabUpdate.bind(this));
      }

      if (chrome.tabs?.onActivated) {
        chrome.tabs.onActivated.addListener(this._handleTabActivated.bind(this));
      }

      // Context menu events
      if (chrome.contextMenus?.onClicked) {
        chrome.contextMenus.onClicked.addListener(this._handleContextMenu.bind(this));
      }

      // Command events
      if (chrome.commands?.onCommand) {
        chrome.commands.onCommand.addListener(this._handleCommand.bind(this));
      }
    }

    /**
     * Handle extension install/update
     */
    async _handleInstall(details) {
      this._createContextMenus();

      if (details.reason === 'install') {
        logger.info('Extension installed');
      } else if (details.reason === 'update') {
        logger.info('Extension updated');
        await this._migrateLegacyData();
      }
    }

    /**
     * Handle extension startup
     */
    _handleStartup() {
      this._createContextMenus();
    }

    /**
     * Handle tab update
     */
    async _handleTabUpdate(tabId, changeInfo, tab) {
      if (changeInfo.status === 'complete' && tab?.url && tab.active) {
        await this._maybeAutoInject(tabId, tab.url);
      }
    }

    /**
     * Handle tab activation
     */
    async _handleTabActivated({ tabId }) {
      try {
        const tab = await new Promise(resolve => {
          chrome.tabs.get(tabId, t => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(t);
          });
        });

        if (tab?.url && tab.status === 'complete') {
          await this._maybeAutoInject(tabId, tab.url);
        }
      } catch (error) {
        // Ignore tab access errors
      }
    }

    /**
     * Handle context menu clicks
     */
    async _handleContextMenu(info, tab) {
      if (!tab?.id) return;

      switch (info.menuItemId) {
        case 'translate-selection':
          await this._injectContentScript(tab.id);
          this._sendTabMessage(tab.id, { action: 'translate-selection' });
          break;

        case 'translate-page':
          await this._injectAndStartContentScript(tab.id);
          break;

        case 'enable-auto-translate':
          if (this.storageManager) {
            await this.storageManager.setConfig({ autoTranslate: true });
            await this._injectAndStartContentScript(tab.id);
          }
          break;
      }
    }

    /**
     * Handle keyboard commands
     */
    async _handleCommand(command) {
      const tabs = await this._queryTabs({ active: true, currentWindow: true });
      const [tab] = tabs || [];

      if (!tab?.id) return;

      switch (command) {
        case 'translate-selection':
          await this._injectContentScript(tab.id);
          this._sendTabMessage(tab.id, { action: 'translate-selection' });
          break;
      }
    }

    /**
     * Create context menus
     */
    _createContextMenus() {
      try {
        chrome.contextMenus?.removeAll(() => {
          chrome.contextMenus?.create({
            id: 'translate-selection',
            title: 'Translate selection',
            contexts: ['selection']
          });

          chrome.contextMenus?.create({
            id: 'translate-page',
            title: 'Translate page',
            contexts: ['page']
          });

          chrome.contextMenus?.create({
            id: 'enable-auto-translate',
            title: 'Enable auto-translate on this site',
            contexts: ['page']
          });
        });
      } catch (error) {
        logger.warn('Context menu creation failed:', error);
      }
    }

    /**
     * Maybe auto-inject content script
     */
    async _maybeAutoInject(tabId, url) {
      if (!this.storageManager) return;

      try {
        const config = await this.storageManager.getConfig({ autoTranslate: false });
        if (!config.autoTranslate) return;

        if (!this._isUrlEligible(url)) return;

        await this._injectAndStartContentScript(tabId);
      } catch (error) {
        // Ignore injection errors
      }
    }

    /**
     * Check if URL is eligible for translation
     */
    _isUrlEligible(url) {
      try {
        const parsedUrl = new URL(url);
        return ['http:', 'https:', 'file:'].includes(parsedUrl.protocol);
      } catch {
        return false;
      }
    }

    /**
     * Inject content script
     */
    async _injectContentScript(tabId) {
      try {
        await chrome.scripting?.executeScript({
          target: { tabId, allFrames: true },
          files: [
            'lib/logger.js',
            'lib/messaging.js',
            'config.js',
            'throttle.js',
            'translator.js',
            'contentScript.js'
          ]
        });
      } catch (error) {
        logger.warn('Content script injection failed:', error);
      }
    }

    /**
     * Inject content script and start translation
     */
    async _injectAndStartContentScript(tabId) {
      await this._injectContentScript(tabId);
      this._sendTabMessage(tabId, { action: 'start' });
    }

    /**
     * Query tabs
     */
    async _queryTabs(queryInfo) {
      if (!chrome.tabs?.query) return [];

      return new Promise((resolve) => {
        chrome.tabs.query(queryInfo, (tabs) => {
          if (chrome.runtime.lastError) {
            resolve([]);
          } else {
            resolve(tabs || []);
          }
        });
      });
    }

    /**
     * Send message to tab
     */
    _sendTabMessage(tabId, message) {
      if (!chrome.tabs?.sendMessage) return;

      chrome.tabs.sendMessage(tabId, message, () => {
        if (chrome.runtime.lastError) {
          // Ignore send errors
        }
      });
    }

    /**
     * Update usage statistics
     */
    _updateUsageStats(providerId, textLength, result) {
      this.usageStats.requests++;
      this.usageStats.tokens += Math.ceil(textLength / 4); // Approximate tokens

      if (!this.usageStats.providers.has(providerId)) {
        this.usageStats.providers.set(providerId, {
          requests: 0,
          tokens: 0,
          errors: 0
        });
      }

      const providerStats = this.usageStats.providers.get(providerId);
      providerStats.requests++;
      providerStats.tokens += Math.ceil(textLength / 4);

      if (result.error) {
        providerStats.errors++;
      }

      // Update throttling
      if (self.qwenThrottle) {
        self.qwenThrottle.recordUsage(Math.ceil(textLength / 4));
      }
    }

    /**
     * Update extension icon
     */
    _updateIcon() {
      const busy = this.activeTranslations > 0;

      // Update badge
      chrome.action?.setBadgeText({
        text: busy ? '...' : ''
      });

      chrome.action?.setBadgeBackgroundColor({
        color: busy ? '#ff4500' : '#00000000'
      });

      // Simple icon update - could be enhanced with usage visualization
      if (busy) {
        chrome.action?.setIcon({
          path: {
            16: 'icon-16.png',
            32: 'icon-32.png',
            48: 'icon-48.png',
            128: 'icon-128.png'
          }
        });
      }
    }

    /**
     * Migrate legacy data
     */
    async _migrateLegacyData() {
      if (!this.storageManager) return;

      try {
        await this.storageManager.migrateLegacyKeys();
        logger.info('Legacy data migration completed');
      } catch (error) {
        logger.warn('Legacy data migration failed:', error);
      }
    }
  }

  // Initialize background service
  const backgroundService = new BackgroundService();

  // Start initialization when the service worker starts
  backgroundService.initialize().catch(error => {
    logger.error('Failed to initialize background service:', error);
  });

  // Expose for testing
  if (typeof module !== 'undefined') {
    module.exports = { backgroundService };
  }

})();