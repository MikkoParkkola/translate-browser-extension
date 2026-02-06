/**
 * Content Observer Module
 * Handles DOM mutation monitoring and dynamic content detection
 */

import { Logger } from '../lib/logger.js';

class ContentObserver {
  constructor(onNewContent, options = {}) {
    this.logger = new Logger({ component: 'ContentObserver' });
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
    this.logger.info('Started observing DOM changes');
  }

  stopObserving() {
    if (!this.isObserving) return;

    this.mutationObserver.disconnect();
    this.clearBatchTimer();
    this.isObserving = false;
    this.logger.info('Stopped observing DOM changes');
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
      this.addToBatch(Array.from(nodesToProcess));
    }
  }

  collectTranslatableNodes(rootNode, collector) {
    if (rootNode.nodeType === Node.TEXT_NODE) {
      if (this.isTranslatableTextNode(rootNode)) {
        collector.add(rootNode);
      }
      return;
    }

    if (rootNode.nodeType === Node.ELEMENT_NODE) {
      if (!this.isTranslatableElement(rootNode)) {
        return;
      }

      const walker = document.createTreeWalker(
        rootNode,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            return this.isTranslatableTextNode(node) ?
              NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        }
      );

      let node;
      while ((node = walker.nextNode())) {
        collector.add(node);
      }
    }
  }

  isTranslatableTextNode(textNode) {
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;

    const text = textNode.textContent?.trim();
    if (!text || text.length < this.options.minTextLength) return false;

    // Skip if already processed
    if (this.processedNodes.has(textNode)) return false;

    const parent = textNode.parentElement;
    if (!parent) return false;

    return this.isTranslatableElement(parent);
  }

  isTranslatableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const tagName = element.tagName.toLowerCase();

    // Skip non-translatable elements
    if (this.options.skipElements.includes(tagName)) return false;

    // Skip elements with no-translate classes
    for (const className of this.options.skipClasses) {
      if (element.classList.contains(className)) return false;
    }

    // Skip elements with no-translate attributes
    for (const attr of this.options.skipAttributes) {
      if (attr.includes('=')) {
        const [attrName, attrValue] = attr.split('=');
        if (element.getAttribute(attrName?.trim()) === attrValue?.replace(/['"]/g, '')) {
          return false;
        }
      } else {
        if (element.hasAttribute(attr)) return false;
      }
    }

    // Skip invisible elements
    if (element.offsetParent === null) return false;

    const computedStyle = getComputedStyle(element);
    if (computedStyle.display === 'none' ||
        computedStyle.visibility === 'hidden' ||
        computedStyle.opacity === '0') {
      return false;
    }

    return true;
  }

  addToBatch(nodes) {
    for (const node of nodes) {
      this.pendingNodes.add(node);
    }

    if (this.pendingNodes.size >= this.options.maxBatchSize) {
      this.processBatch();
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.processBatch();
      }, this.options.batchDelay);
    }
  }

  processBatch() {
    if (this.pendingNodes.size === 0) return;

    const nodesToProcess = Array.from(this.pendingNodes);
    this.pendingNodes.clear();
    this.clearBatchTimer();

    // Mark nodes as processed
    for (const node of nodesToProcess) {
      this.processedNodes.add(node);
    }

    // Notify callback with valid nodes only
    const validNodes = nodesToProcess.filter(node =>
      node.parentElement && this.isTranslatableTextNode(node)
    );

    if (validNodes.length > 0 && this.onNewContent) {
      try {
        this.onNewContent(validNodes, {
          source: 'mutation',
          timestamp: Date.now(),
          batchSize: validNodes.length
        });
      } catch (error) {
        this.logger.error('Error in batch processing callback:', error);
      }
    }
  }

  clearBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  flush() {
    if (this.pendingNodes.size > 0) {
      this.processBatch();
    }
  }

  disconnect() {
    this.stopObserving();
    this.clearBatchTimer();
    this.pendingNodes.clear();
  }
}

export { ContentObserver };