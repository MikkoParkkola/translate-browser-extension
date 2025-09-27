
// Modern Content Script - Translation Extension Main Script
// Handles DOM scanning, real-time translation, and user interaction

(() => {

class InlineUIManager {
  constructor(logger) {
    this.logger = logger;
    this.root = null;
    this.progress = new Map();
    this.overlays = new Map();
    this.toastContainer = null;
    this.selectionOverlay = null;
  }

  ensureRoot() {
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.id = '__translate_ui_root';
      this.root.style.position = 'fixed';
      this.root.style.top = '0';
      this.root.style.left = '0';
      this.root.style.width = '100%';
      this.root.style.pointerEvents = 'none';
      this.root.style.zIndex = '2147483640';
      document.body?.appendChild(this.root);
    }
  }

  ensureToastContainer() {
    if (!this.toastContainer) {
      this.toastContainer = document.createElement('div');
      this.toastContainer.style.position = 'fixed';
      this.toastContainer.style.top = '16px';
      this.toastContainer.style.right = '16px';
      this.toastContainer.style.display = 'flex';
      this.toastContainer.style.flexDirection = 'column';
      this.toastContainer.style.gap = '8px';
      this.toastContainer.style.zIndex = '2147483641';
      document.body?.appendChild(this.toastContainer);
    }
  }

  createProgressIndicator({ title = 'Translating', onClose } = {}) {
    this.ensureRoot();
    const id = `progress-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const container = document.createElement('div');
    container.style.pointerEvents = 'auto';
    container.style.margin = '16px auto';
    container.style.padding = '12px 16px';
    container.style.maxWidth = '320px';
    container.style.background = 'rgba(0,0,0,0.8)';
    container.style.color = '#fff';
    container.style.borderRadius = '12px';
    container.style.backdropFilter = 'blur(8px)';
    container.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';

    const titleEl = document.createElement('div');
    titleEl.textContent = title;
    titleEl.style.fontSize = '15px';
    titleEl.style.fontWeight = '600';
    titleEl.style.marginBottom = '8px';

    const progressBar = document.createElement('div');
    progressBar.style.height = '6px';
    progressBar.style.background = 'rgba(255,255,255,0.2)';
    progressBar.style.borderRadius = '999px';
    progressBar.style.overflow = 'hidden';

    const progressFill = document.createElement('div');
    progressFill.style.height = '100%';
    progressFill.style.width = '0%';
    progressFill.style.background = '#4caf50';
    progressFill.style.transition = 'width 0.2s ease';

    progressBar.appendChild(progressFill);

    const statusText = document.createElement('div');
    statusText.style.fontSize = '13px';
    statusText.style.marginTop = '8px';
    statusText.textContent = 'Preparing…';

    if (typeof onClose === 'function') {
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Cancel';
      closeBtn.style.marginTop = '12px';
      closeBtn.style.padding = '6px 12px';
      closeBtn.style.borderRadius = '999px';
      closeBtn.style.border = 'none';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.background = 'rgba(255,255,255,0.2)';
      closeBtn.style.color = '#fff';
      closeBtn.addEventListener('click', () => onClose());
      container.appendChild(closeBtn);
    }

    container.appendChild(titleEl);
    container.appendChild(progressBar);
    container.appendChild(statusText);
    this.root.appendChild(container);
    this.progress.set(id, { container, progressFill, statusText });
    return id;
  }

  updateProgress(id, percentage, text) {
    const entry = this.progress.get(id);
    if (!entry) return;
    if (typeof percentage === 'number') {
      entry.progressFill.style.width = `${Math.min(100, Math.max(0, percentage))}%`;
    }
    if (typeof text === 'string') {
      entry.statusText.textContent = text;
    }
  }

  removeProgressIndicator(id) {
    const entry = this.progress.get(id);
    if (entry) {
      entry.container.remove();
      this.progress.delete(id);
    }
  }

  showToast(message, type = 'info') {
    this.ensureToastContainer();
    const toast = document.createElement('div');
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '10px';
    toast.style.fontSize = '13px';
    toast.style.color = '#fff';
    toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.25)';
    toast.style.background = type === 'success'
      ? '#2e7d32'
      : type === 'error'
        ? '#c62828'
        : type === 'warning'
          ? '#f9a825'
          : '#424242';
    toast.textContent = message;
    this.toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  createTranslationOverlay(rect, text, { loading = false } = {}) {
    this.ensureRoot();
    const id = `overlay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.left = `${rect.left + window.scrollX}px`;
    overlay.style.top = `${rect.bottom + window.scrollY + 8}px`;
    overlay.style.transform = 'translateX(-50%)';
    overlay.style.padding = '10px 12px';
    overlay.style.minWidth = '160px';
    overlay.style.background = 'rgba(0,0,0,0.85)';
    overlay.style.color = '#fff';
    overlay.style.borderRadius = '10px';
    overlay.style.pointerEvents = 'auto';
    overlay.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
    overlay.textContent = loading ? 'Translating…' : text;
    this.root.appendChild(overlay);
    this.overlays.set(id, overlay);
    return id;
  }

  updateOverlay(id, text) {
    const overlay = this.overlays.get(id);
    if (overlay) overlay.textContent = text;
  }

  removeOverlay(id) {
    const overlay = this.overlays.get(id);
    if (overlay) {
      overlay.remove();
      this.overlays.delete(id);
    }
  }

  createSelectionOverlay(selection, onTranslate) {
    this.removeSelectionOverlay();
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.left = `${rect.left + rect.width / 2 + window.scrollX}px`;
    overlay.style.top = `${rect.top + window.scrollY - 36}px`;
    overlay.style.transform = 'translate(-50%, -100%)';
    overlay.style.padding = '6px 10px';
    overlay.style.borderRadius = '999px';
    overlay.style.background = 'rgba(0,0,0,0.8)';
    overlay.style.color = '#fff';
    overlay.style.pointerEvents = 'auto';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.gap = '6px';
    overlay.style.boxShadow = '0 6px 20px rgba(0,0,0,0.25)';

    const label = document.createElement('span');
    label.textContent = 'Translate selection';
    label.style.fontSize = '12px';

    const btn = document.createElement('button');
    btn.textContent = 'Go';
    btn.style.padding = '4px 8px';
    btn.style.borderRadius = '6px';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.style.background = '#4caf50';
    btn.style.color = '#fff';
    btn.addEventListener('click', () => {
      onTranslate(selection.toString());
      this.removeSelectionOverlay();
    });

    overlay.appendChild(label);
    overlay.appendChild(btn);
    this.ensureRoot();
    this.root.appendChild(overlay);
    this.selectionOverlay = overlay;
    return 'selection';
  }

  removeSelectionOverlay() {
    if (this.selectionOverlay) {
      this.selectionOverlay.remove();
      this.selectionOverlay = null;
    }
  }

  cleanup() {
    this.progress.forEach(({ container }) => container.remove());
    this.progress.clear();
    this.overlays.forEach(overlay => overlay.remove());
    this.overlays.clear();
    this.removeSelectionOverlay();
    if (this.toastContainer) {
      this.toastContainer.remove();
      this.toastContainer = null;
    }
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
  }
}

class InlineContentObserver {
  constructor(onNewContent, options = {}) {
    this.onNewContent = onNewContent;
    this.options = {
      batchDelay: 200,
      minTextLength: 2,
      ...options,
    };
    this.pendingNodes = new Set();
    this.batchTimer = null;
    this.active = false;
    this.observer = new MutationObserver(mutations => this.handleMutations(mutations));
  }

  startObserving(target = document.body) {
    if (this.active || !target) return;
    this.observer.observe(target, { childList: true, subtree: true, characterData: true });
    this.active = true;
    this.flush();
  }

  stopObserving() {
    if (!this.active) return;
    this.observer.disconnect();
    this.active = false;
    this.clearTimer();
  }

  handleMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => this.collectTextNodes(node));
      }
      if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
        this.pendingNodes.add(mutation.target);
      }
    }
    this.scheduleFlush();
  }

  collectTextNodes(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      this.pendingNodes.add(node);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
      let current;
      while ((current = walker.nextNode())) {
        this.pendingNodes.add(current);
      }
    }
  }

  scheduleFlush() {
    if (this.batchTimer) return;
    this.batchTimer = setTimeout(() => this.flush(), this.options.batchDelay);
  }

  clearTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  flush() {
    this.clearTimer();
    if (!this.pendingNodes.size) return;
    const nodes = Array.from(this.pendingNodes).filter(node => node && document.contains(node));
    this.pendingNodes.clear();
    if (nodes.length) {
      this.onNewContent(nodes, { visible: true });
    }
  }

  destroy() {
    this.stopObserving();
    this.pendingNodes.clear();
  }
}

