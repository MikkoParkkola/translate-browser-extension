/**
 * Performance Tracking and Telemetry System
 * Non-invasive monitoring for translation extension operations
 */

import { logger } from './logger.js';

class PerformanceTracker {
  constructor(options = {}) {
    this.options = {
      enableStorage: options.enableStorage !== false,
      maxMetrics: options.maxMetrics || 1000,
      aggregationWindow: options.aggregationWindow || 300000, // 5 minutes
      enableRealTime: options.enableRealTime !== false,
      ...options
    };

    // Metric storage
    this.metrics = new Map();
    this.aggregates = new Map();
    this.sessions = new Map();

    // Performance timers
    this.activeTimers = new Map();
    this.timerIds = 0;

    // Real-time dashboard data
    this.realtimeData = {
      translationSpeed: [],
      domScanTime: [],
      apiResponseTime: [],
      errorRate: 0,
      cacheHitRate: 0,
      memoryUsage: 0
    };

    this.init();
  }

  async init() {
    try {
      // Load existing metrics from storage
      if (this.options.enableStorage && typeof chrome !== 'undefined') {
        const stored = await chrome.storage.local.get(['performanceMetrics']);
        if (stored.performanceMetrics) {
          this.loadMetrics(stored.performanceMetrics);
        }
      }

      // Start periodic aggregation
      this.startAggregation();

      logger.debug('PerformanceTracker', 'Initialized with storage:', this.options.enableStorage);
    } catch (error) {
      logger.error('PerformanceTracker', 'Initialization failed:', error);
    }
  }

  // Timer management for operation tracking
  startTimer(operation, context = {}) {
    const timerId = ++this.timerIds;
    const startTime = performance.now();

    this.activeTimers.set(timerId, {
      operation,
      context,
      startTime,
      timestamp: Date.now()
    });

    return timerId;
  }

  endTimer(timerId, additionalData = {}) {
    const timer = this.activeTimers.get(timerId);
    if (!timer) {
      logger.warn('PerformanceTracker', 'Timer not found:', timerId);
      return null;
    }

    const endTime = performance.now();
    const duration = endTime - timer.startTime;

    this.activeTimers.delete(timerId);

    // Record metric
    this.recordMetric(timer.operation, {
      duration,
      timestamp: timer.timestamp,
      context: timer.context,
      ...additionalData
    });

    return duration;
  }

  // Core metric recording
  recordMetric(type, data) {
    const timestamp = Date.now();
    const metric = {
      type,
      timestamp,
      ...data
    };

    // Store in metrics collection
    if (!this.metrics.has(type)) {
      this.metrics.set(type, []);
    }

    const typeMetrics = this.metrics.get(type);
    typeMetrics.push(metric);

    // Limit metrics size
    if (typeMetrics.length > this.options.maxMetrics) {
      typeMetrics.shift();
    }

    // Update real-time data
    this.updateRealtimeData(type, metric);

    // Persist to storage periodically
    this.scheduleStorage();

    logger.debug('PerformanceTracker', `Recorded ${type}:`, data.duration ? `${data.duration.toFixed(2)}ms` : 'metric');
  }

  // Translation-specific tracking methods
  trackTranslation(sourceText, targetText, duration, fromCache = false) {
    this.recordMetric('translation', {
      duration,
      sourceLength: sourceText.length,
      targetLength: targetText.length,
      tokensEstimate: Math.ceil(sourceText.length / 4),
      fromCache,
      speed: sourceText.length / duration * 1000 // chars per second
    });
  }

  trackDOMScan(nodesProcessed, duration, viewport = false) {
    this.recordMetric('domScan', {
      duration,
      nodesProcessed,
      nodesPerSecond: nodesProcessed / duration * 1000,
      viewport
    });
  }

  trackAPICall(endpoint, duration, success, tokenCount = 0) {
    this.recordMetric('apiCall', {
      duration,
      endpoint,
      success,
      tokenCount,
      tokensPerSecond: tokenCount > 0 ? tokenCount / duration * 1000 : 0
    });
  }

  trackCacheOperation(operation, hit, duration = 0) {
    this.recordMetric('cache', {
      operation, // 'get', 'set', 'clear'
      hit,
      duration
    });
  }

  trackError(component, error, context = {}) {
    this.recordMetric('error', {
      component,
      message: error.message,
      stack: error.stack,
      context
    });
  }

  // Memory usage tracking
  trackMemory() {
    if (performance.memory) {
      const memory = {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit
      };

      this.recordMetric('memory', memory);
      this.realtimeData.memoryUsage = memory.used;
    }
  }

