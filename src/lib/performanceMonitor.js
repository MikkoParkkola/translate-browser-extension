/**
 * Performance Monitoring System
 * Tracks translation performance, API metrics, memory usage, and system health
 */
import { Logger } from './logger.js';


class PerformanceMonitor {
  constructor(options = {}) {
      this.logger = Logger.create('performance-monitor');

    this.options = {
      enableAPIMetrics: true,
      enableMemoryMonitoring: true,
      enablePerformanceMarks: true,
      enableUserExperience: true,
      enableResourceTracking: true,
      enableErrorTracking: true,
      metricsRetentionDays: 7,
      sampleRate: 1.0, // Sample 100% of events by default
      reportingInterval: 60000, // 1 minute
      maxMetricsInMemory: 1000,
      enablePersistence: true,
      ...options
    };

    // Performance metrics storage
    this.metrics = {
      api: {
        requests: 0,
        successCount: 0,
        errorCount: 0,
        totalLatency: 0,
        minLatency: Infinity,
        maxLatency: 0,
        averageLatency: 0,
        timeouts: 0,
        retries: 0,
        cacheHits: 0,
        cacheMisses: 0
      },
      translation: {
        totalTexts: 0,
        totalCharacters: 0,
        successfulTranslations: 0,
        failedTranslations: 0,
        averageTextLength: 0,
        translationsPerMinute: 0,
        qualityScores: [],
        averageQualityScore: 0
      },
      cache: {
        sessionCacheHits: 0,
        sessionCacheMisses: 0,
        tmCacheHits: 0,
        tmCacheMisses: 0,
        cacheEfficiency: 0
      },
      memory: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0,
        memoryPressure: 'normal' // normal, warning, critical
      },
      userExperience: {
        pageLoadTime: 0,
        translationStartTime: 0,
        translationCompleteTime: 0,
        timeToFirstTranslation: 0,
        userInteractions: 0,
        userSatisfactionScore: 0
      },
      system: {
        extensionStartTime: Date.now(),
        uptime: 0,
        crashes: 0,
        contextInvalidations: 0,
        backgroundReloads: 0
      },
      errors: {
        count: 0,
        types: {},
        recentErrors: []
      }
    };

    // Performance timeline for detailed analysis
    this.timeline = [];
    this.maxTimelineLength = this.options.maxMetricsInMemory;

    // Session tracking
    this.sessionId = this.generateSessionId();
    this.sessionStartTime = Date.now();

    // Reporting timer
    this.reportingTimer = null;

    // Performance observers
    this.performanceObserver = null;
    this.memoryMonitorTimer = null;

    // Initialize monitoring
    this.initialize();

