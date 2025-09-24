/**
 * Model Performance Monitor
 * Tracks performance metrics, memory usage, and optimization strategies
 */

import { logger } from './logger.js';

export class ModelPerformanceMonitor {
  constructor(options = {}) {
    // Performance monitoring configuration
    this.performanceConfig = {
      enableMemoryMonitoring: true,
      enableInferenceTracking: true,
      enableAdaptiveOptimization: true,
      memoryMonitoringInterval: 10000, // 10 seconds
      memoryThreshold: 0.8, // 80% memory usage threshold
      performanceOptimizationInterval: 30000, // 30 seconds
      maxInferenceHistory: 100,
      ...options
    };

    // Performance statistics
    this.performanceStats = {
      // Basic metrics
      totalInferences: 0,
      successfulInferences: 0,
      failedInferences: 0,
      averageInferenceTime: 0,
      totalInferenceTime: 0,

      // Detailed performance metrics
      inferenceHistory: [], // Array of { timestamp, duration, success, textLength }
      errorHistory: [], // Array of recent errors
      memoryUsage: {
        currentMemory: 0,
        peakMemory: 0,
        runtimeMemory: 0,
        lastUpdated: null
      },

      // Performance breakdown
      timeBreakdown: {
        initialization: 0,
        preprocessing: 0,
        inference: 0,
        postprocessing: 0
      },

      // Throughput metrics
      tokensPerSecond: 0,
      charactersPerSecond: 0,
      requestsPerMinute: 0,
      averageLatency: 0,

      // System metrics
      cpuUsage: null, // Would need additional API access
      powerUsage: null, // Power consumption if available

      // Performance trends
      performanceTrend: 'stable', // stable, improving, degrading
      optimizationLevel: 'balanced' // low, balanced, high
    };

    // Performance optimization strategies
    this.optimizationStrategies = {
      low: {
        name: 'Low Memory',
        description: 'Minimize memory usage, slower inference',
        settings: {
          maxConcurrentRequests: 1,
          modelUnloadTimeout: 2 * 60 * 1000, // 2 minutes
          enableCache: false,
          contextWindow: 1024
        }
      },
      balanced: {
        name: 'Balanced',
        description: 'Balance between speed and memory',
        settings: {
          maxConcurrentRequests: 2,
          modelUnloadTimeout: 5 * 60 * 1000, // 5 minutes
          enableCache: true,
          contextWindow: 2048
        }
      },
      high: {
        name: 'High Performance',
        description: 'Maximize speed, higher memory usage',
        settings: {
          maxConcurrentRequests: 3,
          modelUnloadTimeout: 15 * 60 * 1000, // 15 minutes
          enableCache: true,
          contextWindow: 4096
        }
      }
    };

    // Timers
    this.memoryMonitorTimer = null;
    this.performanceOptimizationTimer = null;

    // Performance history for trend analysis
    this.performanceHistory = [];
  }

  /**
   * Start performance monitoring
   */
  startPerformanceMonitoring() {
    if (this.memoryMonitorTimer) {
      clearInterval(this.memoryMonitorTimer);
    }

    if (this.performanceOptimizationTimer) {
      clearInterval(this.performanceOptimizationTimer);
    }

    // Monitor memory usage
    if (this.performanceConfig.enableMemoryMonitoring) {
      this.memoryMonitorTimer = setInterval(() => {
        this.updateMemoryUsage();
      }, this.performanceConfig.memoryMonitoringInterval);
    }

    // Periodic performance optimization check
    if (this.performanceConfig.enableAdaptiveOptimization) {
      this.performanceOptimizationTimer = setInterval(() => {
        this.optimizePerformanceAdaptively();
      }, this.performanceConfig.performanceOptimizationInterval);
    }

    logger.info('ModelPerformanceMonitor', 'Performance monitoring started');
  }

  /**
   * Stop performance monitoring
   */
  stopPerformanceMonitoring() {
    if (this.memoryMonitorTimer) {
      clearInterval(this.memoryMonitorTimer);
      this.memoryMonitorTimer = null;
    }

    if (this.performanceOptimizationTimer) {
      clearInterval(this.performanceOptimizationTimer);
      this.performanceOptimizationTimer = null;
    }

    logger.info('ModelPerformanceMonitor', 'Performance monitoring stopped');
  }

