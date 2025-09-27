// Content Observer - Dynamic content detection and smart filtering
// Monitors DOM changes and identifies new translatable content efficiently

var ContentObserver = (typeof self !== 'undefined' && typeof self.qwenContentObserver === 'function') ? self.qwenContentObserver : null;
if (!ContentObserver) {
class ContentObserverDef {
  constructor(onNewContent, options = {}) {
    this.onNewContent = onNewContent;
    this.options = {
      enableSmartFiltering: true,
      batchDelay: 500,
      maxBatchSize: 50,
      minTextLength: 3,
      skipElements: ['script', 'style', 'noscript', 'template', 'svg'],
      skipClasses: ['no-translate', 'notranslate'],
      skipAttributes: ['data-no-translate', 'translate="no"'],
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
      batchesProcessed: 0
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
    if (this.options.enableSmartFiltering && 'IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => this.handleIntersection(entries),
        {
          root: null,
          rootMargin: '50px',
          threshold: 0.1
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
  }

  // Stop observing
  stopObserving() {
    if (!this.isObserving) return;

    this.mutationObserver.disconnect();
    this.intersectionObserver?.disconnect();
    this.clearBatchTimer();

    this.isObserving = false;
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

    // Check for direct text content
    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && this.isTranslatableTextNode(child)) {
        collector.add(child);
        this.stats.nodesAdded++;
      }
    }

    // Recursively process child elements
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

    const parentElement = textNode.parentElement;
    if (!parentElement) return false;

    return this.isTranslatableElement(parentElement);
  }

  // Check if element should be translated
  isTranslatableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const tagName = element.tagName.toLowerCase();

    // Skip certain elements
    if (this.options.skipElements.includes(tagName)) return false;

    // Skip elements with no-translate attributes
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

    // Skip elements with no-translate classes
    for (const className of this.options.skipClasses) {
      if (element.classList.contains(className)) return false;
    }

    // Skip hidden elements
    if (this.isElementHidden(element)) return false;

    // Skip contenteditable elements that are being edited
    if (element.contentEditable === 'true' && element === document.activeElement) {
      return false;
    }

    // Skip form inputs
    if (['input', 'textarea', 'select', 'button'].includes(tagName)) {
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

    // Cache result
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
    const validNodes = nodes.filter(node => document.contains(node));

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
        } else {
          hiddenNodes.push(node);
        }
      }

      // Process visible nodes with higher priority
      if (visibleNodes.length > 0) {
        this.onNewContent(visibleNodes, { priority: 'high', visible: true });
      }

      if (hiddenNodes.length > 0) {
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
    const rect = node.parentElement.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    return (
      rect.top < windowHeight &&
      rect.bottom > 0 &&
      rect.left < windowWidth &&
      rect.right > 0
    );
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
      // Check if this node needs translation
      if (!textNode.parentElement.hasAttribute('data-translated')) {
        textNodes.push(textNode);
      }
    }

    if (textNodes.length > 0) {
      this.onNewContent(textNodes, { priority: 'urgent', visible: true, viewport: true });
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
      cacheSize: this.visibilityCache.size || 'unknown'
    };
  }

  // Reconfigure observer options
  configure(newOptions) {
    this.options = { ...this.options, ...newOptions };

    // Restart observer with new options if currently observing
    if (this.isObserving) {
      const target = document.body;
      this.stopObserving();
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
ContentObserver = ContentObserverDef;

if (typeof self !== 'undefined') {
  self.qwenContentObserver = ContentObserver;
  if (typeof self.ContentObserver === 'undefined') {
    self.ContentObserver = ContentObserver;
  }
}
}

// Export for use in content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContentObserver;
} else if (typeof self !== 'undefined') {
  self.qwenContentObserver = ContentObserver;
  if (typeof self.ContentObserver === 'undefined') {
    self.ContentObserver = ContentObserver;
  }
}
