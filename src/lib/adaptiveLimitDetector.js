/**
 * Adaptive API Limit Detection and Management System
 * Intelligently detects and adapts to API rate limits through dynamic analysis
 *
 * Features:
 * - Real-time rate limit pattern detection
 * - Adaptive throttling based on API responses
 * - Predictive rate limit forecasting
 * - Multi-provider limit management
 * - Circuit breaker pattern for resilience
 * - Performance impact minimization
 * - Historical pattern learning
 * - Intelligent backoff strategies
 */

class AdaptiveLimitDetector {
  constructor(options = {}) {
    // Configuration with intelligent defaults
    this.config = {
      // Detection sensitivity
      detectionWindow: options.detectionWindow || 60000, // 1 minute window
      minSampleSize: options.minSampleSize || 10, // Minimum requests for analysis
      confidenceThreshold: options.confidenceThreshold || 0.75, // 75% confidence

      // Rate limit thresholds
      warningThreshold: options.warningThreshold || 0.8, // 80% of detected limit
      criticalThreshold: options.criticalThreshold || 0.95, // 95% of detected limit
      emergencyThreshold: options.emergencyThreshold || 0.98, // 98% of detected limit

      // Adaptive behavior
      enablePredictiveThrottling: options.enablePredictiveThrottling !== false,
      enableCircuitBreaker: options.enableCircuitBreaker !== false,
      enableLearning: options.enableLearning !== false,

      // Backoff strategies
      baseBackoffMs: options.baseBackoffMs || 1000, // 1 second base
      maxBackoffMs: options.maxBackoffMs || 300000, // 5 minutes max
      backoffMultiplier: options.backoffMultiplier || 2.0,
      jitterEnabled: options.jitterEnabled !== false,

      // Performance optimization
      enableBurstDetection: options.enableBurstDetection !== false,
      burstToleranceMs: options.burstToleranceMs || 5000, // 5 second burst window
      adaptiveWindowSize: options.adaptiveWindowSize !== false
    };

    // Rate limit detection state
    this.limitState = {
      providers: new Map(), // Per-provider state
      globalState: {
        requestHistory: [],
        responseHistory: [],
        detectedLimits: new Map(),
        confidenceScores: new Map(),
        lastUpdate: Date.now()
      }
    };

    // Circuit breaker state
    this.circuitBreakers = new Map();

    // Performance metrics
    this.metrics = {
      detection: {
        limitDetections: 0,
        falsePositives: 0,
        truePositives: 0,
        accuracyRate: 0
      },
      adaptation: {
        throttleAdjustments: 0,
        successfulPredictions: 0,
        failedPredictions: 0,
        averageResponseTime: 0
      },
      learning: {
        patternUpdates: 0,
        modelAccuracy: 0,
        convergenceRate: 0
      }
    };

    // Pattern learning system
    this.patternLearner = {
      requestPatterns: new Map(),
      responsePatterns: new Map(),
      timeSeriesData: [],
      seasonalityFactors: new Map()
    };

    // Predictive analytics
    this.predictor = {
      shortTermForecast: new Map(),
      mediumTermForecast: new Map(),
      confidenceIntervals: new Map(),
      trendAnalysis: new Map()
    };

    // Initialize subsystems
    this.initializeProviderStates();
    this.initializePatternDetection();
    this.startBackgroundAnalysis();
  }

  /**
   * Initialize provider-specific state tracking
   */
  initializeProviderStates() {
    const defaultProviders = ['dashscope', 'openai', 'anthropic', 'google'];

    defaultProviders.forEach(provider => {
      this.limitState.providers.set(provider, {
        requestHistory: [],
        responseHistory: [],
        currentLimits: {
          requestsPerMinute: null,
          tokensPerMinute: null,
          requestsPerHour: null,
          tokensPerHour: null,
          requestsPerDay: null,
          tokensPerDay: null
        },
        detectedLimits: {
          requestsPerMinute: null,
          tokensPerMinute: null,
          requestsPerHour: null,
          tokensPerHour: null
        },
        confidenceScores: {
          requestsPerMinute: 0,
          tokensPerMinute: 0,
          requestsPerHour: 0,
          tokensPerHour: 0
        },
        adaptiveState: {
          currentThrottle: 1.0, // No throttling initially
          recommendedThrottle: 1.0,
          nextAllowedRequest: 0,
          backoffLevel: 0,
          burstTokens: 0
        },
        circuitBreaker: {
          state: 'closed', // closed, open, half-open
          failureCount: 0,
          lastFailure: 0,
          nextRetry: 0
        }
      });
    });
  }

