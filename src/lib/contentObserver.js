/**
 * Advanced Content Observer - Intelligent DOM mutation monitoring with visibility batching
 * Monitors DOM changes and identifies new translatable content efficiently with smart filtering
 */

// Avoid redeclaration errors in Brave Browser
if (typeof window !== 'undefined' && window.ContentObserver) {
  console.log('[ContentObserver] Class already exists, skipping redeclaration');
} else {

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
    this.intersectionObserver = null;
    this.batchTimer = null;
    this.pendingNodes = new Set();
    this.processedNodes = new WeakSet();
    this.visibilityCache = new WeakMap();

    this.isObserving = false;
    this.stats = {
      nodesAdded: 0,
      nodesFiltered: 0,
      batchesProcessed: 0,
      visibleNodes: 0,
      hiddenNodes: 0,
      urgentProcessed: 0
    };

    this.initializeObservers();
  }

  // Initialize mutation and intersection observers
  initializeObservers() {
    // Mutation Observer for DOM changes
    this.mutationObserver = new MutationObserver((mutations) => {
      this.handleMutations(mutations);
    });

    // Intersection Observer for visibility tracking
    if (this.options.enableSmartFiltering && typeof window.IntersectionObserver === 'function') {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => this.handleIntersection(entries),
        {
          root: null,
          rootMargin: this.options.viewportMargin,
          threshold: this.options.intersectionThreshold
        }
      );
    }
  }

  // Start observing the document
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

  // Stop observing
  stopObserving() {
    if (!this.isObserving) return;

    this.mutationObserver.disconnect();
    this.intersectionObserver?.disconnect();
    this.clearBatchTimer();

    this.isObserving = false;
    console.log('[ContentObserver] Stopped observing DOM changes');
  }

  // Handle DOM mutations
  handleMutations(mutations) {
    const nodesToProcess = new Set();

    for (const mutation of mutations) {
      // Handle added nodes
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          this.collectTranslatableNodes(node, nodesToProcess);
        }
      }

      // Handle character data changes
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

  // Collect translatable nodes from a root node
  collectTranslatableNodes(rootNode, collector) {
    if (!rootNode || (typeof Node !== 'undefined' && !(rootNode instanceof Node))) {
      return;
    }

    if (rootNode.nodeType === Node.TEXT_NODE) {
      if (this.isTranslatableTextNode(rootNode)) {
        collector.add(rootNode);
        this.stats.nodesAdded++;
      }
      return;
    }

    if (rootNode.nodeType !== Node.ELEMENT_NODE) return;

    const element = rootNode;

    // Skip if already processed
    if (this.processedNodes.has(element)) return;

    // Skip non-translatable elements
    if (!this.isTranslatableElement(element)) {
      this.stats.nodesFiltered++;
      return;
    }

    // Mark as processed
    this.processedNodes.add(element);

    // Use TreeWalker for efficient text node collection
    const doc = element.ownerDocument || document;

    const walker = doc.createTreeWalker(
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
      this.stats.nodesAdded++;
    }
  }

  // Check if text node is translatable
  isTranslatableTextNode(textNode) {
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;

    const text = textNode.textContent.trim();
    if (text.length < this.options.minTextLength) return false;

    // Skip if only whitespace, numbers, or special characters
    if (!/\p{L}/u.test(text)) return false;

    // Skip URLs, emails, and code patterns
    if (this.isCodeOrUrl(text)) return false;

    const parentElement = textNode.parentElement;
    if (!parentElement) return false;

    return this.isTranslatableElement(parentElement);
  }

  // Detect code patterns or URLs that shouldn't be translated
  isCodeOrUrl(text) {
    // URLs
    if (/^https?:\/\//.test(text) || /www\.\w+\.\w+/.test(text)) return true;

    // Email addresses
    if (/\S+@\S+\.\S+/.test(text)) return true;

    // Code patterns (camelCase, snake_case, function calls)
    if (/^[a-z][a-zA-Z0-9_]*\(|^[a-z_][a-zA-Z0-9_]*$/.test(text.trim())) return true;

    // File paths
    if (/[\/\\][\w-]+\.[\w]{2,4}$/.test(text)) return true;

    // Numbers only
    if (/^\d+(\.\d+)?$/.test(text.trim())) return true;

    return false;
  }

  // Check if element should be translated
  isTranslatableElement(element) {
    if (!element) return false;

    const elementNodeType = (typeof Node !== 'undefined' && typeof Node.ELEMENT_NODE === 'number') ? Node.ELEMENT_NODE : 1;
    if (typeof element.nodeType === 'number' && element.nodeType !== elementNodeType) {
      return false;
    }

    const tagName = (element.tagName || '').toLowerCase();

    // Skip certain elements
    if (this.options.skipElements.includes(tagName)) return false;

    const hasGetAttribute = typeof element.getAttribute === 'function';
    const hasHasAttribute = typeof element.hasAttribute === 'function';
    const hasClassList = typeof element.classList !== 'undefined' && typeof element.classList.contains === 'function';

    // Skip elements with no-translate attributes
    for (const attr of this.options.skipAttributes) {
      if (!hasGetAttribute && !hasHasAttribute) break;
      if (attr.includes('=')) {
        if (!hasGetAttribute) continue;
        const [name, value] = attr.split('=');
        if (element.getAttribute(name.trim()) === value.replace(/"/g, '').trim()) {
          return false;
        }
      } else if (hasHasAttribute && element.hasAttribute(attr)) {
        return false;
      }
    }

    // Skip elements with no-translate classes
    if (hasClassList) {
      for (const className of this.options.skipClasses) {
        if (element.classList.contains(className)) return false;
      }
    }

    // Skip hidden elements
    if (this.isElementHidden(element)) return false;

    // Skip contenteditable elements that are being edited
    if (element.contentEditable === 'true' && element === document.activeElement) {
      return false;
    }

    // Skip form inputs and interactive elements
    if (['input', 'textarea', 'select', 'button', 'canvas', 'audio', 'video'].includes(tagName)) {
      return false;
    }

    // Skip if parent has data-translated (already processed)
    if ((typeof element.hasAttribute === 'function' && element.hasAttribute('data-translated')) ||
        (typeof element.closest === 'function' && element.closest('[data-translated]'))) {
      return false;
    }

    return true;
  }

  // Check if element is hidden
  isElementHidden(element) {
    // Check cache first
    if (this.visibilityCache.has(element)) {
      return this.visibilityCache.get(element);
    }

    let isHidden = false;

    try {
      // Check display and visibility
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        isHidden = true;
      }

      // Check if element has zero dimensions
      if (!isHidden) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          isHidden = true;
        }
      }
    } catch (error) {
      // If style computation fails, assume visible
      isHidden = false;
    }

    // Cache result with expiration
    this.visibilityCache.set(element, isHidden);

    return isHidden;
  }

  // Add nodes to batch for processing
  addToBatch(nodes) {
    for (const node of nodes) {
      this.pendingNodes.add(node);
    }

    // Set up batch processing timer
    this.clearBatchTimer();
    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.options.batchDelay);

    // Process immediately if batch is full
    if (this.pendingNodes.size >= this.options.maxBatchSize) {
      this.clearBatchTimer();
      this.processBatch();
    }
  }

  // Process batched nodes
  processBatch() {
    if (this.pendingNodes.size === 0) return;

    const nodes = Array.from(this.pendingNodes);
    this.pendingNodes.clear();

    // Filter out nodes that are no longer in document
    const validNodes = nodes.filter(node => {
      if (!node || typeof node !== 'object') return false;
      if (typeof document.contains === 'function') {
        const candidate = node.nodeType != null ? node : node.parentElement;
        if (candidate && typeof candidate.nodeType === 'number') {
          try {
            if (!document.contains(candidate)) return false;
          } catch (_) {}
        }
      }
      return true;
    });

    if (validNodes.length > 0) {
      // Group nodes by visibility for smart processing
      const visibleNodes = [];
      const hiddenNodes = [];

      for (const node of validNodes) {
        const parentElement = node.parentElement;
        if (parentElement && this.intersectionObserver) {
          // Use intersection observer for visibility detection
          this.intersectionObserver.observe(parentElement);
        }

        if (this.isNodeVisible(node)) {
          visibleNodes.push(node);
          this.stats.visibleNodes++;
        } else {
          hiddenNodes.push(node);
          this.stats.hiddenNodes++;
        }
      }

      // Process visible nodes with higher priority
      if (visibleNodes.length > 0) {
        this.onNewContent(visibleNodes, { priority: 'high', visible: true });
      }

      // Process hidden nodes with lower priority (optional background processing)
      if (hiddenNodes.length > 0 && this.options.processHiddenContent !== false) {
        this.onNewContent(hiddenNodes, { priority: 'low', visible: false });
      }

      this.stats.batchesProcessed++;
    }
  }

  // Check if node is currently visible
  isNodeVisible(node) {
    if (!node.parentElement) return false;

    // Check if any parent is hidden
    let element = node.parentElement;
    while (element && element !== document.body) {
      if (this.isElementHidden(element)) {
        return false;
      }
      element = element.parentElement;
    }

    // Check if in viewport (basic check)
    try {
      const rect = node.parentElement.getBoundingClientRect();
      const windowHeight = window.innerHeight || document.documentElement.clientHeight;
      const windowWidth = window.innerWidth || document.documentElement.clientWidth;

      return (
        rect.top < windowHeight &&
        rect.bottom > 0 &&
        rect.left < windowWidth &&
        rect.right > 0
      );
    } catch (error) {
      // If getBoundingClientRect fails, assume visible
      return true;
    }
  }

  // Handle intersection observer entries
  handleIntersection(entries) {
    for (const entry of entries) {
      const element = entry.target;

      // Update visibility cache
      this.visibilityCache.set(element, !entry.isIntersecting);

      // If element becomes visible and has pending translations, prioritize them
      if (entry.isIntersecting) {
        this.checkForPendingTranslations(element);
      }
    }
  }

  // Check for pending translations in newly visible elements
  checkForPendingTranslations(element) {
    const textNodes = [];

    if (!element || (typeof element.nodeType === 'number' && typeof Node !== 'undefined' && element.nodeType !== Node.ELEMENT_NODE)) {
      return;
    }

    let walker;
    try {
      walker = document.createTreeWalker(
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
    } catch (_) {
      return;
    }

    let textNode;
    while (textNode = walker.nextNode()) {
      if (!textNode.parentElement || !textNode.parentElement.hasAttribute || !textNode.parentElement.hasAttribute('data-translated')) {
        textNodes.push(textNode);
      }
    }

    if (textNodes.length > 0) {
      this.onNewContent(textNodes, { priority: 'urgent', visible: true, viewport: true });
      this.stats.urgentProcessed++;
    }
  }

  // Clear batch timer
  clearBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  // Force process any pending batches
  flush() {
    this.clearBatchTimer();
    this.processBatch();
  }

  // Clear all caches
  clearCaches() {
    this.visibilityCache = new WeakMap();
    this.processedNodes = new WeakSet();
  }

  // Get observer statistics
  getStats() {
    return {
      ...this.stats,
      pendingNodes: this.pendingNodes.size,
      isObserving: this.isObserving,
      hasIntersectionObserver: !!this.intersectionObserver,
      batchDelay: this.options.batchDelay,
      maxBatchSize: this.options.maxBatchSize
    };
  }

  // Reconfigure observer options
  configure(newOptions) {
    const wasObserving = this.isObserving;
    const target = document.body;

    if (wasObserving) {
      this.stopObserving();
    }

    this.options = { ...this.options, ...newOptions };

    // Reinitialize observers if configuration changed
    if (newOptions.enableSmartFiltering !== undefined ||
        newOptions.viewportMargin !== undefined ||
        newOptions.intersectionThreshold !== undefined) {
      this.initializeObservers();
    }

    if (wasObserving) {
      this.startObserving(target);
    }
  }

  // Manually trigger scan of existing content
  scanExistingContent(rootElement = document.body) {
    const nodes = new Set();
    this.collectTranslatableNodes(rootElement, nodes);

    if (nodes.size > 0) {
      this.addToBatch(nodes);
    }

    return nodes.size;
  }

  // Clean up resources
  destroy() {
    this.stopObserving();
    this.clearBatchTimer();
    this.pendingNodes.clear();
    this.clearCaches();
  }
}

// Export for different environments
if (typeof window !== 'undefined') {
  window.ContentObserver = ContentObserver;
} else if (typeof self !== 'undefined') {
  self.ContentObserver = ContentObserver;
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContentObserver;
}

} // End of redeclaration protection