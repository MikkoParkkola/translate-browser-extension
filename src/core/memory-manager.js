/**
 * @fileoverview Memory management module for preventing leaks and optimizing resource usage
 * Provides cleanup utilities, WeakMap-based references, and memory monitoring
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenMemoryManager = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const logger = (typeof window !== 'undefined' && window.qwenLogger && window.qwenLogger.create) 
    ? window.qwenLogger.create('memory-manager')
    : (typeof self !== 'undefined' && self.qwenLogger && self.qwenLogger.create)
      ? self.qwenLogger.create('memory-manager')
      : console;

  /**
   * WeakMap-based reference manager for preventing memory leaks
   */
  class ReferenceManager {
    constructor() {
      this.elementRefs = new WeakMap();
      this.listenerRefs = new WeakMap();
      this.timerRefs = new Map();
      this.controllerRefs = new Set();
      this.observerRefs = new Set();
      this.cleanupCallbacks = [];
    }

    /**
     * Register element with cleanup data
     */
    registerElement(element, data = {}) {
      this.elementRefs.set(element, {
        created: Date.now(),
        cleaned: false,
        ...data
      });
    }

    /**
     * Register event listener for cleanup tracking
     */
    registerListener(element, eventType, listener, options) {
      if (!this.listenerRefs.has(element)) {
        this.listenerRefs.set(element, []);
      }
      this.listenerRefs.get(element).push({
        eventType,
        listener,
        options,
        added: Date.now()
      });
    }

    /**
     * Register timer for cleanup tracking
     */
    registerTimer(id, type = 'timeout') {
      this.timerRefs.set(id, {
        type,
        created: Date.now()
      });
      return id;
    }

    /**
     * Register AbortController for cleanup
     */
    registerController(controller) {
      this.controllerRefs.add(controller);
      return controller;
    }

    /**
     * Register Observer for cleanup
     */
    registerObserver(observer) {
      this.observerRefs.add(observer);
      return observer;
    }

    /**
     * Clean up all registered references
     */
    cleanup() {
      // Clean up timers
      for (const [id, timer] of this.timerRefs) {
        if (timer.type === 'timeout') {
          clearTimeout(id);
        } else if (timer.type === 'interval') {
          clearInterval(id);
        }
      }
      this.timerRefs.clear();

      // Clean up controllers
      this.controllerRefs.forEach(controller => {
        try {
          controller.abort();
        } catch (e) {
          logger.debug('Controller cleanup error:', e);
        }
      });
      this.controllerRefs.clear();

      // Clean up observers
      this.observerRefs.forEach(observer => {
        try {
          observer.disconnect();
        } catch (e) {
          logger.debug('Observer cleanup error:', e);
        }
      });
      this.observerRefs.clear();

      // Clean up event listeners from all elements
      // Note: We can iterate over WeakMap values that still have strong references
      const elementsToClean = [];
      // Since WeakMap doesn't allow iteration, we'll rely on cleanup callbacks or explicit calls
      // For now, we'll use the DOM to find elements and check if they have listeners
      if (typeof document !== 'undefined') {
        const allElements = document.querySelectorAll('*');
        allElements.forEach(element => {
          const listeners = this.listenerRefs.get(element);
          if (listeners) {
            listeners.forEach(({ eventType, listener, options }) => {
              try {
                element.removeEventListener(eventType, listener, options);
              } catch (e) {
                logger.debug('Listener cleanup error:', e);
              }
            });
            this.listenerRefs.delete(element);
          }
        });
      }

      // Run cleanup callbacks
      this.cleanupCallbacks.forEach(callback => {
        try {
          callback();
        } catch (e) {
          logger.debug('Cleanup callback error:', e);
        }
      });
      this.cleanupCallbacks = [];

      logger.info('Memory manager cleanup completed');
    }

    /**
     * Add cleanup callback
     */
    onCleanup(callback) {
      this.cleanupCallbacks.push(callback);
    }

    /**
     * Get memory usage statistics
     */
    getStats() {
      return {
        timers: this.timerRefs.size,
        controllers: this.controllerRefs.size,
        observers: this.observerRefs.size,
        cleanupCallbacks: this.cleanupCallbacks.length
      };
    }
  }

  /**
   * Memory-safe event listener manager
   */
  class ListenerManager {
    constructor(refManager) {
      this.refManager = refManager;
    }

    /**
     * Add event listener with automatic cleanup tracking
     */
    addEventListener(element, eventType, listener, options) {
      element.addEventListener(eventType, listener, options);
      this.refManager.registerListener(element, eventType, listener, options);
    }

    /**
     * Remove specific event listener
     */
    removeEventListener(element, eventType, listener, options) {
      element.removeEventListener(eventType, listener, options);
      
      const listeners = this.refManager.listenerRefs.get(element);
      if (listeners) {
        const index = listeners.findIndex(l => 
          l.eventType === eventType && 
          l.listener === listener
        );
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      }
    }

    /**
     * Remove all event listeners from element
     */
    removeAllListeners(element) {
      const listeners = this.refManager.listenerRefs.get(element);
      if (listeners) {
        listeners.forEach(({ eventType, listener, options }) => {
          element.removeEventListener(eventType, listener, options);
        });
        this.refManager.listenerRefs.delete(element);
      }
    }
  }

  /**
   * Memory-safe timer manager
   */
  class TimerManager {
    constructor(refManager) {
      this.refManager = refManager;
    }

    /**
     * Set timeout with cleanup tracking
     */
    setTimeout(callback, delay) {
      const id = setTimeout((...args) => {
        this.refManager.timerRefs.delete(id);
        callback(...args);
      }, delay);
      this.refManager.registerTimer(id, 'timeout');
      return id;
    }

    /**
     * Set interval with cleanup tracking
     */
    setInterval(callback, delay) {
      const id = setInterval(callback, delay);
      this.refManager.registerTimer(id, 'interval');
      return id;
    }

    /**
     * Clear timeout
     */
    clearTimeout(id) {
      clearTimeout(id);
      this.refManager.timerRefs.delete(id);
    }

    /**
     * Clear interval
     */
    clearInterval(id) {
      clearInterval(id);
      this.refManager.timerRefs.delete(id);
    }

    /**
     * Clear all tracked timers
     */
    clearAll() {
      for (const [id, timer] of this.refManager.timerRefs) {
        if (timer.type === 'timeout') {
          clearTimeout(id);
        } else if (timer.type === 'interval') {
          clearInterval(id);
        }
      }
      this.refManager.timerRefs.clear();
    }
  }

  /**
   * DOM element lifecycle manager
   */
  class ElementManager {
    constructor(refManager) {
      this.refManager = refManager;
      this.nodeObserver = null;
      this.init();
    }

    init() {
      // Monitor DOM removals to trigger cleanup
      if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
        this.nodeObserver = new MutationObserver(this.handleMutations.bind(this));
        this.nodeObserver.observe(document, {
          childList: true,
          subtree: true
        });
        this.refManager.registerObserver(this.nodeObserver);
      }
    }

    reinit() {
      // Reinitialize after cleanup
      this.nodeObserver = null;
      this.init();
    }

    handleMutations(mutations) {
      mutations.forEach(mutation => {
        mutation.removedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.cleanupElement(node);
          }
        });
      });
    }

    /**
     * Register element for tracking
     */
    track(element, data = {}) {
      this.refManager.registerElement(element, data);
      return element;
    }

    /**
     * Clean up element and its children
     */
    cleanupElement(element) {
      const elementData = this.refManager.elementRefs.get(element);
      if (elementData && !elementData.cleaned) {
        elementData.cleaned = true;
        
        // Remove event listeners
        const listeners = this.refManager.listenerRefs.get(element);
        if (listeners) {
          listeners.forEach(({ eventType, listener, options }) => {
            try {
              element.removeEventListener(eventType, listener, options);
            } catch (e) {
              logger.debug('Error removing listener:', e);
            }
          });
          this.refManager.listenerRefs.delete(element);
        }

        // Clean up child elements
        if (element.querySelectorAll) {
          element.querySelectorAll('*').forEach(child => {
            this.cleanupElement(child);
          });
        }
      }
    }

    /**
     * Create element with automatic tracking
     */
    createElement(tagName, attributes = {}, children = []) {
      const element = document.createElement(tagName);
      
      // Set attributes
      for (const [key, value] of Object.entries(attributes)) {
        if (key === 'textContent') {
          element.textContent = value;
        } else if (key === 'innerHTML') {
          element.innerHTML = value;
        } else if (key.startsWith('data-')) {
          element.dataset[key.slice(5)] = value;
        } else if (key === 'className') {
          element.className = value;
        } else {
          element.setAttribute(key, value);
        }
      }
      
      // Add children
      children.forEach(child => {
        if (typeof child === 'string') {
          element.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
          element.appendChild(child);
        }
      });
      
      this.track(element);
      return element;
    }
  }

  /**
   * Memory usage monitor
   */
  class MemoryMonitor {
    constructor() {
      this.measurements = [];
      this.maxMeasurements = 100;
    }

    /**
     * Take memory measurement
     */
    measure() {
      if (!performance.memory) return null;
      
      const measurement = {
        timestamp: Date.now(),
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
      };
      
      this.measurements.push(measurement);
      
      // Keep only recent measurements
      if (this.measurements.length > this.maxMeasurements) {
        this.measurements.shift();
      }
      
      return measurement;
    }

    /**
     * Get memory statistics
     */
    getStats() {
      // Take a measurement if none exist
      if (!this.measurements.length) {
        this.measure();
      }
      
      // If still no measurements (no performance.memory API), return defaults
      if (!this.measurements.length) {
        return {
          current: { usedJSHeapSize: 0, totalJSHeapSize: 0, jsHeapSizeLimit: 0, timestamp: Date.now() },
          trend: 0,
          measurements: 0,
          utilizationPercent: 0
        };
      }
      
      const latest = this.measurements[this.measurements.length - 1];
      const oldest = this.measurements[0];
      
      return {
        current: latest,
        trend: latest.usedJSHeapSize - oldest.usedJSHeapSize,
        measurements: this.measurements.length,
        utilizationPercent: Math.round((latest.usedJSHeapSize / latest.jsHeapSizeLimit) * 100)
      };
    }

    /**
     * Check if memory usage is concerning
     */
    isMemoryPressure() {
      const stats = this.getStats();
      if (!stats) return false;
      
      return stats.utilizationPercent > 80 || stats.trend > 50 * 1024 * 1024; // 50MB growth
    }
  }

  // Create singleton instances
  const refManager = new ReferenceManager();
  const listenerManager = new ListenerManager(refManager);
  const timerManager = new TimerManager(refManager);
  const elementManager = new ElementManager(refManager);
  const memoryMonitor = new MemoryMonitor();

  // Setup cleanup handlers
  const setupCleanupHandlers = () => {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => refManager.cleanup());
      window.addEventListener('unload', () => refManager.cleanup());
    }
    
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      try {
        chrome.runtime.onMessage.addListener((message) => {
          if (message && message.action === 'cleanup') {
            refManager.cleanup();
          }
        });
      } catch (e) {
        logger.debug('Chrome runtime cleanup handler not available:', e);
      }
    }

    // Periodic memory monitoring
    setInterval(() => {
      memoryMonitor.measure();
      if (memoryMonitor.isMemoryPressure()) {
        logger.warn('Memory pressure detected', memoryMonitor.getStats());
        // Trigger garbage collection hint
        if (window.gc) {
          try {
            window.gc();
          } catch (e) {
            logger.debug('Manual GC not available');
          }
        }
      }
    }, 30000); // Check every 30 seconds
  };

  setupCleanupHandlers();

  // Public API
  return {
    // Managers
    refManager,
    listenerManager,
    timerManager,
    elementManager,
    memoryMonitor,

    // Convenience methods
    cleanup: () => refManager.cleanup(),
    
    // Safe wrappers
    addEventListener: (element, type, listener, options) => 
      listenerManager.addEventListener(element, type, listener, options),
    
    removeEventListener: (element, type, listener, options) => 
      listenerManager.removeEventListener(element, type, listener, options),
      
    setTimeout: (callback, delay) => timerManager.setTimeout(callback, delay),
    setInterval: (callback, delay) => timerManager.setInterval(callback, delay),
    clearTimeout: (id) => timerManager.clearTimeout(id),
    clearInterval: (id) => timerManager.clearInterval(id),
    
    createElement: (tagName, attributes, children) => 
      elementManager.createElement(tagName, attributes, children),
      
    track: (element, data) => elementManager.track(element, data),
    
    // Re-initialization (for tests)
    reinit: () => elementManager.reinit(),
    
    // Statistics
    getStats: () => ({
      memory: memoryMonitor.getStats(),
      references: refManager.getStats()
    }),

    // Testing and debugging
    _internals: {
      ReferenceManager,
      ListenerManager,
      TimerManager,
      ElementManager,
      MemoryMonitor
    }
  };

}));