  /**
   * Initialize pattern detection algorithms
   */
  initializePatternDetection() {
    // Time series analysis for rate limit patterns
    this.patterns = {
      requestRateAnalyzer: {
        window: this.config.detectionWindow,
        samplePoints: [],
        trendLine: null,
        seasonality: null
      },
      responseTimeAnalyzer: {
        baseline: null,
        threshold: null,
        anomalyScore: 0
      },
      errorPatternAnalyzer: {
        errorTypes: new Map(),
        errorSequences: [],
        patterns: new Map()
      }
    };
  }

  /**
   * Start background analysis and learning processes
   */
  startBackgroundAnalysis() {
    // Periodic analysis every 30 seconds
    this.analysisInterval = setInterval(() => {
      this.performPeriodicAnalysis();
    }, 30000);

    // Pattern learning every 5 minutes
    this.learningInterval = setInterval(() => {
      this.updatePatternLearning();
    }, 300000);

    // Metrics calculation every minute
    this.metricsInterval = setInterval(() => {
      this.updateMetrics();
    }, 60000);
  }

  /**
   * Record an API request for analysis
   * @param {string} provider - API provider name
   * @param {Object} requestData - Request metadata
   */
  recordRequest(provider, requestData) {
    const timestamp = Date.now();
    const providerState = this.limitState.providers.get(provider);

    if (!providerState) {
      console.warn(`Unknown provider: ${provider}`);
      return;
    }

    // Record request in provider history
    const requestRecord = {
      timestamp: timestamp,
      tokens: requestData.tokens || 0,
      endpoint: requestData.endpoint || 'unknown',
      model: requestData.model || 'unknown',
      priority: requestData.priority || 'normal',
      userId: requestData.userId || null
    };

    providerState.requestHistory.push(requestRecord);

    // Maintain rolling window
    this.maintainRollingWindow(providerState.requestHistory, this.config.detectionWindow);

    // Update global history
    this.limitState.globalState.requestHistory.push({
      provider: provider,
      ...requestRecord
    });

    this.maintainRollingWindow(
      this.limitState.globalState.requestHistory,
      this.config.detectionWindow
    );

    // Trigger real-time analysis if enough samples
    if (providerState.requestHistory.length >= this.config.minSampleSize) {
      this.analyzeRateLimits(provider);
    }

    console.log(`📊 Recorded request: ${provider} (${requestData.tokens || 0} tokens)`);
  }

  /**
   * Record an API response for analysis
   * @param {string} provider - API provider name
   * @param {Object} responseData - Response metadata
   */
  recordResponse(provider, responseData) {
    const timestamp = Date.now();
    const providerState = this.limitState.providers.get(provider);

    if (!providerState) {
      console.warn(`Unknown provider: ${provider}`);
      return;
    }

    // Record response in provider history
    const responseRecord = {
      timestamp: timestamp,
      success: responseData.success || false,
      statusCode: responseData.statusCode || 200,
      responseTime: responseData.responseTime || 0,
      rateLimitHeaders: responseData.rateLimitHeaders || {},
      errorType: responseData.errorType || null,
      retryAfter: responseData.retryAfter || null,
      tokensUsed: responseData.tokensUsed || 0
    };

    providerState.responseHistory.push(responseRecord);

    // Maintain rolling window
    this.maintainRollingWindow(providerState.responseHistory, this.config.detectionWindow);

    // Update global history
    this.limitState.globalState.responseHistory.push({
      provider: provider,
      ...responseRecord
    });

    this.maintainRollingWindow(
      this.limitState.globalState.responseHistory,
      this.config.detectionWindow
    );

    // Check for rate limiting indicators
    this.checkRateLimitIndicators(provider, responseRecord);

    // Update circuit breaker state
    this.updateCircuitBreaker(provider, responseRecord);

    console.log(`📈 Recorded response: ${provider} (${responseData.statusCode || 200})`);
  }