  /**
   * Update memory usage statistics
   */
  async updateMemoryUsage() {
    try {
      if ('memory' in performance) {
        const memInfo = performance.memory;
        this.performanceStats.memoryUsage.currentMemory = memInfo.usedJSHeapSize;
        this.performanceStats.memoryUsage.peakMemory = Math.max(
          this.performanceStats.memoryUsage.peakMemory,
          memInfo.usedJSHeapSize
        );
        this.performanceStats.memoryUsage.runtimeMemory = memInfo.totalJSHeapSize;
        this.performanceStats.memoryUsage.lastUpdated = new Date();

        // Check for memory pressure
        const memoryPressure = memInfo.usedJSHeapSize / memInfo.totalJSHeapSize;
        if (memoryPressure > this.performanceConfig.memoryThreshold) {
          this.handleMemoryPressure(memoryPressure);
        }
      }
    } catch (error) {
      logger.warn('ModelPerformanceMonitor', 'Failed to update memory usage:', error.message);
    }
  }

  /**
   * Handle memory pressure situations
   */
  handleMemoryPressure(memoryPressure) {
    logger.warn('ModelPerformanceMonitor', `High memory usage detected: ${(memoryPressure * 100).toFixed(1)}%`);

    // Switch to low-power mode to reduce memory usage
    this.applyOptimizationStrategy('low');

    // Clear inference history to free memory
    this.clearInferenceHistory();

    // Trigger garbage collection if available
    if (window.gc) {
      window.gc();
    }
  }

  /**
   * Update performance statistics after inference
   */
  updatePerformanceStats(inferenceTime, success, textLength = 0) {
    const timestamp = Date.now();

    // Update basic stats
    this.performanceStats.totalInferences++;
    if (success) {
      this.performanceStats.successfulInferences++;
    } else {
      this.performanceStats.failedInferences++;
    }

    this.performanceStats.totalInferenceTime += inferenceTime;

    if (success && this.performanceConfig.enableInferenceTracking) {
      // Update inference history
      this.performanceStats.inferenceHistory.push({
        timestamp,
        duration: inferenceTime,
        success,
        textLength
      });

      // Calculate average inference time
      const recentInferences = this.performanceStats.inferenceHistory.slice(-20);
      const avgTime = recentInferences.reduce((sum, inf) => sum + inf.duration, 0) / recentInferences.length;
      this.performanceStats.averageInferenceTime = avgTime;

      // Calculate throughput metrics
      if (textLength > 0) {
        const charactersPerMs = textLength / inferenceTime;
        this.performanceStats.charactersPerSecond = charactersPerMs * 1000;

        // Estimate tokens per second (rough approximation: ~4 characters per token)
        this.performanceStats.tokensPerSecond = (charactersPerMs * 1000) / 4;
      }

      // Update performance trend
      this.updatePerformanceTrend();

      // Limit history size
      if (this.performanceStats.inferenceHistory.length > this.performanceConfig.maxInferenceHistory) {
        this.performanceStats.inferenceHistory = this.performanceStats.inferenceHistory.slice(-this.performanceConfig.maxInferenceHistory);
      }
    }
  }

  /**
   * Update performance trend analysis
   */
  updatePerformanceTrend() {
    const history = this.performanceStats.inferenceHistory;
    if (history.length < 10) return;

    const recent = history.slice(-10);
    const older = history.slice(-20, -10);

    if (older.length === 0) return;

    const recentAvg = recent.reduce((sum, inf) => sum + inf.duration, 0) / recent.length;
    const olderAvg = older.reduce((sum, inf) => sum + inf.duration, 0) / older.length;

    const improvement = (olderAvg - recentAvg) / olderAvg;

    if (improvement > 0.1) {
      this.performanceStats.performanceTrend = 'improving';
    } else if (improvement < -0.1) {
      this.performanceStats.performanceTrend = 'degrading';
    } else {
      this.performanceStats.performanceTrend = 'stable';
    }
  }

  /**
   * Optimize performance adaptively based on current conditions
   */
  async optimizePerformanceAdaptively() {
    try {
      const conditions = await this.analyzeSystemConditions();
      const recommendedStrategy = this.selectOptimalStrategy(conditions);

      if (recommendedStrategy !== this.performanceStats.optimizationLevel) {
        logger.info('ModelPerformanceMonitor', `Switching to ${recommendedStrategy} optimization strategy`);
        this.applyOptimizationStrategy(recommendedStrategy);
      }
    } catch (error) {
      logger.error('ModelPerformanceMonitor', 'Adaptive optimization failed:', error);
    }
  }

