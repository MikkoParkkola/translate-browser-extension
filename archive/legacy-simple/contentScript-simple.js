/**
 * Simple Content Script for Translation Extension
 * Handles basic translation functionality without complex dependencies
 */

// Wrap everything in an IIFE to allow early returns
(function() {
  'use strict';

  // Prevent multiple script injections by checking if we're already initialized
  if (window.translationExtensionInitialized) {
    console.log('[ContentScript] Extension already initialized, skipping duplicate injection...');
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
    console.warn('[ContentScript] Error cleaning up previous instance:', error);
  }
}

// Inline ContentObserver class (essential for dynamic content monitoring)
class ContentObserver {
  constructor(onNewContent, options = {}) {
    this.onNewContent = onNewContent;
    this.options = {
      enableSmartFiltering: true,
      batchDelay: 500,
      maxBatchSize: 50,
      minTextLength: 3,
      skipElements: ['script', 'style', 'noscript', 'template', 'svg', 'code', 'pre'],
      skipClasses: ['no-translate', 'notranslate', 'qwen-translated', 'qwen-translating'],
      skipAttributes: ['data-no-translate', 'translate="no"', 'data-translated'],
      viewportMargin: '50px',
      intersectionThreshold: 0.1,
      ...options
    };

    this.mutationObserver = null;
    this.batchTimer = null;
    this.pendingNodes = new Set();
    this.processedNodes = new WeakSet();
    this.isObserving = false;

    this.initializeObservers();
  }

  initializeObservers() {
    this.mutationObserver = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });
  }

  startObserving(target = document.body) {
    if (this.isObserving) return;

    this.mutationObserver.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false
    });

    this.isObserving = true;
    console.log('[ContentObserver] Started observing DOM changes');
  }

  stopObserving() {
    if (!this.isObserving) return;

    this.mutationObserver.disconnect();
    this.clearBatchTimer();
    this.isObserving = false;
    console.log('[ContentObserver] Stopped observing DOM changes');
  }

  handleMutations(mutations) {
    const nodesToProcess = new Set();

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          this.collectTranslatableNodes(node, nodesToProcess);
        }
      }

      if (mutation.type === 'characterData' && mutation.target.nodeType === Node.TEXT_NODE) {
        const textNode = mutation.target;
        if (this.isTranslatableTextNode(textNode)) {
          nodesToProcess.add(textNode);
        }
      }
    }

    if (nodesToProcess.size > 0) {
      this.addToBatch(nodesToProcess);
    }
  }

  collectTranslatableNodes(rootNode, collector) {
    if (rootNode.nodeType === Node.TEXT_NODE) {
      if (this.isTranslatableTextNode(rootNode)) {
        collector.add(rootNode);
      }
      return;
    }

    if (rootNode.nodeType !== Node.ELEMENT_NODE) return;

    const element = rootNode;
    if (this.processedNodes.has(element)) return;
    if (!this.isTranslatableElement(element)) return;

    this.processedNodes.add(element);

    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          return this.isTranslatableTextNode(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let textNode;
    while (textNode = walker.nextNode()) {
      collector.add(textNode);
    }
  }

  isTranslatableTextNode(textNode) {
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;

    const text = textNode.textContent.trim();
    if (text.length < this.options.minTextLength) return false;
    if (!/\p{L}/u.test(text)) return false;

    const parentElement = textNode.parentElement;
    if (!parentElement) return false;

    return this.isTranslatableElement(parentElement);
  }

  isTranslatableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const tagName = element.tagName.toLowerCase();
    if (this.options.skipElements.includes(tagName)) return false;

    for (const className of this.options.skipClasses) {
      if (element.classList.contains(className)) return false;
    }

    for (const attr of this.options.skipAttributes) {
      if (attr.includes('=')) {
        const [name, value] = attr.split('=');
        if (element.getAttribute(name.trim()) === value.replace(/"/g, '').trim()) {
          return false;
        }
      } else if (element.hasAttribute(attr)) {
        return false;
      }
    }

    try {
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    } catch (error) {
      // If style computation fails, assume visible
    }

    return true;
  }

  addToBatch(nodes) {
    for (const node of nodes) {
      this.pendingNodes.add(node);
    }

    this.clearBatchTimer();
    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.options.batchDelay);

    if (this.pendingNodes.size >= this.options.maxBatchSize) {
      this.clearBatchTimer();
      this.processBatch();
    }
  }

  processBatch() {
    if (this.pendingNodes.size === 0) return;

    const nodes = Array.from(this.pendingNodes);
    this.pendingNodes.clear();

    const validNodes = nodes.filter(node => document.contains(node));

    if (validNodes.length > 0) {
      this.onNewContent(validNodes, { priority: 'normal', visible: true });
    }
  }

  clearBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  flush() {
    this.clearBatchTimer();
    this.processBatch();
  }

  disconnect() {
    this.stopObserving();
    this.clearBatchTimer();
    this.pendingNodes.clear();
  }
}

// Inline simplified LanguageDetector
class AdvancedLanguageDetector {
  constructor(options = {}) {
    this.options = {
      enableDOMAnalysis: true,
      enableContextualHints: true,
      confidence: {
        word: 0.8,
        context: 0.7
      },
      ...options
    };

    // Simple language patterns
    this.patterns = {
      'nl': /\b(de|het|een|van|in|op|met|voor|door|bij|naar|over|onder|tussen|na|als|maar|zo|ook|wel|niet|er|hij|zij|we|ze|dit|dat|deze|die|wat|wie|waar|wanneer|hoe|waarom|mijn|zijn|haar|ons|hun)\b/gi,
      'en': /\b(the|and|or|but|if|then|when|where|what|who|how|why|this|that|these|those|my|your|his|her|our|their)\b/gi,
      'de': /\b(der|die|das|und|oder|aber|wenn|dann|wann|wo|was|wer|wie|warum|dieser|diese|dieses|mein|dein|sein|ihr|unser|euer)\b/gi,
      'fr': /\b(le|la|les|un|une|des|et|ou|mais|si|alors|quand|où|que|qui|comment|pourquoi|ce|cette|ces|mon|ton|son|notre|votre|leur)\b/gi
    };
  }

  async detectLanguage(text, context = {}) {
    try {
      const scores = {};

      // Test each language pattern
      for (const [lang, pattern] of Object.entries(this.patterns)) {
        const matches = text.match(pattern) || [];
        scores[lang] = matches.length / Math.max(text.split(/\s+/).length, 1);
      }

      // Find best match
      const bestLang = Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
      const confidence = scores[bestLang] || 0;

      if (confidence > 0.1) {
        return {
          language: bestLang,
          confidence: Math.min(confidence * 2, 1), // Boost confidence for display
          primaryMethod: 'pattern'
        };
      }

      return null;
    } catch (error) {
      console.warn('[LanguageDetector] Detection failed:', error);
      return null;
    }
  }
}

// Make classes available globally
window.ContentObserver = ContentObserver;
window.AdvancedLanguageDetector = AdvancedLanguageDetector;

console.log('[ContentScript] Inline classes loaded successfully');