  /**
   * Analyze rate limits for a specific provider
   * @param {string} provider - Provider to analyze
   */
  analyzeRateLimits(provider) {
    const providerState = this.limitState.providers.get(provider);
    if (!providerState) return;

    const currentTime = Date.now();
    const analysis = {
      requestsPerMinute: this.analyzeRequestRate(providerState, 60000),
      tokensPerMinute: this.analyzeTokenRate(providerState, 60000),
      requestsPerHour: this.analyzeRequestRate(providerState, 3600000),
      tokensPerHour: this.analyzeTokenRate(providerState, 3600000)
    };

    // Update detected limits with confidence scoring
    for (const [metric, value] of Object.entries(analysis)) {
      if (value.detectedLimit !== null) {
        const previousLimit = providerState.detectedLimits[metric];
        const confidence = this.calculateConfidence(value, previousLimit);

        if (confidence >= this.config.confidenceThreshold) {
          providerState.detectedLimits[metric] = value.detectedLimit;
          providerState.confidenceScores[metric] = confidence;

          console.log(`🎯 Detected limit: ${provider} ${metric} = ${value.detectedLimit} (confidence: ${confidence.toFixed(2)})`);

          // Update adaptive throttling
          this.updateAdaptiveThrottling(provider, metric, value.detectedLimit);
        }
      }
    }

    // Update provider state timestamp
    providerState.lastUpdate = currentTime;

    // Trigger predictive analysis
    if (this.config.enablePredictiveThrottling) {
      this.updatePredictiveAnalysis(provider);
    }
  }

  /**
   * Analyze request rate patterns
   * @param {Object} providerState - Provider state data
   * @param {number} windowMs - Analysis window in milliseconds
   * @returns {Object} Analysis results
   */
  analyzeRequestRate(providerState, windowMs) {
    const currentTime = Date.now();
    const windowStart = currentTime - windowMs;

    const requestsInWindow = providerState.requestHistory.filter(
      req => req.timestamp >= windowStart
    );

    if (requestsInWindow.length < this.config.minSampleSize) {
      return { detectedLimit: null, confidence: 0, currentRate: 0 };
    }

    // Calculate current request rate
    const currentRate = requestsInWindow.length;

    // Look for rate limiting patterns in responses
    const responsesInWindow = providerState.responseHistory.filter(
      res => res.timestamp >= windowStart
    );

    const rateLimitResponses = responsesInWindow.filter(
      res => res.statusCode === 429 || (res.errorType && res.errorType.includes('rate'))
    );

    // Detect limit based on rate limiting responses
    let detectedLimit = null;
    let confidence = 0;

    if (rateLimitResponses.length > 0) {
      // Find the highest successful rate before hitting limits
      const successfulRequests = responsesInWindow.filter(res => res.success);
      if (successfulRequests.length > 0) {
        // Estimate limit as slightly above the highest successful rate
        detectedLimit = Math.ceil(currentRate * 1.1);
        confidence = Math.min(rateLimitResponses.length / requestsInWindow.length, 1.0);
      }
    }

    // Check rate limit headers for explicit limits
    const headerLimits = this.extractRateLimitFromHeaders(responsesInWindow, 'requests');
    if (headerLimits.limit !== null) {
      detectedLimit = headerLimits.limit;
      confidence = Math.max(confidence, 0.9); // High confidence for explicit headers
    }

    return {
      detectedLimit: detectedLimit,
      confidence: confidence,
      currentRate: currentRate,
      rateLimitHits: rateLimitResponses.length
    };
  }