  /**
   * Analyze current system conditions
   */
  async analyzeSystemConditions() {
    const conditions = {
      memoryPressure: 0,
      performanceTrend: this.performanceStats.performanceTrend,
      deviceCapability: 'medium' // Could be enhanced with actual device detection
    };

    // Check memory usage
    if (this.performanceStats.memoryUsage.currentMemory > 0) {
      const memInfo = performance.memory;
      conditions.memoryPressure = memInfo.usedJSHeapSize / memInfo.totalJSHeapSize;
    }

    // Check performance trend
    if (this.performanceStats.performanceTrend === 'degrading') {
      conditions.needsOptimization = true;
    }

    // Check device capabilities (rough heuristic based on performance)
    const avgInferenceTime = this.performanceStats.averageInferenceTime;
    if (avgInferenceTime < 1000) {
      conditions.deviceCapability = 'high';
    } else if (avgInferenceTime > 3000) {
      conditions.deviceCapability = 'low';
    }

    return conditions;
  }

  /**
   * Select optimal performance strategy based on conditions
   */
  selectOptimalStrategy(conditions) {
    // Apply strategy settings (this would integrate with llama.cpp configuration)
    if (conditions.memoryPressure > 0.8 || conditions.deviceCapability === 'low') {
      return 'low';
    }

    if (conditions.deviceCapability === 'high' && conditions.memoryPressure < 0.5) {
      return 'high';
    }

    return 'balanced';
  }

  /**
   * Apply optimization strategy
   */
  applyOptimizationStrategy(strategy) {
    const config = this.optimizationStrategies[strategy];
    if (!config) {
      logger.warn('ModelPerformanceMonitor', `Unknown optimization strategy: ${strategy}`);
      return;
    }

    this.performanceStats.optimizationLevel = strategy;

    // Apply strategy settings (this would integrate with llama.cpp configuration)
    logger.debug('ModelPerformanceMonitor', `Applied ${config.name} optimization strategy`);

    // In a real implementation, these settings would be applied to the llama.cpp instance
    // For example:
    // - this.llamaCppInstance.setMaxConcurrentRequests(config.settings.maxConcurrentRequests)
    // - this.llamaCppInstance.setContextWindow(config.settings.contextWindow)
    // etc.
  }

  /**
   * Clear inference history to free memory
   */
  clearInferenceHistory() {
    this.performanceStats.inferenceHistory = [];
    this.performanceStats.errorHistory = [];
    logger.debug('ModelPerformanceMonitor', 'Inference history cleared to free memory');
  }

  /**
   * Get performance summary
   */
  getPerformanceSummary() {
    const stats = this.performanceStats;
    const successRate = stats.totalInferences > 0
      ? (stats.successfulInferences / stats.totalInferences * 100).toFixed(1)
      : 0;

    return {
      totalInferences: stats.totalInferences,
      successRate: `${successRate}%`,
      averageInferenceTime: `${stats.averageInferenceTime.toFixed(0)}ms`,
      tokensPerSecond: stats.tokensPerSecond.toFixed(1),
      memoryUsage: this.formatBytes(stats.memoryUsage.currentMemory),
      peakMemory: this.formatBytes(stats.memoryUsage.peakMemory),
      performanceTrend: stats.performanceTrend,
      optimizationLevel: stats.optimizationLevel,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Get detailed performance metrics
   */
  getDetailedMetrics() {
    return {
      ...this.performanceStats,
      availableStrategies: Object.keys(this.optimizationStrategies),
      currentStrategy: this.optimizationStrategies[this.performanceStats.optimizationLevel]
    };
  }

  /**
   * Reset performance statistics
   */
  resetStats() {
    this.performanceStats = {
      totalInferences: 0,
      successfulInferences: 0,
      failedInferences: 0,
      averageInferenceTime: 0,
      totalInferenceTime: 0,
      inferenceHistory: [],
      errorHistory: [],
      memoryUsage: {
        currentMemory: 0,
        peakMemory: 0,
        runtimeMemory: 0,
        lastUpdated: null
      },
      timeBreakdown: {
        initialization: 0,
        preprocessing: 0,
        inference: 0,
        postprocessing: 0
      },
      tokensPerSecond: 0,
      charactersPerSecond: 0,
      requestsPerMinute: 0,
      averageLatency: 0,
      cpuUsage: null,
      powerUsage: null,
      performanceTrend: 'stable',
      optimizationLevel: 'balanced'
    };

    logger.info('ModelPerformanceMonitor', 'Performance statistics reset');
  }

  /**
   * Export performance data for analysis
   */
  exportPerformanceData() {
    return {
      timestamp: new Date().toISOString(),
      config: this.performanceConfig,
      stats: this.performanceStats,
      strategies: this.optimizationStrategies
    };
  }

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Clean up monitor resources
   */
  destroy() {
    this.stopPerformanceMonitoring();
    this.clearInferenceHistory();
    logger.debug('ModelPerformanceMonitor', 'Performance monitor destroyed');
  }
}