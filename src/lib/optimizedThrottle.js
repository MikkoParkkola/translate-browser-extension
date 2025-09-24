/**
 * Optimized Rate limiting and throttling for API requests
 * High-performance throttling with predictive capacity management
 */

import { logger } from './logger.js';
import { secureLogger } from './secureLogging.js';
import { startTimer, endTimer, trackAPICall, trackError } from './performanceTracker.js';

class OptimizedThrottle {
  constructor(options = {}) {
    this.requestLimit = options.requestLimit || 60;
    this.tokenLimit = options.tokenLimit || 100000;
    this.windowMs = options.windowMs || 60000; // 1 minute

    // Use circular buffer for better performance than array filtering
    this.requestBuffer = new Array(this.requestLimit);
    this.requestIndex = 0;
    this.requestCount = 0;

    this.tokens = 0;
    this.tokenResetTime = Date.now() + this.windowMs;

    // Performance optimization: cache calculations
    this.lastCleanupTime = 0;
    this.cleanupInterval = Math.min(10000, this.windowMs / 6); // Cleanup every ~10s

    // Predictive capacity tracking
    this.usageHistory = [];
    this.maxHistorySize = 10;
    this.predictedNextWindow = null;

    this.stats = {
      totalRequests: 0,
      totalTokens: 0,
      rateLimitHits: 0,
      averageTokensPerRequest: 0
    };
  }

  // Optimized cleanup using circular buffer
  cleanupRequestsOptimized() {
    const now = Date.now();

    // Skip cleanup if recently performed
    if (now - this.lastCleanupTime < this.cleanupInterval) {
      return;
    }

    this.lastCleanupTime = now;
    const cutoffTime = now - this.windowMs;
    let validRequests = 0;

    // Count valid requests in circular buffer
    for (let i = 0; i < this.requestCount; i++) {
      const requestTime = this.requestBuffer[i];
      if (requestTime && requestTime > cutoffTime) {
        validRequests++;
      }
    }

    // If significant cleanup needed, rebuild buffer
    if (validRequests < this.requestCount * 0.8) {
      const oldBuffer = [...this.requestBuffer];
      this.requestBuffer.fill(null);
      this.requestIndex = 0;
      this.requestCount = 0;

      // Re-add valid requests
      for (let i = 0; i < oldBuffer.length; i++) {
        const requestTime = oldBuffer[i];
        if (requestTime && requestTime > cutoffTime) {
          this.requestBuffer[this.requestIndex] = requestTime;
          this.requestIndex = (this.requestIndex + 1) % this.requestLimit;
          this.requestCount++;
        }
      }

      logger.debug('OptimizedThrottle', `Cleaned up requests: ${oldBuffer.length} -> ${this.requestCount}`);
    }
  }

  // Check if we can make a request with optimized logic
  canMakeRequest(tokensNeeded = 0) {
    const now = Date.now();

    // Reset token counter if window expired
    if (now > this.tokenResetTime) {
      this.updateUsageHistory();
      this.tokens = 0;
      this.tokenResetTime = now + this.windowMs;
    }

    // Optimized request capacity check
    this.cleanupRequestsOptimized();
    const hasRequestCapacity = this.requestCount < this.requestLimit;
    const hasTokenCapacity = this.tokens + tokensNeeded <= this.tokenLimit;

    // Predictive capacity check for better UX
    if (hasRequestCapacity && hasTokenCapacity) {
      const predictedUsage = this.predictUsage();
      if (predictedUsage.tokens + tokensNeeded > this.tokenLimit * 0.9) {
        logger.debug('OptimizedThrottle', 'Predictive throttling: approaching token limit');
        return false;
      }
    }

    return hasRequestCapacity && hasTokenCapacity;
  }

  // Predict usage based on historical patterns
  predictUsage() {
    if (this.usageHistory.length < 2) {
      return { requests: this.requestCount, tokens: this.tokens };
    }

    const recent = this.usageHistory.slice(-3);
    const avgTokensPerMin = recent.reduce((sum, h) => sum + h.tokens, 0) / recent.length;
    const avgRequestsPerMin = recent.reduce((sum, h) => sum + h.requests, 0) / recent.length;

    const timeElapsed = Date.now() - (this.tokenResetTime - this.windowMs);
    const timeRemaining = this.tokenResetTime - Date.now();
    const progressRatio = timeElapsed / this.windowMs;

    const predictedTokens = this.tokens + (avgTokensPerMin * (timeRemaining / this.windowMs));
    const predictedRequests = this.requestCount + (avgRequestsPerMin * (timeRemaining / this.windowMs));

    return {
      tokens: Math.min(predictedTokens, this.tokenLimit),
      requests: Math.min(predictedRequests, this.requestLimit)
    };
  }

  // Update usage history for trend analysis
  updateUsageHistory() {
    this.usageHistory.push({
      timestamp: Date.now(),
      requests: this.requestCount,
      tokens: this.tokens,
      utilizationRate: this.tokens / this.tokenLimit
    });

    // Keep limited history for performance
    if (this.usageHistory.length > this.maxHistorySize) {
      this.usageHistory.shift();
    }
  }

  // Optimized record usage with circular buffer
  recordUsage(tokensUsed = 0) {
    const now = Date.now();

    // Add to circular buffer
    this.requestBuffer[this.requestIndex] = now;
    this.requestIndex = (this.requestIndex + 1) % this.requestLimit;

    if (this.requestCount < this.requestLimit) {
      this.requestCount++;
    }

    this.tokens += tokensUsed;

    // Update statistics
    this.stats.totalRequests++;
    this.stats.totalTokens += tokensUsed;
    this.stats.averageTokensPerRequest = this.stats.totalTokens / this.stats.totalRequests;
  }