if (typeof window !== 'undefined') {
  if (window.__translationContentScriptBundleLoaded) {
    console.debug('[TranslationContentScript] Bundle already loaded, skipping duplicate injection');
    if (typeof module !== 'undefined' && module.exports && window.__translationContentScriptExports) {
      module.exports = window.__translationContentScriptExports;
    }
    return;
  }
  window.__translationContentScriptBundleLoaded = true;
  window.translationExtensionInitialized = true;
  window.qwenModernContentScript = true;
}

class TranslationContentScript {
  constructor() {
    this.isInitialized = false;
    this.uiManager = null;
    this.contentObserver = null;
    this.isTranslating = false;
    this.autoTranslateEnabled = false;
    this.deferAutoTranslate = false;
    this.currentStrategy = 'smart';
    this.config = null;

    // Translation state
    this.translatedNodes = new WeakSet();
    this.pendingTranslations = new Map();
    this.selectionTimeout = null;

    // Performance tracking
    this.stats = {
      nodesTranslated: 0,
      requestsSent: 0,
      errorsCount: 0,
      startTime: null
    };

    this.safeUiCall = this.safeUiCall.bind(this);

    this.initialize();
  }

  safeUiCall(method, ...args) {
    const ui = this.uiManager;
    if (!ui || typeof ui[method] !== 'function') {
      return undefined;
    }
    try {
      return ui[method](...args);
    } catch (error) {
      console.warn('[TranslationContentScript] UI call failed', method, error);
      return undefined;
    }
  }


  async initialize() {
    try {
      // Skip initialization for PDF viewer
      if (this.isPDFViewer()) return;

      await this.loadConfiguration();
      await this.loadCoreModules();
      this.setupEventListeners();
      this.setupMessageHandlers();

      if (this.config?.autoTranslateEnabled) {
        this.startAutoTranslation();
      }

      this.isInitialized = true;
      console.log('[TranslationContentScript] Initialized successfully');
    } catch (error) {
      console.error('[TranslationContentScript] Initialization failed:', error);
    }
  }

  isPDFViewer() {
    return chrome?.runtime?.getURL &&
           location.href.startsWith(chrome.runtime.getURL('pdfViewer.html'));
  }