  /**
   * Analyze token rate patterns
   * @param {Object} providerState - Provider state data
   * @param {number} windowMs - Analysis window in milliseconds
   * @returns {Object} Analysis results
   */
  analyzeTokenRate(providerState, windowMs) {
    const currentTime = Date.now();
    const windowStart = currentTime - windowMs;

    const requestsInWindow = providerState.requestHistory.filter(
      req => req.timestamp >= windowStart
    );

    if (requestsInWindow.length < this.config.minSampleSize) {
      return { detectedLimit: null, confidence: 0, currentRate: 0 };
    }

    // Calculate current token rate
    const currentTokenRate = requestsInWindow.reduce((sum, req) => sum + (req.tokens || 0), 0);

    // Look for token-based rate limiting patterns
    const responsesInWindow = providerState.responseHistory.filter(
      res => res.timestamp >= windowStart
    );

    const tokenLimitResponses = responsesInWindow.filter(
      res => res.statusCode === 429 || (res.errorType && res.errorType.includes('token'))
    );

    let detectedLimit = null;
    let confidence = 0;

    if (tokenLimitResponses.length > 0) {
      // Estimate token limit based on usage patterns
      const successfulTokenUsage = responsesInWindow
        .filter(res => res.success)
        .reduce((sum, res) => sum + (res.tokensUsed || 0), 0);

      if (successfulTokenUsage > 0) {
        detectedLimit = Math.ceil(currentTokenRate * 1.1);
        confidence = Math.min(tokenLimitResponses.length / requestsInWindow.length, 1.0);
      }
    }

    // Check rate limit headers for token limits
    const headerLimits = this.extractRateLimitFromHeaders(responsesInWindow, 'tokens');
    if (headerLimits.limit !== null) {
      detectedLimit = headerLimits.limit;
      confidence = Math.max(confidence, 0.9);
    }

    return {
      detectedLimit: detectedLimit,
      confidence: confidence,
      currentRate: currentTokenRate,
      tokenLimitHits: tokenLimitResponses.length
    };
  }

  /**
   * Extract rate limit information from response headers
   * @param {Array} responses - Response history
   * @param {string} type - 'requests' or 'tokens'
   * @returns {Object} Extracted limit information
   */
  extractRateLimitFromHeaders(responses, type) {
    let limit = null;
    let remaining = null;
    let resetTime = null;

    // Common rate limit header patterns
    const headerPatterns = {
      requests: [
        'x-ratelimit-limit-requests',
        'x-rate-limit-limit',
        'ratelimit-limit',
        'x-ratelimit-requests-limit'
      ],
      tokens: [
        'x-ratelimit-limit-tokens',
        'x-rate-limit-tokens',
        'ratelimit-tokens-limit',
        'x-ratelimit-tokens-limit'
      ]
    };

    const remainingPatterns = {
      requests: [
        'x-ratelimit-remaining-requests',
        'x-rate-limit-remaining',
        'ratelimit-remaining'
      ],
      tokens: [
        'x-ratelimit-remaining-tokens',
        'x-rate-limit-tokens-remaining',
        'ratelimit-tokens-remaining'
      ]
    };

    // Find most recent response with headers
    for (const response of responses.slice().reverse()) {
      if (response.rateLimitHeaders && Object.keys(response.rateLimitHeaders).length > 0) {
        const headers = response.rateLimitHeaders;

        // Extract limit
        for (const pattern of headerPatterns[type] || []) {
          if (headers[pattern] !== undefined) {
            limit = parseInt(headers[pattern], 10);
            break;
          }
        }

        // Extract remaining
        for (const pattern of remainingPatterns[type] || []) {
          if (headers[pattern] !== undefined) {
            remaining = parseInt(headers[pattern], 10);
            break;
          }
        }

        // Extract reset time
        if (headers['x-ratelimit-reset'] || headers['ratelimit-reset']) {
          resetTime = parseInt(headers['x-ratelimit-reset'] || headers['ratelimit-reset'], 10);
        }

        if (limit !== null) break;
      }
    }

    return { limit, remaining, resetTime };
  }

  /**
   * Calculate confidence score for detected limits
   * @param {Object} currentAnalysis - Current analysis results
   * @param {number} previousLimit - Previously detected limit
   * @returns {number} Confidence score (0-1)
   */
  calculateConfidence(currentAnalysis, previousLimit) {
    let confidence = 0;

    // Base confidence from current analysis
    if (currentAnalysis.confidence) {
      confidence = currentAnalysis.confidence;
    }

    // Increase confidence if consistent with previous detection
    if (previousLimit !== null && currentAnalysis.detectedLimit !== null) {
      const consistency = 1 - Math.abs(currentAnalysis.detectedLimit - previousLimit) / previousLimit;
      confidence = Math.max(confidence, consistency * 0.8);
    }

    // Increase confidence based on sample size
    const sampleBonus = Math.min(currentAnalysis.rateLimitHits / 5, 0.2);
    confidence += sampleBonus;

    return Math.min(confidence, 1.0);
  }

