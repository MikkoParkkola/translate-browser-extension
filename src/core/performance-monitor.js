/**
 * @fileoverview Comprehensive performance monitoring system
 * Tracks translation performance, DOM operations, memory usage, and API metrics
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenPerformanceMonitor = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Performance monitoring categories
   */
  const CATEGORIES = {
    TRANSLATION: 'translation',
    DOM_OPERATION: 'dom_operation',
    API_REQUEST: 'api_request',
    MEMORY: 'memory',
    NETWORK: 'network',
    USER_INTERACTION: 'user_interaction'
  };

  /**
   * Performance thresholds (in milliseconds)
   */
  const THRESHOLDS = {
    DOM_OPERATION: {
      FAST: 16, // One frame at 60fps
      ACCEPTABLE: 33, // Two frames at 60fps
      SLOW: 100 // Noticeable delay
    },
    TRANSLATION: {
      FAST: 500, // Quick response
      ACCEPTABLE: 2000, // Still reasonable
      SLOW: 5000 // User will notice
    },
    API_REQUEST: {
      FAST: 200, // Quick API response
      ACCEPTABLE: 1000, // Standard timeout
      SLOW: 3000 // Approaching timeout
    },
    MEMORY: {
      GROWTH_LIMIT: 50 * 1024 * 1024, // 50MB growth limit
      CLEANUP_THRESHOLD: 100 // Operations before cleanup check
    }
  };

  /**
   * Comprehensive performance monitor
   */
  class PerformanceMonitor {
    constructor(options = {}) {
      this.options = {
        enableMemoryTracking: true,
        enableNetworkTracking: true,
        enableUserInteractionTracking: true,
        samplingRate: 1.0, // Sample all operations by default
        maxMetricsHistory: 1000,
        reportingInterval: 30000, // Report every 30 seconds
        ...options
      };

      this.metrics = {
        [CATEGORIES.TRANSLATION]: new MetricTracker('translation'),
        [CATEGORIES.DOM_OPERATION]: new MetricTracker('dom_operation'),
        [CATEGORIES.API_REQUEST]: new MetricTracker('api_request'),
        [CATEGORIES.MEMORY]: new MetricTracker('memory'),
        [CATEGORIES.NETWORK]: new MetricTracker('network'),
        [CATEGORIES.USER_INTERACTION]: new MetricTracker('user_interaction')
      };

      this.operations = new Map(); // Active operations
      this.sessionStart = performance.now();
      this.memoryBaseline = this.getMemoryUsage();

      // Auto-reporting
      if (this.options.reportingInterval > 0) {
        setInterval(() => this.generateReport(), this.options.reportingInterval);
      }
    }

    /**
     * Start tracking a performance operation
     * @param {string} category - Performance category
     * @param {string} type - Operation type
     * @param {Object} metadata - Additional operation metadata
     * @returns {string} Operation ID for later completion
     */
    startOperation(category, type, metadata = {}) {
      if (!this.shouldSample()) return null;

      const operationId = this.generateOperationId();
      const operation = {
        id: operationId,
        category,
        type,
        metadata,
        startTime: performance.now(),
        startMemory: this.getMemoryUsage()
      };

      this.operations.set(operationId, operation);
      return operationId;
    }

    /**
     * Complete a performance operation
     * @param {string} operationId - Operation ID from startOperation
     * @param {Object} result - Operation result metadata
     * @returns {Object} Performance metrics for the operation
     */
    completeOperation(operationId, result = {}) {
      if (!operationId || !this.operations.has(operationId)) {
        return null;
      }

      const operation = this.operations.get(operationId);
      const endTime = performance.now();
      const duration = endTime - operation.startTime;
      const endMemory = this.getMemoryUsage();

      const metrics = {
        id: operationId,
        category: operation.category,
        type: operation.type,
        duration,
        startTime: operation.startTime,
        endTime,
        metadata: { ...operation.metadata, ...result },
        memoryDelta: endMemory - operation.startMemory,
        performance: this.categorizePerformance(operation.category, duration)
      };

      // Record in appropriate metric tracker
      const categoryKey = operation.category;
      if (this.metrics[categoryKey]) {
        this.metrics[categoryKey].record(metrics);
      } else {
        // Fallback to generic category
        console.warn(`Unknown performance category: ${categoryKey}, using DOM_OPERATION as fallback`);
        this.metrics[CATEGORIES.DOM_OPERATION].record(metrics);
      }

      // Clean up
      this.operations.delete(operationId);

      // Check for performance issues
      this.checkPerformanceThresholds(metrics);

      return metrics;
    }

    /**
     * Record a completed operation directly (when timing externally)
     * @param {string} category - Performance category
     * @param {string} type - Operation type
     * @param {number} duration - Duration in milliseconds
     * @param {Object} metadata - Additional metadata
     */
    recordOperation(category, type, duration, metadata = {}) {
      if (!this.shouldSample()) return;

      const metrics = {
        id: this.generateOperationId(),
        category,
        type,
        duration,
        startTime: performance.now() - duration,
        endTime: performance.now(),
        metadata,
        memoryDelta: 0,
        performance: this.categorizePerformance(category, duration)
      };

      if (this.metrics[category]) {
        this.metrics[category].record(metrics);
      } else {
        console.warn(`Unknown performance category: ${category}, using DOM_OPERATION as fallback`);
        this.metrics[CATEGORIES.DOM_OPERATION].record(metrics);
      }
      this.checkPerformanceThresholds(metrics);
    }

    /**
     * Get current performance metrics
     * @param {string} [category] - Specific category or all categories
     * @returns {Object} Performance metrics
     */
    getMetrics(category = null) {
      if (category) {
        return this.metrics[category] ? this.metrics[category].getStats() : null;
      }

      const allMetrics = {};
      for (const [cat, tracker] of Object.entries(this.metrics)) {
        allMetrics[cat] = tracker.getStats();
      }

      return {
        ...allMetrics,
        session: {
          duration: performance.now() - this.sessionStart,
          activeOperations: this.operations.size,
          memoryGrowth: this.getMemoryUsage() - this.memoryBaseline
        }
      };
    }

    /**
     * Generate comprehensive performance report
     * @returns {Object} Detailed performance report
     */
    generateReport() {
      const metrics = this.getMetrics();
      const report = {
        timestamp: Date.now(),
        session: metrics.session,
        summary: this.generateSummary(metrics),
        details: metrics,
        recommendations: this.generateRecommendations(metrics)
      };

      // Log performance issues
      const issues = this.identifyPerformanceIssues(metrics);
      if (issues.length > 0) {
        console.warn('Performance issues detected:', issues);
      }

      return report;
    }

    /**
     * Reset all performance metrics
     */
    reset() {
      for (const tracker of Object.values(this.metrics)) {
        tracker.reset();
      }
      this.operations.clear();
      this.sessionStart = performance.now();
      this.memoryBaseline = this.getMemoryUsage();
    }

    /**
     * Check if current operation should be sampled
     */
    shouldSample() {
      return Math.random() < this.options.samplingRate;
    }

    /**
     * Generate unique operation ID
     */
    generateOperationId() {
      return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get current memory usage (if available)
     */
    getMemoryUsage() {
      if (performance.memory) {
        return performance.memory.usedJSHeapSize;
      }
      return 0;
    }

    /**
     * Categorize performance based on thresholds
     */
    categorizePerformance(category, duration) {
      const thresholds = THRESHOLDS[category.toUpperCase()];
      if (!thresholds) return 'unknown';

      if (duration <= thresholds.FAST) return 'fast';
      if (duration <= thresholds.ACCEPTABLE) return 'acceptable';
      return 'slow';
    }

    /**
     * Check performance thresholds and warn about issues
     */
    checkPerformanceThresholds(metrics) {
      if (metrics.performance === 'slow') {
        console.warn(`Slow ${metrics.category} operation detected:`, {
          type: metrics.type,
          duration: `${metrics.duration.toFixed(2)}ms`,
          metadata: metrics.metadata
        });
      }

      // Check memory growth
      if (metrics.memoryDelta > THRESHOLDS.MEMORY.GROWTH_LIMIT) {
        console.warn(`High memory usage detected:`, {
          operation: metrics.type,
          memoryDelta: `${(metrics.memoryDelta / 1024 / 1024).toFixed(2)}MB`
        });
      }
    }

    /**
     * Generate performance summary
     */
    generateSummary(metrics) {
      const summary = {
        totalOperations: 0,
        averagePerformance: {},
        slowOperations: 0,
        memoryEfficiency: 'good'
      };

      for (const [category, stats] of Object.entries(metrics)) {
        if (category === 'session') continue;

        summary.totalOperations += stats.count;
        summary.averagePerformance[category] = {
          averageTime: stats.averageTime,
          performance: stats.averageTime <= THRESHOLDS[category.toUpperCase()]?.ACCEPTABLE ? 'good' : 'poor'
        };

        summary.slowOperations += stats.slowOperations || 0;
      }

      // Memory efficiency assessment
      const memoryGrowth = metrics.session.memoryGrowth;
      if (memoryGrowth > THRESHOLDS.MEMORY.GROWTH_LIMIT) {
        summary.memoryEfficiency = 'poor';
      } else if (memoryGrowth > THRESHOLDS.MEMORY.GROWTH_LIMIT * 0.5) {
        summary.memoryEfficiency = 'moderate';
      }

      return summary;
    }

    /**
     * Generate performance recommendations
     */
    generateRecommendations(metrics) {
      const recommendations = [];

      // DOM operation recommendations
      const domStats = metrics[CATEGORIES.DOM_OPERATION];
      if (domStats && domStats.averageTime > THRESHOLDS.DOM_OPERATION.ACCEPTABLE) {
        recommendations.push({
          category: 'DOM Operations',
          issue: 'Average DOM operation time exceeds frame budget',
          suggestion: 'Consider batching DOM operations or using requestAnimationFrame for scheduling'
        });
      }

      // Translation performance recommendations
      const translationStats = metrics[CATEGORIES.TRANSLATION];
      if (translationStats && translationStats.averageTime > THRESHOLDS.TRANSLATION.ACCEPTABLE) {
        recommendations.push({
          category: 'Translation',
          issue: 'Translation operations taking too long',
          suggestion: 'Consider reducing batch sizes or implementing streaming translation'
        });
      }

      // Memory recommendations
      if (metrics.session.memoryGrowth > THRESHOLDS.MEMORY.GROWTH_LIMIT) {
        recommendations.push({
          category: 'Memory',
          issue: 'High memory growth detected',
          suggestion: 'Review memory cleanup routines and consider implementing more aggressive garbage collection'
        });
      }

      return recommendations;
    }

    /**
     * Identify performance issues
     */
    identifyPerformanceIssues(metrics) {
      const issues = [];

      for (const [category, stats] of Object.entries(metrics)) {
        if (category === 'session') continue;

        if (stats.slowOperations > stats.count * 0.1) { // More than 10% slow operations
          issues.push(`${category}: ${stats.slowOperations}/${stats.count} operations are slow`);
        }
      }

      return issues;
    }
  }

  /**
   * Individual metric tracker for each category
   */
  class MetricTracker {
    constructor(category) {
      this.category = category;
      this.reset();
    }

    record(metrics) {
      this.operations.push(metrics);
      
      // Keep only recent operations to prevent memory bloat
      if (this.operations.length > 1000) {
        this.operations = this.operations.slice(-500);
      }
    }

    getStats() {
      if (this.operations.length === 0) {
        return {
          count: 0,
          totalTime: 0,
          averageTime: 0,
          minTime: 0,
          maxTime: 0,
          slowOperations: 0,
          fastOperations: 0,
          recentOperations: []
        };
      }

      const durations = this.operations.map(op => op.duration);
      const totalTime = durations.reduce((sum, d) => sum + d, 0);
      const averageTime = totalTime / durations.length;
      const minTime = Math.min(...durations);
      const maxTime = Math.max(...durations);

      const slowOperations = this.operations.filter(op => op.performance === 'slow').length;
      const fastOperations = this.operations.filter(op => op.performance === 'fast').length;

      return {
        count: this.operations.length,
        totalTime,
        averageTime,
        minTime,
        maxTime,
        slowOperations,
        fastOperations,
        recentOperations: this.operations.slice(-10) // Last 10 operations
      };
    }

    reset() {
      this.operations = [];
    }
  }

  // Create global performance monitor instance
  const globalMonitor = new PerformanceMonitor();

  // Public API
  return {
    // Classes
    PerformanceMonitor,
    MetricTracker,

    // Constants
    CATEGORIES,
    THRESHOLDS,

    // Global instance
    monitor: globalMonitor,

    // Convenience methods
    startOperation: (category, type, metadata) => globalMonitor.startOperation(category, type, metadata),
    completeOperation: (operationId, result) => globalMonitor.completeOperation(operationId, result),
    recordOperation: (category, type, duration, metadata) => globalMonitor.recordOperation(category, type, duration, metadata),
    getMetrics: (category) => globalMonitor.getMetrics(category),
    generateReport: () => globalMonitor.generateReport(),
    reset: () => globalMonitor.reset(),

    // Helper functions
    measureAsync: async (category, type, asyncFunction, metadata = {}) => {
      const opId = globalMonitor.startOperation(category, type, metadata);
      try {
        const result = await asyncFunction();
        globalMonitor.completeOperation(opId, { success: true });
        return result;
      } catch (error) {
        globalMonitor.completeOperation(opId, { success: false, error: error.message });
        throw error;
      }
    },

    measureSync: (category, type, syncFunction, metadata = {}) => {
      const opId = globalMonitor.startOperation(category, type, metadata);
      try {
        const result = syncFunction();
        globalMonitor.completeOperation(opId, { success: true });
        return result;
      } catch (error) {
        globalMonitor.completeOperation(opId, { success: false, error: error.message });
        throw error;
      }
    }
  };

}));