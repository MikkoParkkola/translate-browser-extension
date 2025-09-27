/**
 * Offline Detection and Graceful Fallbacks System
 *
 * Provides comprehensive offline detection, connectivity monitoring, and graceful
 * fallback mechanisms for robust operation in unstable network conditions.
 *
 * Features:
 * - Real-time connectivity monitoring with multiple detection methods
 * - Intelligent retry mechanisms with exponential backoff
 * - Graceful degradation strategies for offline scenarios
 * - Queue management for pending requests during offline periods
 * - Connection quality assessment and adaptive behavior
 * - Integration with existing caching and storage systems
 */

class OfflineDetector {
  constructor(options = {}) {
    this.config = {
      // Detection settings
      pingInterval: options.pingInterval || 30000, // 30 seconds
      pingTimeout: options.pingTimeout || 5000, // 5 seconds
      connectivityThreshold: options.connectivityThreshold || 3, // Failed pings before offline
      recoveryThreshold: options.recoveryThreshold || 2, // Successful pings before online

      // Retry configuration
      enableRetryQueue: options.enableRetryQueue !== false,
      maxQueueSize: options.maxQueueSize || 100,
      maxRetries: options.maxRetries || 3,
      retryDelayBase: options.retryDelayBase || 1000, // 1 second base
      retryDelayMax: options.retryDelayMax || 60000, // 1 minute max
      retryBackoffFactor: options.retryBackoffFactor || 2,

      // Fallback configuration
      enableFallbacks: options.enableFallbacks !== false,
      enableOfflineStorage: options.enableOfflineStorage !== false,
      enableCachedResponses: options.enableCachedResponses !== false,
      enableQueuedRequests: options.enableQueuedRequests !== false,

      // Quality assessment
      enableQualityMonitoring: options.enableQualityMonitoring !== false,
      qualityPingEndpoints: options.qualityPingEndpoints || [
        'https://www.google.com/favicon.ico',
        'https://www.cloudflare.com/favicon.ico',
        'https://httpbin.org/status/200'
      ],

      // Event handling
      enableEventCallbacks: options.enableEventCallbacks !== false,
      debug: options.debug || false
    };

    // State management
    this.state = {
      isOnline: navigator.onLine || true,
      lastOnlineTime: Date.now(),
      lastOfflineTime: null,
      connectivityChecks: [],
      currentStreak: 0, // consecutive successes or failures
      connectionQuality: 'unknown', // 'excellent', 'good', 'poor', 'offline'
      qualityScore: 0, // 0-100
      qualityInitialized: false,
      lastQualitySource: 'auto'
    };

    // Retry queue for failed requests
    this.retryQueue = new Map(); // requestId -> retry info
    this.pendingRequests = new Set(); // active request IDs

    // Quality monitoring
    this.qualityMetrics = {
      pingTimes: [],
      successRate: 0,
      averageLatency: 0,
      lastAssessment: Date.now()
    };

    // Event callbacks
    this.callbacks = {
      onOnline: [],
      onOffline: [],
      onQualityChange: [],
      onRetrySuccess: [],
      onRetryFailed: [],
      onQueueFull: []
    };

    // Monitoring intervals
    this.pingInterval = null;
    this.qualityInterval = null;

    // Browser event listeners
    this.boundOnlineHandler = this.handleBrowserOnline.bind(this);
    this.boundOfflineHandler = this.handleBrowserOffline.bind(this);

    this.initialize();
  }

  /**
   * Initialize offline detection system
   */
  initialize() {
    this.log('Initializing offline detection system');

    // Set up browser event listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.boundOnlineHandler);
      window.addEventListener('offline', this.boundOfflineHandler);
    }

    // Start connectivity monitoring
    this.startConnectivityMonitoring();

    // Start quality assessment if enabled
    if (this.config.enableQualityMonitoring) {
      this.startQualityMonitoring();
    }

