(function (root, factory) {
  const AdaptiveLimitDetector = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AdaptiveLimitDetector;
    module.exports.default = AdaptiveLimitDetector;
  }
  if (root && typeof root === 'object') {
    root.AdaptiveLimitDetector = AdaptiveLimitDetector;
  }
}(typeof self !== 'undefined' ? self : (typeof global !== 'undefined' ? global : this), function (root) {
  const DEFAULTS = {
    detectionWindow: 60000,
    minSampleSize: 5,
    confidenceThreshold: 0.7,
    enableCircuitBreaker: true,
    enablePredictiveThrottling: true,
    autoRecovery: true,
    backoffMultiplier: 2,
    baseBackoffMs: 1000,
    maxAdaptiveDelay: 60000,
    circuitBreakerThreshold: 5,
    recoveryThreshold: 2,
    persistState: false,
  };

  function now() {
    return Date.now();
  }

  function parseRetryAfter(value) {
    if (!value) return 0;
    if (typeof value === 'number' && isFinite(value)) {
      return value > 10 ? value : value * 1000;
    }
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) {
      return numeric > 10 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed - now();
    }
    return 0;
  }

  function coalesceRetry(headers) {
    if (!headers) return 0;
    const lower = {};
    Object.keys(headers).forEach(key => {
      lower[key.toLowerCase()] = headers[key];
    });
    return parseRetryAfter(lower['retry-after'] || lower['x-ratelimit-reset-after'] || lower['x-ratelimit-reset']);
  }

  function createLogger(rootScope) {
    try {
      if (rootScope && rootScope.qwenLogger && typeof rootScope.qwenLogger.create === 'function') {
        return rootScope.qwenLogger.create('adaptive-limit');
      }
    } catch (_) {}
    const base = (typeof console !== 'undefined' ? console : {});
    return {
      info: (...args) => base.info && base.info('[adaptive-limit]', ...args),
      warn: (...args) => base.warn && base.warn('[adaptive-limit]', ...args),
      error: (...args) => base.error && base.error('[adaptive-limit]', ...args),
      debug: (...args) => base.debug && base.debug('[adaptive-limit]', ...args),
    };
  }

  class AdaptiveLimitDetector {
    constructor(options = {}) {
      this.config = Object.assign({}, DEFAULTS, options);
      if (typeof options.adaptiveBackoffBase === 'number') {
        this.config.backoffMultiplier = options.adaptiveBackoffBase;
      }
      if (typeof options.maxBackoffMs === 'number') {
        this.config.maxAdaptiveDelay = options.maxBackoffMs;
      }
      if (typeof options.circuitBreakerThreshold === 'number') {
        this.config.circuitBreakerThreshold = options.circuitBreakerThreshold;
      }

      this.logger = createLogger(root);

      this.providers = new Map();
      this.requests = new Map();
      this.requestCounter = 0;

      this.globalMetrics = {
        requestCount: 0,
        errorCount: 0,
        detected: false,
        confidence: 0,
        lastRateLimit: null,
      };
      this._statusSnapshot = { requestCount: 0, errorCount: 0 };

      this.circuitBreaker = {
        state: 'closed',
        failureCount: 0,
        lastFailure: 0,
        nextRetry: 0,
        probeInFlight: false,
      };
    }

    _ensureProvider(provider) {
      const id = provider || 'global';
      if (!this.providers.has(id)) {
        this.providers.set(id, {
          id,
          requestCount: 0,
          errorCount: 0,
          successCount: 0,
          lastRequest: 0,
          lastResponse: 0,
          rateLimited: false,
          adaptiveDelayMs: 0,
          nextAllowedAt: 0,
          history: [],
        });
      }
      return this.providers.get(id);
    }

    _recordHistory(state, entry) {
      state.history.push(entry);
      if (state.history.length > 50) state.history.shift();
    }

    _applyRateLimit(providerState, delayMs, headers) {
      const boundedDelay = Math.max(0, Math.min(delayMs, this.config.maxAdaptiveDelay));
      const until = now() + boundedDelay;
      providerState.rateLimited = true;
      providerState.adaptiveDelayMs = boundedDelay;
      providerState.nextAllowedAt = until;
      providerState.lastResponse = now();
      this.globalMetrics.detected = true;
      this.globalMetrics.lastRateLimit = providerState.lastResponse;
      this.globalMetrics.confidence = Math.min(1, Math.max(this.globalMetrics.confidence, this.config.confidenceThreshold));
      this.logger.warn('rate limit detected', { provider: providerState.id, delayMs: boundedDelay, headers });
      this._registerFailure(true, boundedDelay);
    }

    _registerFailure(isRateLimit, suggestedDelayMs) {
      if (!this.config.enableCircuitBreaker) return;
      const nowTs = now();
      this.circuitBreaker.failureCount += 1;
      this.circuitBreaker.lastFailure = nowTs;

      if (this.circuitBreaker.state === 'closed' && this.circuitBreaker.failureCount >= this.config.circuitBreakerThreshold) {
        this._openCircuitBreaker(suggestedDelayMs);
      } else if (this.circuitBreaker.state === 'half-open') {
        this._openCircuitBreaker(suggestedDelayMs);
      } else if (this.circuitBreaker.state === 'open' && suggestedDelayMs) {
        this.circuitBreaker.nextRetry = Math.max(this.circuitBreaker.nextRetry, nowTs + suggestedDelayMs);
      }
    }

    _registerSuccess(providerState) {
      if (providerState) {
        providerState.successCount += 1;
        providerState.rateLimited = false;
        providerState.adaptiveDelayMs = 0;
        providerState.nextAllowedAt = 0;
      }
      if (!this.config.enableCircuitBreaker) return;

      if (this.circuitBreaker.state === 'half-open') {
        this.logger.info('circuit breaker recovered');
        this.circuitBreaker.state = 'closed';
        this.circuitBreaker.failureCount = 0;
        this.circuitBreaker.nextRetry = 0;
        this.circuitBreaker.probeInFlight = false;
      } else if (this.circuitBreaker.state === 'open' && this.config.autoRecovery) {
        this.circuitBreaker.failureCount = Math.max(0, this.circuitBreaker.failureCount - 1);
        if (this.circuitBreaker.failureCount === 0) {
          this.circuitBreaker.state = 'closed';
          this.circuitBreaker.nextRetry = 0;
        }
      } else if (this.circuitBreaker.state === 'closed' && this.circuitBreaker.failureCount > 0) {
        this.circuitBreaker.failureCount = Math.max(0, this.circuitBreaker.failureCount - 1);
      }
    }

    _openCircuitBreaker(suggestedDelayMs) {
      const nowTs = now();
      const backoff = suggestedDelayMs || this.config.baseBackoffMs * Math.pow(this.config.backoffMultiplier, this.circuitBreaker.failureCount - this.config.circuitBreakerThreshold + 1);
      const bounded = Math.max(this.config.baseBackoffMs, Math.min(backoff, this.config.maxAdaptiveDelay));
      this.circuitBreaker.state = 'open';
      this.circuitBreaker.nextRetry = nowTs + bounded;
      this.circuitBreaker.probeInFlight = false;
      this.logger.warn('circuit breaker opened', { delayMs: bounded, failureCount: this.circuitBreaker.failureCount });
    }

    checkRequestAllowed(provider) {
      const state = this._ensureProvider(provider);
      const nowTs = now();

      if (state.nextAllowedAt && nowTs < state.nextAllowedAt) {
        return false;
      }

      if (!this.config.enableCircuitBreaker) {
        return true;
      }

      if (this.circuitBreaker.state === 'open') {
        if (nowTs >= this.circuitBreaker.nextRetry) {
          this.circuitBreaker.state = 'half-open';
          this.circuitBreaker.probeInFlight = false;
        } else {
          return false;
        }
      }

      if (this.circuitBreaker.state === 'half-open') {
        if (this.circuitBreaker.probeInFlight) {
          return false;
        }
        this.circuitBreaker.probeInFlight = true;
      }

      return true;
    }

    canMakeRequest(provider) {
      return this.checkRequestAllowed(provider);
    }

    startRequest(requestData = {}) {
      const provider = requestData.provider || requestData.providerId || 'global';
      const allowed = this.checkRequestAllowed(provider);
      if (!allowed) {
        this.logger.debug('request blocked by circuit breaker', { provider });
      }

      const state = this._ensureProvider(provider);
      state.requestCount += 1;
      state.lastRequest = now();
      this._recordHistory(state, { type: 'request', timestamp: state.lastRequest, data: requestData });
      this.globalMetrics.requestCount += 1;

      const id = `req_${++this.requestCounter}_${state.lastRequest}`;
      this.requests.set(id, { provider, timestamp: state.lastRequest, data: requestData });
      return id;
    }

    recordRequest(provider, requestData = {}) {
      const state = this._ensureProvider(provider);
      state.requestCount += 1;
      state.lastRequest = requestData.timestamp || now();
      this._recordHistory(state, { type: 'request', timestamp: state.lastRequest, data: requestData });
      this.globalMetrics.requestCount += 1;
    }

    recordResponse(firstArg, responseData = {}) {
      let providerState;
      let providerId;
      if (this.requests.has(firstArg)) {
        const req = this.requests.get(firstArg);
        providerId = req.provider;
        providerState = this._ensureProvider(providerId);
        this.requests.delete(firstArg);
      } else {
        providerId = firstArg || 'global';
        providerState = this._ensureProvider(providerId);
      }

      const timestamp = responseData.timestamp || now();
      providerState.lastResponse = timestamp;
      this._recordHistory(providerState, { type: 'response', timestamp, data: responseData });

      if (responseData.success === false || (responseData.status && responseData.status >= 400)) {
        providerState.errorCount += 1;
        this.globalMetrics.errorCount += 1;
      } else {
        this._registerSuccess(providerState);
      }

      if (responseData.status === 429 || responseData.isRateLimit) {
        const headerDelay = coalesceRetry(responseData.rateLimitHeaders || responseData.headers || {});
        const suggestedDelay = headerDelay || this.config.baseBackoffMs * this.config.backoffMultiplier;
        this._applyRateLimit(providerState, suggestedDelay, responseData.rateLimitHeaders || responseData.headers);
      } else if (responseData.retryAfterMs) {
        this._applyRateLimit(providerState, responseData.retryAfterMs, responseData.rateLimitHeaders || responseData.headers);
      } else if (providerState.rateLimited && !responseData.success === false) {
        this._registerSuccess(providerState);
      }

      return providerState;
    }

    recordError(firstArg, errorData = {}) {
      let providerState;
      let providerId;
      if (this.requests.has(firstArg)) {
        const req = this.requests.get(firstArg);
        providerId = req.provider;
        providerState = this._ensureProvider(providerId);
        this.requests.delete(firstArg);
      } else {
        providerId = firstArg || 'global';
        providerState = this._ensureProvider(providerId);
      }

      providerState.errorCount += 1;
      providerState.lastResponse = now();
      this.globalMetrics.errorCount += 1;
      this._recordHistory(providerState, { type: 'error', timestamp: providerState.lastResponse, data: errorData });

      const isRateLimit = !!errorData.isRateLimit || errorData.status === 429;
      const delayMs = errorData.retryAfterMs || parseRetryAfter(errorData.retryAfter) || (isRateLimit ? this.config.baseBackoffMs * this.config.backoffMultiplier : 0);
      if (isRateLimit || delayMs) {
        this._applyRateLimit(providerState, delayMs || this.config.baseBackoffMs, {});
      } else {
        this._registerFailure(false, 0);
      }

      return providerState;
    }

    getAdaptiveDelay(provider) {
      const state = this._ensureProvider(provider);
      const nowTs = now();
      const providerDelay = state.nextAllowedAt ? Math.max(0, state.nextAllowedAt - nowTs) : 0;
      const breakerDelay = this.circuitBreaker.state === 'open' ? Math.max(0, this.circuitBreaker.nextRetry - nowTs) : 0;
      const combined = Math.max(providerDelay, breakerDelay);
      return Math.min(this.config.maxAdaptiveDelay, combined);
    }

    getCircuitBreakerState() {
      return {
        state: this.circuitBreaker.state,
        failureCount: this.circuitBreaker.failureCount,
        lastFailure: this.circuitBreaker.lastFailure,
        nextRetry: this.circuitBreaker.nextRetry,
      };
    }

    getStatus() {
      const providers = {};
      for (const [id, state] of this.providers.entries()) {
        providers[id] = {
          requestCount: state.requestCount,
          errorCount: state.errorCount,
          successCount: state.successCount,
          rateLimited: state.rateLimited,
          adaptiveDelayMs: state.adaptiveDelayMs,
          nextAllowedAt: state.nextAllowedAt,
          lastRequest: state.lastRequest,
          lastResponse: state.lastResponse,
        };
      }

      return {
        providers,
        globalMetrics: Object.assign({}, this.globalMetrics),
        circuitBreaker: this.getCircuitBreakerState(),
      };
    }

    getLimitStatus() {
      const snapshot = this._statusSnapshot || { requestCount: 0, errorCount: 0 };
      const requestDelta = this.globalMetrics.requestCount - snapshot.requestCount;
      const errorDelta = this.globalMetrics.errorCount - snapshot.errorCount;
      this._statusSnapshot = {
        requestCount: this.globalMetrics.requestCount,
        errorCount: this.globalMetrics.errorCount,
      };

      return {
        state: this.circuitBreaker.state,
        nextRetry: this.circuitBreaker.nextRetry,
        requestCount: requestDelta,
        errorCount: errorDelta,
        detected: this.globalMetrics.detected,
        confidence: this.globalMetrics.confidence,
        lastRateLimit: this.globalMetrics.lastRateLimit,
        totalRequestCount: this.globalMetrics.requestCount,
        totalErrorCount: this.globalMetrics.errorCount,
      };
    }

    reset() {
      this.providers.clear();
      this.requests.clear();
      this.requestCounter = 0;
      this.globalMetrics = {
        requestCount: 0,
        errorCount: 0,
        detected: false,
        confidence: 0,
        lastRateLimit: null,
      };
      this._statusSnapshot = { requestCount: 0, errorCount: 0 };
      this.circuitBreaker = {
        state: 'closed',
        failureCount: 0,
        lastFailure: 0,
        nextRetry: 0,
        probeInFlight: false,
      };
      this.logger.info('adaptive limit detector reset');
    }
  }

  return AdaptiveLimitDetector;
}));