  // Get current usage stats with optimization
  getUsage() {
    const now = Date.now();

    if (now > this.tokenResetTime) {
      this.tokens = 0;
      this.tokenResetTime = now + this.windowMs;
    }

    this.cleanupRequestsOptimized();

    const prediction = this.predictUsage();

    return {
      requests: this.requestCount,
      requestLimit: this.requestLimit,
      tokens: this.tokens,
      tokenLimit: this.tokenLimit,
      resetIn: Math.max(0, this.tokenResetTime - now),
      utilizationRate: this.tokens / this.tokenLimit,
      predicted: prediction,
      stats: { ...this.stats },
      efficiency: this.calculateEfficiency()
    };
  }

  calculateEfficiency() {
    const totalCapacity = this.stats.totalRequests * (this.tokenLimit / this.requestLimit);
    return totalCapacity > 0 ? (this.stats.totalTokens / totalCapacity) : 0;
  }

  // Optimized wait for capacity with smart backoff
  async waitForCapacity(tokensNeeded = 0, maxWaitMs = 30000) {
    const startTime = Date.now();
    let waitCount = 0;

    while (!this.canMakeRequest(tokensNeeded)) {
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error('Rate limit wait timeout');
      }

      // Smart wait timing based on capacity type
      const usage = this.getUsage();
      let waitTime = 1000; // Default 1 second

      if (usage.tokens + tokensNeeded > this.tokenLimit) {
        // Wait for token window reset
        waitTime = Math.min(usage.resetIn, 5000);
      } else if (usage.requests >= this.requestLimit) {
        // Wait for oldest request to expire
        waitTime = Math.min(2000, usage.resetIn / 2);
      }

      secureLogger.debug('OptimizedThrottle',
        `Waiting ${waitTime}ms for capacity (attempt ${++waitCount}`);

      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  // Enhanced rate limit execution with circuit breaker pattern
  async runWithRateLimit(fn, tokensNeeded = 0, retries = 5) {
    const timerId = startTimer('apiCall', { tokensNeeded, retries });

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Wait for capacity with predictive logic
        await this.waitForCapacity(tokensNeeded);

        const result = await fn();
        const executionTime = endTimer(timerId, {
          attempt: attempt + 1,
          success: true
        });

        // Record successful usage
        this.recordUsage(tokensNeeded);

        // Track API call performance
        if (executionTime !== null) {
          trackAPICall('translation', executionTime, true, tokensNeeded);
        }

        secureLogger.debug('OptimizedThrottle',
          `Request completed in ${executionTime?.toFixed(2)}ms`);

        return result;

      } catch (error) {
        this.stats.rateLimitHits++;

        // Track API error
        trackError('OptimizedThrottle', error, {
          attempt: attempt + 1,
          tokensNeeded
        });

        // Smart error detection and backoff
        const isRateLimit = this.isRateLimitError(error);
        const isParameterLimit = error.message?.includes('Parameter limit exceeded');

        if (isRateLimit || isParameterLimit) {
          const backoffTime = this.calculateBackoffTime(attempt, isParameterLimit);

          secureLogger.warn('OptimizedThrottle',
            `${isParameterLimit ? 'Parameter limit' : 'Rate limit'} hit, ` +
            `waiting ${backoffTime}ms before retry ${attempt + 1}/${retries}`);

          await new Promise(resolve => setTimeout(resolve, backoffTime));
          continue;
        }

        // Non-rate-limit error, track and throw immediately
        const executionTime = endTimer(timerId, {
          attempt: attempt + 1,
          success: false,
          error: error.message
        });

        if (executionTime !== null) {
          trackAPICall('translation', executionTime, false, tokensNeeded);
        }

        throw error;
      }
    }

    // Final failure after all retries
    const executionTime = endTimer(timerId, {
      success: false,
      exhaustedRetries: true
    });

    if (executionTime !== null) {
      trackAPICall('translation', executionTime, false, tokensNeeded);
    }

    throw new Error(`Rate limit exceeded after ${retries} attempts`);
  }

  isRateLimitError(error) {
    const message = error.message?.toLowerCase() || '';
    return message.includes('rate limit') ||
           message.includes('429') ||
           message.includes('too many requests') ||
           error.status === 429;
  }

  calculateBackoffTime(attempt, isParameterLimit) {
    const baseWait = isParameterLimit ? 2000 : 1500;
    const backoff = Math.min(
      baseWait * Math.pow(1.4, attempt), // Gentler exponential backoff
      isParameterLimit ? 30000 : 15000   // Cap backoff time
    );

    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 0.1 * backoff;
    return Math.round(backoff + jitter);
  }

  // Get performance insights
  getPerformanceInsights() {
    const usage = this.getUsage();
    return {
      ...usage,
      usageHistory: this.usageHistory.slice(-5), // Last 5 periods
      recommendations: this.generateRecommendations(usage)
    };
  }

  generateRecommendations(usage) {
    const recommendations = [];

    if (usage.utilizationRate > 0.8) {
      recommendations.push('High token utilization detected. Consider implementing request batching.');
    }

    if (this.stats.rateLimitHits > 5) {
      recommendations.push('Frequent rate limits detected. Consider implementing smarter request spacing.');
    }

    if (usage.efficiency < 0.5) {
      recommendations.push('Low efficiency detected. Consider optimizing request sizes.');
    }

    return recommendations;
  }

  // Reset statistics
  resetStats() {
    this.stats = {
      totalRequests: 0,
      totalTokens: 0,
      rateLimitHits: 0,
      averageTokensPerRequest: 0
    };
    this.usageHistory = [];
  }
}

export { OptimizedThrottle };

// For CommonJS compatibility
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { OptimizedThrottle };
}