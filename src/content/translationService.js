/**
 * Translation Service Module
 * Handles core translation logic, node processing, and messaging
 */

import { startTimer, endTimer, trackTranslation, trackDOMScan } from '../lib/performanceTracker.js';

class TranslationService {
  constructor(options = {}) {
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

    // Initialize urgent content queue
    this.urgentContentQueue = [];

    // Message communication
    this.messageHandlers = new Map();
    this.setupMessageHandlers();
  }

  setupMessageHandlers() {
    this.messageHandlers.set('translateSelection', (request) => this.translateSelection(request.text));
    this.messageHandlers.set('translatePage', () => this.translatePage());
    this.messageHandlers.set('debugShowAllText', () => this.debugShowAllText());
    this.messageHandlers.set('extractHiddenDutchContent', () => this.extractHiddenDutchContent());
    this.messageHandlers.set('scanIframes', () => this.scanIframes());
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      console.log('[TranslationService] Received message:', request.type);

      const handler = this.messageHandlers.get(request.type);
      if (!handler) {
        sendResponse({ error: `Unknown message type: ${request.type}` });
        return;
      }

      const result = await handler(request);
      sendResponse({ success: true, result });

    } catch (error) {
      console.error('[TranslationService] Message handler error:', error);
      sendResponse({ error: error.message });
    }
  }

  async sendMessageWithRetry(message, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await chrome.runtime.sendMessage(message);
      } catch (error) {
        console.warn(`[TranslationService] Message attempt ${attempt}/${maxRetries} failed:`, error.message);

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

  async translateSelection(text) {
    if (!text || text.trim().length === 0) {
      console.warn('[TranslationService] No text provided for selection translation');
      return null;
    }

    try {
      const settings = await this.sendMessageWithRetry({ type: 'getSettings' });
      if (!settings || !settings.success) {
        console.error('[TranslationService] Failed to get settings for selection translation');
        return null;
      }

      console.log('[TranslationService] Translating selection:', text.substring(0, 100) + '...');

      const response = await this.sendMessageWithRetry({
        type: 'translate',
        text: text,
        sourceLanguage: settings.data.sourceLanguage || 'auto',
        targetLanguage: settings.data.targetLanguage || 'en',
        provider: settings.data.provider || 'qwen-mt-turbo'
      });

      if (response && response.success && response.data) {
        const result = {
          originalText: text,
          translatedText: response.data,
          sourceLanguage: settings.data.sourceLanguage,
          targetLanguage: settings.data.targetLanguage
        };

        this.showTranslationResult(text, response.data, {
          method: 'selection',
          provider: settings.data.provider
        });

        return result;
      } else {
        console.error('[TranslationService] Translation failed:', response);
        return null;
      }
    } catch (error) {
      console.error('[TranslationService] Selection translation error:', error);
      return null;
    }
  }

  async translatePage() {
    if (this.isTranslating) {
      console.log('[TranslationService] Translation already in progress, skipping');
      return { alreadyInProgress: true };
    }

    const timerId = startTimer('pageTranslation');
    this.isTranslating = true;

    try {
      console.log('[TranslationService] Starting page translation');

      // Detect JavaScript framework for optimization
      const framework = this.detectJavaScriptFramework();
      console.log('[TranslationService] Detected framework:', framework);

      // Find noscript content that might contain fallback text
      this.findNoscriptContent();

      // Comprehensive scan of all text nodes
      const nodes = this.comprehensiveScan();
      console.log(`[TranslationService] Found ${nodes.length} text nodes to translate`);

      if (nodes.length === 0) {
        console.log('[TranslationService] No translatable text found');
        return { noContent: true };
      }

      // Language detection and settings
      const settings = await this.ensureLanguageDetection();
      if (!settings) {
        console.error('[TranslationService] Failed to get translation settings');
        return { error: 'Settings unavailable' };
      }

      const duration = endTimer(timerId);
      trackDOMScan(nodes.length, duration);

      // Process nodes in optimized batches
      const result = await this.translateNodes(nodes, settings);

      console.log(`[TranslationService] Translation completed: ${result.translatedCount}/${result.totalNodes} nodes`);

      return {
        success: true,
        translatedCount: result.translatedCount,
        totalNodes: result.totalNodes,
        framework
      };

    } catch (error) {
      console.error('[TranslationService] Page translation error:', error);
      const duration = endTimer(timerId, { success: false });
      return { error: error.message };
    } finally {
      this.isTranslating = false;
    }
  }

  detectJavaScriptFramework() {
    const frameworks = [];

    // React detection
    if (window.React || document.querySelector('[data-reactroot]') ||
        document.querySelector('*[data-react-component]')) {
      frameworks.push('React');
    }

    // Vue detection
    if (window.Vue || document.querySelector('[data-v-]') ||
        document.querySelector('*[v-]')) {
      frameworks.push('Vue');
    }

    // Angular detection
    if (window.angular || window.ng || document.querySelector('[ng-app]') ||
        document.querySelector('*[ng-]')) {
      frameworks.push('Angular');
    }

    // Next.js detection
    if (window.__NEXT_DATA__ || document.querySelector('#__next')) {
      frameworks.push('Next.js');
    }

    return frameworks.length > 0 ? frameworks : ['Vanilla'];
  }

  findNoscriptContent() {
    const noscriptElements = document.querySelectorAll('noscript');
    if (noscriptElements.length > 0) {
      console.log(`[TranslationService] Found ${noscriptElements.length} noscript elements`);
    }
  }

  comprehensiveScan() {
    const timerId = startTimer('comprehensiveScan');
    const allTextNodes = this.findTextNodes();
    const translatableNodes = allTextNodes.filter(node => this.isTranslatableNode(node));

    const duration = endTimer(timerId);
    console.log(`[TranslationService] Comprehensive scan: ${allTextNodes.length} total, ${translatableNodes.length} translatable (${duration}ms)`);

    return translatableNodes;
  }

  debugShowAllText() {
    const allTextNodes = this.findTextNodes();
    const result = {
      totalNodes: allTextNodes.length,
      translatableNodes: 0,
      samples: []
    };

    for (const node of allTextNodes.slice(0, 20)) {
      const text = node.textContent?.trim();
      if (text && text.length > 3) {
        const isTranslatable = this.isTranslatableNode(node);
        if (isTranslatable) result.translatableNodes++;

        result.samples.push({
          text: text.substring(0, 100),
          translatable: isTranslatable,
          parent: node.parentElement?.tagName?.toLowerCase(),
          classes: Array.from(node.parentElement?.classList || [])
        });
      }
    }

    console.log('[TranslationService] Debug text analysis:', result);
    return result;
  }

  extractHiddenDutchContent() {
    const hiddenElements = [];
    const elements = document.querySelectorAll('*');

    for (const element of elements) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') {
        const text = element.textContent?.trim();
        if (text && text.length > 10) {
          hiddenElements.push({
            text: text.substring(0, 200),
            element: element.tagName.toLowerCase(),
            classes: Array.from(element.classList)
          });
        }
      }
    }

    console.log('[TranslationService] Hidden content analysis:', hiddenElements);
    return { hiddenElements: hiddenElements.slice(0, 10) };
  }

  scanIframes() {
    const iframes = document.querySelectorAll('iframe');
    const results = [];

    for (const iframe of iframes) {
      try {
        const iframeDoc = iframe.contentDocument;
        if (iframeDoc) {
          const textNodes = this.findTextNodesInDocument(iframeDoc);
          results.push({
            src: iframe.src || 'about:blank',
            textNodes: textNodes.length,
            accessible: true
          });
        } else {
          results.push({
            src: iframe.src || 'about:blank',
            textNodes: 0,
            accessible: false
          });
        }
      } catch (error) {
        results.push({
          src: iframe.src || 'about:blank',
          textNodes: 0,
          accessible: false,
          error: error.message
        });
      }
    }

    console.log('[TranslationService] Iframe scan results:', results);
    return { iframes: results };
  }

  isTranslatableText(text) {
    if (!text || typeof text !== 'string') return false;

    const trimmed = text.trim();
    if (trimmed.length < 3) return false;
    if (/^\d+$/.test(trimmed)) return false; // Skip pure numbers
    if (/^[^\w\s]+$/.test(trimmed)) return false; // Skip pure symbols

    return true;
  }

  findTextNodes(root = document.body) {
    if (!root) return [];
    return this.findTextNodesInDocument(root.ownerDocument || document, root);
  }

  findTextNodesInDocument(doc, root = null) {
    const textNodes = [];
    const walker = doc.createTreeWalker(
      root || doc.body || doc.documentElement,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    return textNodes;
  }

  isTranslatableNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;
    if (this.translatedNodes.has(node)) return false;

    const text = node.textContent?.trim();
    if (!this.isTranslatableText(text)) return false;

    const parent = node.parentElement;
    if (!parent) return false;

    // Skip script and style elements
    const tagName = parent.tagName?.toLowerCase();
    if (['script', 'style', 'noscript', 'template', 'svg', 'code', 'pre'].includes(tagName)) {
      return false;
    }

    // Skip elements with no-translate classes or attributes
    if (parent.classList.contains('no-translate') ||
        parent.classList.contains('notranslate') ||
        parent.classList.contains('qwen-translated') ||
        parent.classList.contains('qwen-translating') ||
        parent.hasAttribute('data-no-translate') ||
        parent.hasAttribute('translate') && parent.getAttribute('translate') === 'no') {
      return false;
    }

    // Skip invisible elements
    if (parent.offsetParent === null) return false;

    const computedStyle = getComputedStyle(parent);
    if (computedStyle.display === 'none' ||
        computedStyle.visibility === 'hidden' ||
        computedStyle.opacity === '0') {
      return false;
    }

    return true;
  }

  async translateNodes(nodes) {
    if (!nodes || nodes.length === 0) return { translatedCount: 0, totalNodes: 0 };

    const timerId = startTimer('translateNodes');
    let translatedCount = 0;

    try {
      // Get settings
      const settingsResponse = await this.sendMessageWithRetry({ type: 'getSettings' });
      if (!settingsResponse || !settingsResponse.success) {
        throw new Error('Failed to get translation settings');
      }
      const settings = settingsResponse.data;

      // Create optimized batches
      const batches = this.createBatches(nodes, 20);
      console.log(`[TranslationService] Created ${batches.length} batches for ${nodes.length} nodes`);

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        console.log(`[TranslationService] Processing batch ${i + 1}/${batches.length} (${batch.length} nodes)`);

        try {
          const batchResult = await this.translateOptimizedBatch(batch, settings);
          translatedCount += batchResult;

          // Small delay between batches to prevent overwhelming the API
          if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }

        } catch (error) {
          console.error(`[TranslationService] Batch ${i + 1} failed:`, error);
          // Continue with next batch
        }
      }

      const duration = endTimer(timerId, { success: true, translatedCount });
      console.log(`[TranslationService] Translation completed: ${translatedCount}/${nodes.length} nodes in ${duration}ms`);

      return { translatedCount, totalNodes: nodes.length };

    } catch (error) {
      endTimer(timerId, { success: false, error: error.message });
      throw error;
    }
  }

  createBatches(nodes, maxBatchSize = 20) {
    const batches = [];
    let currentBatch = [];
    let currentTokenCount = 0;
    const maxTokensPerBatch = 6000;

    for (const node of nodes) {
      const text = node.textContent?.trim();
      if (!text) continue;

      const tokenCount = Math.ceil(text.length / 4); // Rough token estimation

      if ((currentBatch.length >= maxBatchSize) ||
          (currentTokenCount + tokenCount > maxTokensPerBatch && currentBatch.length > 0)) {
        batches.push(currentBatch);
        currentBatch = [];
        currentTokenCount = 0;
      }

      currentBatch.push(node);
      currentTokenCount += tokenCount;
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  splitLongText(text, maxChars) {
    if (text.length <= maxChars) return [text];

    const chunks = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let currentChunk = '';

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > maxChars && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  async translateOptimizedBatch(nodes, settings) {
    if (!nodes || nodes.length === 0) return 0;

    const timerId = startTimer('translateBatch');
    let translatedCount = 0;

    try {
      // Collect unique texts to avoid duplicate translations
      const uniqueTexts = new Map();
      const nodeTextMap = new Map();

      for (const node of nodes) {
        const text = node.textContent?.trim();
        if (!text || !this.isTranslatableText(text)) continue;

        nodeTextMap.set(node, text);

        if (!uniqueTexts.has(text)) {
          uniqueTexts.set(text, []);
        }
        uniqueTexts.get(text).push(node);
      }

      if (uniqueTexts.size === 0) {
        endTimer(timerId, { uniqueTexts: 0 });
        return 0;
      }

      // Prepare batch translation request
      const textsToTranslate = Array.from(uniqueTexts.keys());
      console.log(`[TranslationService] Batch: ${nodes.length} nodes, ${uniqueTexts.size} unique texts`);

      const response = await this.sendMessageWithRetry({
        type: 'translateBatch',
        texts: textsToTranslate,
        sourceLanguage: settings.sourceLanguage || 'auto',
        targetLanguage: settings.targetLanguage || 'en',
        provider: settings.provider || 'qwen-mt-turbo'
      });

      if (!response || !response.success || !response.data) {
        throw new Error('Batch translation failed: ' + (response?.error || 'No response'));
      }

      // Apply translations to all nodes with same text
      const translations = response.data;
      for (let i = 0; i < textsToTranslate.length; i++) {
        const originalText = textsToTranslate[i];
        const translation = translations[i];
        const nodesWithThisText = uniqueTexts.get(originalText);

        if (translation && typeof translation === 'string') {
          for (const node of nodesWithThisText) {
            if (node.parentElement) {
              this.applyTranslation(node, translation);
              this.translatedNodes.add(node);
              translatedCount++;

              // Track translation performance
              trackTranslation(originalText, translation, 0, false);
            }
          }
        }
      }

      const duration = endTimer(timerId, {
        success: true,
        uniqueTexts: uniqueTexts.size,
        translatedCount
      });

      return translatedCount;

    } catch (error) {
      endTimer(timerId, { success: false, error: error.message });
      console.error('[TranslationService] Batch translation error:', error);
      throw error;
    }
  }

  applyTranslation(node, translatedText) {
    if (!node || !node.parentElement || !translatedText) return;

    try {
      // Store original text for potential rollback
      const originalText = node.textContent;

      // Preserve whitespace structure
      const leadingWhitespace = originalText.match(/^\s*/)?.[0] || '';
      const trailingWhitespace = originalText.match(/\s*$/)?.[0] || '';

      // Apply translation with preserved whitespace
      node.textContent = leadingWhitespace + translatedText + trailingWhitespace;

      // Add visual indicator
      const parent = node.parentElement;
      parent.classList.add('qwen-translated');
      parent.setAttribute('data-original-text', originalText);
      parent.setAttribute('data-translated', 'true');

      // Store in preservation map for dynamic content
      this.originalTextMap.set(originalText, translatedText);

    } catch (error) {
      console.error('[TranslationService] Error applying translation:', error);
    }
  }

  showTranslationResult(original, translated, info = {}) {
    console.log(`[TranslationService] Translation result (${info.method || 'unknown'}):`, {
      original: original.substring(0, 100),
      translated: translated.substring(0, 100),
      provider: info.provider
    });

    // Could add visual feedback here if needed
  }

  handleContextInvalidation() {
    console.warn('[TranslationService] Extension context invalidated, cleaning up...');
    this.cleanup();
  }

  cleanup() {
    if (this.contentObserver) {
      this.contentObserver.disconnect();
      this.contentObserver = null;
    }

    if (this.contentChangeTimeout) {
      clearTimeout(this.contentChangeTimeout);
      this.contentChangeTimeout = null;
    }

    if (this.preservationTimer) {
      clearTimeout(this.preservationTimer);
      this.preservationTimer = null;
    }

    this.isInitialized = false;
    this.isTranslating = false;
    this.originalTextMap.clear();
  }
}

export { TranslationService };