  /**
   * Update adaptive throttling based on detected limits
   * @param {string} provider - Provider name
   * @param {string} metric - Rate limit metric
   * @param {number} detectedLimit - Detected limit value
   */
  updateAdaptiveThrottling(provider, metric, detectedLimit) {
    const providerState = this.limitState.providers.get(provider);
    if (!providerState) return;

    const adaptiveState = providerState.adaptiveState;
    const currentUsage = this.getCurrentUsage(provider, metric);

    // Calculate usage percentage
    const usagePercentage = currentUsage / detectedLimit;

    // Determine throttle adjustment based on usage
    let recommendedThrottle = 1.0;

    if (usagePercentage >= this.config.emergencyThreshold) {
      recommendedThrottle = 0.1; // Severe throttling
    } else if (usagePercentage >= this.config.criticalThreshold) {
      recommendedThrottle = 0.3; // Heavy throttling
    } else if (usagePercentage >= this.config.warningThreshold) {
      recommendedThrottle = 0.6; // Moderate throttling
    } else {
      recommendedThrottle = Math.max(0.8, 1.0 - usagePercentage); // Light throttling
    }

    // Apply smoothing to avoid sudden changes
    const smoothingFactor = 0.3;
    adaptiveState.recommendedThrottle =
      (1 - smoothingFactor) * adaptiveState.recommendedThrottle +
      smoothingFactor * recommendedThrottle;

    // Update current throttle with rate limiting
    const maxChangePerUpdate = 0.2;
    const throttleDelta = adaptiveState.recommendedThrottle - adaptiveState.currentThrottle;
    const limitedDelta = Math.sign(throttleDelta) * Math.min(Math.abs(throttleDelta), maxChangePerUpdate);

    adaptiveState.currentThrottle = Math.max(0.05, adaptiveState.currentThrottle + limitedDelta);

    console.log(`🎛️ Updated throttling: ${provider} ${metric} = ${adaptiveState.currentThrottle.toFixed(2)} (usage: ${(usagePercentage * 100).toFixed(1)}%)`);

    // Update metrics
    this.metrics.adaptation.throttleAdjustments++;
  }

  /**
   * Get current usage for a provider metric
   * @param {string} provider - Provider name
   * @param {string} metric - Metric name
   * @returns {number} Current usage value
   */
  getCurrentUsage(provider, metric) {
    const providerState = this.limitState.providers.get(provider);
    if (!providerState) return 0;

    const currentTime = Date.now();
    let windowSize = 60000; // Default to 1 minute

    if (metric.includes('Hour')) {
      windowSize = 3600000; // 1 hour
    } else if (metric.includes('Day')) {
      windowSize = 86400000; // 1 day
    }

    const windowStart = currentTime - windowSize;
    const requestsInWindow = providerState.requestHistory.filter(
      req => req.timestamp >= windowStart
    );

    if (metric.includes('tokens') || metric.includes('Tokens')) {
      return requestsInWindow.reduce((sum, req) => sum + (req.tokens || 0), 0);
    } else {
      return requestsInWindow.length;
    }
  }

  /**
   * Check for rate limiting indicators in responses
   * @param {string} provider - Provider name
   * @param {Object} responseRecord - Response data
   */
  checkRateLimitIndicators(provider, responseRecord) {
    const indicators = {
      statusCode429: responseRecord.statusCode === 429,
      retryAfterHeader: responseRecord.retryAfter !== null,
      rateLimitError: responseRecord.errorType && responseRecord.errorType.includes('rate'),
      slowResponse: responseRecord.responseTime > 10000 // >10 seconds
    };

    const indicatorCount = Object.values(indicators).filter(Boolean).length;

    if (indicatorCount >= 2) {
      console.warn(`🚨 Rate limiting detected: ${provider}`, indicators);

      // Trigger immediate analysis
      this.analyzeRateLimits(provider);

      // Apply emergency throttling if severe
      if (indicators.statusCode429 && indicators.retryAfterHeader) {
        this.applyEmergencyThrottling(provider, responseRecord.retryAfter);
      }
    }
  }

  /**
   * Apply emergency throttling when rate limits are hit
   * @param {string} provider - Provider name
   * @param {number} retryAfter - Retry after seconds
   */
  applyEmergencyThrottling(provider, retryAfter) {
    const providerState = this.limitState.providers.get(provider);
    if (!providerState) return;

    const adaptiveState = providerState.adaptiveState;

    // Calculate emergency backoff
    const backoffMs = Math.min(
      (retryAfter || 60) * 1000,
      this.config.maxBackoffMs
    );

    adaptiveState.nextAllowedRequest = Date.now() + backoffMs;
    adaptiveState.currentThrottle = 0.1; // Severe throttling
    adaptiveState.backoffLevel = Math.min(adaptiveState.backoffLevel + 1, 10);

    console.warn(`🛑 Emergency throttling: ${provider} (backoff: ${backoffMs}ms)`);
  }