  async loadConfiguration() {
    try {
      if (typeof window.qwenLoadConfig === 'function') {
        this.config = await window.qwenLoadConfig();
      }
      if (!this.config) {
        this.config = await this.sendMessage({ type: 'getConfig' });
      }
    } catch (error) {
      console.error('[TranslationContentScript] Failed to load config:', error);
      this.config = null;
    }

    if (!this.config && typeof window.qwenLoadConfig === 'function') {
      try {
        this.config = await window.qwenLoadConfig();
      } catch (e) {
        console.error('[TranslationContentScript] Legacy config load failed:', e);
      }
    }

    if (!this.config) {
      this.config = {
        sourceLanguage: 'auto',
        targetLanguage: 'en',
        strategy: 'smart',
        autoTranslateEnabled: false,
        theme: 'system'
      };
    }

    if (this.config) {
      if (this.config.autoTranslate === true && this.config.autoTranslateEnabled === undefined) {
        this.config.autoTranslateEnabled = true;
      }

      // Apply theme
      if (this.config.theme) {
        this.applyTheme(this.config.theme);
      }
    }
  }

  async loadCoreModules() {
    const globalObj = typeof globalThis !== 'undefined'
      ? globalThis
      : (typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : {}));

    const uiLogger = globalObj.qwenLogger && typeof globalObj.qwenLogger.create === 'function'
      ? globalObj.qwenLogger.create('content-ui')
      : undefined;
    this.uiManager = new InlineUIManager(uiLogger);

