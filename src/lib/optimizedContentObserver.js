/**
 * Optimized Content Observer for Translation Extension
 * High-performance DOM scanning with reduced computational overhead
 */

import { logger } from './logger.js';
import { startTimer, endTimer, trackDOMScan } from './performanceTracker.js';

class OptimizedContentObserver {
  constructor(onNewContent, options = {}) {
    this.onNewContent = onNewContent;
    this.options = {
      enableSmartFiltering: true,
      batchDelay: 300, // Reduced from 500ms for better responsiveness
      maxBatchSize: 30, // Reduced from 50 to prevent UI blocking
      minTextLength: 3,
      skipElements: new Set(['script', 'style', 'noscript', 'template', 'svg', 'code', 'pre', 'meta', 'link']),
      skipClasses: new Set(['no-translate', 'notranslate', 'qwen-translated', 'qwen-translating']),
      skipAttributes: new Set(['data-no-translate', 'data-translated']),
      viewportMargin: '50px',
      intersectionThreshold: 0.1,
      maxProcessingTime: 16, // Max 16ms per batch to maintain 60fps
      ...options
    };

    this.mutationObserver = null;
    this.intersectionObserver = null;
    this.batchTimer = null;
    this.pendingNodes = new Set();
    this.processedNodes = new WeakSet();
    this.visibleElements = new WeakSet();
    this.isObserving = false;
    this.performanceMetrics = {
      batchesProcessed: 0,
      nodesProcessed: 0,
      averageProcessingTime: 0
    };

    // Cache DOM query results
    this.elementCache = new WeakMap();

    // Pre-compile regex patterns for better performance
    this.textValidationRegex = /\p{L}/u;
    this.skipAttributePatterns = this.compileSkipPatterns();

    this.initializeObservers();
  }

  compileSkipPatterns() {
    const patterns = [];
    for (const attr of this.options.skipAttributes) {
      if (attr.includes('=')) {
        const [name, value] = attr.split('=');
        patterns.push({
          type: 'value',
          name: name.trim(),
          value: value.replace(/"/g, '').trim()
        });
      } else {
        patterns.push({
          type: 'exists',
          name: attr
        });
      }
    }
    return patterns;
  }

  initializeObservers() {
    // Mutation Observer with optimized configuration
    this.mutationObserver = new MutationObserver((mutations) => {
      this.handleMutationsOptimized(mutations);
    });

    // Intersection Observer for viewport-based filtering
    if (this.options.enableSmartFiltering && 'IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => this.handleIntersection(entries),
        {
          rootMargin: this.options.viewportMargin,
          threshold: this.options.intersectionThreshold
        }
      );
    }
  }