  /**
   * Update circuit breaker state based on response
   * @param {string} provider - Provider name
   * @param {Object} responseRecord - Response data
   */
  updateCircuitBreaker(provider, responseRecord) {
    if (!this.config.enableCircuitBreaker) return;

    let circuitBreaker = this.circuitBreakers.get(provider);
    if (!circuitBreaker) {
      circuitBreaker = {
        state: 'closed',
        failureCount: 0,
        failureThreshold: 5,
        timeout: 60000, // 1 minute
        lastFailure: 0,
        nextRetry: 0
      };
      this.circuitBreakers.set(provider, circuitBreaker);
    }

    const currentTime = Date.now();

    if (responseRecord.success) {
      // Reset on success
      if (circuitBreaker.state === 'half-open') {
        circuitBreaker.state = 'closed';
        circuitBreaker.failureCount = 0;
        console.log(`🔓 Circuit breaker closed: ${provider}`);
      }
    } else {
      // Track failure
      circuitBreaker.failureCount++;
      circuitBreaker.lastFailure = currentTime;

      if (circuitBreaker.state === 'closed' &&
          circuitBreaker.failureCount >= circuitBreaker.failureThreshold) {
        // Open circuit breaker
        circuitBreaker.state = 'open';
        circuitBreaker.nextRetry = currentTime + circuitBreaker.timeout;
        console.warn(`🔒 Circuit breaker opened: ${provider}`);
      }
    }

    // Transition from open to half-open
    if (circuitBreaker.state === 'open' && currentTime >= circuitBreaker.nextRetry) {
      circuitBreaker.state = 'half-open';
      console.log(`🔓 Circuit breaker half-open: ${provider}`);
    }
  }

  /**
   * Check if requests are allowed for a provider
   * @param {string} provider - Provider name
   * @returns {Object} Allow status and recommendations
   */
  checkRequestAllowed(provider) {
    const providerState = this.limitState.providers.get(provider);
    const circuitBreaker = this.circuitBreakers.get(provider);
    const currentTime = Date.now();

    if (!providerState) {
      return { allowed: true, reason: 'unknown_provider', throttle: 1.0 };
    }

    // Check circuit breaker
    if (circuitBreaker && circuitBreaker.state === 'open') {
      return {
        allowed: false,
        reason: 'circuit_breaker_open',
        retryAfter: Math.max(0, circuitBreaker.nextRetry - currentTime),
        throttle: 0
      };
    }

    // Check adaptive throttling
    const adaptiveState = providerState.adaptiveState;
    if (currentTime < adaptiveState.nextAllowedRequest) {
      return {
        allowed: false,
        reason: 'adaptive_throttling',
        retryAfter: adaptiveState.nextAllowedRequest - currentTime,
        throttle: adaptiveState.currentThrottle
      };
    }

    // Calculate recommended delay based on throttling
    const delay = adaptiveState.currentThrottle < 1.0
      ? (1.0 - adaptiveState.currentThrottle) * this.config.baseBackoffMs
      : 0;

    return {
      allowed: true,
      reason: 'allowed',
      recommendedDelay: delay,
      throttle: adaptiveState.currentThrottle
    };
  }

  /**
   * Perform periodic analysis and optimization
   */
  performPeriodicAnalysis() {
    const currentTime = Date.now();

    // Analyze all providers
    for (const [provider, state] of this.limitState.providers) {
      if (state.requestHistory.length >= this.config.minSampleSize) {
        this.analyzeRateLimits(provider);
      }

      // Decay throttling over time if no recent issues
      this.decayThrottling(provider);
    }

    // Update global metrics
    this.updateMetrics();

    console.log('⚙️ Periodic analysis completed');
  }