  // Real-time data updates for dashboard
  updateRealtimeData(type, metric) {
    const maxDataPoints = 50;

    switch (type) {
      case 'translation':
        this.realtimeData.translationSpeed.push({
          timestamp: metric.timestamp,
          speed: metric.speed,
          fromCache: metric.fromCache
        });
        if (this.realtimeData.translationSpeed.length > maxDataPoints) {
          this.realtimeData.translationSpeed.shift();
        }
        break;

      case 'domScan':
        this.realtimeData.domScanTime.push({
          timestamp: metric.timestamp,
          duration: metric.duration,
          nodesProcessed: metric.nodesProcessed
        });
        if (this.realtimeData.domScanTime.length > maxDataPoints) {
          this.realtimeData.domScanTime.shift();
        }
        break;

      case 'apiCall':
        this.realtimeData.apiResponseTime.push({
          timestamp: metric.timestamp,
          duration: metric.duration,
          success: metric.success
        });
        if (this.realtimeData.apiResponseTime.length > maxDataPoints) {
          this.realtimeData.apiResponseTime.shift();
        }
        break;
    }

    // Update aggregate rates
    this.updateAggregateRates();
  }

  updateAggregateRates() {
    const now = Date.now();
    const windowMs = 60000; // 1 minute window

    // Calculate error rate
    const recentErrors = this.getMetricsInWindow('error', windowMs);
    const recentOperations = this.getTotalOperationsInWindow(windowMs);
    this.realtimeData.errorRate = recentOperations > 0 ? recentErrors.length / recentOperations : 0;

    // Calculate cache hit rate
    const recentCacheOps = this.getMetricsInWindow('cache', windowMs);
    const cacheHits = recentCacheOps.filter(op => op.hit).length;
    this.realtimeData.cacheHitRate = recentCacheOps.length > 0 ? cacheHits / recentCacheOps.length : 0;
  }

  getMetricsInWindow(type, windowMs) {
    const cutoff = Date.now() - windowMs;
    const typeMetrics = this.metrics.get(type) || [];
    return typeMetrics.filter(metric => metric.timestamp > cutoff);
  }

  getTotalOperationsInWindow(windowMs) {
    let total = 0;
    for (const [type, metrics] of this.metrics) {
      if (type !== 'memory') { // Exclude memory metrics from operation count
        total += this.getMetricsInWindow(type, windowMs).length;
      }
    }
    return total;
  }

  // Aggregation and analysis
  getAggregateStats(type, windowMs = 300000) {
    const metrics = this.getMetricsInWindow(type, windowMs);
    if (metrics.length === 0) return null;

    const durations = metrics.map(m => m.duration).filter(d => d !== undefined);
    if (durations.length === 0) return { count: metrics.length };

    durations.sort((a, b) => a - b);
    const len = durations.length;

    return {
      count: metrics.length,
      avg: durations.reduce((a, b) => a + b, 0) / len,
      min: durations[0],
      max: durations[len - 1],
      p50: durations[Math.floor(len * 0.5)],
      p95: durations[Math.floor(len * 0.95)],
      p99: durations[Math.floor(len * 0.99)]
    };
  }

  // Dashboard data for popup UI
  getDashboardData() {
    const stats = {};

    // Get stats for key operations
    ['translation', 'domScan', 'apiCall'].forEach(type => {
      stats[type] = this.getAggregateStats(type);
    });

    // Performance insights
    const insights = this.generateInsights(stats);

    return {
      realtime: { ...this.realtimeData },
      statistics: stats,
      insights,
      timestamp: Date.now()
    };
  }

  generateInsights(stats) {
    const insights = [];

    // Translation performance insights
    if (stats.translation && stats.translation.count > 10) {
      const avg = stats.translation.avg;
      if (avg > 2000) { // Slow translations
        insights.push({
          type: 'warning',
          category: 'translation',
          message: `Slow translation average: ${avg.toFixed(0)}ms. Consider optimizing batch sizes.`,
          metric: avg
        });
      } else if (avg < 500) {
        insights.push({
          type: 'success',
          category: 'translation',
          message: `Fast translation performance: ${avg.toFixed(0)}ms average`,
          metric: avg
        });
      }
    }

    // DOM scanning insights
    if (stats.domScan && stats.domScan.count > 5) {
      const p95 = stats.domScan.p95;
      if (p95 > 16) { // Above 60fps threshold
        insights.push({
          type: 'warning',
          category: 'domScan',
          message: `DOM scanning may impact performance. P95: ${p95.toFixed(1)}ms (>16ms)`,
          metric: p95
        });
      }
    }

    // API performance insights
    if (stats.apiCall && stats.apiCall.count > 5) {
      const p95 = stats.apiCall.p95;
      if (p95 > 5000) {
        insights.push({
          type: 'info',
          category: 'apiCall',
          message: `High API latency detected. P95: ${(p95/1000).toFixed(1)}s`,
          metric: p95
        });
      }
    }

    // Cache efficiency insights
    if (this.realtimeData.cacheHitRate > 0) {
      const hitRate = this.realtimeData.cacheHitRate;
      if (hitRate < 0.3) {
        insights.push({
          type: 'info',
          category: 'cache',
          message: `Low cache hit rate: ${(hitRate * 100).toFixed(1)}%. Consider cache optimization.`,
          metric: hitRate
        });
      } else if (hitRate > 0.7) {
        insights.push({
          type: 'success',
          category: 'cache',
          message: `Good cache efficiency: ${(hitRate * 100).toFixed(1)}% hit rate`,
          metric: hitRate
        });
      }
    }

    // Error rate insights
    if (this.realtimeData.errorRate > 0.05) { // >5% error rate
      insights.push({
        type: 'error',
        category: 'reliability',
        message: `High error rate: ${(this.realtimeData.errorRate * 100).toFixed(1)}%`,
        metric: this.realtimeData.errorRate
      });
    }

    return insights;
  }

