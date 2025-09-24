/**
 * @fileoverview High-performance DOM manipulation optimization module
 * Provides batched DOM operations, virtual DOM patterns, and efficient diff algorithms
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenDOMOptimizer = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) 
    ? window.qwenLogger.create('dom-optimizer')
    : (typeof self !== 'undefined' && self.qwenLogger && self.qwenLogger.create)
      ? self.qwenLogger.create('dom-optimizer')
      : console;

  /**
   * Batch DOM operations to minimize layout thrashing
   */
  class DOMBatch {
    constructor() {
      this.operations = [];
      this.fragments = new Map();
      this.scheduled = false;
    }

    /**
     * Schedule a DOM operation for batch execution
     */
    schedule(operation) {
      this.operations.push(operation);
      
      if (!this.scheduled) {
        this.scheduled = true;
        // Use requestAnimationFrame for optimal timing
        requestAnimationFrame(() => this.execute());
      }
    }

    /**
     * Execute all scheduled operations in a single frame with optimized batching
     */
    execute() {
      if (this.operations.length === 0) return;

      const startTime = performance.now();
      
      // Group operations by type first, then by parent for optimal batching
      const textOperations = [];
      const otherOperations = [];
      
      for (let i = 0; i < this.operations.length; i++) {
        const op = this.operations[i];
        if (op.type === 'replaceText') {
          textOperations.push(op);
        } else {
          otherOperations.push(op);
        }
      }
      
      // Process text operations first in one batch for minimal layout impact
      if (textOperations.length > 0) {
        this.executeBatchedTextOperations(textOperations);
      }
      
      // Process other operations by parent
      if (otherOperations.length > 0) {
        const byParent = new Map();
        for (const op of otherOperations) {
          const parent = op.parent || op.element?.parentNode;
          if (parent) {
            if (!byParent.has(parent)) {
              byParent.set(parent, []);
            }
            byParent.get(parent).push(op);
          }
        }

        for (const [parent, ops] of byParent) {
          this.executeParentOperations(parent, ops);
        }
      }

      const duration = performance.now() - startTime;
      if (duration > 16) { // Warn if frame budget exceeded
        logger.warn('DOM batch execution exceeded frame budget:', { duration, operations: this.operations.length });
      }

      // Clear operations and reset state
      this.operations = [];
      this.fragments.clear();
      this.scheduled = false;
    }

    /**
     * Execute text replacement operations in an optimized batch
     */
    executeBatchedTextOperations(textOps) {
      // Direct text assignment is faster than creating new nodes
      for (let i = 0; i < textOps.length; i++) {
        const op = textOps[i];
        if (op.element && op.element.nodeType === Node.TEXT_NODE) {
          op.element.textContent = op.newText;
        }
      }
    }

    /**
     * Execute operations for a specific parent element
     */
    executeParentOperations(parent, operations) {
      const fragment = document.createDocumentFragment();
      let needsFragmentAppend = false;

      for (const op of operations) {
        try {
          switch (op.type) {
            case 'replaceText':
              op.element.textContent = op.newText;
              break;
              
            case 'appendChild':
              if (op.useFragment) {
                // op.element is an array when useFragment is true
                if (Array.isArray(op.element)) {
                  for (const child of op.element) {
                    fragment.appendChild(child);
                  }
                } else {
                  fragment.appendChild(op.element);
                }
                needsFragmentAppend = true;
              } else {
                parent.appendChild(op.element);
              }
              break;
              
            case 'insertBefore':
              parent.insertBefore(op.newElement, op.referenceElement);
              break;
              
            case 'removeChild':
              if (op.element.parentNode === parent) {
                parent.removeChild(op.element);
              }
              break;
              
            case 'replaceChild':
              parent.replaceChild(op.newElement, op.oldElement);
              break;

            case 'setAttribute':
              op.element.setAttribute(op.name, op.value);
              break;

            case 'setStyle':
              op.element.style[op.property] = op.value;
              break;
          }
        } catch (error) {
          logger.error('DOM operation failed:', { operation: op.type, error: error.message });
        }
      }

      // Append fragment if needed
      if (needsFragmentAppend && fragment.childNodes.length > 0) {
        parent.appendChild(fragment);
      }
    }
  }

  /**
   * Virtual DOM node for efficient diffing
   */
  class VirtualNode {
    constructor(tagName, attributes = {}, children = [], textContent = null) {
      this.tagName = tagName;
      this.attributes = attributes;
      this.children = children;
      this.textContent = textContent;
      this.key = attributes.key || null;
    }

    static fromElement(element) {
      if (element.nodeType === Node.TEXT_NODE) {
        return new VirtualNode('#text', {}, [], element.textContent);
      }

      const attributes = {};
      for (const attr of element.attributes || []) {
        attributes[attr.name] = attr.value;
      }

      const children = [];
      for (const child of element.childNodes) {
        children.push(VirtualNode.fromElement(child));
      }

      return new VirtualNode(
        element.tagName?.toLowerCase() || '#element',
        attributes,
        children,
        element.childNodes.length === 0 ? element.textContent : null
      );
    }
  }

  /**
   * Efficient diff algorithm for DOM updates
   */
  class DOMDiffer {
    constructor(batch) {
      this.batch = batch;
    }

    /**
     * Generate minimal set of operations to transform old tree to new tree
     */
    diff(oldNode, newNode, element) {
      const patches = [];

      if (!oldNode && newNode) {
        // Create new node
        patches.push({ type: 'create', newNode, element });
      } else if (oldNode && !newNode) {
        // Remove node
        patches.push({ type: 'remove', element });
      } else if (oldNode && newNode) {
        // Update existing node
        if (oldNode.tagName !== newNode.tagName) {
          patches.push({ type: 'replace', newNode, element });
        } else {
          // Diff attributes
          this.diffAttributes(oldNode.attributes, newNode.attributes, element, patches);
          
          // Diff text content
          if (oldNode.textContent !== newNode.textContent && newNode.children.length === 0) {
            patches.push({ 
              type: 'replaceText', 
              element, 
              newText: newNode.textContent 
            });
          }
          
          // Diff children
          this.diffChildren(oldNode.children, newNode.children, element, patches);
        }
      }

      return patches;
    }

    diffAttributes(oldAttrs, newAttrs, element, patches) {
      // Add/update attributes
      for (const [name, value] of Object.entries(newAttrs)) {
        if (oldAttrs[name] !== value) {
          patches.push({ 
            type: 'setAttribute', 
            element, 
            name, 
            value 
          });
        }
      }

      // Remove attributes
      for (const name of Object.keys(oldAttrs)) {
        if (!(name in newAttrs)) {
          patches.push({ 
            type: 'removeAttribute', 
            element, 
            name 
          });
        }
      }
    }

    diffChildren(oldChildren, newChildren, parentElement, patches) {
      const maxLength = Math.max(oldChildren.length, newChildren.length);
      
      for (let i = 0; i < maxLength; i++) {
        const oldChild = oldChildren[i];
        const newChild = newChildren[i];
        const childElement = parentElement.childNodes[i];

        const childPatches = this.diff(oldChild, newChild, childElement);
        patches.push(...childPatches);
      }
    }
  }

  /**
   * High-performance text node replacement with batching
   */
  class TextNodeOptimizer {
    constructor(batch) {
      this.batch = batch;
      this.textNodeCache = new WeakMap();
    }

    /**
     * Efficiently replace text in a node with minimal DOM manipulation
     */
    replaceText(node, newText, preserveWhitespace = true) {
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        logger.warn('Invalid text node provided for optimization');
        return;
      }

      const currentText = node.textContent || '';
      
      // Skip if text is identical
      if (currentText === newText) {
        return;
      }

      // Preserve leading/trailing whitespace if requested
      if (preserveWhitespace && currentText.trim() !== newText.trim()) {
        const leadingWs = currentText.match(/^\s*/)[0];
        const trailingWs = currentText.match(/\s*$/)[0];
        newText = leadingWs + newText.trim() + trailingWs;
      }

      // Schedule batched update
      this.batch.schedule({
        type: 'replaceText',
        element: node,
        newText: newText,
        parent: node.parentNode
      });
    }

    /**
     * Batch replace multiple text nodes efficiently with optimized DOM operations
     */
    replaceTextBatch(replacements) {
      if (!replacements || replacements.length === 0) return;

      // Pre-validate and batch by parent for optimal DOM performance
      const batchOperations = [];
      const byParent = new Map();
      
      for (let i = 0; i < replacements.length; i++) {
        const { node, newText, preserveWhitespace = true } = replacements[i];
        
        if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentNode) {
          continue;
        }
        
        const currentText = node.textContent || '';
        if (currentText === newText) continue; // Skip identical text
        
        // Prepare final text with whitespace preservation
        let finalText = newText;
        if (preserveWhitespace && currentText.trim() !== newText.trim()) {
          const leadingWs = currentText.match(/^\s*/)[0];
          const trailingWs = currentText.match(/\s*$/)[0];
          finalText = leadingWs + newText.trim() + trailingWs;
        }
        
        const parent = node.parentNode;
        if (!byParent.has(parent)) {
          byParent.set(parent, []);
        }
        
        byParent.get(parent).push({
          type: 'replaceText',
          element: node,
          newText: finalText,
          parent
        });
      }
      
      // Schedule all operations in batches by parent for efficient DOM updates
      for (const [parent, operations] of byParent) {
        for (const operation of operations) {
          this.batch.schedule(operation);
        }
      }
    }
  }

  /**
   * Element creation optimizer with fragment support
   */
  class ElementOptimizer {
    constructor(batch) {
      this.batch = batch;
      this.elementCache = new Map();
    }

    /**
     * Create optimized element with caching
     */
    createElement(tagName, attributes = {}, useCache = false) {
      const cacheKey = useCache ? `${tagName}:${JSON.stringify(attributes)}` : null;
      
      if (cacheKey && this.elementCache.has(cacheKey)) {
        return this.elementCache.get(cacheKey).cloneNode(true);
      }

      const element = document.createElement(tagName);
      
      // Set attributes efficiently
      for (const [name, value] of Object.entries(attributes)) {
        if (name === 'textContent') {
          element.textContent = value;
        } else if (name === 'innerHTML') {
          element.innerHTML = value;
        } else if (name.startsWith('data-')) {
          element.dataset[name.slice(5)] = value;
        } else if (name === 'className') {
          element.className = value;
        } else {
          element.setAttribute(name, value);
        }
      }

      if (cacheKey) {
        this.elementCache.set(cacheKey, element.cloneNode(true));
      }

      return element;
    }

    /**
     * Efficiently append multiple children using DocumentFragment
     */
    appendChildren(parent, children, useFragment = true) {
      if (children.length === 0) return;

      if (useFragment && children.length > 1) {
        this.batch.schedule({
          type: 'appendChild',
          parent,
          element: children,
          useFragment: true
        });
      } else {
        for (const child of children) {
          this.batch.schedule({
            type: 'appendChild',
            parent,
            element: child,
            useFragment: false
          });
        }
      }
    }
  }

  /**
   * Performance monitoring for DOM operations
   */
  class DOMPerformanceMonitor {
    constructor() {
      this.metrics = {
        operationsCount: 0,
        totalTime: 0,
        averageTime: 0,
        slowOperations: []
      };
      this.thresholds = {
        slowOperation: 16, // ms
        verySlowOperation: 50 // ms
      };
    }

    startOperation(operationType) {
      return {
        type: operationType,
        startTime: performance.now()
      };
    }

    endOperation(operation) {
      const duration = performance.now() - operation.startTime;
      
      this.metrics.operationsCount++;
      this.metrics.totalTime += duration;
      this.metrics.averageTime = this.metrics.totalTime / this.metrics.operationsCount;

      if (duration > this.thresholds.slowOperation) {
        this.metrics.slowOperations.push({
          type: operation.type,
          duration,
          timestamp: Date.now()
        });

        // Keep only recent slow operations
        if (this.metrics.slowOperations.length > 100) {
          this.metrics.slowOperations = this.metrics.slowOperations.slice(-50);
        }
      }

      if (duration > this.thresholds.verySlowOperation) {
        logger.warn('Very slow DOM operation detected:', {
          type: operation.type,
          duration: `${duration.toFixed(2)}ms`
        });
      }

      return duration;
    }

    getMetrics() {
      return { ...this.metrics };
    }

    reset() {
      this.metrics = {
        operationsCount: 0,
        totalTime: 0,
        averageTime: 0,
        slowOperations: []
      };
    }
  }

  // Create singleton instances
  const batch = new DOMBatch();
  const textOptimizer = new TextNodeOptimizer(batch);
  const elementOptimizer = new ElementOptimizer(batch);
  const performanceMonitor = new DOMPerformanceMonitor();
  const differ = new DOMDiffer(batch);

  // Load performance monitor if available
  let globalPerformanceMonitor;
  let PERF_CATEGORIES;
  try {
    const perfModule = (typeof self !== 'undefined' && self.qwenPerformanceMonitor) ||
                      (typeof require !== 'undefined' ? require('./performance-monitor') : null);
    globalPerformanceMonitor = perfModule;
    PERF_CATEGORIES = perfModule?.CATEGORIES;
  } catch (e) {
    // Performance monitor not available
  }

  // Public API
  return {
    // Core classes
    DOMBatch,
    VirtualNode,
    DOMDiffer,
    TextNodeOptimizer,
    ElementOptimizer,
    DOMPerformanceMonitor,

    // Singleton instances for immediate use
    batch,
    textOptimizer,
    elementOptimizer,
    performanceMonitor,
    differ,

    // Convenience methods with integrated performance monitoring
    replaceText: (node, newText, preserveWhitespace = true) => {
      const localOp = performanceMonitor.startOperation('replaceText');
      const globalOp = globalPerformanceMonitor?.startOperation(PERF_CATEGORIES?.DOM_OPERATION, 'replaceText', {
        nodeType: node?.nodeType,
        textLength: newText?.length
      });
      
      textOptimizer.replaceText(node, newText, preserveWhitespace);
      
      performanceMonitor.endOperation(localOp);
      globalPerformanceMonitor?.completeOperation(globalOp, { success: true });
    },

    createElement: (tagName, attributes = {}, useCache = false) => {
      const localOp = performanceMonitor.startOperation('createElement');
      const globalOp = globalPerformanceMonitor?.startOperation(PERF_CATEGORIES?.DOM_OPERATION, 'createElement', {
        tagName,
        attributeCount: Object.keys(attributes).length,
        useCache
      });
      
      const element = elementOptimizer.createElement(tagName, attributes, useCache);
      
      performanceMonitor.endOperation(localOp);
      globalPerformanceMonitor?.completeOperation(globalOp, { success: true });
      return element;
    },

    appendChildren: (parent, children, useFragment = true) => {
      const localOp = performanceMonitor.startOperation('appendChildren');
      const globalOp = globalPerformanceMonitor?.startOperation(PERF_CATEGORIES?.DOM_OPERATION, 'appendChildren', {
        childCount: Array.isArray(children) ? children.length : 1,
        useFragment
      });
      
      elementOptimizer.appendChildren(parent, children, useFragment);
      
      performanceMonitor.endOperation(localOp);
      globalPerformanceMonitor?.completeOperation(globalOp, { success: true });
    },

    batchReplace: (replacements) => {
      const localOp = performanceMonitor.startOperation('batchReplace');
      const globalOp = globalPerformanceMonitor?.startOperation(PERF_CATEGORIES?.DOM_OPERATION, 'batchReplace', {
        replacementCount: replacements?.length
      });
      
      textOptimizer.replaceTextBatch(replacements);
      
      performanceMonitor.endOperation(localOp);
      globalPerformanceMonitor?.completeOperation(globalOp, { success: true });
    },

    executeBatch: (sync = false) => {
      const localOp = performanceMonitor.startOperation('executeBatch');
      const globalOp = globalPerformanceMonitor?.startOperation(PERF_CATEGORIES?.DOM_OPERATION, 'executeBatch', {
        operationCount: batch.operations.length,
        synchronous: sync
      });
      
      if (sync) {
        batch.execute();
        performanceMonitor.endOperation(localOp);
        globalPerformanceMonitor?.completeOperation(globalOp, { success: true });
      } else {
        requestAnimationFrame(() => {
          batch.execute();
          performanceMonitor.endOperation(localOp);
          globalPerformanceMonitor?.completeOperation(globalOp, { success: true });
        });
      }
    },

    // Utility functions
    defer: (callback) => {
      requestAnimationFrame(callback);
    },

    measurePerformance: (callback) => {
      const start = performance.now();
      const result = callback();
      const duration = performance.now() - start;
      return { result, duration };
    },

    /**
     * Batch translate text nodes with DOM optimization
     * @param {Array} translationPairs - Array of {element, original, translated} objects
     * @param {Object} options - Translation options
     * @returns {Promise} - Resolves when translation is complete
     */
    batchTranslate: async (translationPairs, options = {}) => {
      const localOp = performanceMonitor.startOperation('batchTranslate');
      const globalOp = globalPerformanceMonitor?.startOperation(PERF_CATEGORIES?.DOM_OPERATION, 'batchTranslate', {
        pairCount: translationPairs?.length,
        batchSize: options?.batchSize || 50
      });
      
      try {
        const {
          batchSize = 50,
          frameTarget = 16,
          preserveWhitespace = true,
          markTranslated = false,
          continueOnError = false
        } = options;

        // Process in chunks to respect frame budget
        const chunks = [];
        for (let i = 0; i < translationPairs.length; i += batchSize) {
          chunks.push(translationPairs.slice(i, i + batchSize));
        }

        for (const chunk of chunks) {
          const frameStart = performance.now();
          
          // Apply translations using batch operations
          const replacements = chunk.map(pair => ({
            node: pair.element.firstChild || pair.element,
            newText: pair.translated,
            preserveWhitespace
          })).filter(r => r.node && r.node.nodeType === Node.TEXT_NODE);

          if (replacements.length > 0) {
            // Use the existing batchReplace method
            textOptimizer.replaceTextBatch(replacements);
          }

          // Mark elements as translated if requested
          if (markTranslated) {
            chunk.forEach(pair => {
              if (pair.element && pair.element.setAttribute) {
                pair.element.setAttribute('data-qwen-translated', 'true');
              }
            });
          }

          // Check frame budget and yield if necessary
          const frameTime = performance.now() - frameStart;
          if (frameTime > frameTarget && chunks.indexOf(chunk) < chunks.length - 1) {
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
        }

        // Execute all batched operations
        batch.execute();
        
        // Complete operations successfully
        performanceMonitor.endOperation(localOp);
        globalPerformanceMonitor?.completeOperation(globalOp, { 
          success: true,
          pairsProcessed: translationPairs.length
        });
      } catch (error) {
        // Complete operations with error
        performanceMonitor.endOperation(localOp);
        globalPerformanceMonitor?.completeOperation(globalOp, { 
          success: false, 
          error: error.message,
          pairsProcessed: translationPairs.length
        });
        
        if (!options.continueOnError) {
          throw error;
        }
        logger.warn('batchTranslate error (continuing):', error.message);
      }
    }
  };

}));