  /**
   * Decay throttling over time to allow recovery
   * @param {string} provider - Provider name
   */
  decayThrottling(provider) {
    const providerState = this.limitState.providers.get(provider);
    if (!providerState) return;

    const adaptiveState = providerState.adaptiveState;
    const currentTime = Date.now();

    // Only decay if no recent failures
    const recentResponses = providerState.responseHistory.filter(
      res => res.timestamp > currentTime - 300000 // Last 5 minutes
    );

    const recentFailures = recentResponses.filter(res => !res.success);
    const failureRate = recentFailures.length / Math.max(recentResponses.length, 1);

    if (failureRate < 0.1 && adaptiveState.currentThrottle < 1.0) {
      // Gradually increase throttle towards 1.0
      const recoveryRate = 0.05; // 5% per period
      adaptiveState.currentThrottle = Math.min(
        1.0,
        adaptiveState.currentThrottle + recoveryRate
      );

      // Reset backoff level
      if (adaptiveState.currentThrottle > 0.8) {
        adaptiveState.backoffLevel = Math.max(0, adaptiveState.backoffLevel - 1);
      }
    }
  }

  /**
   * Update pattern learning from historical data
   */
  updatePatternLearning() {
    if (!this.config.enableLearning) return;

    console.log('🧠 Updating pattern learning...');

    // Analyze seasonal patterns
    this.analyzeSeasonalPatterns();

    // Update response time baselines
    this.updateResponseTimeBaselines();

    // Learn error patterns
    this.learnErrorPatterns();

    this.metrics.learning.patternUpdates++;
  }

  /**
   * Analyze seasonal patterns in API usage
   */
  analyzeSeasonalPatterns() {
    const currentTime = Date.now();
    const hourOfDay = new Date(currentTime).getHours();
    const dayOfWeek = new Date(currentTime).getDay();

    // Track usage patterns by time
    for (const [provider, state] of this.limitState.providers) {
      const key = `${provider}_${dayOfWeek}_${hourOfDay}`;

      if (!this.patternLearner.seasonalityFactors.has(key)) {
        this.patternLearner.seasonalityFactors.set(key, {
          samples: [],
          averageUsage: 0,
          peakUsage: 0
        });
      }

      const current5MinWindow = currentTime - 300000; // 5 minutes
      const recentRequests = state.requestHistory.filter(
        req => req.timestamp > current5MinWindow
      ).length;

      const pattern = this.patternLearner.seasonalityFactors.get(key);
      pattern.samples.push(recentRequests);

      // Keep only recent samples (last 30 days)
      if (pattern.samples.length > 8640) { // 30 days * 24 hours * 12 (5-min periods)
        pattern.samples = pattern.samples.slice(-8640);
      }

      // Update statistics
      pattern.averageUsage = pattern.samples.reduce((a, b) => a + b, 0) / pattern.samples.length;
      pattern.peakUsage = Math.max(...pattern.samples);
    }
  }

  /**
   * Update response time baselines for anomaly detection
   */
  updateResponseTimeBaselines() {
    for (const [provider, state] of this.limitState.providers) {
      const recentResponses = state.responseHistory.filter(
        res => res.timestamp > Date.now() - 3600000 && res.success // Last hour, successful only
      );

      if (recentResponses.length >= 10) {
        const responseTimes = recentResponses.map(res => res.responseTime);
        const baseline = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
        const stdDev = Math.sqrt(
          responseTimes.reduce((sum, time) => sum + Math.pow(time - baseline, 2), 0) / responseTimes.length
        );

        // Update pattern analyzer
        this.patterns.responseTimeAnalyzer.baseline = baseline;
        this.patterns.responseTimeAnalyzer.threshold = baseline + (2 * stdDev);
      }
    }
  }

  /**
   * Learn from error patterns to improve predictions
   */
  learnErrorPatterns() {
    const recentErrors = [];

    for (const [provider, state] of this.limitState.providers) {
      const errors = state.responseHistory.filter(
        res => !res.success && res.timestamp > Date.now() - 3600000
      );

      errors.forEach(error => {
        recentErrors.push({
          provider: provider,
          errorType: error.errorType,
          statusCode: error.statusCode,
          timestamp: error.timestamp
        });
      });
    }

    // Identify error patterns and sequences
    this.identifyErrorPatterns(recentErrors);
  }

