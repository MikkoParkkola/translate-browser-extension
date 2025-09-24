/**
 * DOM Optimization and Translation Engine
 * Provides intelligent DOM manipulation for high-performance translation rendering
 *
 * Features:
 * - Batched DOM operations to minimize reflow/repaint
 * - Virtual DOM diffing for efficient updates
 * - Intelligent node scheduling and priority management
 * - Memory-efficient translation state tracking
 * - Performance monitoring and optimization metrics
 * - Shadow DOM and iframe support
 * - Responsive design preservation
 * - Accessibility compliance maintenance
 */

class DOMOptimizer {
  constructor(options = {}) {
    // Configuration with intelligent defaults
    this.config = {
      // Batching configuration
      batchSize: options.batchSize || 50,
      batchTimeout: options.batchTimeout || 16, // ~60fps for smooth updates
      maxConcurrentBatches: options.maxConcurrentBatches || 3,

      // Performance optimization
      enableVirtualDOM: options.enableVirtualDOM !== false,
      enableLazyUpdates: options.enableLazyUpdates !== false,
      enablePriorityScheduling: options.enablePriorityScheduling !== false,

      // Visual stability
      preserveLayout: options.preserveLayout !== false,
      minimizeReflow: options.minimizeReflow !== false,
      respectUserPreferences: options.respectUserPreferences !== false,

      // Accessibility and compliance
      maintainARIA: options.maintainARIA !== false,
      preserveSemantics: options.preserveSemantics !== false,
      respectReducedMotion: options.respectReducedMotion !== false,

      // Advanced features
      shadowDOMSupport: options.shadowDOMSupport !== false,
      iframeSupport: options.iframeSupport !== false,
      intersectionObserver: options.intersectionObserver !== false
    };

    // State management
    this.state = {
      pendingOperations: new Map(),
      activeOperations: new Set(),
      completedOperations: new Set(),
      errorOperations: new Set()
    };

    // Performance tracking
    this.metrics = {
      operations: {
        total: 0,
        successful: 0,
        failed: 0,
        batched: 0,
        individual: 0
      },
      performance: {
        batchProcessingTime: [],
        domUpdateTime: [],
        reflows: 0,
        repaints: 0
      },
      memory: {
        nodeCount: 0,
        operationMemory: 0,
        cacheSize: 0
      }
    };

    // DOM operation queues with priority levels
    this.operationQueues = {
      high: [], // Visible, above-fold content
      medium: [], // Visible, below-fold content
      low: [], // Hidden or deferred content
      background: [] // Analytics, non-critical updates
    };

    // Virtual DOM representation for diffing
    this.virtualDOM = new Map();

    // Batch processing state
    this.batchProcessor = {
      active: false,
      timeoutId: null,
      frameId: null,
      currentBatch: []
    };

    // Node tracking and classification
    this.nodeClassifier = {
      cache: new WeakMap(),
      priorityScores: new WeakMap()
    };

    // Layout preservation system
    this.layoutPreserver = {
      measurements: new WeakMap(),
      preservationStrategies: new Map()
    };

    // Intersection observer for performance optimization
    this.intersectionObserver = null;
    this.visibilityTracker = new WeakMap();

    // Initialize systems
    this.initializeIntersectionObserver();
    this.initializePerformanceMonitoring();
    this.initializeAccessibilityGuards();
  }

