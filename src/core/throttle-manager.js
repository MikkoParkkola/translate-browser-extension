/**
 * @fileoverview Rate limiting manager with token bucket algorithm per provider
 * Provides intelligent throttling, queue management, and usage tracking with provider-specific limits
 */

(function (root, factory) {
  const mod = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else {
    root.qwenCoreThrottle = mod;
  }
}(typeof self !== 'undefined' ? self : this, function (root) {

  // Import types and logger for JSDoc
  /// <reference path="./types.js" />
  /// <reference path="./logger.js" />

  /**
   * Throttle error types
   */
  const THROTTLE_ERRORS = {
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    INVALID_PROVIDER: 'INVALID_PROVIDER',
    CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
    INVALID_TOKENS: 'INVALID_TOKENS',
    QUEUE_FULL: 'QUEUE_FULL'
  };

  /**
   * Default throttle configuration
   */
  const DEFAULT_CONFIG = {
    requestLimit: 60,
    tokenLimit: 100000,
    windowMs: 60000,
    maxQueueSize: 1000,
    burstMultiplier: 1.2,
    retryDelayMs: 1000,
    maxRetries: 3
  };

  /**
   * Token bucket state for a provider
   * @typedef {Object} TokenBucket
   * @property {number} tokens - Available tokens
   * @property {number} requests - Available requests
   * @property {number} lastRefill - Last refill timestamp
   * @property {Array<{timestamp: number, tokens: number}>} tokenHistory - Token usage history
   * @property {Array<number>} requestHistory - Request timestamp history
   */

  /**
   * Queued request item
   * @typedef {Object} QueuedRequest
   * @property {string} providerId - Provider identifier
   * @property {number} tokens - Required tokens
   * @property {Function} resolve - Promise resolve function
   * @property {Function} reject - Promise reject function
   * @property {number} timestamp - Queue timestamp
   * @property {number} retries - Retry count
   */

  /**
   * Usage statistics for a provider
   * @typedef {Object} ProviderUsage
   * @property {number} requests - Requests made in current window
   * @property {number} tokens - Tokens used in current window
   * @property {number} requestLimit - Request limit per window
   * @property {number} tokenLimit - Token limit per window
   * @property {number} windowMs - Window duration in milliseconds
   * @property {number} queueSize - Current queue size
   * @property {number} totalRequests - Total requests made
   * @property {number} totalTokens - Total tokens used
   * @property {number} throttledRequests - Number of throttled requests
   */

  /**
   * Approximate token count from text
   * @param {string} text - Input text
   * @returns {number} Approximate token count
   */
  function approximateTokens(text) {
    if (typeof text !== 'string') {
      return 0;
    }
    
    // Improved token estimation:
    // - Average 4 characters per token for Western languages
    // - Average 2 characters per token for CJK languages
    // - Account for punctuation and spacing
    
    const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff]/g;
    const cjkMatches = text.match(cjkRegex);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    const nonCjkCount = text.length - cjkCount;
    
    const estimatedTokens = Math.ceil(cjkCount / 2) + Math.ceil(nonCjkCount / 4);
    return Math.max(1, estimatedTokens);
  }

  /**
   * Create throttle manager instance
   * @param {Object} [globalConfig] - Global throttle configuration
   * @returns {Object} Throttle manager instance
   */
  function createThrottleManager(globalConfig = {}) {
    const logger = (root.qwenCoreLogger && root.qwenCoreLogger.create) 
      ? root.qwenCoreLogger.create('throttle-manager') 
      : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

    const globalCfg = { ...DEFAULT_CONFIG, ...globalConfig };
    
    /** @type {Map<string, Object>} Provider configurations */
    const providerConfigs = new Map();
    
    /** @type {Map<string, TokenBucket>} Token buckets per provider */
    const tokenBuckets = new Map();
    
    /** @type {Array<QueuedRequest>} Global request queue */
    const requestQueue = [];
    
    /** @type {Map<string, number>} Processing locks per provider */
    const processingLocks = new Map();
    
    /** @type {number|null} Queue processing timer */
    let processTimer = null;
    
    /** @type {number} Global statistics */
    let totalThrottledRequests = 0;

    /**
     * Initialize token bucket for a provider
     * @param {string} providerId - Provider identifier
     * @param {Object} config - Provider configuration
     * @returns {TokenBucket} Initialized token bucket
     */
    function initializeTokenBucket(providerId, config) {
      const bucket = {
        tokens: config.tokenLimit,
        requests: config.requestLimit,
        lastRefill: Date.now(),
        tokenHistory: [],
        requestHistory: []
      };
      
      tokenBuckets.set(providerId, bucket);
      logger.debug(`Initialized token bucket for provider: ${providerId}`, {
        tokenLimit: config.tokenLimit,
        requestLimit: config.requestLimit
      });
      
      return bucket;
    }

    /**
     * Refill token bucket based on time elapsed
     * @param {string} providerId - Provider identifier
     */
    function refillTokenBucket(providerId) {
      const config = providerConfigs.get(providerId);
      const bucket = tokenBuckets.get(providerId);
      
      if (!config || !bucket) return;

      const now = Date.now();
      const elapsed = now - bucket.lastRefill;
      
      if (elapsed < 100) return; // Avoid excessive refills
      
      // Calculate refill rates
      const tokenRefillRate = config.tokenLimit / config.windowMs;
      const requestRefillRate = config.requestLimit / config.windowMs;
      
      // Refill tokens and requests
      const tokensToAdd = Math.floor(elapsed * tokenRefillRate);
      const requestsToAdd = Math.floor(elapsed * requestRefillRate);
      
      bucket.tokens = Math.min(config.tokenLimit, bucket.tokens + tokensToAdd);
      bucket.requests = Math.min(config.requestLimit, bucket.requests + requestsToAdd);
      bucket.lastRefill = now;
      
      // Clean up old history entries
      const cutoff = now - config.windowMs;
      bucket.tokenHistory = bucket.tokenHistory.filter(entry => entry.timestamp > cutoff);
      bucket.requestHistory = bucket.requestHistory.filter(timestamp => timestamp > cutoff);
    }

    /**
     * Record token and request usage
     * @param {string} providerId - Provider identifier
     * @param {number} tokens - Tokens used
     */
    function recordUsage(providerId, tokens) {
      const bucket = tokenBuckets.get(providerId);
      if (!bucket) return;

      const now = Date.now();
      
      bucket.tokenHistory.push({ timestamp: now, tokens });
      bucket.requestHistory.push(now);
      
      // Update bucket counts
      bucket.tokens = Math.max(0, bucket.tokens - tokens);
      bucket.requests = Math.max(0, bucket.requests - 1);
      
      logger.debug(`Recorded usage for ${providerId}: ${tokens} tokens`, {
        remainingTokens: bucket.tokens,
        remainingRequests: bucket.requests
      });
    }

    /**
     * Check if request can be processed immediately
     * @param {string} providerId - Provider identifier
     * @param {number} tokens - Required tokens
     * @returns {boolean} True if request can be processed
     */
    function canProcessImmediate(providerId, tokens) {
      const config = providerConfigs.get(providerId);
      const bucket = tokenBuckets.get(providerId);
      
      if (!config || !bucket) return false;
      
      refillTokenBucket(providerId);
      
      return bucket.requests > 0 && bucket.tokens >= tokens;
    }

    /**
     * Calculate wait time for a request
     * @param {string} providerId - Provider identifier
     * @param {number} tokens - Required tokens
     * @returns {number} Wait time in milliseconds
     */
    function calculateWaitTime(providerId, tokens) {
      const config = providerConfigs.get(providerId);
      const bucket = tokenBuckets.get(providerId);
      
      if (!config || !bucket) return 0;
      
      const tokenRefillRate = config.tokenLimit / config.windowMs;
      const requestRefillRate = config.requestLimit / config.windowMs;
      
      const tokenWait = tokens > bucket.tokens ? 
        (tokens - bucket.tokens) / tokenRefillRate : 0;
      const requestWait = bucket.requests <= 0 ? 
        1 / requestRefillRate : 0;
      
      return Math.max(tokenWait, requestWait);
    }

    /**
     * Process queued requests
     */
    function processQueue() {
      if (processTimer) {
        clearTimeout(processTimer);
        processTimer = null;
      }
      
      if (requestQueue.length === 0) return;
      
      const now = Date.now();
      let processed = 0;
      const maxBatchSize = 10; // Process up to 10 requests per batch
      
      // Sort queue by priority (timestamp for FIFO)
      requestQueue.sort((a, b) => a.timestamp - b.timestamp);
      
      for (let i = requestQueue.length - 1; i >= 0 && processed < maxBatchSize; i--) {
        const request = requestQueue[i];
        
        // Check for expired requests
        if (now - request.timestamp > 60000) { // 60 second timeout
          requestQueue.splice(i, 1);
          request.reject(new Error(`${THROTTLE_ERRORS.RATE_LIMIT_EXCEEDED}: Request timeout`));
          continue;
        }
        
        // Check if request can be processed
        if (canProcessImmediate(request.providerId, request.tokens)) {
          requestQueue.splice(i, 1);
          recordUsage(request.providerId, request.tokens);
          request.resolve();
          processed++;
        }
      }
      
      // Schedule next processing if queue is not empty
      if (requestQueue.length > 0) {
        const nextDelay = Math.min(1000, globalCfg.retryDelayMs);
        processTimer = setTimeout(processQueue, nextDelay);
      }
      
      if (processed > 0) {
        logger.debug(`Processed ${processed} queued requests, ${requestQueue.length} remaining`);
      }
    }

    /**
     * Configure provider-specific throttling
     * @param {string} providerId - Provider identifier
     * @param {Object} limits - Throttle configuration
     * @throws {Error} For invalid configuration
     */
    function configure(providerId, limits) {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error(`${THROTTLE_ERRORS.INVALID_PROVIDER}: Provider ID must be a non-empty string`);
      }
      
      if (!limits || typeof limits !== 'object') {
        throw new Error(`${THROTTLE_ERRORS.CONFIGURATION_ERROR}: Limits must be an object`);
      }
      
      // Validate configuration
      const config = { ...globalCfg, ...limits };
      
      if (config.requestLimit <= 0 || !isFinite(config.requestLimit)) {
        throw new Error(`${THROTTLE_ERRORS.CONFIGURATION_ERROR}: requestLimit must be a positive finite number`);
      }
      
      if (config.tokenLimit <= 0 || !isFinite(config.tokenLimit)) {
        throw new Error(`${THROTTLE_ERRORS.CONFIGURATION_ERROR}: tokenLimit must be a positive finite number`);
      }
      
      if (config.windowMs <= 0 || !isFinite(config.windowMs)) {
        throw new Error(`${THROTTLE_ERRORS.CONFIGURATION_ERROR}: windowMs must be a positive finite number`);
      }
      
      providerConfigs.set(providerId, config);
      
      // Initialize or update token bucket
      if (tokenBuckets.has(providerId)) {
        const bucket = tokenBuckets.get(providerId);
        // Adjust existing bucket to new limits
        bucket.tokens = Math.min(bucket.tokens, config.tokenLimit);
        bucket.requests = Math.min(bucket.requests, config.requestLimit);
      } else {
        initializeTokenBucket(providerId, config);
      }
      
      logger.info(`Configured throttling for provider: ${providerId}`, config);
    }

    /**
     * Request permission to make an API call
     * @param {string} providerId - Provider identifier
     * @param {number|string} tokens - Required tokens (number) or text to estimate
     * @returns {Promise<void>} Resolves when request can proceed
     * @throws {Error} For rate limiting or configuration errors
     */
    function requestPermission(providerId, tokens) {
      return new Promise((resolve, reject) => {
        try {
          if (!providerId || typeof providerId !== 'string') {
            throw new Error(`${THROTTLE_ERRORS.INVALID_PROVIDER}: Provider ID must be a non-empty string`);
          }
          
          if (!providerConfigs.has(providerId)) {
            throw new Error(`${THROTTLE_ERRORS.INVALID_PROVIDER}: Provider not configured: ${providerId}`);
          }
          
          // Convert text to token count if needed
          let tokenCount;
          if (typeof tokens === 'string') {
            tokenCount = approximateTokens(tokens);
          } else if (typeof tokens === 'number' && isFinite(tokens) && tokens >= 0) {
            tokenCount = Math.ceil(tokens);
          } else {
            throw new Error(`${THROTTLE_ERRORS.INVALID_TOKENS}: Tokens must be a positive number or string`);
          }
          
          const config = providerConfigs.get(providerId);
          
          // Check token limit
          if (tokenCount > config.tokenLimit) {
            throw new Error(`${THROTTLE_ERRORS.RATE_LIMIT_EXCEEDED}: Request exceeds token limit (${tokenCount} > ${config.tokenLimit})`);
          }
          
          // Check queue size
          if (requestQueue.length >= globalCfg.maxQueueSize) {
            throw new Error(`${THROTTLE_ERRORS.QUEUE_FULL}: Request queue is full`);
          }
          
          // Try immediate processing
          if (canProcessImmediate(providerId, tokenCount)) {
            recordUsage(providerId, tokenCount);
            resolve();
            return;
          }
          
          // Queue the request
          const queuedRequest = {
            providerId,
            tokens: tokenCount,
            resolve,
            reject,
            timestamp: Date.now(),
            retries: 0
          };
          
          requestQueue.push(queuedRequest);
          totalThrottledRequests++;
          
          logger.debug(`Queued request for provider: ${providerId}`, {
            tokens: tokenCount,
            queueSize: requestQueue.length
          });
          
          // Start processing if not already running
          if (!processTimer) {
            processTimer = setTimeout(processQueue, 100);
          }
          
        } catch (error) {
          reject(error);
        }
      });
    }

    /**
     * Get usage statistics for a provider
     * @param {string} providerId - Provider identifier
     * @returns {ProviderUsage} Usage statistics
     * @throws {Error} For invalid provider
     */
    function getUsage(providerId) {
      if (!providerId || typeof providerId !== 'string') {
        throw new Error(`${THROTTLE_ERRORS.INVALID_PROVIDER}: Provider ID must be a non-empty string`);
      }
      
      if (!providerConfigs.has(providerId)) {
        throw new Error(`${THROTTLE_ERRORS.INVALID_PROVIDER}: Provider not configured: ${providerId}`);
      }
      
      const config = providerConfigs.get(providerId);
      const bucket = tokenBuckets.get(providerId);
      
      if (!bucket) {
        return {
          requests: 0,
          tokens: 0,
          requestLimit: config.requestLimit,
          tokenLimit: config.tokenLimit,
          windowMs: config.windowMs,
          queueSize: 0,
          totalRequests: 0,
          totalTokens: 0,
          throttledRequests: 0
        };
      }
      
      refillTokenBucket(providerId);
      
      // Calculate current usage
      const now = Date.now();
      const cutoff = now - config.windowMs;
      
      const currentRequests = bucket.requestHistory.filter(ts => ts > cutoff).length;
      const currentTokens = bucket.tokenHistory
        .filter(entry => entry.timestamp > cutoff)
        .reduce((sum, entry) => sum + entry.tokens, 0);
      
      const totalRequests = bucket.requestHistory.length;
      const totalTokens = bucket.tokenHistory.reduce((sum, entry) => sum + entry.tokens, 0);
      
      const providerQueueSize = requestQueue.filter(req => req.providerId === providerId).length;
      
      return {
        requests: currentRequests,
        tokens: currentTokens,
        requestLimit: config.requestLimit,
        tokenLimit: config.tokenLimit,
        windowMs: config.windowMs,
        queueSize: providerQueueSize,
        totalRequests,
        totalTokens,
        throttledRequests: totalThrottledRequests
      };
    }

    /**
     * Get all configured providers
     * @returns {string[]} Array of provider IDs
     */
    function getProviders() {
      return Array.from(providerConfigs.keys());
    }

    /**
     * Remove provider configuration
     * @param {string} providerId - Provider identifier
     * @returns {boolean} True if provider was removed
     */
    function removeProvider(providerId) {
      const removed = providerConfigs.delete(providerId);
      if (removed) {
        tokenBuckets.delete(providerId);
        processingLocks.delete(providerId);
        
        // Remove queued requests for this provider
        const removedRequests = [];
        for (let i = requestQueue.length - 1; i >= 0; i--) {
          if (requestQueue[i].providerId === providerId) {
            removedRequests.push(requestQueue.splice(i, 1)[0]);
          }
        }
        
        // Reject all removed requests
        removedRequests.forEach(request => {
          request.reject(new Error(`${THROTTLE_ERRORS.INVALID_PROVIDER}: Provider removed: ${providerId}`));
        });
        
        logger.info(`Removed throttling configuration for provider: ${providerId}`);
      }
      
      return removed;
    }

    /**
     * Clear all queued requests
     */
    function clearQueue() {
      const queueSize = requestQueue.length;
      
      // Copy queue and clear it first to avoid race conditions
      const requestsToReject = requestQueue.splice(0);
      
      // Reject all requests
      requestsToReject.forEach(request => {
        try {
          request.reject(new Error(`${THROTTLE_ERRORS.RATE_LIMIT_EXCEEDED}: Queue cleared`));
        } catch (error) {
          // Ignore rejection errors
        }
      });
      
      if (processTimer) {
        clearTimeout(processTimer);
        processTimer = null;
      }
      
      logger.info(`Cleared ${queueSize} queued requests`);
    }

    /**
     * Reset usage statistics for a provider
     * @param {string} [providerId] - Provider identifier (optional, resets all if not specified)
     */
    function resetUsage(providerId) {
      if (providerId) {
        const bucket = tokenBuckets.get(providerId);
        if (bucket) {
          bucket.tokenHistory = [];
          bucket.requestHistory = [];
          logger.info(`Reset usage statistics for provider: ${providerId}`);
        }
      } else {
        // Reset all providers
        for (const bucket of tokenBuckets.values()) {
          bucket.tokenHistory = [];
          bucket.requestHistory = [];
        }
        totalThrottledRequests = 0;
        logger.info('Reset usage statistics for all providers');
      }
    }

    // Cleanup function
    function cleanup() {
      if (processTimer) {
        clearTimeout(processTimer);
        processTimer = null;
      }
      clearQueue();
    }

    // Register cleanup handlers
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', cleanup);
    } else if (typeof process !== 'undefined') {
      process.on('exit', cleanup);
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
    }

    // Public API
    return {
      configure,
      requestPermission,
      getUsage,
      getProviders,
      removeProvider,
      clearQueue,
      resetUsage,
      
      // Utility functions
      approximateTokens,
      
      // Internal state for testing
      _getInternalState() {
        return {
          providerConfigs,
          tokenBuckets,
          requestQueue: requestQueue.slice(),
          totalThrottledRequests
        };
      }
    };
  }

  // Export factory and constants
  return {
    createThrottleManager,
    approximateTokens,
    THROTTLE_ERRORS,
    DEFAULT_CONFIG,
    version: '1.0.0'
  };

}));