  // Storage management
  scheduleStorage() {
    if (!this.storageScheduled) {
      this.storageScheduled = true;
      setTimeout(() => {
        this.persistMetrics();
        this.storageScheduled = false;
      }, 5000); // Batch storage writes
    }
  }

  async persistMetrics() {
    if (!this.options.enableStorage || typeof chrome === 'undefined') return;

    try {
      const serializedMetrics = this.serializeMetrics();
      await chrome.storage.local.set({ performanceMetrics: serializedMetrics });
      logger.debug('PerformanceTracker', 'Metrics persisted to storage');
    } catch (error) {
      logger.error('PerformanceTracker', 'Failed to persist metrics:', error);
    }
  }

  serializeMetrics() {
    const serialized = {};

    // Only serialize recent metrics to avoid storage bloat
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours

    for (const [type, metrics] of this.metrics) {
      const recentMetrics = metrics.filter(m => m.timestamp > cutoff);
      if (recentMetrics.length > 0) {
        serialized[type] = recentMetrics.slice(-500); // Max 500 per type
      }
    }

    return serialized;
  }

  loadMetrics(serializedMetrics) {
    for (const [type, metrics] of Object.entries(serializedMetrics)) {
      this.metrics.set(type, metrics);
    }
    logger.debug('PerformanceTracker', 'Loaded metrics from storage');
  }

  startAggregation() {
    // Aggregate metrics every 5 minutes
    setInterval(() => {
      this.trackMemory();
      this.updateAggregateRates();

      // Clean old metrics
      this.cleanOldMetrics();
    }, this.options.aggregationWindow);
  }

  cleanOldMetrics() {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    let cleaned = 0;

    for (const [type, metrics] of this.metrics) {
      const originalLength = metrics.length;
      const filtered = metrics.filter(m => m.timestamp > cutoff);
      this.metrics.set(type, filtered);
      cleaned += originalLength - filtered.length;
    }

    if (cleaned > 0) {
      logger.debug('PerformanceTracker', `Cleaned ${cleaned} old metrics`);
    }
  }

  // Reset and cleanup
  clearMetrics() {
    this.metrics.clear();
    this.aggregates.clear();
    this.realtimeData = {
      translationSpeed: [],
      domScanTime: [],
      apiResponseTime: [],
      errorRate: 0,
      cacheHitRate: 0,
      memoryUsage: 0
    };

    if (typeof chrome !== 'undefined') {
      chrome.storage.local.remove(['performanceMetrics']);
    }

    logger.info('PerformanceTracker', 'All metrics cleared');
  }
}

// Global instance
let globalTracker = null;

// Factory function
function createTracker(options) {
  return new PerformanceTracker(options);
}

// Get global tracker
function getTracker() {
  if (!globalTracker) {
    globalTracker = new PerformanceTracker();
  }
  return globalTracker;
}

// Convenience methods for common tracking
function startTimer(operation, context) {
  return getTracker().startTimer(operation, context);
}

function endTimer(timerId, additionalData) {
  return getTracker().endTimer(timerId, additionalData);
}

function trackTranslation(sourceText, targetText, duration, fromCache) {
  return getTracker().trackTranslation(sourceText, targetText, duration, fromCache);
}

function trackDOMScan(nodesProcessed, duration, viewport) {
  return getTracker().trackDOMScan(nodesProcessed, duration, viewport);
}

function trackAPICall(endpoint, duration, success, tokenCount) {
  return getTracker().trackAPICall(endpoint, duration, success, tokenCount);
}

function trackError(component, error, context) {
  return getTracker().trackError(component, error, context);
}

function getDashboardData() {
  return getTracker().getDashboardData();
}

// Export for browser extension
if (typeof window !== 'undefined') {
  window.PerformanceTracker = {
    createTracker,
    getTracker,
    startTimer,
    endTimer,
    trackTranslation,
    trackDOMScan,
    trackAPICall,
    trackError,
    getDashboardData
  };
} else if (typeof self !== 'undefined') {
  // Service worker context
  self.PerformanceTracker = {
    createTracker,
    getTracker,
    startTimer,
    endTimer,
    trackTranslation,
    trackDOMScan,
    trackAPICall,
    trackError,
    getDashboardData
  };
}

export {
  PerformanceTracker,
  createTracker,
  getTracker,
  startTimer,
  endTimer,
  trackTranslation,
  trackDOMScan,
  trackAPICall,
  trackError,
  getDashboardData
};