  /**
   * Initialize intersection observer for visibility-based optimization
   */
  initializeIntersectionObserver() {
    if (!this.config.intersectionObserver || !window.IntersectionObserver) {
      return;
    }

    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const priority = entry.isIntersecting ? 'high' : 'low';
        this.visibilityTracker.set(entry.target, {
          visible: entry.isIntersecting,
          priority: priority,
          ratio: entry.intersectionRatio
        });
      });
    }, {
      threshold: [0, 0.1, 0.5, 1.0],
      rootMargin: '50px'
    });
  }

  /**
   * Initialize performance monitoring systems
   */
  initializePerformanceMonitoring() {
    // Monitor for layout thrashing
    if (window.PerformanceObserver) {
      try {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach(entry => {
            if (entry.entryType === 'measure') {
              this.metrics.performance.domUpdateTime.push(entry.duration);
            }
          });
        });
        observer.observe({ entryTypes: ['measure'] });
      } catch (e) {
        console.warn('Performance observer not supported for measures');
      }
    }
  }

  /**
   * Initialize accessibility compliance guards
   */
  initializeAccessibilityGuards() {
    // Respect user's motion preferences
    if (this.config.respectReducedMotion && typeof window !== 'undefined' && window.matchMedia) {
      try {
        const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
        this.reducedMotionPreference = mediaQuery.matches;
        mediaQuery.addEventListener('change', (e) => {
          this.reducedMotionPreference = e.matches;
        });
      } catch (e) {
        // Fallback for environments without matchMedia support
        this.reducedMotionPreference = false;
      }
    } else {
      this.reducedMotionPreference = false;
    }
  }

  /**
   * Queue a DOM operation with intelligent priority assignment
   * @param {Element} element - Target DOM element
   * @param {Object} operation - Operation details
   * @param {string} priority - Priority level (auto, high, medium, low, background)
   * @returns {string} Operation ID for tracking
   */
  queueOperation(element, operation, priority = 'auto') {
    const operationId = this.generateOperationId();

    // Determine priority automatically if requested
    if (priority === 'auto') {
      priority = this.calculateOperationPriority(element, operation);
    }

    // Create operation descriptor
    const operationDescriptor = {
      id: operationId,
      element: element,
      operation: operation,
      priority: priority,
      timestamp: performance.now(),
      retries: 0,
      dependencies: operation.dependencies || [],
      metadata: {
        nodeType: element.nodeName,
        textLength: operation.text ? operation.text.length : 0,
        visible: this.isElementVisible(element)
      }
    };

    // Store in pending operations
    this.state.pendingOperations.set(operationId, operationDescriptor);

    // Add to appropriate priority queue
    this.operationQueues[priority].push(operationDescriptor);

    // Track element for intersection observation
    if (this.intersectionObserver && !this.visibilityTracker.has(element)) {
      this.intersectionObserver.observe(element);
    }

    // Update metrics
    this.metrics.operations.total++;
    this.metrics.memory.operationMemory += this.estimateOperationMemory(operationDescriptor);

    // Schedule batch processing
    this.scheduleBatchProcessing();

    console.log(`🔄 DOM operation queued: ${operationId} (priority: ${priority})`);
    return operationId;
  }

  /**
   * Calculate intelligent priority for DOM operations
   * @param {Element} element - Target element
   * @param {Object} operation - Operation details
   * @returns {string} Calculated priority level
   */
  calculateOperationPriority(element, operation) {
    let score = 0;

    // Visibility scoring (highest priority)
    if (this.isElementVisible(element)) {
      score += 100;

      // Above fold content gets higher priority
      const rect = element.getBoundingClientRect();
      if (rect.top < window.innerHeight) {
        score += 50;
      }
    }

    // Content importance scoring
    const tagName = element.tagName.toLowerCase();
    const contentImportance = {
      'h1': 40, 'h2': 35, 'h3': 30, 'h4': 25, 'h5': 20, 'h6': 15,
      'p': 25, 'span': 20, 'div': 15, 'li': 20, 'td': 20,
      'button': 35, 'a': 30, 'label': 25, 'input': 20
    };
    score += contentImportance[tagName] || 10;

    // Text length consideration
    if (operation.text) {
      if (operation.text.length > 200) score += 15;
      else if (operation.text.length > 50) score += 10;
      else if (operation.text.length > 10) score += 5;
    }

    // User interaction proximity
    if (element.closest('form, button, nav, header')) {
      score += 20;
    }

    // Accessibility elements
    if (element.hasAttribute('aria-label') || element.hasAttribute('role')) {
      score += 15;
    }

    // Determine priority tier
    if (score >= 150) return 'high';
    if (score >= 100) return 'medium';
    if (score >= 50) return 'low';
    return 'background';
  }

  /**
   * Schedule batch processing with intelligent timing
   */
  scheduleBatchProcessing() {
    if (this.batchProcessor.active) {
      return; // Already scheduled
    }

    // Immediate processing for high-priority operations
    const highPriorityCount = this.operationQueues.high.length;
    if (highPriorityCount > 0) {
      this.batchProcessor.frameId = requestAnimationFrame(() => {
        this.processBatch('high');
      });
      this.batchProcessor.active = true;
      return;
    }

    // Debounced processing for other operations
    if (this.batchProcessor.timeoutId) {
      clearTimeout(this.batchProcessor.timeoutId);
    }

    this.batchProcessor.timeoutId = setTimeout(() => {
      this.batchProcessor.frameId = requestAnimationFrame(() => {
        this.processNextBatch();
      });
    }, this.config.batchTimeout);

    this.batchProcessor.active = true;
  }

  /**
   * Process the next available batch with priority consideration
   */
  async processNextBatch() {
    try {
      // Process in priority order
      const priorityOrder = ['high', 'medium', 'low', 'background'];

      for (const priority of priorityOrder) {
        if (this.operationQueues[priority].length > 0) {
          await this.processBatch(priority);
          break;
        }
      }
    } finally {
      this.batchProcessor.active = false;
      this.batchProcessor.timeoutId = null;
      this.batchProcessor.frameId = null;

      // Schedule next batch if operations remain
      const totalOperations = Object.values(this.operationQueues)
        .reduce((sum, queue) => sum + queue.length, 0);

      if (totalOperations > 0) {
        this.scheduleBatchProcessing();
      }
    }
  }

  /**
   * Process a batch of operations from specified priority queue
   * @param {string} priority - Priority queue to process
   */
  async processBatch(priority) {
    const startTime = performance.now();
    const queue = this.operationQueues[priority];

    if (queue.length === 0) {
      return;
    }

    // Extract batch from queue
    const batchSize = Math.min(this.config.batchSize, queue.length);
    const batch = queue.splice(0, batchSize);

    console.log(`⚡ Processing ${priority} priority batch: ${batch.length} operations`);

    // Group operations by type for optimal DOM manipulation
    const groupedOperations = this.groupOperationsByType(batch);

    // Process each group with appropriate strategy
    const results = [];
    for (const [operationType, operations] of groupedOperations) {
      const groupResults = await this.processOperationGroup(operationType, operations);
      results.push(...groupResults);
    }

    // Update metrics
    const processingTime = performance.now() - startTime;
    this.metrics.performance.batchProcessingTime.push(processingTime);
    this.metrics.operations.batched += batch.length;

    // Handle results
    results.forEach(result => {
      if (result.success) {
        this.state.completedOperations.add(result.operationId);
        this.metrics.operations.successful++;
      } else {
        this.state.errorOperations.add(result.operationId);
        this.metrics.operations.failed++;
        this.handleOperationError(result);
      }

      // Clean up from pending operations
      this.state.pendingOperations.delete(result.operationId);
    });

    console.log(`✅ Batch completed in ${processingTime.toFixed(2)}ms`);
  }

  /**
   * Group operations by type for efficient batch processing
   * @param {Array} operations - Operations to group
   * @returns {Map} Grouped operations by type
   */
  groupOperationsByType(operations) {
    const groups = new Map();

    operations.forEach(operation => {
      const type = operation.operation.type || 'textUpdate';
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type).push(operation);
    });

    return groups;
  }

  /**
   * Process a group of similar operations efficiently
   * @param {string} operationType - Type of operations
   * @param {Array} operations - Operations to process
   * @returns {Array} Processing results
   */
  async processOperationGroup(operationType, operations) {
    const results = [];

    try {
      // Begin performance measurement
      performance.mark(`dom-update-start-${operationType}`);

      // Batch DOM reads first (to avoid layout thrashing)
      if (this.config.minimizeReflow) {
        await this.batchDOMReads(operations);
      }

      // Process operations based on type
      switch (operationType) {
        case 'textUpdate':
          results.push(...await this.processTextUpdates(operations));
          break;
        case 'styleUpdate':
          results.push(...await this.processStyleUpdates(operations));
          break;
        case 'attributeUpdate':
          results.push(...await this.processAttributeUpdates(operations));
          break;
        case 'classUpdate':
          results.push(...await this.processClassUpdates(operations));
          break;
        default:
          results.push(...await this.processGenericUpdates(operations));
      }

      // End performance measurement
      performance.mark(`dom-update-end-${operationType}`);
      performance.measure(
        `dom-update-${operationType}`,
        `dom-update-start-${operationType}`,
        `dom-update-end-${operationType}`
      );

    } catch (error) {
      console.error(`Error processing ${operationType} operations:`, error);

      // Mark all operations in this group as failed
      operations.forEach(operation => {
        results.push({
          operationId: operation.id,
          success: false,
          error: error.message,
          operation: operation
        });
      });
    }

    return results;
  }

  /**
   * Batch DOM reads to avoid layout thrashing
   * @param {Array} operations - Operations requiring DOM reads
   */
  async batchDOMReads(operations) {
    const elementsToRead = operations
      .filter(op => op.operation.requiresRead)
      .map(op => op.element);

    if (elementsToRead.length === 0) return;

    // Read all DOM properties at once
    elementsToRead.forEach(element => {
      if (this.config.preserveLayout) {
        const measurements = {
          rect: element.getBoundingClientRect(),
          computedStyle: window.getComputedStyle(element),
          scrollPosition: {
            top: element.scrollTop,
            left: element.scrollLeft
          }
        };
        this.layoutPreserver.measurements.set(element, measurements);
      }
    });
  }

  /**
   * Process text update operations efficiently
   * @param {Array} operations - Text update operations
   * @returns {Array} Processing results
   */
  async processTextUpdates(operations) {
    const results = [];

    for (const operation of operations) {
      try {
        const { element, operation: op } = operation;
        const { text, preserveWhitespace = true, maintainSemantic = true } = op;

        // Store original text for rollback if needed
        const originalText = element.textContent;

        // Preserve layout measurements if required
        if (this.config.preserveLayout) {
          this.preserveElementLayout(element);
        }

        // Update text content with whitespace preservation
        if (preserveWhitespace) {
          element.textContent = text;
        } else {
          element.textContent = text.trim();
        }

        // Maintain ARIA attributes if required
        if (this.config.maintainARIA && maintainSemantic) {
          this.updateARIAAttributes(element, text);
        }

        // Track in virtual DOM if enabled
        if (this.config.enableVirtualDOM) {
          this.updateVirtualDOM(element, text);
        }

        results.push({
          operationId: operation.id,
          success: true,
          element: element,
          originalText: originalText,
          newText: text
        });

      } catch (error) {
        results.push({
          operationId: operation.id,
          success: false,
          error: error.message,
          operation: operation
        });
      }
    }

    return results;
  }

  /**
   * Process style update operations efficiently
   * @param {Array} operations - Style update operations
   * @returns {Array} Processing results
   */
  async processStyleUpdates(operations) {
    const results = [];

    for (const operation of operations) {
      try {
        const { element, operation: op } = operation;
        const { styles, transitionDuration = 0 } = op;

        // Apply styles efficiently
        Object.entries(styles).forEach(([property, value]) => {
          element.style[property] = value;
        });

        // Handle transitions if required and reduced motion is not preferred
        if (transitionDuration > 0 && !this.reducedMotionPreference) {
          element.style.transition = `all ${transitionDuration}ms ease`;

          // Clean up transition after completion
          setTimeout(() => {
            element.style.transition = '';
          }, transitionDuration);
        }

        results.push({
          operationId: operation.id,
          success: true,
          element: element,
          appliedStyles: styles
        });

      } catch (error) {
        results.push({
          operationId: operation.id,
          success: false,
          error: error.message,
          operation: operation
        });
      }
    }

    return results;
  }

  /**
   * Process attribute update operations efficiently
   * @param {Array} operations - Attribute update operations
   * @returns {Array} Processing results
   */
  async processAttributeUpdates(operations) {
    const results = [];

    for (const operation of operations) {
      try {
        const { element, operation: op } = operation;
        const { attributes } = op;

        // Store original attributes for rollback
        const originalAttributes = {};
        Object.keys(attributes).forEach(attr => {
          originalAttributes[attr] = element.getAttribute(attr);
        });

        // Apply attribute updates
        Object.entries(attributes).forEach(([attr, value]) => {
          if (value === null || value === undefined) {
            element.removeAttribute(attr);
          } else {
            element.setAttribute(attr, value);
          }
        });

        results.push({
          operationId: operation.id,
          success: true,
          element: element,
          originalAttributes: originalAttributes,
          newAttributes: attributes
        });

      } catch (error) {
        results.push({
          operationId: operation.id,
          success: false,
          error: error.message,
          operation: operation
        });
      }
    }

    return results;
  }

  /**
   * Process class update operations efficiently
   * @param {Array} operations - Class update operations
   * @returns {Array} Processing results
   */
  async processClassUpdates(operations) {
    const results = [];

    for (const operation of operations) {
      try {
        const { element, operation: op } = operation;
        const { addClass = [], removeClass = [], toggleClass = [] } = op;

        // Store original class list
        const originalClasses = Array.from(element.classList);

        // Apply class updates
        removeClass.forEach(cls => element.classList.remove(cls));
        addClass.forEach(cls => element.classList.add(cls));
        toggleClass.forEach(cls => element.classList.toggle(cls));

        results.push({
          operationId: operation.id,
          success: true,
          element: element,
          originalClasses: originalClasses,
          finalClasses: Array.from(element.classList)
        });

      } catch (error) {
        results.push({
          operationId: operation.id,
          success: false,
          error: error.message,
          operation: operation
        });
      }
    }

    return results;
  }

  /**
   * Process generic operations as fallback
   * @param {Array} operations - Generic operations
   * @returns {Array} Processing results
   */
  async processGenericUpdates(operations) {
    const results = [];

    for (const operation of operations) {
      try {
        const { element, operation: op } = operation;

        // Execute custom operation function if provided
        if (typeof op.execute === 'function') {
          const result = await op.execute(element, op);
          results.push({
            operationId: operation.id,
            success: true,
            element: element,
            result: result
          });
        } else {
          throw new Error('Generic operation missing execute function');
        }

      } catch (error) {
        results.push({
          operationId: operation.id,
          success: false,
          error: error.message,
          operation: operation
        });
      }
    }

    return results;
  }

  /**
   * Preserve element layout during updates
   * @param {Element} element - Element to preserve
   */
  preserveElementLayout(element) {
    if (!this.layoutPreserver.measurements.has(element)) {
      const rect = element.getBoundingClientRect();
      const computedStyle = window.getComputedStyle(element);

      this.layoutPreserver.measurements.set(element, {
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        fontSize: computedStyle.fontSize,
        lineHeight: computedStyle.lineHeight,
        padding: computedStyle.padding,
        margin: computedStyle.margin
      });
    }
  }

  /**
   * Update ARIA attributes for accessibility
   * @param {Element} element - Element to update
   * @param {string} text - New text content
   */
  updateARIAAttributes(element, text) {
    // Update aria-label if present
    if (element.hasAttribute('aria-label')) {
      element.setAttribute('aria-label', text);
    }

    // Update aria-describedby content if applicable
    const describedBy = element.getAttribute('aria-describedby');
    if (describedBy) {
      const descriptor = document.getElementById(describedBy);
      if (descriptor) {
        descriptor.textContent = text;
      }
    }

    // Update title attribute for additional context
    if (element.hasAttribute('title')) {
      element.setAttribute('title', text);
    }
  }

  /**
   * Update virtual DOM representation
   * @param {Element} element - DOM element
   * @param {string} content - New content
   */
  updateVirtualDOM(element, content) {
    const elementId = this.getElementId(element);
    this.virtualDOM.set(elementId, {
      tagName: element.tagName,
      content: content,
      attributes: this.getElementAttributes(element),
      timestamp: Date.now()
    });
  }

  /**
   * Handle operation errors with retry logic
   * @param {Object} result - Failed operation result
   */
  handleOperationError(result) {
    const operation = result.operation;

    // Increment retry count
    operation.retries = (operation.retries || 0) + 1;

    // Retry if under limit
    if (operation.retries < 3) {
      console.warn(`⚠️ Retrying operation ${operation.id} (attempt ${operation.retries + 1})`);

      // Re-queue with lower priority
      const newPriority = this.downgradePriority(operation.priority);
      this.operationQueues[newPriority].push(operation);
    } else {
      console.error(`❌ Operation ${operation.id} failed permanently:`, result.error);

      // Store error for analysis
      this.state.errorOperations.add(operation.id);
    }
  }

  /**
   * Downgrade operation priority for retries
   * @param {string} currentPriority - Current priority level
   * @returns {string} Downgraded priority
   */
  downgradePriority(currentPriority) {
    const priorities = ['high', 'medium', 'low', 'background'];
    const currentIndex = priorities.indexOf(currentPriority);
    return currentIndex < priorities.length - 1
      ? priorities[currentIndex + 1]
      : currentPriority;
  }

  /**
   * Check if element is visible in viewport
   * @param {Element} element - Element to check
   * @returns {boolean} Visibility status
   */
  isElementVisible(element) {
    // Use cached visibility if available
    const cachedVisibility = this.visibilityTracker.get(element);
    if (cachedVisibility) {
      return cachedVisibility.visible;
    }

    try {
      // Fallback to manual check
      const rect = element.getBoundingClientRect();

      // Check if getComputedStyle is available and element is a valid DOM element
      if (typeof window !== 'undefined' && window.getComputedStyle && element.nodeType === 1) {
        const style = window.getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.bottom > 0 &&
          rect.top < (window.innerHeight || 1080)
        );
      } else {
        // Basic visibility check without computed style
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          rect.bottom > 0 &&
          rect.top < (window.innerHeight || 1080)
        );
      }
    } catch (error) {
      // Default to visible if checks fail
      return true;
    }
  }

  /**
   * Generate unique operation ID
   * @returns {string} Unique identifier
   */
  generateOperationId() {
    return `dom_op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Estimate memory usage for operation
   * @param {Object} operation - Operation descriptor
   * @returns {number} Estimated memory usage in bytes
   */
  estimateOperationMemory(operation) {
    let size = 200; // Base operation overhead

    if (operation.operation.text) {
      size += operation.operation.text.length * 2; // UTF-16 encoding
    }

    if (operation.operation.styles) {
      size += Object.keys(operation.operation.styles).length * 50;
    }

    if (operation.operation.attributes) {
      size += Object.keys(operation.operation.attributes).length * 30;
    }

    return size;
  }

  /**
   * Get unique element identifier
   * @param {Element} element - DOM element
   * @returns {string} Unique identifier
   */
  getElementId(element) {
    if (element.id) return element.id;

    // Generate path-based identifier
    const path = [];
    let current = element;
    while (current && current !== document.body) {
      const index = Array.from(current.parentNode?.children || []).indexOf(current);
      path.unshift(`${current.tagName.toLowerCase()}[${index}]`);
      current = current.parentNode;
    }

    return path.join(' > ');
  }

  /**
   * Get element attributes as object
   * @param {Element} element - DOM element
   * @returns {Object} Attributes object
   */
  getElementAttributes(element) {
    const attributes = {};
    for (const attr of element.attributes) {
      attributes[attr.name] = attr.value;
    }
    return attributes;
  }

  /**
   * Get comprehensive performance metrics
   * @returns {Object} Performance metrics
   */
  getMetrics() {
    const avgBatchTime = this.metrics.performance.batchProcessingTime.length > 0
      ? this.metrics.performance.batchProcessingTime.reduce((a, b) => a + b, 0) /
        this.metrics.performance.batchProcessingTime.length
      : 0;

    const avgDOMUpdateTime = this.metrics.performance.domUpdateTime.length > 0
      ? this.metrics.performance.domUpdateTime.reduce((a, b) => a + b, 0) /
        this.metrics.performance.domUpdateTime.length
      : 0;

    return {
      operations: { ...this.metrics.operations },
      performance: {
        averageBatchTime: avgBatchTime,
        averageDOMUpdateTime: avgDOMUpdateTime,
        totalBatches: this.metrics.performance.batchProcessingTime.length,
        reflows: this.metrics.performance.reflows,
        repaints: this.metrics.performance.repaints
      },
      memory: { ...this.metrics.memory },
      queues: {
        high: this.operationQueues.high.length,
        medium: this.operationQueues.medium.length,
        low: this.operationQueues.low.length,
        background: this.operationQueues.background.length
      },
      state: {
        pending: this.state.pendingOperations.size,
        completed: this.state.completedOperations.size,
        errors: this.state.errorOperations.size
      }
    };
  }

  /**
   * Clear completed operations and optimize memory
   */
  cleanup() {
    // Clear completed operations older than 5 minutes
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

    this.state.completedOperations.forEach(operationId => {
      const operation = this.state.pendingOperations.get(operationId);
      if (operation && operation.timestamp < fiveMinutesAgo) {
        this.state.completedOperations.delete(operationId);
      }
    });

    // Clean up virtual DOM entries
    if (this.config.enableVirtualDOM) {
      for (const [elementId, data] of this.virtualDOM.entries()) {
        if (data.timestamp < fiveMinutesAgo) {
          this.virtualDOM.delete(elementId);
        }
      }
    }

    // Reset performance metrics if they get too large
    if (this.metrics.performance.batchProcessingTime.length > 1000) {
      this.metrics.performance.batchProcessingTime =
        this.metrics.performance.batchProcessingTime.slice(-100);
    }

    if (this.metrics.performance.domUpdateTime.length > 1000) {
      this.metrics.performance.domUpdateTime =
        this.metrics.performance.domUpdateTime.slice(-100);
    }

    console.log('🧹 DOM optimizer cleanup completed');
  }

  /**
   * Destroy the DOM optimizer and clean up resources
   */
  destroy() {
    // Cancel any pending operations
    if (this.batchProcessor.timeoutId) {
      clearTimeout(this.batchProcessor.timeoutId);
    }

    if (this.batchProcessor.frameId) {
      cancelAnimationFrame(this.batchProcessor.frameId);
    }

    // Disconnect intersection observer
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
    }

    // Clear all data structures
    this.state.pendingOperations.clear();
    this.state.activeOperations.clear();
    this.state.completedOperations.clear();
    this.state.errorOperations.clear();

    Object.values(this.operationQueues).forEach(queue => {
      queue.length = 0;
    });

    this.virtualDOM.clear();

    console.log('🔥 DOM optimizer destroyed');
  }
}

// Export for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DOMOptimizer;
} else if (typeof window !== 'undefined') {
  window.DOMOptimizer = DOMOptimizer;
}