    this.log('Offline detection system initialized');
  }

  /**
   * Start periodic connectivity monitoring
   */
  startConnectivityMonitoring() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      this.checkConnectivity();
    }, this.config.pingInterval);

    // Initial connectivity check
    this.checkConnectivity();
  }

  /**
   * Check network connectivity using multiple methods
   */
  async checkConnectivity() {
    const checkStartTime = Date.now();

    try {
      const results = await Promise.allSettled([
        this.pingEndpoint(this.config.qualityPingEndpoints[0]),
        this.checkNavigatorOnline(),
        this.checkNetworkConnection()
      ]);

      const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
      const isConnected = successCount >= 2; // Majority consensus

      const checkDuration = Date.now() - checkStartTime;

      this.recordConnectivityCheck({
        timestamp: checkStartTime,
        isConnected,
        duration: checkDuration,
        methods: results.map(r => r.status === 'fulfilled' ? r.value : false),
        successCount
      });

      this.updateConnectivityState(isConnected);

    } catch (error) {
      this.log('Connectivity check failed:', error.message);
      this.recordConnectivityCheck({
        timestamp: checkStartTime,
        isConnected: false,
        duration: Date.now() - checkStartTime,
        error: error.message
      });

      this.updateConnectivityState(false);
    }
  }

  /**
   * Ping a specific endpoint to test connectivity
   */
  async pingEndpoint(url, timeout = this.config.pingTimeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'HEAD',
        mode: 'no-cors',
        cache: 'no-cache',
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const duration = Math.max(1, Date.now() - startTime);

      return {
        success: true,
        duration,
        status: response.status || 0
      };

    } catch (error) {
      clearTimeout(timeoutId);

      return {
        success: false,
        error: error.name,
        aborted: error.name === 'AbortError'
      };
    }
  }

  /**
   * Check navigator.onLine property
   */
  checkNavigatorOnline() {
    return Promise.resolve(navigator.onLine);
  }

  /**
   * Check network connection using Network Information API if available
   */
  checkNetworkConnection() {
    return new Promise(resolve => {
      if ('connection' in navigator) {
        const connection = navigator.connection;
        const isConnected = connection.effectiveType !== 'slow-2g' &&
                           connection.downlink > 0;
        resolve(isConnected);
      } else {
        resolve(true); // Default to connected if API not available
      }
    });
  }

  /**
   * Record connectivity check result
   */
  recordConnectivityCheck(result) {
    this.state.connectivityChecks.push(result);

    // Maintain rolling window of checks
    const maxChecks = 20;
    if (this.state.connectivityChecks.length > maxChecks) {
      this.state.connectivityChecks = this.state.connectivityChecks.slice(-maxChecks);
    }

    this.log('Connectivity check recorded:', result);
  }

  /**
   * Update connectivity state based on check results
   */
  updateConnectivityState(isConnected) {
    const wasOnline = this.state.isOnline;
    const currentTime = Date.now();

    if (isConnected === wasOnline) {
      // State unchanged, update streak
      this.state.currentStreak++;
    } else {
      // State change detected
      if (isConnected) {
        // Going online
        if (this.state.currentStreak >= this.config.recoveryThreshold) {
          this.state.isOnline = true;
          this.state.lastOnlineTime = currentTime;
          this.state.currentStreak = 1;

          this.handleOnlineTransition();
        }
      } else {
        // Going offline
        if (this.state.currentStreak >= this.config.connectivityThreshold) {
          this.state.isOnline = false;
          this.state.lastOfflineTime = currentTime;
          this.state.currentStreak = 1;

          this.handleOfflineTransition();
        }
      }
    }

    this.assessConnectionQuality();
  }

  /**
   * Handle transition to online state
   */
  handleOnlineTransition() {
    this.log('Transitioned to ONLINE state');

    // Trigger online callbacks
    this.triggerCallbacks('onOnline', {
      timestamp: Date.now(),
      wasOfflineDuration: this.state.lastOfflineTime ?
        Date.now() - this.state.lastOfflineTime : null
    });

    // Process retry queue
    if (this.config.enableRetryQueue) {
      this.processRetryQueue();
    }
  }

  /**
   * Handle transition to offline state
   */
  handleOfflineTransition() {
    this.log('Transitioned to OFFLINE state');

    // Trigger offline callbacks
    this.triggerCallbacks('onOffline', {
      timestamp: Date.now(),
      wasOnlineDuration: Date.now() - this.state.lastOnlineTime
    });
  }

  /**
   * Browser online event handler
   */
  handleBrowserOnline() {
    this.log('Browser online event detected');
    this.checkConnectivity();
  }

  /**
   * Browser offline event handler
   */
  handleBrowserOffline() {
    this.log('Browser offline event detected');
    this.updateConnectivityState(false);
  }

  /**
   * Start connection quality monitoring
   */
  startQualityMonitoring() {
    if (this.qualityInterval) {
      clearInterval(this.qualityInterval);
    }

    this.qualityInterval = setInterval(() => {
      this.assessConnectionQuality();
    }, this.config.pingInterval * 2); // Less frequent than connectivity checks
  }

  /**
   * Assess connection quality based on recent metrics
   */
  async assessConnectionQuality() {
    if (!this.state.isOnline) {
      this.updateQuality('offline', 0, { source: 'auto' });
      return;
    }

    // Perform quality assessment pings
    const pingPromises = this.config.qualityPingEndpoints.map(endpoint =>
      this.pingEndpoint(endpoint, 3000)
    );

    try {
      const results = await Promise.allSettled(pingPromises);
      const successfulPings = results
        .filter(r => r.status === 'fulfilled' && r.value.success)
        .map(r => r.value);

      if (successfulPings.length === 0) {
        this.updateQuality('poor', 10, { source: 'auto' });
        return;
      }

      // Calculate metrics
      const avgLatency = successfulPings.reduce((sum, ping) => sum + ping.duration, 0) / successfulPings.length;
      const successRate = successfulPings.length / results.length;

      // Update metrics
      this.qualityMetrics.pingTimes.push(...successfulPings.map(p => p.duration));
      this.qualityMetrics.pingTimes = this.qualityMetrics.pingTimes.slice(-20); // Keep last 20
      this.qualityMetrics.successRate = successRate;
      this.qualityMetrics.averageLatency = avgLatency;
      this.qualityMetrics.lastAssessment = Date.now();

      // Determine quality level
      let quality, score;

      if (successRate >= 0.9 && avgLatency < 200) {
        quality = 'excellent';
        score = 90 + Math.min(10, (1 - avgLatency / 200) * 10);
      } else if (successRate >= 0.7 && avgLatency < 500) {
        quality = 'good';
        score = 70 + (successRate - 0.7) * 100 + Math.min(10, (1 - avgLatency / 500) * 10);
      } else if (successRate >= 0.5 && avgLatency < 2000) {
        quality = 'poor';
        score = 30 + (successRate - 0.5) * 100 + Math.min(20, (1 - avgLatency / 2000) * 20);
      } else {
        quality = 'very-poor';
        score = Math.max(5, successRate * 30);
      }

      this.updateQuality(quality, Math.round(score), { source: 'auto' });

    } catch (error) {
      this.log('Quality assessment failed:', error.message);
      this.updateQuality('poor', 20, { source: 'auto' });
    }
  }

  /**
   * Update connection quality state
   */
  updateQuality(quality, score, { source = 'manual' } = {}) {
    const previousQuality = this.state.connectionQuality;

    this.state.connectionQuality = quality;
    this.state.qualityScore = score;
    this.state.qualityInitialized = true;
    this.state.lastQualitySource = source;

    if (quality !== previousQuality) {
      this.log(`Connection quality changed: ${previousQuality} → ${quality} (${score})`);

      this.triggerCallbacks('onQualityChange', {
        quality,
        score,
        previousQuality,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Add request to retry queue with exponential backoff
   */
  addToRetryQueue(requestData, error) {
    if (!this.config.enableRetryQueue) {
      return false;
    }

    if (this.retryQueue.size >= this.config.maxQueueSize) {
      this.triggerCallbacks('onQueueFull', { queueSize: this.retryQueue.size });
      return false;
    }

    const requestId = requestData.id || this.generateRequestId();
    const retryInfo = {
      requestData,
      error,
      attempts: 0,
      maxRetries: this.config.maxRetries,
      nextRetryTime: Date.now() + this.config.retryDelayBase,
      addedTime: Date.now()
    };

    this.retryQueue.set(requestId, retryInfo);
    this.log(`Added request to retry queue: ${requestId}`);

    return true;
  }

  /**
   * Process retry queue for pending requests
   */
  async processRetryQueue() {
    if (!this.state.isOnline || this.retryQueue.size === 0) {
      return;
    }

    this.log(`Processing retry queue: ${this.retryQueue.size} requests`);

    const currentTime = Date.now();
    const readyRequests = Array.from(this.retryQueue.entries())
      .filter(([_, retryInfo]) => retryInfo.nextRetryTime <= currentTime)
      .slice(0, 5); // Process up to 5 requests at once

    for (const [requestId, retryInfo] of readyRequests) {
      try {
        retryInfo.attempts++;

        this.log(`Retrying request ${requestId} (attempt ${retryInfo.attempts})`);

        const result = await this.executeRetryRequest(retryInfo.requestData);

        if (result.success) {
          this.retryQueue.delete(requestId);
          this.triggerCallbacks('onRetrySuccess', {
            requestId,
            attempts: retryInfo.attempts,
            result
          });
        } else {
          this.handleRetryFailure(requestId, retryInfo, result.error);
        }

      } catch (error) {
        this.handleRetryFailure(requestId, retryInfo, error);
      }
    }
  }

  /**
   * Handle retry failure with exponential backoff
   */
  handleRetryFailure(requestId, retryInfo, error) {
    if (retryInfo.attempts >= retryInfo.maxRetries) {
      this.retryQueue.delete(requestId);
      this.triggerCallbacks('onRetryFailed', {
        requestId,
        attempts: retryInfo.attempts,
        error
      });
      this.log(`Request ${requestId} failed after ${retryInfo.attempts} attempts`);
    } else {
      // Calculate exponential backoff delay
      const delay = Math.min(
        this.config.retryDelayBase * Math.pow(this.config.retryBackoffFactor, retryInfo.attempts),
        this.config.retryDelayMax
      );

      retryInfo.nextRetryTime = Date.now() + delay;
      this.log(`Request ${requestId} will retry in ${delay}ms`);
    }
  }

  /**
   * Execute retry request (override in specific implementations)
   */
  async executeRetryRequest(requestData) {
    // This should be overridden by specific implementations
    // Default implementation just returns success
    return { success: true, data: null };
  }

  /**
   * Get comprehensive offline/connectivity status
   */
  getStatus() {
    const recentChecks = this.state.connectivityChecks.slice(-5);
    const successRate = recentChecks.length > 0 ?
      recentChecks.filter(c => c.isConnected).length / recentChecks.length : 0;

    return {
      isOnline: this.state.isOnline,
      connectionQuality: this.state.connectionQuality,
      qualityScore: this.state.qualityScore,
      lastOnlineTime: this.state.lastOnlineTime,
      lastOfflineTime: this.state.lastOfflineTime,
      currentStreak: this.state.currentStreak,

      metrics: {
        recentSuccessRate: successRate,
        averageLatency: this.qualityMetrics.averageLatency,
        checksPerformed: this.state.connectivityChecks.length,
        lastAssessment: this.qualityMetrics.lastAssessment
      },

      retryQueue: {
        size: this.retryQueue.size,
        maxSize: this.config.maxQueueSize,
        pendingRequests: this.pendingRequests.size
      },

      config: {
        enableRetryQueue: this.config.enableRetryQueue,
        enableFallbacks: this.config.enableFallbacks,
        enableQualityMonitoring: this.config.enableQualityMonitoring
      }
    };
  }

  /**
   * Register event callback
   */
  on(event, callback) {
    if (this.callbacks[event]) {
      this.callbacks[event].push(callback);
    }
  }

  /**
   * Trigger event callbacks
   */
  triggerCallbacks(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          this.log(`Callback error for ${event}:`, error.message);
        }
      });
    }
  }

  /**
   * Generate unique request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if online
   */
  isOnline() {
    return this.state.isOnline;
  }

  /**
   * Check if should use fallbacks
   */
  shouldUseFallbacks() {
    if (this.config.debug) {
      console.log('[OfflineDetector] shouldUseFallbacks check', {
        isOnline: this.state.isOnline,
        quality: this.state.connectionQuality,
        initialized: this.state.qualityInitialized,
        source: this.state.lastQualitySource
      });
    }
    if (!this.state.isOnline) return true;
    if (!this.state.qualityInitialized) return false;
    if (this.state.connectionQuality === 'unknown') return false;
    const poorQuality = this.state.connectionQuality === 'poor' ||
                        this.state.connectionQuality === 'very-poor';
    if (!poorQuality) return false;
    const source = this.state.lastQualitySource || 'manual';
    if (source !== 'auto') return true;
    const checks = (this.state.connectivityChecks && this.state.connectivityChecks.length) || 0;
    return checks >= (this.config.connectivityThreshold || 1);
  }

  /**
   * Force connectivity check
   */
  forceConnectivityCheck() {
    this.checkConnectivity();
  }

  /**
   * Clear retry queue
   */
  clearRetryQueue() {
    const clearedCount = this.retryQueue.size;
    this.retryQueue.clear();
    this.log(`Cleared retry queue: ${clearedCount} requests removed`);
    return clearedCount;
  }

  /**
   * Debug logging
   */
  log(...args) {
    if (this.config.debug) {
      console.log('[OfflineDetector]', ...args);
    }
  }

  /**
   * Clean up resources
   */
  destroy() {
    // Clear intervals
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.qualityInterval) {
      clearInterval(this.qualityInterval);
      this.qualityInterval = null;
    }

    // Remove event listeners
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.boundOnlineHandler);
      window.removeEventListener('offline', this.boundOfflineHandler);
    }

    // Clear queues
    this.retryQueue.clear();
    this.pendingRequests.clear();

    this.log('Offline detector destroyed');
  }
}

// Export for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = OfflineDetector;
} else if (typeof window !== 'undefined') {
  window.OfflineDetector = OfflineDetector;
}