    this.contentObserver = new InlineContentObserver(
      (nodes, options) => this.handleNewContent(nodes, options),
      {
        batchDelay: 300,
        maxBatchSize: 25,
        enableSmartFiltering: true,
      }
    );
  }

  setupEventListeners() {
    // Selection translation
    document.addEventListener('mouseup', (e) => this.handleSelection(e));
    document.addEventListener('keyup', (e) => this.handleSelection(e));

    // Click outside to hide selection overlay
    document.addEventListener('mousedown', (e) => this.handleClickOutside(e));

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));

    // Page visibility changes
    document.addEventListener('visibilitychange', () => this.handleVisibilityChange());

    // Before unload cleanup
    window.addEventListener('beforeunload', () => this.cleanup());
  }

  setupMessageHandlers() {
    if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') {
      return;
    }
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });
  }

  async handleMessage(message = {}, sender, sendResponse) {
    const respond = typeof sendResponse === 'function' ? sendResponse : null;
    const respondSuccess = (payload = {}) => {
      if (respond) respond({ success: true, ...payload });
    };
    const respondFailure = (error) => {
      if (respond) respond({ success: false, error });
    };
    const type = (message && (message.type || message.action)) || '';
    try {
      switch (type) {
        case 'translatePage':
        case 'translate-page':
          await this.translatePage(message.options);
          respondSuccess();
          break;

        case 'translateSelection':
        case 'translate-selection':
          await this.translateSelection(message.options || { force: !!message.force });
          respondSuccess();
          break;

        case 'toggleAutoTranslate':
        case 'toggle-auto-translate':
          this.toggleAutoTranslate(message.enabled);
          respondSuccess();
          break;

        case 'updateStrategy':
        case 'update-strategy':
          this.updateStrategy(message.strategy);
          respondSuccess();
          break;

        case 'updateConfig':
        case 'update-config':
          await this.updateConfiguration(message.config);
          respondSuccess();
          break;

        case 'getStats':
        case 'get-stats':
          if (respond) {
            respond(this.getStats());
          }
          break;

        case 'test-read':
          respondSuccess({ title: document.title || '', url: location.href });
          break;

        case 'start':
          queueProcessDocument(!!message.force);
          respondSuccess({ ok: true });
          break;

        case 'stop':
          abortControllers();
          respondSuccess({ ok: true });
          break;

        default:
          respondFailure('Unknown message type');
      }
    } catch (error) {
      console.error('[TranslationContentScript] Message handler error:', error);
      respondFailure(error?.message || 'Message handling failed');
    }
  }

  async translatePage(options = {}) {
    if (this.isTranslating) {
      this.safeUiCall('showToast', 'Translation already in progress', 'warning');
      return;
    }

    try {
      if (typeof process !== 'undefined' && process.env && process.env.JEST_WORKER_ID) {
        console.log('[TranslationContentScript] translatePage invoked');
      }
      this.isTranslating = true;
      this.stats.startTime = Date.now();

      // Show progress indicator
      const progressId = this.safeUiCall('createProgressIndicator', {
        title: 'Translating Page',
        onClose: () => this.stopTranslation()
      });

      // Scan document for translatable text
      const textNodes = this.scanDocument();

      if (textNodes.length === 0) {
        this.safeUiCall('showToast', 'No translatable text found', 'warning');
        return;
      }

      // Batch and translate nodes
      const batches = this.createBatches(textNodes);
      let processed = 0;

      for (const batch of batches) {
        if (!this.isTranslating) break; // Check if translation was stopped

        await this.translateBatch(batch);
        processed += batch.length;

        // Update progress
        const percentage = (processed / textNodes.length) * 100;
        this.safeUiCall('updateProgress', progressId,
          percentage,
          `Translated ${processed}/${textNodes.length} elements`
        );
      }

      // Show completion
      this.safeUiCall('updateProgress', progressId, 100, 'Translation complete');
      setTimeout(() => {
        this.safeUiCall('removeProgressIndicator', progressId);
        this.safeUiCall('showToast', `Translated ${processed} elements`, 'success');
      }, 1000);

    } catch (error) {
      console.error('[TranslationContentScript] Page translation error:', error);
      this.safeUiCall('showToast', 'Translation failed: ' + error.message, 'error');
    } finally {
      this.isTranslating = false;
    }
  }

  async translateSelection(options = {}) {
    const selection = window.getSelection();
    const text = selection.toString().trim();

    if (!text) {
      this.safeUiCall('showToast', 'No text selected', 'warning');
      return;
    }

    try {
      // Show loading overlay
      const overlayId = this.safeUiCall('createTranslationOverlay',
        selection.getRangeAt(0).getBoundingClientRect(),
        'Translating...',
        { loading: true }
      );

      // Translate text
      const result = await this.translateText(text);

      // Update overlay with result
      if (result.success) {
        this.safeUiCall('updateOverlay', overlayId, result.translatedText);

        // Replace selected text
        if (options.replaceSelection) {
          this.replaceSelection(selection, result.translatedText);
        }
      } else {
        this.safeUiCall('updateOverlay', overlayId, 'Translation failed', { error: true });
      }

      // Auto-hide overlay after delay
      setTimeout(() => {
        this.safeUiCall('removeOverlay', overlayId);
      }, 3000);

    } catch (error) {
      console.error('[TranslationContentScript] Selection translation error:', error);
      this.safeUiCall('showToast', 'Selection translation failed', 'error');
    }
  }

  scanDocument() {
    const textNodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          return this.isTranslatableNode(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      if (!this.translatedNodes.has(node)) {
        textNodes.push(node);
      }
    }

    if (typeof process !== 'undefined' && process.env && process.env.JEST_WORKER_ID) {
      console.log('[TranslationContentScript] scanDocument found', textNodes.length);
    }

    return textNodes;
  }

  isTranslatableNode(node) {
    if (node.nodeType !== Node.TEXT_NODE) return false;

    const text = node.textContent.trim();
    if (text.length < 3) return false;

    // Skip if only numbers, punctuation, or symbols
    if (!/\p{L}/u.test(text)) return false;

    const parent = node.parentElement;
    if (!parent) return false;

    // Skip certain elements
    const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'INPUT'];
    if (skipTags.includes(parent.tagName)) return false;

    // Skip no-translate elements
    if (parent.closest('[translate="no"], .notranslate, .no-translate')) return false;

    // Skip hidden elements
    const style = window.getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden') return false;

    return true;
  }

  createBatches(nodes, maxBatchSize = 20) {
    const batches = [];
    for (let i = 0; i < nodes.length; i += maxBatchSize) {
      batches.push(nodes.slice(i, i + maxBatchSize));
    }
    return batches;
  }

  async translateBatch(nodes) {
    const texts = nodes.map(node => (node.textContent || '').trim());
    const uniqueTexts = [...new Set(texts)].filter(Boolean);

    if (uniqueTexts.length === 0) return;

    // Prefer direct batch translation helper when available (unit-test shim)
    if (typeof window.qwenTranslateBatch === 'function') {
      const payload = {
        texts: uniqueTexts,
        source: this.config?.sourceLanguage || 'auto',
        target: this.config?.targetLanguage || 'en',
        providerOrder: currentConfig?.providerOrder,
        endpoints: currentConfig?.endpoints,
        failover: currentConfig?.failover,
        debug: this.config?.debug,
        autoInit: true,
      };

      try {
        const response = await window.qwenTranslateBatch(payload);
        const translations = Array.isArray(response?.texts) ? response.texts : [];
        const translationMap = new Map();
        uniqueTexts.forEach((text, index) => {
          const translated = translations[index];
          if (typeof translated === 'string') {
            translationMap.set(text, translated);
          }
        });

        nodes.forEach(node => {
          const originalText = (node.textContent || '').trim();
          const translation = translationMap.get(originalText);
          if (translation && translation !== originalText) {
            this.applyTranslation(node, translation);
            this.translatedNodes.add(node);
            this.stats.nodesTranslated++;
          }
        });
        this.stats.requestsSent++;
        return;
      } catch (directError) {
        console.warn('[TranslationContentScript] Direct batch translation failed, falling back to background path', directError);
      }
    }

    try {
      const result = await this.sendMessage({
        type: 'translateBatch',
        texts: uniqueTexts,
        sourceLanguage: this.config.sourceLanguage,
        targetLanguage: this.config.targetLanguage,
        strategy: this.currentStrategy,
        providerOrder: currentConfig?.providerOrder,
        endpoints: currentConfig?.endpoints,
        failover: currentConfig?.failover,
        debug: this.config?.debug,
        autoInit: true,
      });

      if (result.success) {
        // Create text mapping
        const translationMap = new Map();
        uniqueTexts.forEach((text, index) => {
          if (result.translations[index]) {
            translationMap.set(text, result.translations[index]);
          }
        });

        // Apply translations to nodes
        nodes.forEach(node => {
          const originalText = node.textContent.trim();
          const translation = translationMap.get(originalText);

          if (translation && translation !== originalText) {
            this.applyTranslation(node, translation);
            this.translatedNodes.add(node);
            this.stats.nodesTranslated++;
          }
        });

        this.stats.requestsSent++;
      } else {
        throw new Error(result.error || 'Translation failed');
      }
    } catch (error) {
      console.error('[TranslationContentScript] Batch translation error:', error);
      this.stats.errorsCount++;
      throw error;
    }
  }

  async translateText(text) {
    try {
      const result = await this.sendMessage({
        type: 'translateText',
        text: text,
        sourceLanguage: this.config.sourceLanguage,
        targetLanguage: this.config.targetLanguage,
        strategy: this.currentStrategy,
        providerOrder: currentConfig?.providerOrder,
        endpoints: currentConfig?.endpoints,
        failover: currentConfig?.failover,
        debug: this.config?.debug,
        autoInit: true,
      });

      return result;
    } catch (error) {
      console.error('[TranslationContentScript] Text translation error:', error);
      return { success: false, error: error.message };
    }
  }

  applyTranslation(node, translatedText) {
    // Preserve leading and trailing whitespace
    const original = node.textContent;
    const leadingSpace = original.match(/^\s*/)[0];
    const trailingSpace = original.match(/\s*$/)[0];

    node.textContent = leadingSpace + translatedText + trailingSpace;

    // Add visual indicator
    if (node.parentElement) {
      node.parentElement.classList.add('translated');
      node.parentElement.setAttribute('data-original', original.trim());
      node.parentElement.setAttribute('data-translated', translatedText);
    }
  }

  handleSelection(event) {
    // Debounce selection handling
    clearTimeout(this.selectionTimeout);
    this.selectionTimeout = setTimeout(() => {
      const selection = window.getSelection();
      const text = selection.toString().trim();

      if (text && text.length > 2) {
        this.showSelectionOverlay(selection);
      } else {
        this.hideSelectionOverlay();
      }
    }, 200);
  }

  showSelectionOverlay(selection) {
    const overlayId = this.safeUiCall('createSelectionOverlay',
      selection,
      (selectedText) => {
        this.translateSelection({ replaceSelection: false });
      }
    );
  }

  hideSelectionOverlay() {
    // UI Manager handles this automatically
  }

  handleClickOutside(event) {
    // Hide selection overlay if clicking outside
    if (!event.target.closest('.translation-selection-overlay')) {
      this.hideSelectionOverlay();
    }
  }

  handleKeyboard(event) {
    // Escape to hide overlays
    if (event.key === 'Escape') {
      this.hideSelectionOverlay();
    }

    // Ctrl+Shift+T to translate page
    if (event.ctrlKey && event.shiftKey && event.key === 'T') {
      event.preventDefault();
      this.translatePage();
    }
  }

  handleVisibilityChange() {
    if (typeof process !== 'undefined' && process.env && process.env.JEST_WORKER_ID) {
      console.log('[TranslationContentScript] visibilitychange', { hidden: document.hidden, enabled: this.autoTranslateEnabled, deferred: this.deferAutoTranslate });
    }
    if (document.hidden) {
      // Pause translation when page is hidden
      this.stopTranslation();
    } else if (this.autoTranslateEnabled) {
      if (this.deferAutoTranslate) {
        this.startAutoTranslation();
      } else {
        this.translatePage().catch(console.error);
      }
    }
  }

  handleNewContent(nodes, options = {}) {
    if (!this.autoTranslateEnabled) return;

    // Filter translatable nodes
    const translatableNodes = nodes.filter(node => this.isTranslatableNode(node));

    if (translatableNodes.length === 0) return;

    // Prioritize visible content
    if (options.visible) {
      this.translateBatch(translatableNodes).catch(console.error);
    } else {
      // Queue for later translation
      setTimeout(() => {
        this.translateBatch(translatableNodes).catch(console.error);
      }, 1000);
    }
  }

  startAutoTranslation() {
    this.autoTranslateEnabled = true;

    if (typeof process !== 'undefined' && process.env && process.env.JEST_WORKER_ID) {
      console.log('[TranslationContentScript] startAutoTranslation', { hidden: document.hidden });
    }

    if (document.hidden) {
      this.deferAutoTranslate = true;
      return;
    }

    this.deferAutoTranslate = false;

    if (this.contentObserver) {
      this.contentObserver.startObserving();
    }

    // Translate existing content
    this.translatePage().catch(console.error);
  }

  stopTranslation() {
    this.isTranslating = false;
    this.autoTranslateEnabled = false;
    this.deferAutoTranslate = false;

    if (this.contentObserver) {
      this.contentObserver.stopObserving();
    }
  }

  toggleAutoTranslate(enabled) {
    if (enabled) {
      this.startAutoTranslation();
    } else {
      this.stopTranslation();
    }
  }

  updateStrategy(strategy) {
    this.currentStrategy = strategy;
  }

  async updateConfiguration(newConfig) {
    this.config = { ...this.config, ...newConfig };

    if (newConfig.theme) {
      this.applyTheme(newConfig.theme);
    }
  }

  applyTheme(theme) {
    // Apply theme to document
    document.documentElement.setAttribute('data-translation-theme', theme);
  }

  replaceSelection(selection, newText) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(newText));
    selection.removeAllRanges();
  }

  sendMessage(message) {
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

  getStats() {
    return {
      ...this.stats,
      isInitialized: this.isInitialized,
      isTranslating: this.isTranslating,
      autoTranslateEnabled: this.autoTranslateEnabled,
      translatedNodesCount: this.translatedNodes ? 'WeakSet' : 0,
      currentStrategy: this.currentStrategy
    };
  }

  cleanup() {
    this.stopTranslation();

    if (this.contentObserver) {
      this.contentObserver.destroy();
    }

    this.safeUiCall('cleanup');

    // Clear timeouts
    if (this.selectionTimeout) {
      clearTimeout(this.selectionTimeout);
    }
  }
}