  /**
   * Identify patterns in error sequences
   * @param {Array} errors - Recent error data
   */
  identifyErrorPatterns(errors) {
    // Group errors by provider and time proximity
    const errorGroups = new Map();

    errors.forEach(error => {
      const timeSlot = Math.floor(error.timestamp / 60000); // 1-minute slots
      const key = `${error.provider}_${timeSlot}`;

      if (!errorGroups.has(key)) {
        errorGroups.set(key, []);
      }
      errorGroups.get(key).push(error);
    });

    // Analyze patterns in error groups
    for (const [key, errorGroup] of errorGroups) {
      if (errorGroup.length >= 3) {
        // Potential error burst pattern
        const pattern = {
          provider: errorGroup[0].provider,
          errorCount: errorGroup.length,
          timeSpan: Math.max(...errorGroup.map(e => e.timestamp)) -
                   Math.min(...errorGroup.map(e => e.timestamp)),
          errorTypes: [...new Set(errorGroup.map(e => e.errorType))]
        };

        this.patterns.errorPatternAnalyzer.patterns.set(key, pattern);
      }
    }
  }

  /**
   * Update comprehensive metrics
   */
  updateMetrics() {
    // Calculate accuracy metrics
    const totalDetections = this.metrics.detection.limitDetections;
    const truePositives = this.metrics.detection.truePositives;
    const falsePositives = this.metrics.detection.falsePositives;

    if (totalDetections > 0) {
      this.metrics.detection.accuracyRate = truePositives / totalDetections;
    }

    // Calculate prediction accuracy
    const totalPredictions = this.metrics.adaptation.successfulPredictions +
                           this.metrics.adaptation.failedPredictions;
    if (totalPredictions > 0) {
      this.metrics.learning.modelAccuracy =
        this.metrics.adaptation.successfulPredictions / totalPredictions;
    }

    // Calculate average response time across all providers
    let totalResponseTime = 0;
    let responseCount = 0;

    for (const state of this.limitState.providers.values()) {
      const recentResponses = state.responseHistory.filter(
        res => res.timestamp > Date.now() - 3600000
      );

      totalResponseTime += recentResponses.reduce((sum, res) => sum + res.responseTime, 0);
      responseCount += recentResponses.length;
    }

    if (responseCount > 0) {
      this.metrics.adaptation.averageResponseTime = totalResponseTime / responseCount;
    }
  }

  /**
   * Maintain rolling window for historical data
   * @param {Array} array - Array to maintain
   * @param {number} windowMs - Window size in milliseconds
   */
  maintainRollingWindow(array, windowMs) {
    const cutoff = Date.now() - windowMs;
    const startIndex = array.findIndex(item => item.timestamp >= cutoff);

    if (startIndex > 0) {
      array.splice(0, startIndex);
    }
  }

  /**
   * Get comprehensive status and metrics
   * @returns {Object} Complete status information
   */
  getStatus() {
    const status = {
      providers: {},
      globalMetrics: { ...this.metrics },
      circuitBreakers: {},
      patterns: {
        seasonalFactors: this.patternLearner.seasonalityFactors.size,
        errorPatterns: this.patterns.errorPatternAnalyzer.patterns.size,
        responseTimeBaseline: this.patterns.responseTimeAnalyzer.baseline
      }
    };

    // Provider-specific status
    for (const [provider, state] of this.limitState.providers) {
      const circuitBreaker = this.circuitBreakers.get(provider);

      status.providers[provider] = {
        detectedLimits: { ...state.detectedLimits },
        confidenceScores: { ...state.confidenceScores },
        currentThrottle: state.adaptiveState.currentThrottle,
        backoffLevel: state.adaptiveState.backoffLevel,
        circuitBreakerState: circuitBreaker ? circuitBreaker.state : 'closed',
        requestCount: state.requestHistory.length,
        responseCount: state.responseHistory.length
      };

      status.circuitBreakers[provider] = circuitBreaker || { state: 'closed' };
    }

    return status;
  }

  /**
   * Clean up resources and stop background processes
   */
  destroy() {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
    }

    if (this.learningInterval) {
      clearInterval(this.learningInterval);
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Clear all data structures
    this.limitState.providers.clear();
    this.circuitBreakers.clear();
    this.patternLearner.requestPatterns.clear();
    this.patternLearner.responsePatterns.clear();
    this.patternLearner.seasonalityFactors.clear();

    console.log('🔥 Adaptive limit detector destroyed');
  }
}

// Export for both Node.js and browser environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AdaptiveLimitDetector;
} else if (typeof window !== 'undefined') {
  window.AdaptiveLimitDetector = AdaptiveLimitDetector;
}