  startObserving(target = document.body) {
    if (this.isObserving) return;

    this.mutationObserver.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: false // Disabled for better performance
    });

    this.isObserving = true;
    logger.debug('OptimizedContentObserver', 'Started observing DOM changes');
  }

  stopObserving() {
    if (!this.isObserving) return;

    this.mutationObserver.disconnect();
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }
    this.clearBatchTimer();
    this.isObserving = false;

    logger.debug('OptimizedContentObserver', 'Stopped observing DOM changes', this.performanceMetrics);
  }

  handleMutationsOptimized(mutations) {
    const startTime = performance.now();
    const nodesToProcess = new Set();
    let processedMutations = 0;

    for (const mutation of mutations) {
      // Time-box mutation processing to prevent UI blocking
      if (performance.now() - startTime > this.options.maxProcessingTime) {
        logger.debug('OptimizedContentObserver', 'Time-boxing mutations, deferring remaining');
        break;
      }

      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) {
            this.collectTranslatableNodesOptimized(node, nodesToProcess);
          }
        }
      } else if (mutation.type === 'characterData') {
        const textNode = mutation.target;
        if (this.isTranslatableTextNodeOptimized(textNode)) {
          nodesToProcess.add(textNode);
        }
      }

      processedMutations++;
    }

    if (nodesToProcess.size > 0) {
      this.addToBatch(nodesToProcess);
    }

    logger.debug('OptimizedContentObserver',
      `Processed ${processedMutations}/${mutations.length} mutations, found ${nodesToProcess.size} translatable nodes`);
  }

  collectTranslatableNodesOptimized(rootNode, collector) {
    const timerId = startTimer('nodeCollection', { rootNodeType: rootNode.nodeType });

    if (rootNode.nodeType === Node.TEXT_NODE) {
      if (this.isTranslatableTextNodeOptimized(rootNode)) {
        collector.add(rootNode);
      }
      endTimer(timerId);
      return;
    }

    if (rootNode.nodeType !== Node.ELEMENT_NODE) {
      endTimer(timerId);
      return;
    }

    const element = rootNode;

    // Quick duplicate check
    if (this.processedNodes.has(element)) {
      endTimer(timerId);
      return;
    }

    // Fast element validation with caching
    if (!this.isTranslatableElementOptimized(element)) {
      endTimer(timerId);
      return;
    }

    this.processedNodes.add(element);

    // Use optimized tree walker with early termination
    this.walkTextNodesOptimized(element, collector);
    endTimer(timerId, { processed: true });
  }

  walkTextNodesOptimized(element, collector) {
    const startTime = performance.now();
    const maxWalkTime = 8; // Max 8ms for tree walking

    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Time-box tree walking
          if (performance.now() - startTime > maxWalkTime) {
            return NodeFilter.FILTER_REJECT;
          }

          return this.isTranslatableTextNodeOptimized(node)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let textNode;
    let nodeCount = 0;
    const maxNodes = 50; // Limit nodes processed per element

    while ((textNode = walker.nextNode()) && nodeCount < maxNodes) {
      collector.add(textNode);
      nodeCount++;
    }

    if (nodeCount >= maxNodes) {
      logger.debug('OptimizedContentObserver', 'Hit node limit during tree walking, may have more nodes');
    }
  }

  isTranslatableTextNodeOptimized(textNode) {
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return false;

    const text = textNode.textContent;
    if (!text || text.length < this.options.minTextLength) return false;

    // Fast text validation - avoid trim() for performance
    if (!this.textValidationRegex.test(text)) return false;

    const parentElement = textNode.parentElement;
    if (!parentElement) return false;

    return this.isTranslatableElementOptimized(parentElement);
  }

  isTranslatableElementOptimized(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    // Check cache first
    const cached = this.elementCache.get(element);
    if (cached !== undefined) return cached;

    let isTranslatable = true;

    // Fast tag name check
    const tagName = element.tagName;
    if (this.options.skipElements.has(tagName.toLowerCase())) {
      isTranslatable = false;
    } else {
      // Fast class check - avoid classList.contains() in loop
      if (element.className && typeof element.className === 'string') {
        const classes = element.className.split(' ');
        for (const cls of classes) {
          if (this.options.skipClasses.has(cls)) {
            isTranslatable = false;
            break;
          }
        }
      }

      // Fast attribute check with pre-compiled patterns
      if (isTranslatable) {
        for (const pattern of this.skipAttributePatterns) {
          if (pattern.type === 'exists') {
            if (element.hasAttribute(pattern.name)) {
              isTranslatable = false;
              break;
            }
          } else if (pattern.type === 'value') {
            if (element.getAttribute(pattern.name) === pattern.value) {
              isTranslatable = false;
              break;
            }
          }
        }
      }

      // Defer expensive visibility check if viewport filtering is enabled
      if (isTranslatable && this.intersectionObserver && !this.visibleElements.has(element)) {
        this.intersectionObserver.observe(element);
        // Assume visible until intersection observer reports otherwise
        this.visibleElements.add(element);
      }
    }

    // Cache the result
    this.elementCache.set(element, isTranslatable);
    return isTranslatable;
  }

  handleIntersection(entries) {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        this.visibleElements.add(entry.target);
      } else {
        this.visibleElements.delete(entry.target);
        // Invalidate cache for non-visible elements
        this.elementCache.delete(entry.target);
      }
    }
  }

  addToBatch(nodes) {
    for (const node of nodes) {
      this.pendingNodes.add(node);
    }

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

  processBatch() {
    if (this.pendingNodes.size === 0) return;

    const timerId = startTimer('domScan', { batch: true });
    const nodes = Array.from(this.pendingNodes);
    this.pendingNodes.clear();

    try {
      this.onNewContent(nodes);
    } catch (error) {
      logger.error('OptimizedContentObserver', 'Error processing batch:', error);
    }

    const processingTime = endTimer(timerId, {
      nodesProcessed: nodes.length,
      viewport: true
    });

    // Track DOM scan performance
    if (processingTime !== null) {
      trackDOMScan(nodes.length, processingTime, true);
      this.updatePerformanceMetrics(nodes.length, processingTime);
    }

    logger.debug('OptimizedContentObserver',
      `Processed batch of ${nodes.length} nodes in ${processingTime?.toFixed(2)}ms`);
  }

  updatePerformanceMetrics(nodeCount, processingTime) {
    this.performanceMetrics.batchesProcessed++;
    this.performanceMetrics.nodesProcessed += nodeCount;

    const totalTime = this.performanceMetrics.averageProcessingTime *
                     (this.performanceMetrics.batchesProcessed - 1) + processingTime;
    this.performanceMetrics.averageProcessingTime =
      totalTime / this.performanceMetrics.batchesProcessed;
  }

  clearBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  cleanup() {
    this.stopObserving();
    this.pendingNodes.clear();
    this.elementCache = new WeakMap();
    this.visibleElements = new WeakSet();
    this.processedNodes = new WeakSet();
  }

  getPerformanceMetrics() {
    return { ...this.performanceMetrics };
  }
}

export { OptimizedContentObserver };

// For CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OptimizedContentObserver };
}