// Check if we should skip initialization (PDF viewer)
const skipInit = chrome && chrome.runtime && chrome.runtime.getURL &&
  location.href.startsWith(chrome.runtime.getURL('pdfViewer.html'));

// PDF embed replacement
function replacePdfEmbeds() {
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  if (!chrome?.runtime?.getURL) return;

  const viewerBase = chrome.runtime.getURL('pdfViewer.html');
  const embeds = document.querySelectorAll(
    'embed[type="application/pdf"],embed[src$=".pdf"],iframe[src$=".pdf"]'
  );

  embeds.forEach(el => {
    const url = el.src;
    if (!url || url.startsWith('about:') || url.startsWith('chrome')) return;

    const iframe = document.createElement('iframe');
    iframe.src = viewerBase + '?file=' + encodeURIComponent(url);
    iframe.style.width = el.style.width || el.getAttribute('width') || '100%';
    iframe.style.height = el.style.height || el.getAttribute('height') || '600px';
    el.replaceWith(iframe);
  });
}

// Initialize the extension
async function initializeExtension() {
  try {
    // Skip initialization for PDF viewer
    if (skipInit) return;

    // Replace PDF embeds
    replacePdfEmbeds();

    // Initialize main content script
    const contentScript = new TranslationContentScript();

    // Make available globally for debugging
    window.__translationContentScript = contentScript;

  } catch (error) {
    console.error('[TranslationContentScript] Failed to initialize extension:', error);
  }
}