    this.logger.info('[PerformanceMonitor] Initialized with session ID:', this.sessionId);
  }

  /**
   * Initialize performance monitoring
   */
  initialize() {
    // Start performance observers if available
    if (this.options.enablePerformanceMarks && typeof PerformanceObserver !== 'undefined') {
      this.setupPerformanceObserver();
    }

    // Start memory monitoring
    if (this.options.enableMemoryMonitoring) {
      this.startMemoryMonitoring();
    }

    // Start periodic reporting
    if (this.options.reportingInterval > 0) {
      this.startPeriodicReporting();
    }

    // Mark extension initialization
    this.markEvent('extension_initialized', {
      sessionId: this.sessionId,
      timestamp: Date.now()
    });
  }

  /**
   * Track API request performance
   */
  trackAPIRequest(request) {
    if (!this.options.enableAPIMetrics || !this.shouldSample()) return;

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    this.markEvent('api_request_start', {
      requestId,
      provider: request.provider,
      textLength: request.text?.length || 0,
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      timestamp: startTime
    });

    // Return tracking object
    return {
      requestId,
      startTime,
      complete: (response) => this.trackAPIResponse(requestId, startTime, request, response),
      error: (error) => this.trackAPIError(requestId, startTime, request, error)
    };
  }

  /**
   * Track successful API response
   */
  trackAPIResponse(requestId, startTime, request, response) {
    const endTime = Date.now();
    const latency = endTime - startTime;

    // Update API metrics
    this.metrics.api.requests++;
    this.metrics.api.successCount++;
    this.metrics.api.totalLatency += latency;
    this.metrics.api.minLatency = Math.min(this.metrics.api.minLatency, latency);
    this.metrics.api.maxLatency = Math.max(this.metrics.api.maxLatency, latency);
    this.metrics.api.averageLatency = this.metrics.api.totalLatency / this.metrics.api.requests;

    // Track cache performance
    if (response.cached || response.translationMemory) {
      this.metrics.api.cacheHits++;
    } else {
      this.metrics.api.cacheMisses++;
    }

    // Update translation metrics
    this.metrics.translation.totalTexts++;
    this.metrics.translation.totalCharacters += request.text?.length || 0;
    this.metrics.translation.successfulTranslations++;
    this.metrics.translation.averageTextLength =
      this.metrics.translation.totalCharacters / this.metrics.translation.totalTexts;

    // Track quality if available
    if (response.qualityVerification) {
      this.metrics.translation.qualityScores.push(response.qualityVerification.overallScore);
      this.metrics.translation.averageQualityScore =
        this.metrics.translation.qualityScores.reduce((sum, score) => sum + score, 0) /
        this.metrics.translation.qualityScores.length;
    }

    this.markEvent('api_request_complete', {
      requestId,
      latency,
      provider: request.provider,
      textLength: request.text?.length || 0,
      translationLength: response.text?.length || 0,
      cached: response.cached || response.translationMemory,
      qualityScore: response.qualityVerification?.overallScore,
      timestamp: endTime
    });

    this.logger.info(`[PerformanceMonitor] API request completed: ${latency}ms (${request.provider})`);
  }

  /**
   * Track API errors
   */
  trackAPIError(requestId, startTime, request, error) {
    const endTime = Date.now();
    const latency = endTime - startTime;

    // Update API metrics
    this.metrics.api.requests++;
    this.metrics.api.errorCount++;
    this.metrics.translation.failedTranslations++;

    // Track error details
    this.trackError('api_error', error, {
      requestId,
      provider: request.provider,
      latency,
      textLength: request.text?.length || 0
    });

    this.markEvent('api_request_error', {
      requestId,
      latency,
      provider: request.provider,
      error: error.message || 'Unknown error',
      textLength: request.text?.length || 0,
      timestamp: endTime
    });

    this.logger.warn(`[PerformanceMonitor] API request failed: ${latency}ms (${error.message})`);
  }

  /**
   * Track translation performance
   */
  trackTranslation(originalTexts, translatedTexts, metadata = {}) {
    if (!this.shouldSample()) return;

    const translationId = this.generateTranslationId();
    const timestamp = Date.now();

    this.markEvent('translation_batch', {
      translationId,
      originalCount: originalTexts.length,
      translatedCount: translatedTexts.length,
      totalCharacters: originalTexts.reduce((sum, text) => sum + text.length, 0),
      provider: metadata.provider,
      batchSize: originalTexts.length,
      timestamp
    });

    // Update translations per minute
    this.updateTranslationsPerMinute();
  }

  /**
   * Track user experience metrics
   */
  trackUserExperience(event, data = {}) {
    if (!this.options.enableUserExperience || !this.shouldSample()) return;

    const timestamp = Date.now();

    switch (event) {
      case 'page_load':
        this.metrics.userExperience.pageLoadTime = data.loadTime || 0;
        break;

      case 'translation_start':
        this.metrics.userExperience.translationStartTime = timestamp;
        break;

      case 'translation_complete':
        this.metrics.userExperience.translationCompleteTime = timestamp;
        if (this.metrics.userExperience.translationStartTime > 0) {
          this.metrics.userExperience.timeToFirstTranslation =
            timestamp - this.metrics.userExperience.translationStartTime;
        }
        break;

      case 'user_interaction':
        this.metrics.userExperience.userInteractions++;
        break;

      case 'user_satisfaction':
        this.metrics.userExperience.userSatisfactionScore = data.score || 0;
        break;
    }

    this.markEvent('user_experience', {
      event,
      data,
      timestamp
    });
  }

  /**
   * Track system performance
   */
  trackSystemEvent(event, data = {}) {
    const timestamp = Date.now();

    switch (event) {
      case 'context_invalidation':
        this.metrics.system.contextInvalidations++;
        break;

      case 'background_reload':
        this.metrics.system.backgroundReloads++;
        break;

      case 'crash':
        this.metrics.system.crashes++;
        break;
    }

    // Update system uptime
    this.metrics.system.uptime = timestamp - this.metrics.system.extensionStartTime;

    this.markEvent('system_event', {
      event,
      data,
      timestamp
    });
  }

  /**
   * Track errors with context
   */
  trackError(type, error, context = {}) {
    if (!this.options.enableErrorTracking) return;

    const errorInfo = {
      type,
      message: error.message || 'Unknown error',
      stack: error.stack,
      context,
      timestamp: Date.now()
    };

    // Update error metrics
    this.metrics.errors.count++;
    this.metrics.errors.types[type] = (this.metrics.errors.types[type] || 0) + 1;
    this.metrics.errors.recentErrors.push(errorInfo);

    // Keep only recent errors (last 50)
    if (this.metrics.errors.recentErrors.length > 50) {
      this.metrics.errors.recentErrors = this.metrics.errors.recentErrors.slice(-50);
    }

    this.markEvent('error', errorInfo);

    this.logger.error(`[PerformanceMonitor] Error tracked: ${type} - ${error.message}`);
  }

  /**
   * Track memory usage
   */
  trackMemoryUsage() {
    if (!this.options.enableMemoryMonitoring) return;

    try {
      // Browser memory API (if available)
      if (typeof performance !== 'undefined' && performance.memory) {
        const memory = performance.memory;
        this.metrics.memory.heapUsed = memory.usedJSHeapSize;
        this.metrics.memory.heapTotal = memory.totalJSHeapSize;
        this.metrics.memory.external = memory.usedJSHeapSize; // Approximation

        // Determine memory pressure
        const memoryUsageRatio = memory.usedJSHeapSize / memory.totalJSHeapSize;
        if (memoryUsageRatio > 0.9) {
          this.metrics.memory.memoryPressure = 'critical';
        } else if (memoryUsageRatio > 0.7) {
          this.metrics.memory.memoryPressure = 'warning';
        } else {
          this.metrics.memory.memoryPressure = 'normal';
        }
      }

      this.markEvent('memory_sample', {
        heapUsed: this.metrics.memory.heapUsed,
        heapTotal: this.metrics.memory.heapTotal,
        memoryPressure: this.metrics.memory.memoryPressure,
        timestamp: Date.now()
      });

    } catch (error) {
      this.logger.warn('[PerformanceMonitor] Memory tracking failed:', error);
    }
  }

  /**
   * Track resource usage (cache, storage, etc.)
   */
  trackResourceUsage(resources) {
    if (!this.options.enableResourceTracking || !this.shouldSample()) return;

    this.markEvent('resource_usage', {
      ...resources,
      timestamp: Date.now()
    });
  }

  /**
   * Mark performance event for timeline
   */
  markEvent(type, data) {
    const event = {
      type,
      data,
      timestamp: Date.now(),
      sessionId: this.sessionId
    };

    // Add to timeline
    this.timeline.push(event);

    // Maintain timeline size
    if (this.timeline.length > this.maxTimelineLength) {
      this.timeline = this.timeline.slice(-this.maxTimelineLength);
    }

    // Performance mark if available
    if (this.options.enablePerformanceMarks && typeof performance !== 'undefined' && performance.mark) {
      try {
        performance.mark(`pm_${type}_${Date.now()}`);
      } catch (error) {
        // Ignore marking errors
      }
    }
  }

  /**
   * Get comprehensive performance report
   */
  getPerformanceReport() {
    const now = Date.now();
    const sessionDuration = now - this.sessionStartTime;

    return {
      sessionId: this.sessionId,
      sessionDuration,
      timestamp: now,
      metrics: {
        ...this.metrics,
        system: {
          ...this.metrics.system,
          uptime: sessionDuration
        }
      },
      derived: {
        apiSuccessRate: this.metrics.api.requests > 0
          ? this.metrics.api.successCount / this.metrics.api.requests
          : 0,
        cacheHitRate: (this.metrics.api.cacheHits + this.metrics.api.cacheMisses) > 0
          ? this.metrics.api.cacheHits / (this.metrics.api.cacheHits + this.metrics.api.cacheMisses)
          : 0,
        translationSuccessRate: this.metrics.translation.totalTexts > 0
          ? this.metrics.translation.successfulTranslations / this.metrics.translation.totalTexts
          : 0,
        averageTranslationTime: this.metrics.api.averageLatency,
        memoryEfficiency: this.metrics.memory.memoryPressure === 'normal' ? 1.0 :
                         this.metrics.memory.memoryPressure === 'warning' ? 0.7 : 0.3,
        errorRate: this.metrics.api.requests > 0
          ? this.metrics.errors.count / this.metrics.api.requests
          : 0
      },
      health: this.getSystemHealth()
    };
  }

  /**
   * Get system health status
   */
  getSystemHealth() {
    const health = {
      overall: 'good',
      issues: [],
      score: 1.0
    };

    // Check API performance
    if (this.metrics.api.averageLatency > 5000) {
      health.issues.push('High API latency detected');
      health.score *= 0.8;
    }

    // Check error rate
    const errorRate = this.metrics.api.requests > 0
      ? this.metrics.api.errorCount / this.metrics.api.requests
      : 0;
    if (errorRate > 0.1) {
      health.issues.push('High error rate detected');
      health.score *= 0.7;
    }

    // Check memory pressure
    if (this.metrics.memory.memoryPressure === 'critical') {
      health.issues.push('Critical memory pressure');
      health.score *= 0.5;
    } else if (this.metrics.memory.memoryPressure === 'warning') {
      health.issues.push('Memory pressure warning');
      health.score *= 0.8;
    }

    // Check system stability
    if (this.metrics.system.crashes > 0) {
      health.issues.push('System crashes detected');
      health.score *= 0.6;
    }

    // Determine overall health
    if (health.score < 0.5) {
      health.overall = 'critical';
    } else if (health.score < 0.7) {
      health.overall = 'warning';
    } else if (health.score < 0.9) {
      health.overall = 'fair';
    }

    return health;
  }

  /**
   * Get performance timeline for analysis
   */
  getTimeline(filterType = null, limit = 100) {
    let timeline = this.timeline;

    if (filterType) {
      timeline = timeline.filter(event => event.type === filterType);
    }

    return timeline.slice(-limit);
  }

  /**
   * Start performance observer
   */
  setupPerformanceObserver() {
    try {
      if (typeof PerformanceObserver !== 'undefined') {
        this.performanceObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          for (const entry of entries) {
            if (entry.name.startsWith('pm_')) {
              // Track our custom performance marks
              this.markEvent('performance_mark', {
                name: entry.name,
                startTime: entry.startTime,
                duration: entry.duration || 0
              });
            }
          }
        });

        this.performanceObserver.observe({ entryTypes: ['mark', 'measure'] });
      }
    } catch (error) {
      this.logger.warn('[PerformanceMonitor] Performance observer setup failed:', error);
    }
  }

  /**
   * Start memory monitoring
   */
  startMemoryMonitoring() {
    this.memoryMonitorTimer = setInterval(() => {
      this.trackMemoryUsage();
    }, 30000); // Every 30 seconds
  }

  /**
   * Start periodic reporting
   */
  startPeriodicReporting() {
    this.reportingTimer = setInterval(() => {
      const report = this.getPerformanceReport();
      this.logger.info('[PerformanceMonitor] Periodic report:', {
        apiRequests: report.metrics.api.requests,
        averageLatency: report.metrics.api.averageLatency.toFixed(0) + 'ms',
        successRate: (report.derived.apiSuccessRate * 100).toFixed(1) + '%',
        memoryPressure: report.metrics.memory.memoryPressure,
        health: report.health.overall
      });
    }, this.options.reportingInterval);
  }

  /**
   * Update translations per minute calculation
   */
  updateTranslationsPerMinute() {
    const now = Date.now();
    const minuteAgo = now - 60000;

    const recentTranslations = this.timeline
      .filter(event => event.type === 'translation_batch' && event.timestamp > minuteAgo)
      .reduce((sum, event) => sum + (event.data.originalCount || 0), 0);

    this.metrics.translation.translationsPerMinute = recentTranslations;
  }

  /**
   * Sampling logic
   */
  shouldSample() {
    return Math.random() < this.options.sampleRate;
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Generate unique request ID
   */
  generateRequestId() {
    return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  }

  /**
   * Generate unique translation ID
   */
  generateTranslationId() {
    return 'trans_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  }

  /**
   * Reset metrics (for testing or cleanup)
   */
  resetMetrics() {
    // Reset all metrics to initial state
    Object.keys(this.metrics).forEach(category => {
      if (typeof this.metrics[category] === 'object') {
        Object.keys(this.metrics[category]).forEach(key => {
          if (typeof this.metrics[category][key] === 'number') {
            this.metrics[category][key] = key.includes('min') ? Infinity : 0;
          } else if (Array.isArray(this.metrics[category][key])) {
            this.metrics[category][key] = [];
          } else if (typeof this.metrics[category][key] === 'object') {
            this.metrics[category][key] = {};
          }
        });
      }
    });

    this.timeline = [];
    this.sessionStartTime = Date.now();
    this.logger.info('[PerformanceMonitor] Metrics reset');
  }

  /**
   * Start tracking a translation request (convenience method)
   */
  startTranslationRequest(textLength) {
    const requestId = this.generateRequestId();
    const request = {
      type: 'translation',
      textLength: textLength,
      timestamp: Date.now()
    };
    this.trackAPIRequest(request);
    return requestId;
  }

  /**
   * End tracking a translation request (convenience method)
   */
  endTranslationRequest(requestId, success, message) {
    const endTime = Date.now();
    const startTime = endTime - 1000; // Estimate start time if not tracked

    if (success) {
      const response = { success: true, message: message };
      this.trackAPIResponse(requestId, startTime, { type: 'translation' }, response);
    } else {
      const error = new Error(message);
      this.trackAPIError(requestId, startTime, { type: 'translation' }, error);
    }
  }

  /**
   * Start tracking a batch translation request (convenience method)
   */
  startBatchTranslationRequest(textCount, totalLength) {
    const requestId = this.generateRequestId();
    const request = {
      type: 'batch_translation',
      textCount: textCount,
      totalLength: totalLength,
      timestamp: Date.now()
    };
    this.trackAPIRequest(request);

    // Store batch context for later use
    this._batchContext = this._batchContext || {};
    this._batchContext[requestId] = { textCount, totalLength };

    return requestId;
  }

  /**
   * End tracking a batch translation request (convenience method)
   */
  endBatchTranslationRequest(requestId, success, message) {
    const endTime = Date.now();
    const startTime = endTime - 2000; // Estimate start time for batch

    // Get batch context
    const batchContext = this._batchContext && this._batchContext[requestId];
    const textCount = batchContext ? batchContext.textCount : 1;

    if (success) {
      const response = { success: true, message: message };
      this.trackAPIResponse(requestId, startTime, { type: 'batch_translation' }, response);

      // Adjust for batch count (trackAPIResponse already added 1, so add remaining count - 1)
      const remainingCount = textCount - 1;
      this.metrics.translation.totalTexts += remainingCount;
      this.metrics.translation.successfulTranslations += remainingCount;

      if (batchContext) {
        this.metrics.translation.totalCharacters += batchContext.totalLength;
        this.metrics.translation.averageTextLength = this.metrics.translation.totalCharacters / this.metrics.translation.totalTexts;
      }
    } else {
      const error = new Error(message);
      this.trackAPIError(requestId, startTime, { type: 'batch_translation' }, error);

      // Track failed translations (trackAPIError doesn't auto-increment, so add full count)
      this.metrics.translation.totalTexts += textCount;
      this.metrics.translation.failedTranslations += textCount;
    }

    // Clean up batch context
    if (this._batchContext && this._batchContext[requestId]) {
      delete this._batchContext[requestId];
    }
  }

  /**
   * Start tracking an API request (convenience method)
   */
  startApiRequest(operation, tokenEstimate) {
    const requestId = this.generateRequestId();
    const request = {
      type: operation,
      tokenEstimate: tokenEstimate,
      timestamp: Date.now()
    };
    this.trackAPIRequest(request);
    return requestId;
  }

  /**
   * End tracking an API request (convenience method)
   */
  endApiRequest(requestId, success, message, responseTokens) {
    const endTime = Date.now();
    const startTime = endTime - 1500; // Estimate start time for API

    if (success) {
      const response = {
        success: true,
        message: message,
        tokens: responseTokens || 0
      };
      this.trackAPIResponse(requestId, startTime, { type: 'api_request' }, response);
    } else {
      const error = new Error(message);
      this.trackAPIError(requestId, startTime, { type: 'api_request' }, error);
    }
  }

  /**
   * Record cache hit (convenience method)
   */
  recordCacheHit(cacheType) {
    if (cacheType === 'session') {
      this.metrics.cache.sessionCacheHits++;
    } else if (cacheType === 'translation-memory') {
      this.metrics.cache.tmCacheHits++;
    }
    this.markEvent('cache_hit', { cacheType });
  }

  /**
   * Record cache miss (convenience method)
   */
  recordCacheMiss(cacheType) {
    if (cacheType === 'session') {
      this.metrics.cache.sessionCacheMisses++;
    } else if (cacheType === 'translation-memory') {
      this.metrics.cache.tmCacheMisses++;
    }
    this.markEvent('cache_miss', { cacheType });
  }

  /**
   * Get cache hit rate (convenience method)
   */
  getCacheHitRate(cacheType) {
    if (cacheType === 'session') {
      const hits = this.metrics.cache.sessionCacheHits;
      const misses = this.metrics.cache.sessionCacheMisses;
      return hits + misses > 0 ? hits / (hits + misses) : 0;
    } else if (cacheType === 'translation-memory') {
      const hits = this.metrics.cache.tmCacheHits;
      const misses = this.metrics.cache.tmCacheMisses;
      return hits + misses > 0 ? hits / (hits + misses) : 0;
    }
    return 0;
  }

  /**
   * Update memory metrics (convenience method)
   */
  updateMemoryMetrics() {
    this.trackMemoryUsage();
  }

  /**
   * Get metrics (convenience method)
   */
  getMetrics() {
    return {
      api: this.metrics.api,
      translation: this.metrics.translation,
      cache: this.metrics.cache,
      memory: this.metrics.memory,
      quality: this.metrics.quality,
      userExperience: this.metrics.userExperience,
      system: this.metrics.system,
      errors: this.metrics.errors
    };
  }

  /**
   * Generate performance report (convenience method)
   */
  generateReport() {
    const report = this.getPerformanceReport();
    return {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      api: report.metrics.api,
      translation: report.metrics.translation,
      cache: report.metrics.cache,
      memory: report.metrics.memory,
      quality: report.metrics.quality,
      userExperience: report.metrics.userExperience,
      system: report.metrics.system,
      errors: report.metrics.errors,
      derived: report.derived,
      health: report.health
    };
  }

  /**
   * Record quality metrics (convenience method)
   */
  recordQualityMetrics(requestId, overallScore, metrics) {
    if (!this.metrics.quality) {
      this.metrics.quality = {
        averageScore: 0,
        totalAssessments: 0,
        scoreSum: 0
      };
    }

    this.metrics.quality.totalAssessments++;
    this.metrics.quality.scoreSum += overallScore;
    this.metrics.quality.averageScore = this.metrics.quality.scoreSum / this.metrics.quality.totalAssessments;

    this.markEvent('quality_assessment', { requestId, overallScore, metrics });
  }

  /**
   * Stop monitoring and cleanup
   */
  destroy() {
    if (this.performanceObserver) {
      this.performanceObserver.disconnect();
    }

    if (this.memoryMonitorTimer) {
      clearInterval(this.memoryMonitorTimer);
    }

    if (this.reportingTimer) {
      clearInterval(this.reportingTimer);
    }

    this.markEvent('monitor_destroyed', {
      sessionDuration: Date.now() - this.sessionStartTime,
      timestamp: Date.now()
    });

    this.logger.info('[PerformanceMonitor] Destroyed');
  }

  /**
   * Configure monitoring options
   */
  configure(newOptions) {
    this.options = { ...this.options, ...newOptions };
    this.logger.info('[PerformanceMonitor] Configuration updated:', newOptions);
  }

  /**
   * Get monitoring statistics
   */
  getStats() {
    return {
      sessionId: this.sessionId,
      sessionDuration: Date.now() - this.sessionStartTime,
      timelineLength: this.timeline.length,
      options: this.options,
      health: this.getSystemHealth(),
      lastReport: this.getPerformanceReport()
    };
  }
}

// Export for different environments
if (typeof window !== 'undefined') {
  window.PerformanceMonitor = PerformanceMonitor;
} else if (typeof self !== 'undefined') {
  self.PerformanceMonitor = PerformanceMonitor;
} else if (typeof module !== 'undefined' && module.exports) {
  module.exports = PerformanceMonitor;
}