// Main script execution wrapped in try-catch for context invalidation
try {

class SimpleTranslationScript {
  constructor() {
    this.isInitialized = false;
    this.translatedNodes = new WeakSet();
    this.isTranslating = false;
    this.contentObserver = null;
    this.languageDetector = null;
    this.contentChangeTimeout = null;
    this.lastContentHash = null;
    this.autoTranslateCount = 0;
    this.maxAutoTranslates = 10;
    this.initialElementCount = document.querySelectorAll('*').length;
    this.detectedLanguage = null;
    this.lastLanguageDetection = null;

    // Translation preservation system for dynamic content replacement
    this.originalTextMap = new Map(); // original text -> translation
    this.lastElementCount = this.initialElementCount;
    this.contentReplacementDetected = false;
    this.preservationTimer = null;

    // Progress indicator
    this.progressIndicator = null;

    // Wait a short moment for scripts to load, then initialize
    setTimeout(() => this.initialize(), 100);
  }

  async initialize() {
    if (this.isInitialized) return;

    console.log('[ContentScript] Initializing...');

    try {
      // Check if extension context is still valid before proceeding
      if (!(await this.isExtensionContextValid())) {
        console.error('[ContentScript] Extension context is invalid, cannot initialize');
        this.handleContextInvalidation();
        return;
      }

      // Set up message listener
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        this.handleMessage(request, sender, sendResponse);
        return true; // Keep message channel open
      });

      // Selection translation is now handled via context menu only

      // Set up dynamic content observation
      this.setupDynamicContentObserver();

      // Initialize language detector
      this.initializeLanguageDetector();

      // Initialize urgent content queue
      this.urgentContentQueue = [];

      // Initialize content hash for change detection
      this.lastContentHash = this.getContentHash();
      console.log('[ContentScript] Initial content hash:', this.lastContentHash);

      // Initialize progress indicator
      this.initializeProgressIndicator();

      this.isInitialized = true;
      console.log('[ContentScript] Initialized successfully');

    } catch (error) {
      console.error('[ContentScript] Failed to initialize:', error);
      if (error.message?.includes('Extension context invalidated')) {
        this.handleContextInvalidation();
      }
    }
  }

  // Helper method to check if extension context is valid
  async isExtensionContextValid() {
    try {
      // Try to access extension runtime
      const id = chrome.runtime.id;
      return !!id;
    } catch (error) {
      console.warn('[ContentScript] Extension context invalid:', error.message);
      return false;
    }
  }

  handleContextInvalidation() {
    console.warn('[ContentScript] Extension context invalidated, cleaning up...');
    this.cleanup();

    // Mark the global flag as false so a new instance can be created when extension reloads
    window.translationExtensionInitialized = false;

    // Show user notification
    this.showContextInvalidationNotice();
  }

  showContextInvalidationNotice() {
    // Only show notice if we haven't already shown it
    if (window.translationContextNoticeShown) return;
    window.translationContextNoticeShown = true;

    const notice = document.createElement('div');
    notice.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #ff6b6b;
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: system-ui, sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      cursor: pointer;
    `;
    notice.textContent = 'Translation extension reloaded. Please refresh the page.';
    notice.onclick = () => notice.remove();

    document.body.appendChild(notice);

    // Auto-remove after 5 seconds
    setTimeout(() => {
      if (notice.parentNode) {
        notice.remove();
      }
    }, 5000);
  }

  cleanup() {
    console.log('[ContentScript] Cleaning up instance...');

    try {
      // Stop any ongoing operations
      this.isTranslating = false;
      this.isAutoTranslateEnabled = false;

      // Disconnect observers
      if (this.contentObserver) {
        this.contentObserver.disconnect();
        this.contentObserver = null;
      }

      // Clear timeouts
      if (this.contentChangeTimeout) {
        clearTimeout(this.contentChangeTimeout);
        this.contentChangeTimeout = null;
      }

      if (this.preservationTimer) {
        clearTimeout(this.preservationTimer);
        this.preservationTimer = null;
      }

      // Clear maps
      if (this.originalTextMap) {
        this.originalTextMap.clear();
      }

      this.isInitialized = false;
    } catch (error) {
      console.warn('[ContentScript] Error during cleanup:', error);
    }
  }

  // Send message with retry logic for extension context invalidation
  async sendMessageWithRetry(message, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check if context is valid before sending
        if (!(await this.isExtensionContextValid())) {
          throw new Error('Extension context invalidated');
        }

        console.log(`[ContentScript] Sending message (attempt ${attempt}/${maxRetries}):`, message.type);
        const response = await chrome.runtime.sendMessage(message);

        if (response) {
          return response;
        } else {
          throw new Error('No response from background script');
        }
      } catch (error) {
        console.warn(`[ContentScript] Message send attempt ${attempt} failed:`, error.message);

        if (error.message.includes('Extension context invalidated') ||
            error.message.includes('context invalidated') ||
            error.message.includes('runtime.sendMessage') ||
            error.message.includes('Could not establish connection')) {
          console.error('[ContentScript] Extension context is invalid, cannot retry');
          this.handleContextInvalidation();
          throw new Error('Extension context invalidated - please reload the page');
        }

        if (attempt === maxRetries) {
          console.error('[ContentScript] All message attempts failed');
          throw error;
        }

        // Wait before retry (exponential backoff)
        const delay = 1000 * Math.pow(2, attempt - 1);
        console.log(`[ContentScript] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }




  async handleMessage(request, sender, sendResponse) {
    try {
      console.log('[ContentScript] Received message:', request.type);

      switch (request.type) {
        case 'ping':
          // Health check for background script
          sendResponse({ pong: true });
          break;

        case 'translatePage':
          await this.translatePage();
          sendResponse({ success: true });
          break;

        case 'translateSelection':
          // Handle context menu selection translation - text is passed from background script
          const selectedText = request.text || window.getSelection().toString().trim();

          if (selectedText) {
            await this.translateSelection(selectedText);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: 'No text selected. Please select text and use the context menu.' });
          }
          break;

        case 'startAutoTranslate':
          // Auto-translate when page loads (if auto-translate is enabled)
          console.log('[ContentScript] Auto-translate triggered by background script');
          await this.translatePage();
          sendResponse({ success: true });
          break;

        case 'toggleAutoTranslate':
          this.isAutoTranslateEnabled = request.enabled;
          console.log('[ContentScript] Auto-translate toggled:', this.isAutoTranslateEnabled);

          if (this.isAutoTranslateEnabled) {
            // Start observing and translate existing content
            this.startAutoTranslation();
          } else {
            // Stop observing
            this.stopAutoTranslation();
          }
          sendResponse({ success: true });
          break;

        case 'clearTranslationCache':
          this.clearTranslationCache();
          sendResponse({ success: true });
          break;

        case 'translationProgress':
          // Handle progress updates from background script
          this.handleProgressUpdate(request.progress);
          sendResponse({ success: true });
          break;

        case 'debugTranslation':
          // Force a fresh scan and show debugging info
          console.log('[ContentScript] === DEBUG TRANSLATION START ===');
          this.clearTranslationCache();
          const debugNodes = this.findTextNodes();
          console.log(`[ContentScript] Debug scan found ${debugNodes.length} nodes`);
          sendResponse({
            success: true,
            nodeCount: debugNodes.length,
            hasSpecialElements: debugNodes.some(node => {
              const tag = node.parentElement?.tagName;
              return ['TABLE', 'TD', 'TH', 'BUTTON', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag);
            })
          });
          console.log('[ContentScript] === DEBUG TRANSLATION END ===');
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[ContentScript] Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async translateSelection(text) {
    if (this.isTranslating) return;
    this.isTranslating = true;

    try {
      console.log('[ContentScript] Translating selection:', text.substring(0, 50) + '...');

      // Show loading indicator
      this.showNotification('Translating...', 'info');

      // Get language settings from storage
      const settings = await chrome.storage.sync.get(['sourceLanguage', 'targetLanguage']);

      // Send translation request to background script with context validation
      const response = await this.sendMessageWithRetry({
        type: 'translate',
        text: text,
        source: settings.sourceLanguage || 'auto',
        target: settings.targetLanguage || 'en'
      });

      if (response.success) {
        // Show translation result with additional info
        const cacheInfo = response.cached ? ' (cached)' : '';
        const latencyInfo = response.latency ? ` ${response.latency}ms` : '';

        this.showTranslationResult(text, response.text, {
          provider: response.provider,
          cached: response.cached,
          latency: response.latency,
          detectedLanguage: response.detectedLanguage
        });

        console.log(`[ContentScript] Translation successful${cacheInfo}${latencyInfo}`);
      } else {
        throw new Error(response.error || 'Translation failed');
      }

    } catch (error) {
      console.error('[ContentScript] Translation failed:', error);

      // Enhanced error messages
      let errorMessage = error.message;
      if (error.message.includes('API key')) {
        errorMessage = 'Please configure your API key in settings';
      } else if (error.message.includes('rate limit') || error.message.includes('429')) {
        errorMessage = 'Rate limit exceeded. Please wait and try again.';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage = 'Network error. Please check your connection.';
      }

      this.showNotification('Translation failed: ' + errorMessage, 'error');
    } finally {
      this.isTranslating = false;
    }
  }

  async translatePage() {
    if (this.isTranslating) return;
    this.isTranslating = true;

    try {
      console.log('[ContentScript] Starting page translation...');

      // Test communication with background service first
      try {
        console.log('[ContentScript] Testing background service connection...');
        const pingResponse = await this.sendMessageWithRetry({ type: 'ping' });
        console.log('[ContentScript] Background service ping successful:', pingResponse.message);
      } catch (pingError) {
        console.error('[ContentScript] Background service ping failed:', pingError.message);
        this.showNotification('Background service not responding. Please reload the extension.', 'error');
        this.isTranslating = false;
        return;
      }

      // Show loading indicator
      this.showNotification('Translating page...', 'info');

      // Perform language detection before translation
      await this.ensureLanguageDetection();

      // Get language settings from storage
      const settings = await chrome.storage.sync.get(['sourceLanguage', 'targetLanguage']);

      // Find all translatable text nodes with retry for SPAs
      let textNodes = this.findTextNodes();
      console.log(`[ContentScript] Found ${textNodes.length} text nodes`);

      // Show sample of found text for debugging
      const sampleTexts = textNodes.slice(0, 5).map(node => node.textContent.trim().substring(0, 50)).join(' | ');
      console.log(`[ContentScript] 📝 Sample text found: ${sampleTexts}`);

      // ALWAYS do a comprehensive scan to catch all dynamic content
      console.log('[ContentScript] 🔍 Performing comprehensive scan for all dynamic content...');
      const comprehensiveNodes = this.comprehensiveScan();
      if (comprehensiveNodes.length > textNodes.length) {
        console.log(`[ContentScript] 🎯 Comprehensive scan found ${comprehensiveNodes.length} nodes (vs ${textNodes.length} from regular scan)`);
        textNodes = comprehensiveNodes;
      } else if (textNodes.length > 0) {
        console.log(`[ContentScript] 📊 Regular scan found more content (${textNodes.length} vs ${comprehensiveNodes.length}), using regular scan`);
      }

        // Debug: Show ALL text content on page (no filters) to see what we're missing
        console.log('[ContentScript] 🔍 DEBUG: Showing ALL text content on page...');
        const allNodes = this.debugShowAllText();

        // Also scan all accessible iframes for content
        console.log('[ContentScript] 🔍 Scanning iframes for Dutch content...');
        const iframeNodes = this.scanIframes();
        if (iframeNodes.length > 0) {
          console.log(`[ContentScript] 🎯 Found ${iframeNodes.length} nodes in iframes`);
          textNodes = textNodes.concat(iframeNodes);
        } else {
          // If we found iframes but couldn't access them, guide user to selection translation
          // Cross-origin iframe detection removed - extension now handles these correctly with allFrames: true
        }

        // If we detect Dutch content in hidden elements, include them for translation
        if (allNodes.length > textNodes.length) {
          console.log('[ContentScript] 🇳🇱 Found Dutch content in hidden elements, including them for translation...');
          const hiddenDutchNodes = this.extractHiddenDutchContent();
          if (hiddenDutchNodes.length > 0) {
            console.log(`[ContentScript] 🎯 Adding ${hiddenDutchNodes.length} hidden Dutch nodes for translation`);
            textNodes = textNodes.concat(hiddenDutchNodes);
          }
        }

      // Also check for noscript content (fallback content that may be hidden)
      const noscriptNodes = this.findNoscriptContent();
      if (noscriptNodes.length > 0) {
        console.log(`[ContentScript] Found ${noscriptNodes.length} noscript text nodes`);
        textNodes = textNodes.concat(noscriptNodes);
      }

      // If no content found, detect if this is a known JavaScript framework and wait longer
      if (textNodes.length === 0) {
        const frameworkInfo = this.detectJavaScriptFramework();

        if (frameworkInfo.detected) {
          console.log(`[ContentScript] Detected ${frameworkInfo.type} framework, waiting longer for content...`);
          this.showNotification(`Waiting for ${frameworkInfo.type} content to load...`, 'info');

          // Wait longer for framework-based SPAs (up to 10 seconds)
          for (let attempt = 1; attempt <= 20; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            textNodes = this.findTextNodes();

            // Also check noscript on each attempt
            const noscriptNodes = this.findNoscriptContent();
            if (noscriptNodes.length > 0) {
              textNodes = textNodes.concat(noscriptNodes);
            }

            console.log(`[ContentScript] ${frameworkInfo.type} attempt ${attempt}: Found ${textNodes.length} text nodes`);

            if (textNodes.length > 0) {
              this.showNotification('Content loaded, starting translation...', 'info');
              break;
            }

            // Check if DOM has new elements added (framework is loading)
            if (attempt % 4 === 0) {
              const currentElements = document.querySelectorAll('*').length;
              if (currentElements > this.initialElementCount + 10) {
                console.log(`[ContentScript] Framework still loading content (${currentElements} elements)...`);
                this.showNotification(`${frameworkInfo.type} still loading content...`, 'info');
              }
            }
          }
        } else {
          console.log('[ContentScript] No content found initially, waiting for SPA to load...');
          this.showNotification('Waiting for page content to load...', 'info');

          // Wait for SPA content to load (up to 3 seconds)
          for (let attempt = 1; attempt <= 6; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 500));
            textNodes = this.findTextNodes();

            // Also check noscript on each attempt
            const noscriptNodes = this.findNoscriptContent();
            if (noscriptNodes.length > 0) {
              textNodes = textNodes.concat(noscriptNodes);
            }

            console.log(`[ContentScript] Attempt ${attempt}: Found ${textNodes.length} text nodes`);

            if (textNodes.length > 0) {
              this.showNotification('Content loaded, starting translation...', 'info');
              break;
            }
          }
        }

        if (textNodes.length === 0) {
          const finalMessage = frameworkInfo.detected
            ? `No translatable text found on this ${frameworkInfo.type} page (content may still be loading)`
            : 'No translatable text found on this page';
          this.showNotification(finalMessage, 'warning');
          return;
        }
      }

      // Process in optimized batches (adapted from legacy code)
      const batches = this.createBatches(textNodes);
      console.log(`[ContentScript] Created ${batches.length} batches for ${textNodes.length} text nodes`);
      let translated = 0;

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        try {
          console.log(`[ContentScript] Processing batch ${i + 1}/${batches.length} with ${batch.length} nodes`);
          const result = await this.translateBatch(batch, settings);
          if (result.success) {
            translated += result.translatedCount;
            console.log(`[ContentScript] Batch ${i + 1} translated ${result.translatedCount} nodes`);
          } else {
            console.warn(`[ContentScript] Batch ${i + 1} failed:`, result.error);
          }
        } catch (error) {
          console.error(`[ContentScript] Batch ${i + 1} translation failed:`, error);
        }

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      let message;
      if (translated > 0) {
        message = `🎯 TRANSLATION SUCCESS: Translated ${translated} text elements`;
      } else if (textNodes.length === 0) {
        message = 'No translatable content found on this page';
      } else {
        message = 'Content found but no new translations needed';
      }
      this.showNotification(message, translated > 0 ? 'success' : 'info');

      if (translated > 0) {
        console.log(`🎯🎯🎯 [TRANSLATION COMPLETE] Successfully translated ${translated} elements on this page! 🎯🎯🎯`);
      }

      // Update content hash after successful translation
      this.lastContentHash = this.getContentHash();

    } catch (error) {
      console.error('[ContentScript] Page translation failed:', error);
      this.showNotification('Page translation failed: ' + error.message, 'error');
    } finally {
      this.isTranslating = false;
    }
  }

  detectJavaScriptFramework() {
    // Detect various JavaScript frameworks and libraries
    const detections = {
      detected: false,
      type: 'SPA',
      confidence: 0
    };

    try {
      const scripts = Array.from(document.scripts);
      const htmlContent = document.documentElement.outerHTML;

      // Oracle ADF Detection
      if (htmlContent.includes('AdfLoopbackUtils') ||
          htmlContent.includes('oracle.adf') ||
          scripts.some(script => script.textContent.includes('AdfLoopbackUtils'))) {
        detections.detected = true;
        detections.type = 'Oracle ADF';
        detections.confidence = 0.9;
        return detections;
      }

      // Angular Detection
      if (window.ng || window.angular ||
          document.querySelector('[ng-app]') ||
          htmlContent.includes('ng-') ||
          scripts.some(script => script.src.includes('angular'))) {
        detections.detected = true;
        detections.type = 'Angular';
        detections.confidence = 0.8;
        return detections;
      }

      // React Detection
      if (window.React || window.ReactDOM ||
          document.querySelector('[data-reactroot]') ||
          document.querySelector('#app-root') ||
          htmlContent.includes('react') ||
          htmlContent.includes('__PRELOADED_STATE__') ||
          scripts.some(script => script.src.includes('react'))) {
        detections.detected = true;
        detections.type = 'React';
        detections.confidence = 0.8;
        return detections;
      }

      // Vue Detection
      if (window.Vue ||
          document.querySelector('[v-]') ||
          htmlContent.includes('v-') ||
          scripts.some(script => script.src.includes('vue'))) {
        detections.detected = true;
        detections.type = 'Vue';
        detections.confidence = 0.8;
        return detections;
      }

      // Generic SPA indicators
      if (htmlContent.length < 1000 && scripts.length > 2) {
        detections.detected = true;
        detections.type = 'JavaScript SPA';
        detections.confidence = 0.6;
        return detections;
      }

      // Check for minimal HTML with lots of JavaScript
      const bodyText = document.body ? document.body.innerText.trim() : '';
      if (bodyText.length < 50 && scripts.length > 1) {
        detections.detected = true;
        detections.type = 'JavaScript Framework';
        detections.confidence = 0.5;
        return detections;
      }

    } catch (error) {
      console.warn('[ContentScript] Error detecting framework:', error);
    }

    return detections;
  }

  findNoscriptContent() {
    // Specifically look for noscript elements with meaningful content
    const noscriptElements = document.querySelectorAll('noscript');
    const textNodes = [];

    noscriptElements.forEach(noscript => {
      const textContent = noscript.textContent.trim();

      // Only include noscript with substantial text content, but skip CSS
      if (textContent.length > 20 && /\p{L}/u.test(textContent) && !textContent.includes('<style')) {
        console.log('[ContentScript] Found noscript with content:', textContent.substring(0, 100) + '...');

        // Get all text nodes within this noscript
        const walker = document.createTreeWalker(
          noscript,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              const text = node.textContent.trim();
              return (text.length > 3 && /\p{L}/u.test(text))
                ? NodeFilter.FILTER_ACCEPT
                : NodeFilter.FILTER_REJECT;
            }
          }
        );

        let textNode;
        while (textNode = walker.nextNode()) {
          if (!this.translatedNodes.has(textNode)) {
            textNodes.push(textNode);
          }
        }
      }
    });

    return textNodes;
  }

  comprehensiveScan() {
    console.log('[ContentScript] 🔍 Starting comprehensive scan for hidden/dynamic content...');
    const foundNodes = [];

    // 1. Check hidden elements that might contain Dutch content
    const hiddenElements = document.querySelectorAll('[style*="display: none"], [style*="visibility: hidden"], .hidden, [hidden]');
    console.log(`[ContentScript] Found ${hiddenElements.length} hidden elements to check`);

    hiddenElements.forEach((element, index) => {
      if (index < 10) { // Limit to avoid performance issues
        const textContent = element.textContent.trim();
        if (textContent.length > 10 && /\p{L}/u.test(textContent)) {
          console.log(`[ContentScript] Hidden element ${index + 1} content:`, textContent.substring(0, 100) + '...');

          // Get text nodes from hidden elements
          const self = this;
          const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                const text = node.textContent.trim();
                return (text.length > 3 && /\p{L}/u.test(text) && self.isTranslatableText(text))
                  ? NodeFilter.FILTER_ACCEPT
                  : NodeFilter.FILTER_REJECT;
              }
            }
          );

          let textNode;
          while (textNode = walker.nextNode()) {
            if (!this.translatedNodes.has(textNode)) {
              foundNodes.push(textNode);
            }
          }
        }
      }
    });

    // 2. Check for Shadow DOM content
    try {
      const elementsWithShadow = document.querySelectorAll('*');
      let shadowRootCount = 0;

      elementsWithShadow.forEach(element => {
        if (element.shadowRoot && shadowRootCount < 5) { // Limit shadow DOM checks
          shadowRootCount++;
          console.log(`[ContentScript] Checking shadow root ${shadowRootCount}...`);

          const walker = document.createTreeWalker(
            element.shadowRoot,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                const text = node.textContent.trim();
                return (text.length > 3 && /\p{L}/u.test(text))
                  ? NodeFilter.FILTER_ACCEPT
                  : NodeFilter.FILTER_REJECT;
              }
            }
          );

          let textNode;
          while (textNode = walker.nextNode()) {
            if (!this.translatedNodes.has(textNode)) {
              foundNodes.push(textNode);
              console.log('[ContentScript] Found shadow DOM text:', textNode.textContent.substring(0, 50) + '...');
            }
          }
        }
      });

      if (shadowRootCount > 0) {
        console.log(`[ContentScript] Checked ${shadowRootCount} shadow DOMs`);
      }
    } catch (error) {
      console.log('[ContentScript] Shadow DOM check failed:', error.message);
    }

    // 3. Check for content that might be dynamically loaded
    const dynamicContainers = document.querySelectorAll('[id*="content"], [class*="content"], [id*="main"], [class*="main"], [id*="body"], [class*="body"]');
    console.log(`[ContentScript] Checking ${dynamicContainers.length} potential dynamic containers...`);

    dynamicContainers.forEach((container, index) => {
      if (index < 20) { // Limit container checks
        const textContent = container.textContent.trim();
        if (textContent.length > 50) { // Only check containers with substantial content
          console.log(`[ContentScript] Container ${index + 1} (${container.tagName}.${container.className || container.id}) has ${textContent.length} chars`);

          // Look for Dutch-like content patterns
          const dutchPattern = /\b(de|het|een|van|in|op|met|voor|door|bij|naar|over|onder|tussen|na|als|maar|zo|ook|wel|niet|er|hij|zij|we|ze|dit|dat|deze|die|wat|wie|waar|wanneer|hoe|waarom|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|heren|dames|welkom)\b/gi;
          const dutchMatches = textContent.match(dutchPattern);

          if (dutchMatches && dutchMatches.length > 2) {
            console.log(`[ContentScript] 🇳🇱 Found potential Dutch content with ${dutchMatches.length} Dutch words:`, dutchMatches.slice(0, 5));

            const self = this;
            const walker = document.createTreeWalker(
              container,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode: (node) => {
                  const text = node.textContent.trim();
                  if (text.length < 3 || !self.isTranslatableText(text)) {
                    return NodeFilter.FILTER_REJECT;
                  }

                  // Check if this specific text node contains Dutch words
                  const nodeDutchMatches = text.match(dutchPattern);
                  return (nodeDutchMatches && nodeDutchMatches.length > 0)
                    ? NodeFilter.FILTER_ACCEPT
                    : NodeFilter.FILTER_REJECT;
                }
              }
            );

            let textNode;
            while (textNode = walker.nextNode()) {
              if (!this.translatedNodes.has(textNode)) {
                foundNodes.push(textNode);
                console.log('[ContentScript] 🎯 Found Dutch text node:', textNode.textContent.substring(0, 50) + '...');
              }
            }
          }
        }
      }
    });

    console.log(`[ContentScript] 🔍 Comprehensive scan complete: found ${foundNodes.length} additional nodes`);
    return foundNodes;
  }

  debugShowAllText() {
    console.log('[ContentScript] 🔍 DEBUG: Starting raw text scan...');

    // Get ALL text nodes with minimal filtering
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const text = node.textContent.trim();
          // Only basic filtering - must have some text and letters
          return (text.length > 2 && /\p{L}/u.test(text))
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    const allTextNodes = [];
    let node;
    while (node = walker.nextNode()) {
      allTextNodes.push(node);
    }

    console.log(`[ContentScript] 🔍 DEBUG: Found ${allTextNodes.length} total text nodes on page`);

    // Show first 20 text nodes with their parent info
    allTextNodes.slice(0, 20).forEach((node, index) => {
      const text = node.textContent.trim();
      const parent = node.parentElement;
      const parentInfo = parent ? `${parent.tagName}.${parent.className || parent.id || 'no-class'}` : 'no-parent';

      // Check if this contains Dutch-like words
      const dutchPattern = /\b(de|het|een|van|in|op|met|voor|door|bij|naar|over|onder|tussen|na|als|maar|zo|ook|wel|niet|er|hij|zij|we|ze|dit|dat|deze|die|wat|wie|waar|wanneer|hoe|waarom|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|heren|dames|welkom)\b/gi;
      const dutchMatches = text.match(dutchPattern);
      const dutchFlag = dutchMatches && dutchMatches.length > 0 ? '🇳🇱' : '';

      console.log(`[ContentScript] 🔍 ${index + 1}. ${dutchFlag} "${text.substring(0, 100)}" (${parentInfo})`);

      if (dutchMatches && dutchMatches.length > 0) {
        console.log(`[ContentScript] 🇳🇱 DUTCH DETECTED: ${dutchMatches.length} Dutch words:`, dutchMatches.slice(0, 5));
      }
    });

    if (allTextNodes.length > 20) {
      console.log(`[ContentScript] 🔍 DEBUG: ... and ${allTextNodes.length - 20} more text nodes`);
    }

    return allTextNodes;
  }

  extractHiddenDutchContent() {
    console.log('[ContentScript] 🇳🇱 Extracting hidden Dutch content for translation...');

    const dutchNodes = [];
    const dutchPattern = /\b(de|het|een|van|in|op|met|voor|door|bij|naar|over|onder|tussen|na|als|maar|zo|ook|wel|niet|er|hij|zij|we|ze|dit|dat|deze|die|wat|wie|waar|wanneer|hoe|waarom|mijn|zijn|haar|ons|hun|deze|die|wat|waar|wanneer|hoe|waarom|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|heren|dames|welkom|berichtenbox|berichten|werkruimte|bibliotheek|contacten|kalender|correspondentie|profiel|account|instellingen|notificaties|applicaties|help|over|privacy|voorwaarden)\b/gi;

    // Get ALL text nodes including hidden ones
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const text = node.textContent.trim();
          if (text.length < 3 || !/\p{L}/u.test(text)) return NodeFilter.FILTER_REJECT;

          // Skip CSS and scripts
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const skipTags = ['SCRIPT', 'STYLE', 'TEMPLATE'];
          if (skipTags.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;

          // Check if this node contains Dutch words
          const dutchMatches = text.match(dutchPattern);
          if (dutchMatches && dutchMatches.length > 0) {
            return NodeFilter.FILTER_ACCEPT;
          }

          // Also accept "MijnJellinek" and other Dutch-looking names
          if (text.includes('Mijn') || text.includes('mijn') ||
              text.match(/\b[A-Z][a-z]+[A-Z][a-z]+\b/) || // CamelCase Dutch compounds
              text.match(/ijk|lijk|ning|heid|loos|vol|baar/)) { // Dutch suffixes
            return NodeFilter.FILTER_ACCEPT;
          }

          return NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      if (!this.translatedNodes.has(node)) {
        const text = node.textContent.trim();
        const parent = node.parentElement;

        // Check if it's hidden
        const style = window.getComputedStyle(parent);
        const isHidden = style.display === 'none' || style.visibility === 'hidden';

        if (isHidden) {
          console.log(`[ContentScript] 🇳🇱 Found hidden Dutch text: "${text}" (${parent.tagName})`);
          dutchNodes.push(node);
        } else {
          console.log(`[ContentScript] 🇳🇱 Found visible Dutch text: "${text}" (${parent.tagName})`);
          dutchNodes.push(node);
        }
      }
    }

    console.log(`[ContentScript] 🇳🇱 Extracted ${dutchNodes.length} Dutch text nodes (including hidden)`);
    return dutchNodes;
  }

  scanIframes() {
    console.log('[ContentScript] 🔍 Starting iframe scan for Dutch content...');
    const iframeNodes = [];

    try {
      // Get all iframes in the document
      const iframes = document.querySelectorAll('iframe');
      console.log(`[ContentScript] Found ${iframes.length} iframes to scan`);

      for (const iframe of iframes) {
        try {
          // Check if iframe is accessible (same-origin)
          let iframeDoc;
          try {
            iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          } catch (e) {
            console.log(`[ContentScript] ❌ Cannot access iframe (cross-origin): ${iframe.src || 'about:blank'}`);
            continue;
          }

          if (!iframeDoc) {
            console.log(`[ContentScript] ❌ Iframe document not accessible: ${iframe.src || 'about:blank'}`);
            continue;
          }

          console.log(`[ContentScript] ✅ Scanning accessible iframe: ${iframe.src || 'about:blank'}`);

          // Use TreeWalker to find text nodes in iframe
          const walker = document.createTreeWalker(
            iframeDoc.body || iframeDoc.documentElement,
            NodeFilter.SHOW_TEXT,
            {
              acceptNode: (node) => {
                const text = node.textContent.trim();
                if (text.length < 3) return NodeFilter.FILTER_REJECT;

                // Skip non-letters
                if (!/\p{L}/u.test(text)) return NodeFilter.FILTER_REJECT;

                // Check for Dutch patterns
                const dutchPattern = /\b(de|het|een|van|in|op|met|voor|door|bij|naar|over|onder|tussen|na|als|maar|zo|ook|wel|niet|er|hij|zij|we|ze|dit|dat|deze|die|wat|wie|waar|wanneer|hoe|waarom|mijn|zijn|haar|ons|hun|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|heren|dames|welkom|vragenlijst|toestemming|contactpersoon|familieworkshop|motivatie|brief|aangemaakt|vullen|afgehandeld)\b/gi;

                if (dutchPattern.test(text)) {
                  console.log(`[ContentScript] 🇳🇱 Found Dutch in iframe: "${text.substring(0, 50)}..."`);
                  return NodeFilter.FILTER_ACCEPT;
                }

                // Also check for specific Dutch questionnaire terms
                if (text.includes('vragenlijst') || text.includes('Vragenlijst') ||
                    text.includes('toestemming') || text.includes('Toestemming') ||
                    text.includes('aangemaakt op') || text.includes('vullen') ||
                    text.includes('afgehandeld') || text.includes('Afgehandeld')) {
                  console.log(`[ContentScript] 🎯 Found questionnaire Dutch in iframe: "${text.substring(0, 50)}..."`);
                  return NodeFilter.FILTER_ACCEPT;
                }

                return NodeFilter.FILTER_REJECT;
              }
            }
          );

          let node;
          while (node = walker.nextNode()) {
            // Verify parent element exists and is not a script/style tag
            const parent = node.parentElement;
            if (parent && !['SCRIPT', 'STYLE'].includes(parent.tagName)) {
              // Special handling for NOSCRIPT content (like main validation)
              if (parent.tagName === 'NOSCRIPT') {
                const textContent = parent.textContent.trim();
                // Only include noscript if it has substantial text content and is not CSS/HTML
                if (textContent.length > 20 && /\p{L}/u.test(textContent) &&
                    !textContent.includes('<style') && !textContent.includes('{') &&
                    !textContent.includes('display:')) {
                  console.log(`[ContentScript] ✅ Including NOSCRIPT content in iframe: "${node.textContent.trim().substring(0, 50)}..."`);
                  iframeNodes.push(node);
                }
              } else {
                iframeNodes.push(node);
              }
            }
          }

        } catch (error) {
          console.log(`[ContentScript] ❌ Error scanning iframe: ${error.message}`);
          continue;
        }
      }

      console.log(`[ContentScript] 🎯 Found ${iframeNodes.length} Dutch text nodes in iframes`);
      return iframeNodes;

    } catch (error) {
      console.error('[ContentScript] ❌ Error in iframe scanning:', error);
      return [];
    }
  }

  isTranslatableText(text) {
    if (!text || !text.trim()) return false;

    const trimmedText = text.trim();

    // Skip if too short
    if (trimmedText.length < 3) return false;

    // Must contain letters
    if (!/\p{L}/u.test(trimmedText)) return false;

    // Skip CSS-like content
    if (trimmedText.includes('{') || trimmedText.includes('}') ||
        trimmedText.includes('display:') || trimmedText.includes('#app-root') ||
        trimmedText.includes('nonce=')) {
      return false;
    }

    // Skip lines that are mostly numbers/symbols
    const letters = (trimmedText.match(/[A-Za-zÀ-ÿ]/g) || []).length;
    const nonLetters = (trimmedText.replace(/[A-Za-zÀ-ÿ]/g, '').length);
    if (letters < 2 || letters < nonLetters / 2) return false;

    return true;
  }

  findTextNodes() {
    const textNodes = [];

    // Legacy-style document scanning with iframe support
    const scanDocument = (doc, context = 'main') => {
      const nodeCount = textNodes.length;

      if (!doc || !doc.body) return;

      const walker = document.createTreeWalker(
        doc.body,
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

      console.log(`[ContentScript] ${context}: Found ${textNodes.length - nodeCount} text nodes`);
    };

    // Scan main document
    scanDocument(document, 'main document');

    // Scan accessible iframes (like legacy code)
    try {
      const frames = document.querySelectorAll('iframe, frame');
      frames.forEach((frame, index) => {
        try {
          const frameDoc = frame.contentDocument || frame.contentWindow?.document;
          if (frameDoc && frameDoc.body) {
            scanDocument(frameDoc, `iframe ${index + 1}`);
          }
        } catch (error) {
          // Cross-origin frame - skip silently
        }
      });
    } catch (error) {
      console.warn('[ContentScript] Error scanning frames:', error);
    }

    // Track element types for debugging
    const elementTypeCounts = {};
    textNodes.forEach(node => {
      const parentTag = node.parentElement?.tagName || 'UNKNOWN';
      elementTypeCounts[parentTag] = (elementTypeCounts[parentTag] || 0) + 1;
    });

    console.log(`[ContentScript] Total found: ${textNodes.length} translatable text nodes`);
    console.log(`[ContentScript] Element types found:`, elementTypeCounts);

    // Log sample text from tables, buttons, headings for debugging
    const specialElements = textNodes.filter(node => {
      const tag = node.parentElement?.tagName;
      return ['TABLE', 'TD', 'TH', 'BUTTON', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag);
    });

    if (specialElements.length > 0) {
      console.log(`[ContentScript] Found ${specialElements.length} nodes in tables/buttons/headings:`);
      specialElements.slice(0, 10).forEach((node, i) => {
        console.log(`  ${i+1}. ${node.parentElement.tagName}: "${node.textContent.trim()}"`);
      });
    } else {
      console.log(`[ContentScript] ⚠️ No text found in tables, buttons, or headings!`);
    }

    return textNodes;
  }

  // Legacy-style translatable node check - simple and effective
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

  // Legacy-style simple batch creation
  createBatches(nodes, maxBatchSize = 20) {
    const batches = [];
    const MAX_CHARS_PER_BATCH = 6000; // Conservative limit for Qwen API
    const MAX_NODES_PER_BATCH = maxBatchSize;

    let currentBatch = [];
    let currentCharCount = 0;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const text = node.textContent.trim();
      const textLength = text.length;

      // Skip empty text nodes
      if (textLength === 0) continue;

      // If adding this node would exceed limits, start new batch
      if ((currentCharCount + textLength > MAX_CHARS_PER_BATCH ||
           currentBatch.length >= MAX_NODES_PER_BATCH) &&
          currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentCharCount = 0;
      }

      // If single text is too long, split it
      if (textLength > MAX_CHARS_PER_BATCH) {
        console.warn(`[ContentScript] Text too long (${textLength} chars), splitting:`, text.substring(0, 100) + '...');
        // Split long text into chunks
        const chunks = this.splitLongText(text, MAX_CHARS_PER_BATCH);
        for (const chunk of chunks) {
          // Create a temporary node for each chunk
          const tempNode = { ...node, textContent: chunk };
          batches.push([tempNode]);
        }
        continue;
      }

      currentBatch.push(node);
      currentCharCount += textLength;
    }

    // Add remaining nodes as final batch
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    console.log(`[ContentScript] Created ${batches.length} batches from ${nodes.length} nodes (max ${MAX_CHARS_PER_BATCH} chars per batch)`);
    return batches;
  }

  // Helper method to split long text into smaller chunks
  splitLongText(text, maxChars) {
    const chunks = [];
    let startIndex = 0;

    while (startIndex < text.length) {
      let endIndex = startIndex + maxChars;

      // Try to break at sentence boundary
      if (endIndex < text.length) {
        const sentenceEnd = text.lastIndexOf('.', endIndex);
        const questionEnd = text.lastIndexOf('?', endIndex);
        const exclamationEnd = text.lastIndexOf('!', endIndex);

        const bestBreak = Math.max(sentenceEnd, questionEnd, exclamationEnd);
        if (bestBreak > startIndex) {
          endIndex = bestBreak + 1;
        } else {
          // Try to break at word boundary
          const spaceIndex = text.lastIndexOf(' ', endIndex);
          if (spaceIndex > startIndex) {
            endIndex = spaceIndex;
          }
        }
      }

      chunks.push(text.substring(startIndex, endIndex).trim());
      startIndex = endIndex;
    }

    return chunks.filter(chunk => chunk.length > 0);
  }

  // Legacy-style simple batch translation
  async translateBatch(nodes, settings) {
    const texts = nodes.map(node => node.textContent.trim());
    const uniqueTexts = [...new Set(texts)];

    if (uniqueTexts.length === 0) return { success: true, translatedCount: 0 };

    try {
      const result = await this.sendMessageWithRetry({
        type: 'translateBatch',
        texts: uniqueTexts,
        sourceLanguage: settings.sourceLanguage || 'auto',
        targetLanguage: settings.targetLanguage || 'en'
      });

      if (result.success) {
        // Create text mapping - match legacy pattern
        const translationMap = new Map();
        uniqueTexts.forEach((text, index) => {
          if (result.texts && result.texts[index]) {
            translationMap.set(text, result.texts[index]);
          }
        });

        // Apply translations to nodes - legacy style
        let translatedCount = 0;
        const specialElementsInBatch = nodes.filter(node => {
          const tag = node.parentElement?.tagName;
          return ['TABLE', 'TD', 'TH', 'BUTTON', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(tag);
        });

        if (specialElementsInBatch.length > 0) {
          console.log(`[ContentScript] Batch contains ${specialElementsInBatch.length} table/button/heading elements`);
        }

        nodes.forEach(node => {
          const originalText = node.textContent.trim();
          const translation = translationMap.get(originalText);
          const parentTag = node.parentElement?.tagName;

          // Debug logging for translation decision
          console.log(`[ContentScript] 🔍 Translation check: "${originalText}" → "${translation}" (same: ${translation === originalText})`);

          if (translation) {
            // Apply translation even if it's the same - this ensures consistent handling
            this.applyTranslation(node, translation);
            this.translatedNodes.add(node);
            translatedCount++;

            // Save translation mapping for content replacement restoration
            this.originalTextMap.set(originalText, translation);

            // Log all translations for debugging
            if (translation !== originalText) {
              console.log(`[ContentScript] ✅ Translated "${originalText}" → "${translation}"`);
            } else {
              console.log(`[ContentScript] ✅ Applied same translation "${originalText}" (no change needed)`);
            }

            // Log special element translations
            if (['TABLE', 'TD', 'TH', 'BUTTON', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(parentTag)) {
              console.log(`[ContentScript] Special ${parentTag}: "${originalText}" → "${translation}"`);
            }
          } else {
            console.log(`[ContentScript] ❌ No translation for "${originalText}"`);
            if (specialElementsInBatch.some(n => n === node)) {
              console.log(`[ContentScript] ${parentTag} not translated: "${originalText}" (no translation available)`);
            }
          }
        });

        return { success: true, translatedCount };
      } else {
        throw new Error(result.error || 'Translation failed');
      }
    } catch (error) {
      console.error('[ContentScript] Batch translation error:', error);
      return { success: false, error: error.message, translatedCount: 0 };
    }
  }

  // Legacy-style translation application
  applyTranslation(node, translatedText) {
    // Preserve leading and trailing whitespace
    const original = node.textContent;
    const leadingSpace = original.match(/^\s*/)[0];
    const trailingSpace = original.match(/\s*$/)[0];

    node.textContent = leadingSpace + translatedText + trailingSpace;

    // Add visual indicator like legacy
    if (node.parentElement) {
      node.parentElement.classList.add('translated');
      node.parentElement.setAttribute('data-original', original.trim());
      node.parentElement.setAttribute('data-translated', translatedText);
    }
  }

  // Keep the complex method for compatibility but rename it
  async translateOptimizedBatch(nodes, settings) {
    // Extract texts and deduplicate (key legacy optimization)
    const texts = nodes.map(node => node.textContent.trim());
    const uniqueTexts = [...new Set(texts)]; // Remove duplicates

    if (uniqueTexts.length === 0) {
      return { success: true, translatedCount: 0 };
    }

    console.log(`[ContentScript] Batch: ${nodes.length} nodes, ${uniqueTexts.length} unique texts (${Math.round((1 - uniqueTexts.length/texts.length) * 100)}% deduplication)`);
    console.log('[ContentScript] 📄 Text content to translate:', uniqueTexts.map(t => t.substring(0, 100)).join(' | '));

    try {
      // Use proper translateBatch (like legacy) instead of hacky joined text
      const sourceLanguage = settings.sourceLanguage || 'auto';
      const targetLanguage = settings.targetLanguage || 'en';
      console.log(`[ContentScript] 🌐 LANGUAGE DEBUG: ${sourceLanguage} → ${targetLanguage}`);

      const response = await this.sendMessageWithRetry({
        type: 'translateBatch',
        texts: uniqueTexts,
        sourceLanguage: sourceLanguage,
        targetLanguage: targetLanguage
      });

      console.log('[ContentScript] 🔍 FULL RESPONSE DEBUG:', JSON.stringify(response, null, 2));

      if (response.success) {
        console.log('[ContentScript] 📝 Translation API response:', response.texts.length + ' translations received');
        console.log('[ContentScript] 🔍 Sample translations:');
        uniqueTexts.slice(0, 3).forEach((text, index) => {
          console.log(`  "${text}" → "${response.texts[index]}"`);
        });

        // Create translation mapping with quality verification
        const translationMap = new Map();
        let qualityStats = { excellent: 0, good: 0, fair: 0, poor: 0, failed: 0 };

        uniqueTexts.forEach((text, index) => {
          if (response.texts[index]) {
            const translation = response.texts[index].trim();
            translationMap.set(text, translation);

            // Track quality if available
            if (response.qualityVerifications && response.qualityVerifications[index]) {
              const quality = response.qualityVerifications[index];
              qualityStats[quality.status] = (qualityStats[quality.status] || 0) + 1;
            }
          }
        });

        // Log quality summary if available
        if (Object.values(qualityStats).some(count => count > 0)) {
          console.log('[ContentScript] 📊 Quality Summary:', qualityStats);
        }

        // Apply translations to all nodes using the map
        let translatedCount = 0;
        nodes.forEach(node => {
          const originalText = node.textContent.trim();
          const translation = translationMap.get(originalText);

          if (translation) {
            console.log(`[ContentScript] 🔄 Processing: "${originalText}" → "${translation}"`);

            // Only apply visual changes if translation is different
            const needsVisualUpdate = translation !== originalText;
            // Check if this is a noscript element (read-only)
            const parentElement = node.parentElement;
            const isNoscriptContent = parentElement?.tagName === 'NOSCRIPT';

            if (isNoscriptContent && needsVisualUpdate) {
              // For noscript content, create a visible replacement div only if translation changed
              console.log('🎯 [TRANSLATION SUCCESS] Creating visible replacement for noscript content');

              const translationDiv = document.createElement('div');
              translationDiv.style.cssText = `
                background: #fff9c4;
                border: 1px solid #f0c674;
                border-radius: 4px;
                padding: 10px;
                margin: 10px 0;
                font-family: inherit;
                line-height: 1.4;
                display: block;
              `;

              // Preserve whitespace
              const original = node.textContent;
              const leadingSpace = original.match(/^\s*/)[0];
              const trailingSpace = original.match(/\s*$/)[0];

              translationDiv.textContent = leadingSpace + translation + trailingSpace;
              translationDiv.setAttribute('data-translation-original', 'noscript');

              // Insert the translation div after the noscript element
              parentElement.parentNode.insertBefore(translationDiv, parentElement.nextSibling);
              console.log('[ContentScript] 📌 Inserted translation div after noscript. Translation:', translation.substring(0, 100));
            } else if (!isNoscriptContent && needsVisualUpdate) {
              // Regular text node translation - only update if different
              const original = node.textContent;
              const leadingSpace = original.match(/^\s*/)[0];
              const trailingSpace = original.match(/\s*$/)[0];

              node.textContent = leadingSpace + translation + trailingSpace;
              console.log('[ContentScript] ✏️ Updated text node:', originalText, '→', translation);
            } else {
              console.log('[ContentScript] ✅ Text already correct:', originalText);
            }

            // Always mark as translated and count (even if no visual change)
            this.translatedNodes.add(node);
            translatedCount++;
          }
        });

        return { success: true, translatedCount };
      } else {
        console.error('[ContentScript] 🚨 Translation API error:', response.error);
        console.error('[ContentScript] 🚨 Full error response:', JSON.stringify(response, null, 2));
        return { success: false, error: response.error || 'Translation failed', translatedCount: 0 };
      }
    } catch (error) {
      console.error('[ContentScript] Optimized batch translation error:', error);
      return { success: false, error: error.message, translatedCount: 0 };
    }
  }

  // Lightweight method for translating specific nodes (used by ContentObserver)
  async translateNodes(nodes) {
    if (!nodes || nodes.length === 0) {
      console.log('[ContentScript] No nodes to translate');
      return { success: true, translatedCount: 0 };
    }

    console.log(`[ContentScript] Translating ${nodes.length} specific nodes`);

    try {
      // Get current settings
      const settings = await this.sendMessageWithRetry({ type: 'getSettings' });
      if (!settings.success) {
        throw new Error('Failed to get translation settings');
      }

      // Perform language detection if not already done or if detection is stale
      await this.ensureLanguageDetection();

      // Use existing batch creation and translation logic
      const batches = this.createBatches(nodes);
      let totalTranslated = 0;

      for (const batch of batches) {
        const result = await this.translateBatch(batch, settings);
        if (result.success) {
          totalTranslated += result.translatedCount;
        } else {
          console.warn('[ContentScript] Batch translation failed:', result.error);
        }
      }

      console.log(`[ContentScript] Translated ${totalTranslated}/${nodes.length} nodes`);

      // Process any queued urgent content
      if (this.urgentContentQueue && this.urgentContentQueue.length > 0) {
        const queuedNodes = this.urgentContentQueue;
        this.urgentContentQueue = [];
        console.log(`[ContentScript] Processing ${queuedNodes.length} queued urgent nodes`);
        setTimeout(() => this.translateNodes(queuedNodes), 100);
      }

      return { success: true, translatedCount: totalTranslated };

    } catch (error) {
      console.error('[ContentScript] translateNodes error:', error);
      return { success: false, error: error.message, translatedCount: 0 };
    }
  }

  showTranslationResult(original, translated, info = {}) {
    // Create translation result modal
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      border: 1px solid #ccc;
      border-radius: 8px;
      padding: 20px;
      max-width: 500px;
      max-height: 400px;
      overflow: auto;
      z-index: 10001;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `;

    // Build info string
    const infoItems = [];
    if (info.provider) infoItems.push(`Provider: ${info.provider}`);
    if (info.detectedLanguage) infoItems.push(`Detected: ${info.detectedLanguage}`);
    if (info.cached) infoItems.push('Source: Cache');
    if (info.latency) infoItems.push(`Time: ${info.latency}ms`);

    const infoSection = infoItems.length > 0 ? `
      <div style="margin-bottom: 15px; font-size: 12px; color: #666;">
        ${infoItems.join(' • ')}
      </div>
    ` : '';

    modal.innerHTML = `
      <div style="margin-bottom: 15px;">
        <strong>Original:</strong>
        <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-top: 5px;">${original}</div>
      </div>
      <div style="margin-bottom: 15px;">
        <strong>Translation:</strong>
        <div style="background: #e3f2fd; padding: 10px; border-radius: 4px; margin-top: 5px;">${translated}</div>
      </div>
      ${infoSection}
      <button id="close-translation" style="background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Close</button>
    `;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      z-index: 10000;
    `;

    // Close handlers
    const closeModal = () => {
      document.body.removeChild(overlay);
      document.body.removeChild(modal);
    };

    modal.querySelector('#close-translation').addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);

    document.body.appendChild(overlay);
    document.body.appendChild(modal);
  }

  setupDynamicContentObserver() {
    // Set up advanced ContentObserver with visibility batching and smart filtering
    this.contentObserver = new window.ContentObserver(
      (nodes, metadata) => this.handleNewContent(nodes, metadata),
      {
        enableSmartFiltering: true,
        batchDelay: 750, // Slightly longer for better batching
        maxBatchSize: 75, // Larger batches for efficiency
        minTextLength: 3,
        skipElements: ['script', 'style', 'noscript', 'template', 'svg', 'code', 'pre'],
        skipClasses: ['no-translate', 'notranslate', 'qwen-translated', 'qwen-translating'],
        skipAttributes: ['data-no-translate', 'translate="no"', 'data-translated'],
        viewportMargin: '100px', // Larger margin for better preloading
        intersectionThreshold: 0.1
      }
    );

    this.contentObserver.startObserving();
    console.log('[ContentScript] Advanced content observer set up with visibility batching');
  }

  initializeLanguageDetector() {
    // Set up advanced language detector
    this.languageDetector = new window.AdvancedLanguageDetector({
      enableDOMAnalysis: true,
      enableContextualHints: true,
      confidence: {
        word: 0.8,
        context: 0.7
      }
    });

    console.log('[ContentScript] Language detector initialized');
  }

  async detectPageLanguage() {
    if (!this.languageDetector) {
      console.warn('[ContentScript] Language detector not available');
      return null;
    }

    try {
      // Get sample text from the page for detection
      const textSample = this.getPageTextSample();
      if (!textSample || textSample.length < 10) {
        console.log('[ContentScript] Insufficient text for language detection');
        return null;
      }

      const context = {
        url: window.location.href,
        domain: window.location.hostname,
        title: document.title,
        userAgent: navigator.userAgent,
        pageType: this.detectPageType()
      };

      const result = await this.languageDetector.detectLanguage(textSample, context);

      if (result && result.language && result.confidence > 0.6) {
        this.detectedLanguage = result.language;
        this.lastLanguageDetection = {
          language: result.language,
          confidence: result.confidence,
          method: result.primaryMethod,
          timestamp: Date.now()
        };

        console.log(`[ContentScript] Detected page language: ${result.language} (confidence: ${result.confidence.toFixed(2)}, method: ${result.primaryMethod})`);
        return result;
      } else {
        console.log('[ContentScript] Could not reliably detect page language');
        return null;
      }
    } catch (error) {
      console.error('[ContentScript] Language detection failed:', error);
      return null;
    }
  }

  getPageTextSample(maxLength = 2000) {
    const textNodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const text = node.textContent.trim();
          if (text.length < 3) return NodeFilter.FILTER_REJECT;

          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tagName = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'template'].includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    let totalLength = 0;
    while ((node = walker.nextNode()) && totalLength < maxLength) {
      const text = node.textContent.trim();
      textNodes.push(text);
      totalLength += text.length;
    }

    return textNodes.join(' ').substring(0, maxLength);
  }

  detectPageType() {
    // Simple page type detection for context
    const url = window.location.href;
    const title = document.title.toLowerCase();

    if (url.includes('github.com')) return 'code';
    if (url.includes('stackoverflow.com')) return 'qa';
    if (url.includes('wikipedia.org')) return 'encyclopedia';
    if (url.includes('news') || title.includes('news')) return 'news';
    if (url.includes('blog') || title.includes('blog')) return 'blog';
    if (url.includes('shop') || url.includes('store')) return 'ecommerce';
    if (title.includes('login') || title.includes('sign')) return 'auth';

    return 'general';
  }

  async ensureLanguageDetection() {
    // Check if we need to perform language detection
    const detectionAge = this.lastLanguageDetection
      ? Date.now() - this.lastLanguageDetection.timestamp
      : Infinity;

    // Re-detect if no previous detection or if it's older than 5 minutes
    if (!this.detectedLanguage || detectionAge > 5 * 60 * 1000) {
      console.log('[ContentScript] Performing language detection for current context');
      const detection = await this.detectPageLanguage();

      if (detection && detection.language) {
        // Update the detected language in settings if it differs
        await this.updateSourceLanguageIfNeeded(detection.language, detection.confidence);
      }
    }
  }

  async updateSourceLanguageIfNeeded(detectedLang, confidence) {
    try {
      // Only update if confidence is high and language is different from current setting
      if (confidence < 0.75) {
        console.log(`[ContentScript] Language detection confidence too low (${confidence.toFixed(2)}) to update settings`);
        return;
      }

      const currentSettings = await this.sendMessageWithRetry({ type: 'getSettings' });
      if (!currentSettings.success) {
        console.warn('[ContentScript] Could not get current settings to check source language');
        return;
      }

      const currentSourceLang = currentSettings.sourceLanguage;

      // Skip update if detected language matches current setting
      if (currentSourceLang === detectedLang) {
        console.log(`[ContentScript] Detected language (${detectedLang}) matches current setting`);
        return;
      }

      // Skip update if current setting is 'auto' (user prefers auto-detection)
      if (currentSourceLang === 'auto') {
        console.log('[ContentScript] Source language is set to auto, preserving user preference');
        return;
      }

      // Update the source language setting
      console.log(`[ContentScript] Updating source language from ${currentSourceLang} to ${detectedLang} (confidence: ${confidence.toFixed(2)})`);

      const updateResult = await this.sendMessageWithRetry({
        type: 'updateSettings',
        settings: {
          sourceLanguage: detectedLang,
          lastLanguageDetection: {
            language: detectedLang,
            confidence: confidence,
            timestamp: Date.now(),
            source: 'content-script'
          }
        }
      });

      if (updateResult.success) {
        console.log(`[ContentScript] Successfully updated source language to ${detectedLang}`);
      } else {
        console.warn('[ContentScript] Failed to update source language setting:', updateResult.error);
      }

    } catch (error) {
      console.error('[ContentScript] Error updating source language:', error);
    }
  }

  handleNewContent(nodes, metadata = {}) {
    const { priority = 'normal', visible = true, viewport = false } = metadata;

    console.log(`[ContentScript] New content detected: ${nodes.length} nodes, priority: ${priority}, visible: ${visible}`);

    // Check for massive content replacement first
    if (nodes.length > 100) {
      console.log('[ContentScript] 🚨 Large content batch detected - checking for content replacement');
      const bodyChildren = document.body.children.length;
      if (nodes.length > bodyChildren * 2) {
        this.handleContentReplacement();
        return;
      }
    }

    // Filter out already translated nodes
    const untranslatedNodes = nodes.filter(node => !this.translatedNodes.has(node));

    if (untranslatedNodes.length === 0) {
      console.log('[ContentScript] No new untranslated content found');
      return;
    }

    // Check if content has actually changed using hash
    const currentHash = this.getContentHash();
    const hasReallyChanged = this.lastContentHash === null || this.lastContentHash !== currentHash;

    if (!hasReallyChanged) {
      console.log('[ContentScript] No real content change detected, skipping');
      return;
    }

    this.lastContentHash = currentHash;

    // Handle urgent/visible content immediately
    if (priority === 'urgent' || (visible && viewport)) {
      console.log('[ContentScript] 🚨 Urgent content detected - immediate processing');
      this.processUrgentContent(untranslatedNodes);
      return;
    }

    // Check auto-translate limits for normal content
    if (this.autoTranslateCount >= this.maxAutoTranslates) {
      console.log('[ContentScript] Max auto-translates reached, showing manual option');
      this.showNotification('New content detected - click extension to translate', 'info');
      return;
    }

    // Debounce for normal priority content
    clearTimeout(this.contentChangeTimeout);
    this.contentChangeTimeout = setTimeout(() => {
      this.processNormalContent(untranslatedNodes, priority);
    }, priority === 'high' ? 500 : 1000);
  }

  processUrgentContent(nodes) {
    if (this.isTranslating) {
      console.log('[ContentScript] Already translating, queuing urgent content');
      this.urgentContentQueue = (this.urgentContentQueue || []).concat(nodes);
      return;
    }

    this.showNotification('Translating visible content...', 'info');
    this.translateNodes(nodes);
  }

  processNormalContent(nodes, priority) {
    console.log(`[ContentScript] Processing ${nodes.length} nodes with priority: ${priority}`);

    console.log(`[ContentScript] Auto-translate attempt ${this.autoTranslateCount + 1}/${this.maxAutoTranslates}`);
    this.showNotification(`Auto-translating new content (${this.autoTranslateCount + 1}/${this.maxAutoTranslates})...`, 'info');

    // Auto-translate with delay based on priority
    const delay = priority === 'high' ? 500 : 1000;
    setTimeout(() => {
      if (!this.isTranslating && this.autoTranslateCount < this.maxAutoTranslates) {
        this.autoTranslateCount++; // Increment only when actually starting translation
        console.log('[ContentScript] Auto-translating new content...');
        this.translatePage();
      }
    }, delay);
  }

  setupBasicContentObserver() {
    // Fallback to basic MutationObserver if ContentObserver is not available
    this.contentObserver = new MutationObserver((mutations) => {
      let hasNewContent = false;

      mutations.forEach((mutation) => {
        if (mutation.addedNodes.length > 0) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
              if (this.hasTranslatableText(node)) {
                hasNewContent = true;
              }
            }
          });
        }
      });

      if (hasNewContent) {
        clearTimeout(this.contentChangeTimeout);
        this.contentChangeTimeout = setTimeout(() => {
          if (this.autoTranslateCount < this.maxAutoTranslates && !this.isTranslating) {
            this.autoTranslateCount++;
            this.translatePage();
          }
        }, 1000);
      }
    });

    this.contentObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    console.log('[ContentScript] Basic content observer set up');
  }

  startAutoTranslation() {
    this.isAutoTranslateEnabled = true;

    // Start the dynamic content observer
    if (this.contentObserver) {
      this.contentObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    console.log('[ContentScript] Auto-translation started');

    // Translate existing content immediately (like legacy)
    setTimeout(() => {
      if (this.isAutoTranslateEnabled) {
        console.log('[ContentScript] Auto-translating existing content...');
        this.translatePage().catch(console.error);
      }
    }, 100);
  }

  stopAutoTranslation() {
    this.isAutoTranslateEnabled = false;

    // Stop the dynamic content observer
    if (this.contentObserver) {
      this.contentObserver.disconnect();
    }

    console.log('[ContentScript] Auto-translation stopped');
  }

  // Clear translation cache to force fresh scan (useful for debugging)
  clearTranslationCache() {
    const previousCount = this.translatedNodes.size || 0;
    this.translatedNodes = new WeakSet();
    console.log(`[ContentScript] Cleared translation cache (previously had ~${previousCount} marked nodes)`);
  }

  // Detect massive content replacement (websites overwriting DOM after translation)
  detectContentReplacement(mutations) {
    const currentElementCount = document.querySelectorAll('*').length;
    const elementCountDiff = Math.abs(currentElementCount - this.lastElementCount);

    // Check for large-scale DOM replacement
    let massiveRemovals = 0;
    let massiveAdditions = 0;

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        massiveRemovals += mutation.removedNodes.length;
        massiveAdditions += mutation.addedNodes.length;
      }
    }

    // Threshold for detecting content replacement (adjust as needed)
    const isReplacement = (
      (massiveRemovals > 10 && massiveAdditions > 10) || // Many nodes replaced simultaneously
      (elementCountDiff > this.lastElementCount * 0.3) || // More than 30% of elements changed
      (currentElementCount < this.lastElementCount * 0.7) // Page shrank by more than 30%
    );

    this.lastElementCount = currentElementCount;

    if (isReplacement) {
      console.log(`[ContentScript] 🚨 Content replacement detected: removed=${massiveRemovals}, added=${massiveAdditions}, elementDiff=${elementCountDiff}`);
    }

    return isReplacement;
  }

  // Handle content replacement by preserving and reapplying translations
  handleContentReplacement() {
    this.contentReplacementDetected = true;

    // Clear existing preservation timer
    if (this.preservationTimer) {
      clearTimeout(this.preservationTimer);
    }

    // Wait a short moment for DOM to stabilize, then restore translations
    this.preservationTimer = setTimeout(() => {
      console.log('[ContentScript] 🔄 Attempting to restore translations after content replacement...');
      this.restoreTranslations();
    }, 500);
  }

  // Restore translations using preserved text mappings
  async restoreTranslations() {
    if (this.originalTextMap.size === 0) {
      console.log('[ContentScript] No preserved translations to restore, attempting fresh scan...');
      // Try fresh translation since we have no preserved mappings
      if (!this.isTranslating && this.autoTranslateCount < this.maxAutoTranslates) {
        console.log('[ContentScript] 🔄 Attempting fresh translation after content replacement...');
        this.autoTranslateCount++;
        // Clear translation cache to allow re-translation
        this.translatedNodes = new WeakSet();
        this.translatePage();
      }
      return;
    }

    // Use comprehensive scan to find ALL text nodes, not just untranslated ones
    const allTextNodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const text = node.textContent.trim();
          if (text.length < 3) return NodeFilter.FILTER_REJECT;
          if (!/\p{L}/u.test(text)) return NodeFilter.FILTER_REJECT;

          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'];
          if (skipTags.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let textNode;
    while (textNode = walker.nextNode()) {
      allTextNodes.push(textNode);
    }

    let restoredCount = 0;

    for (const node of allTextNodes) {
      const originalText = node.textContent.trim();

      // Check if we have a translation for this text
      if (this.originalTextMap.has(originalText)) {
        const translation = this.originalTextMap.get(originalText);

        // Only apply if the text hasn't already been translated
        if (originalText !== translation && !this.translatedNodes.has(node)) {
          this.applyTranslation(node, translation);
          this.translatedNodes.add(node);
          restoredCount++;

          // Log restoration of special elements
          const parentTag = node.parentElement?.tagName;
          if (['TABLE', 'TD', 'TH', 'BUTTON', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'].includes(parentTag)) {
            console.log(`[ContentScript] 🔄 Restored ${parentTag}: "${originalText}" → "${translation}"`);
          }
        }
      }
    }

    if (restoredCount > 0) {
      console.log(`[ContentScript] ✅ Restored ${restoredCount} translations after content replacement`);
      this.showNotification(`Restored ${restoredCount} translations after page update`, 'success');
    } else {
      console.log('[ContentScript] ⚠️ No translations could be restored, trying fresh translation...');

      // If we can't restore, try a fresh translation
      if (!this.isTranslating && this.autoTranslateCount < this.maxAutoTranslates) {
        console.log('[ContentScript] 🔄 Attempting fresh translation of replaced content...');
        this.autoTranslateCount++;
        // Clear translation cache to allow re-translation
        this.translatedNodes = new WeakSet();
        this.translatePage();
      }
    }

    this.contentReplacementDetected = false;
  }

  hasTranslatableText(element) {
    // Quick check if an element or its children contain translatable text
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const text = node.textContent.trim();
          if (text.length < 3) return NodeFilter.FILTER_REJECT;
          if (!/\p{L}/u.test(text)) return NodeFilter.FILTER_REJECT;

          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'];
          if (skipTags.includes(parent.tagName)) return NodeFilter.FILTER_REJECT;

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    return walker.nextNode() !== null;
  }

  getContentHash() {
    // Create a simple hash of page content to detect real changes
    const textNodes = this.findTextNodes();
    const noscriptNodes = this.findNoscriptContent();
    const allNodes = textNodes.concat(noscriptNodes);
    const contentTexts = allNodes.map(node => node.textContent.trim()).slice(0, 50); // First 50 text nodes
    const contentString = contentTexts.join('|');

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < contentString.length; i++) {
      const char = contentString.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return hash;
  }

  cleanup() {
    // Clean up observers and timeouts
    if (this.contentObserver) {
      this.contentObserver.disconnect();
      this.contentObserver = null;
    }

    if (this.contentChangeTimeout) {
      clearTimeout(this.contentChangeTimeout);
      this.contentChangeTimeout = null;
    }

    console.log('[ContentScript] Cleanup completed');
  }

  showNotification(message, type = 'info') {
    // Remove existing notification
    const existing = document.getElementById('translation-notification');
    if (existing) {
      existing.remove();
    }

    // Create notification
    const notification = document.createElement('div');
    notification.id = 'translation-notification';

    const colors = {
      info: '#007bff',
      success: '#28a745',
      warning: '#ffc107',
      error: '#dc3545'
    };

    // Enhanced styling for success notifications
    const isSuccess = type === 'success' && message.includes('TRANSLATION SUCCESS');
    const duration = isSuccess ? 5000 : 3000; // Success notifications last longer

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${colors[type] || colors.info};
      color: white;
      padding: ${isSuccess ? '15px 20px' : '10px 15px'};
      border-radius: 6px;
      z-index: 10002;
      font-size: ${isSuccess ? '16px' : '14px'};
      font-weight: ${isSuccess ? 'bold' : 'normal'};
      max-width: 350px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      border: ${isSuccess ? '2px solid #fff' : 'none'};
      animation: ${isSuccess ? 'pulse 0.5s ease-in-out' : 'none'};
    `;

    notification.textContent = message;

    // Auto-remove after specified duration
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, duration);

    document.body.appendChild(notification);
  }

  // Legacy-style auto-translation methods
  startAutoTranslation() {
    console.log('[ContentScript] Starting auto-translation');
    this.isAutoTranslateEnabled = true;

    // Start observing for dynamic content
    if (this.contentObserver) {
      this.contentObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false
      });
    }

    // Translate existing content immediately (like legacy)
    setTimeout(() => {
      if (this.isAutoTranslateEnabled) {
        console.log('[ContentScript] Auto-translating existing content');
        this.translatePage().catch(console.error);
      }
    }, 100);
  }

  stopAutoTranslation() {
    console.log('[ContentScript] Stopping auto-translation');
    this.isAutoTranslateEnabled = false;

    // Stop observing
    if (this.contentObserver) {
      this.contentObserver.disconnect();
    }
  }

  async initializeProgressIndicator() {
    // Simple inline progress indicator instead of loading external file
    this.progressIndicator = {
      isVisible: false,
      startTime: null,
      show() {
        if (this.isVisible) return;
        this.startTime = Date.now();
        this.isVisible = true;
        console.log('[ContentScript] Progress tracking started');
      },
      updateStatus(status, message) {
        console.log(`[ContentScript] Progress: ${status} - ${message || ''}`);
      },
      updateProgress(completed, total) {
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
        console.log(`[ContentScript] Progress: ${completed}/${total} (${percentage}%)`);
      },
      showCompletion(totalTexts, totalTime) {
        console.log(`[ContentScript] Translation completed: ${totalTexts} texts in ${totalTime}ms`);
        this.hide();
      },
      showError(error) {
        console.error(`[ContentScript] Translation error: ${error}`);
        this.hide();
      },
      hide() {
        this.isVisible = false;
        console.log('[ContentScript] Progress tracking ended');
      }
    };
    console.log('[ContentScript] Simple progress indicator initialized');
  }

  handleProgressUpdate(progress) {
    try {
      if (!this.progressIndicator) {
        console.log('[ContentScript] Progress indicator not available, skipping update');
        return;
      }

      const { completed, total, status, percentage } = progress;

      // Show progress indicator if not already visible
      if (!this.progressIndicator.isVisible) {
        this.progressIndicator.show();
      }

      // Update progress based on status
      switch (status) {
        case 'scanning':
          this.progressIndicator.updateStatus('scanning');
          break;

        case 'translating':
          this.progressIndicator.updateStatus('translating');
          this.progressIndicator.updateProgress(completed, total);
          break;

        case 'waiting':
          this.progressIndicator.updateStatus('waiting', 'Rate limit reached - waiting...');
          break;

        case 'complete':
          this.progressIndicator.showCompletion(total, Date.now() - this.progressIndicator.startTime);
          break;

        case 'error':
          this.progressIndicator.showError(progress.error || 'Translation failed');
          break;

        default:
          // Generic progress update
          this.progressIndicator.updateProgress(completed, total);
          break;
      }

      console.log(`[ContentScript] Progress updated: ${completed}/${total} (${percentage}%) - ${status}`);
    } catch (error) {
      console.error('[ContentScript] Error handling progress update:', error);
    }
  }
}

// Store class reference to prevent re-declaration
window.SimpleTranslationScript = SimpleTranslationScript;

// Initialize content script instance
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    try {
      window.translationScriptInstance = new SimpleTranslationScript();
      console.log('[ContentScript] Instance created successfully after DOM loaded');
    } catch (error) {
      console.error('[ContentScript] Failed to create instance after DOM loaded:', error);
      // Reset the flag to allow retry on next injection
      window.translationExtensionInitialized = false;
    }
  });
} else {
  try {
    window.translationScriptInstance = new SimpleTranslationScript();
    console.log('[ContentScript] Instance created successfully');
  } catch (error) {
    console.error('[ContentScript] Failed to create instance:', error);
    // Reset the flag to allow retry on next injection
    window.translationExtensionInitialized = false;
  }
}

} catch (extensionError) {
  console.error('[ContentScript] Extension context error during initialization:', extensionError);
  // Reset flags so extension can retry when reloaded
  window.translationExtensionInitialized = false;
  window.translationScriptInitialized = false;
}

})(); // End of IIFE