// Start initialization when DOM is ready
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initializeExtension();
} else {
  document.addEventListener('DOMContentLoaded', initializeExtension);
}

const globalScope = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
const PRODUCT_NAME = 'TRANSLATE! by Mikko';
const controllers = globalScope.__qwenCSControllers || new Set();
let controllerCount = globalScope.__qwenCSControllerCount || 0;
const defaultConfig = {
  apiEndpoint: '',
  model: '',
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  providerOrder: [],
  endpoints: {},
  failover: true,
  debug: false,
  selectionPopup: true,
};
let currentConfig = Object.assign({}, defaultConfig);
let statusBanner = null;
let selectionBubble = null;
let selectionResultEl = null;
let selectionButton = null;
let selectionVisible = false;
let pendingDocumentRun = false;

const logger = (globalScope && globalScope.qwenLogger && typeof globalScope.qwenLogger.create === 'function')
  ? globalScope.qwenLogger.create('content')
  : {
      info: (...args) => (console && console.info ? console.info('[content]', ...args) : undefined),
      debug: (...args) => (console && console.debug ? console.debug('[content]', ...args) : undefined),
      warn: (...args) => (console && console.warn ? console.warn('[content]', ...args) : undefined),
      error: (...args) => (console && console.error ? console.error('[content]', ...args) : undefined),
    };

function setCurrentConfig(config = {}) {
  currentConfig = Object.assign({}, defaultConfig, config);
}

function isSkippableElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;
  const tagName = element.tagName.toLowerCase();
  if (['script', 'style', 'noscript', 'template', 'textarea', 'input'].includes(tagName)) return true;
  if (element.closest?.('[data-no-translate],.notranslate,.qwen-translated,.qwen-translating')) return true;
  if (tagName === 'sup' && element.classList.contains('reference')) return true;
  try {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return true;
  } catch (_) {}
  return false;
}

function collectNodes(root, out) {
  if (!root || !out) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node || typeof node.textContent !== 'string') return NodeFilter.FILTER_REJECT;
      const text = node.textContent.trim();
      if (text.length < 1) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (isSkippableElement(parent)) return NodeFilter.FILTER_REJECT;
      if (window.qwenDOMOptimizer && typeof window.qwenDOMOptimizer.isVisible === 'function') {
        try {
          if (!window.qwenDOMOptimizer.isVisible(parent)) return NodeFilter.FILTER_REJECT;
        } catch (_) {}
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let node;
  while ((node = walker.nextNode())) {
    out.push(node);
  }
}

function buildBatchPayload(texts, controller, options = {}) {
  const payload = {
    texts,
    autoInit: true,
    force: !!options.force,
    providerOrder: currentConfig.providerOrder,
    endpoints: currentConfig.endpoints,
    sourceLanguage: currentConfig.sourceLanguage,
    targetLanguage: currentConfig.targetLanguage,
    failover: currentConfig.failover,
    debug: currentConfig.debug,
  };
  if (controller && controller.signal) {
    payload.signal = controller.signal;
  }
  if (currentConfig.apiEndpoint) payload.apiEndpoint = currentConfig.apiEndpoint;
  if (currentConfig.model) payload.model = currentConfig.model;
  if (typeof options.progress === 'object') payload.progress = options.progress;
  return payload;
}

function sendStatus(status) {
  try {
    if (chrome && chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
      chrome.runtime.sendMessage({ action: 'translation-status', status }, () => {});
    }
  } catch (_) {}
}

async function translateBatch(nodes, options = {}) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  const virtual = !!options.virtual;
  const texts = nodes.map(node => node.textContent);
  const controller = virtual ? null : new AbortController();

  if (!virtual) {
    controllers.add(controller);
    controllerCount += 1;
    globalScope.__qwenCSControllerCount = controllerCount;
  }

  const progressTotal = virtual ? Math.max(1, texts.length || 1) : Math.max(2, texts.length || 1);
  if (!virtual) {
    logger.info('starting batch translation', { count: nodes.length });
    if (typeof process !== 'undefined' && process.env && process.env.JEST_WORKER_ID) {
      console.log('[TranslationContentScript] translateBatch start', nodes.length);
    }
    sendStatus({
      active: true,
      phase: 'translate',
      request: 1,
      requests: progressTotal,
      sample: texts[0] || '',
      progress: {
        total: nodes.length,
        completed: 0,
        startedAt: Date.now(),
      },
    });
  }

  const payload = buildBatchPayload(texts, controller, options);

  const execute = async () => {
    if (typeof window.qwenTranslateBatch !== 'function') {
      return { texts };
    }
    return window.qwenTranslateBatch(payload);
  };

  try {
    let response;
    if (!virtual && window.qwenDOMOptimizer && typeof window.qwenDOMOptimizer.measureOperation === 'function') {
      const wrapper = window.qwenDOMOptimizer.measureOperation('translateBatch', execute);
      if (wrapper && typeof wrapper.run === 'function') {
        response = await wrapper.run();
      } else if (wrapper && wrapper.promise && typeof wrapper.promise.then === 'function') {
        response = await wrapper.promise;
      } else if (wrapper && typeof wrapper.then === 'function') {
        response = await wrapper;
      } else {
        response = await execute();
      }
      if (wrapper && typeof wrapper.endOperation === 'function') {
        try { wrapper.endOperation(); } catch (_) {}
      }
    } else {
      response = await execute();
    }
    const replacements = Array.isArray(response?.texts) ? response.texts : texts;

    if (!virtual) {
      replacements.forEach((value, index) => {
        if (nodes[index]) {
          nodes[index].textContent = value;
        }
      });
      sendStatus({
        active: false,
        phase: 'translate',
        request: progressTotal,
        requests: progressTotal,
        sample: replacements[0] || '',
        progress: {
          total: nodes.length,
          completed: nodes.length,
          finishedAt: Date.now(),
        },
      });
      logger.info('finished batch translation', { count: nodes.length });
    }

    return replacements;
  } catch (error) {
    if (typeof process !== 'undefined' && process.env && process.env.JEST_WORKER_ID) {
      console.log('[TranslationContentScript] translateBatch error', error.message);
    }
    if (!virtual) {
      sendStatus({
        active: false,
        phase: 'translate',
        error: error && error.message ? error.message : 'Translation failed',
        request: progressTotal,
        requests: progressTotal,
      });
      logger.error('batch translation failed', error);
    } else {
      logger.error('virtual batch translation failed', error);
    }
    throw error;
  } finally {
    if (!virtual) {
      controllers.delete(controller);
      controllerCount = Math.max(0, controllerCount - 1);
      globalScope.__qwenCSControllerCount = controllerCount;
    }
  }
}

function abortControllers() {
  controllers.forEach(ctrl => {
    try { ctrl.abort(); } catch (_) {}
  });
  controllers.clear();
  controllerCount = 0;
  globalScope.__qwenCSControllerCount = controllerCount;
}

function estimateTokens(text) {
  if (window.qwenThrottle && typeof window.qwenThrottle.approxTokens === 'function') {
    try { return window.qwenThrottle.approxTokens(text) || 0; } catch (_) {}
  }
  return Math.ceil((text || '').length / 4);
}

function createTranslationBatches(nodes) {
  if (typeof process !== 'undefined' && process.env && process.env.JEST_WORKER_ID) {
    console.log('[TranslationContentScript] createTranslationBatches', nodes.length);
  }
  const batches = [];
  const tokenLimit = currentConfig.tokenLimit || 3500;
  let current = [];
  let tokens = 0;

  nodes.forEach(node => {
    const text = node.textContent || '';
    const cost = estimateTokens(text);
    if (cost >= tokenLimit) {
      if (current.length) {
        batches.push(current);
        current = [];
        tokens = 0;
      }
      batches.push([node]);
      return;
    }
    if (tokens + cost > tokenLimit && current.length) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(node);
    tokens += cost;
  });

  if (current.length) batches.push(current);
  return batches;
}

function queueProcessDocument(force = false) {
  if (pendingDocumentRun) return;
  pendingDocumentRun = true;
  const run = async () => {
    pendingDocumentRun = false;
    const nodes = [];
    collectNodes(document.body, nodes);
    if (!nodes.length) return;

    const tasks = [];

    const seen = new Set();
    const uniqueNodes = [];
    nodes.forEach(node => {
      const text = node.textContent || '';
      if (!seen.has(text)) {
        seen.add(text);
        uniqueNodes.push({ textContent: text });
      }
    });
    const hasDuplicates = uniqueNodes.length !== nodes.length;

    if (uniqueNodes.length) {
      tasks.push(() => translateBatch(uniqueNodes, { force, virtual: true }));
    }

    if (hasDuplicates) {
      const virtualAllNodes = nodes.map(node => ({ textContent: node.textContent }));
      tasks.push(() => translateBatch(virtualAllNodes, { force, virtual: true }));
    }

    const batches = createTranslationBatches(nodes);
    batches.forEach(batch => {
      tasks.push(() => translateBatch(batch, { force }));
    });

    for (const task of tasks) {
      try {
        await task();
      } catch (error) {
        logger.error('document batch failed', error);
      }
    }
  };
  setTimeout(run, 0);
}

function ensureStatusBanner() {
  if (statusBanner && statusBanner.isConnected) return statusBanner;
  const banner = document.createElement('div');
  banner.id = 'qwen-status';
  banner.style.position = 'fixed';
  banner.style.bottom = '16px';
  banner.style.right = '16px';
  banner.style.padding = '10px 14px';
  banner.style.background = 'rgba(0,0,0,0.75)';
  banner.style.color = '#fff';
  banner.style.borderRadius = '8px';
  banner.style.fontFamily = 'sans-serif';
  banner.style.zIndex = '2147483647';
  document.body.appendChild(banner);
  statusBanner = banner;
  return banner;
}

function showStatusMessage(message) {
  const banner = ensureStatusBanner();
  banner.textContent = message;
}

function ensureBubble() {
  if (selectionBubble && selectionBubble.isConnected) return selectionBubble;
  const bubble = document.createElement('div');
  bubble.className = 'qwen-bubble';
  bubble.style.position = 'fixed';
  bubble.style.top = '16px';
  bubble.style.right = '16px';
  bubble.style.padding = '12px';
  bubble.style.background = 'rgba(0,0,0,0.85)';
  bubble.style.borderRadius = '12px';
  bubble.style.color = '#fff';
  bubble.style.fontFamily = 'sans-serif';
  bubble.style.zIndex = '2147483647';
  bubble.style.minWidth = '160px';
  bubble.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)';
  bubble.style.display = 'none';

  const result = document.createElement('div');
  result.className = 'qwen-bubble__result';
  result.style.marginBottom = '8px';
  bubble.appendChild(result);

  const actions = document.createElement('div');
  actions.className = 'qwen-bubble__actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Translate';
  button.style.padding = '6px 12px';
  button.style.borderRadius = '6px';
  button.style.border = 'none';
  button.style.cursor = 'pointer';
  actions.appendChild(button);
  bubble.appendChild(actions);

  document.body.appendChild(bubble);
  selectionBubble = bubble;
  selectionResultEl = result;
  selectionButton = button;
  selectionButton.addEventListener('click', () => translateSelection());
  return bubble;
}

function hideSelectionBubble() {
  if (selectionBubble) {
    selectionBubble.style.display = 'none';
  }
  selectionVisible = false;
}

function showSelectionBubble(range) {
  if (currentConfig.selectionPopup === false) return;
  const bubble = ensureBubble();
  selectionResultEl.textContent = '';
  bubble.style.display = 'block';
  selectionVisible = true;
  if (range && typeof range.getBoundingClientRect === 'function') {
    const rect = range.getBoundingClientRect();
    const top = rect.bottom + 8;
    bubble.style.top = `${Math.max(16, Math.min(top, window.innerHeight - 120))}px`;
    bubble.style.left = `${Math.min(rect.left, window.innerWidth - 240)}px`;
    bubble.style.right = 'auto';
  }
}

function formatErrorMessage(error) {
  const base = (window.qwenI18n && typeof window.qwenI18n.t === 'function')
    ? window.qwenI18n.t('bubble.error')
    : 'Translation failed';
  const detail = error && error.message ? error.message : String(error || '');
  return `${base}: ${detail}`;
}

async function translateSelection(options = {}) {
  const selection = window.getSelection && window.getSelection();
  if (!selection || selection.isCollapsed) return;
  const text = selection.toString().trim();
  if (!text) return;

  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  showSelectionBubble(range);
  selectionResultEl.textContent = '…';

  const payload = {
    text,
    autoInit: true,
    force: !!options.force,
    providerOrder: currentConfig.providerOrder,
    endpoints: currentConfig.endpoints,
    sourceLanguage: currentConfig.sourceLanguage,
    targetLanguage: currentConfig.targetLanguage,
    failover: currentConfig.failover,
    debug: currentConfig.debug,
  };
  if (currentConfig.apiEndpoint) payload.apiEndpoint = currentConfig.apiEndpoint;
  if (currentConfig.model) payload.model = currentConfig.model;

  try {
    if (window.qwenI18n && window.qwenI18n.ready && typeof window.qwenI18n.ready.then === 'function') {
      await window.qwenI18n.ready;
    }
    const translator = window.qwenTranslate || window.__qwenTranslateFallback;
    if (typeof translator !== 'function') {
      throw new Error('translator unavailable');
    }
    const result = await translator(payload);
    const translated = result && (result.text || result.translation) ? (result.text || result.translation) : text;
    selectionResultEl.textContent = translated;
    showStatusMessage(`${PRODUCT_NAME}: ${translated}`);
  } catch (error) {
    const message = formatErrorMessage(error);
    selectionResultEl.textContent = message;
    showStatusMessage(`${PRODUCT_NAME}: ${message}`);
  }
}

function handleSelectionEvent() {
  const selection = window.getSelection && window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) {
    if (selectionVisible) hideSelectionBubble();
    return;
  }
  showSelectionBubble(selection.rangeCount ? selection.getRangeAt(0) : null);
}

function messageListener(message = {}, sender, sendResponse) {
  const action = message.action || message.type;
  switch (action) {
    case 'start':
      queueProcessDocument(!!message.force);
      if (typeof sendResponse === 'function') sendResponse({ ok: true });
      return true;
    case 'stop':
      abortControllers();
      if (typeof sendResponse === 'function') sendResponse({ ok: true });
      return false;
    case 'translate-selection':
    case 'translateSelection': {
      const promise = Promise.resolve(translateSelection({ force: !!message.force }));
      if (typeof sendResponse === 'function') {
        promise
          .then(() => sendResponse({ ok: true }))
          .catch(error => sendResponse({ ok: false, error: error?.message || 'translation failed' }));
        return true;
      }
      promise.catch(error => logger.error('selection translation failed', error));
      return true;
    }
    default:
      if (typeof sendResponse === 'function') sendResponse({ ok: false });
      return false;
  }
}

function registerListeners() {
  if (!globalScope || globalScope.__qwenCSListenersRegistered) return;
  if (document && document.addEventListener) {
    document.addEventListener('mouseup', handleSelectionEvent, true);
  }
  if (chrome && chrome.runtime && chrome.runtime.onMessage && typeof chrome.runtime.onMessage.addListener === 'function') {
    chrome.runtime.onMessage.addListener(messageListener);
  }
  if (window && window.addEventListener) {
    window.addEventListener('beforeunload', () => {
      abortControllers();
    });
  }
  globalScope.__qwenCSListenersRegistered = true;
}

registerListeners();

if (typeof module !== 'undefined' && module.exports) {
  if (globalScope && globalScope.__qwenContentTestExports) {
    module.exports = globalScope.__qwenContentTestExports;
  } else {
    const testExports = {
      TranslationContentScript,
      replacePdfEmbeds,
      initializeExtension,
      setCurrentConfig,
      collectNodes,
      translateBatch,
      messageListener,
      queueProcessDocument,
      translateSelection,
      __controllerCount: () => controllerCount,
    };
    if (globalScope) {
      globalScope.__qwenContentTestExports = testExports;
      globalScope.__qwenCSControllers = controllers;
      globalScope.__qwenCSControllerCount = controllerCount;
    }
    if (typeof window !== 'undefined') {
      window.__translationContentScriptExports = testExports;
    }
    module.exports = testExports;
  }
}

})();

