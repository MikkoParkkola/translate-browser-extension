/**
 * @fileoverview Standardized error handling for translation providers
 * Integrates with centralized error-handler.js for consistent error management
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenProviderErrorHandler = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  const errorHandler = (typeof self !== 'undefined' && self.qwenErrorHandler) ||
                     (typeof require !== 'undefined' ? require('./error-handler') : null);

  /**
   * Standard provider error types
   */
  const PROVIDER_ERROR_TYPES = {
    NETWORK: 'network',
    AUTHENTICATION: 'authentication', 
    RATE_LIMIT: 'rate_limit',
    INVALID_REQUEST: 'invalid_request',
    INVALID_RESPONSE: 'invalid_response',
    SERVER_ERROR: 'server_error',
    TIMEOUT: 'timeout',
    QUOTA_EXCEEDED: 'quota_exceeded'
  };

  /**
   * Enhanced provider error class
   */
  class ProviderError extends Error {
    constructor(message, type, status, retryable = false, retryAfter = null) {
      super(message);
      this.name = 'ProviderError';
      this.type = type;
      this.status = status;
      this.retryable = retryable;
      this.retryAfter = retryAfter;
      this.code = status ? `HTTP_${status}` : 'PROVIDER_ERROR';
      this.timestamp = new Date().toISOString();
    }
  }

  /**
   * Standardized HTTP error handler for providers
   */
  async function handleHttpError(response, context = {}) {
    const status = response.status;
    let message = response.statusText || 'Unknown error';
    let errorType = PROVIDER_ERROR_TYPES.SERVER_ERROR;
    let retryable = false;
    let retryAfter = null;

    // Extract error message from response body
    try {
      const errorData = await response.json();
      message = errorData.error?.message || 
               errorData.message || 
               errorData.detail ||
               errorData.error ||
               message;
    } catch (e) {
      // Unable to parse error response, use status text
    }

    // Determine error type and retryability based on status
    switch (true) {
      case status === 401 || status === 403:
        errorType = PROVIDER_ERROR_TYPES.AUTHENTICATION;
        retryable = false;
        break;
      case status === 429:
        errorType = PROVIDER_ERROR_TYPES.RATE_LIMIT;
        retryable = true;
        retryAfter = getRetryAfter(response) || 60000; // Default 1 minute
        break;
      case status === 400 || status === 422:
        errorType = PROVIDER_ERROR_TYPES.INVALID_REQUEST;
        retryable = false;
        break;
      case status >= 500:
        errorType = PROVIDER_ERROR_TYPES.SERVER_ERROR;
        retryable = true;
        retryAfter = getRetryAfter(response) || 5000; // Default 5 seconds
        break;
      default:
        errorType = PROVIDER_ERROR_TYPES.NETWORK;
        retryable = false;
    }

    const error = new ProviderError(
      `HTTP ${status}: ${message}`, 
      errorType, 
      status, 
      retryable, 
      retryAfter
    );

    // Use centralized error handler for logging, but still throw
    if (errorHandler) {
      errorHandler.handle(error, {
        operation: 'translation',
        provider: context.provider,
        endpoint: context.endpoint,
        ...context
      }, null, context.logger);
    }

    throw error;
  }

  /**
   * Extract retry-after header value
   */
  function getRetryAfter(response) {
    if (!response.headers || !response.headers.get) return null;
    
    const retryAfter = response.headers.get('retry-after');
    if (!retryAfter) return null;

    // Try parsing as seconds first
    let ms = Number(retryAfter) * 1000;
    if (Number.isFinite(ms)) {
      return Math.max(100, Math.min(ms, 300000)); // Cap at 5 minutes
    }

    // Try parsing as HTTP date
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      ms = Math.max(0, timestamp - Date.now());
      return Math.max(100, Math.min(ms, 300000)); // Cap at 5 minutes
    }

    return null;
  }

  /**
   * Handle network/fetch errors
   */
  function handleNetworkError(error, context = {}) {
    let errorType = PROVIDER_ERROR_TYPES.NETWORK;
    let retryable = true;

    // Categorize network errors
    if (error.name === 'AbortError' || error.message.includes('aborted')) {
      errorType = PROVIDER_ERROR_TYPES.TIMEOUT;
      retryable = false;
    } else if (error.message.includes('timeout')) {
      errorType = PROVIDER_ERROR_TYPES.TIMEOUT;
      retryable = true;
    }

    const providerError = new ProviderError(
      error.message,
      errorType,
      null,
      retryable,
      retryable ? 5000 : null // 5 second retry for network errors
    );

    // Use centralized error handler for logging, but still throw
    if (errorHandler) {
      errorHandler.handle(providerError, {
        operation: 'translation',
        provider: context.provider,
        originalError: error.name,
        ...context
      }, null, context.logger);
    }

    throw providerError;
  }

  /**
   * Handle invalid response errors
   */
  function handleResponseError(message, context = {}) {
    const error = new ProviderError(
      message || 'Invalid API response',
      PROVIDER_ERROR_TYPES.INVALID_RESPONSE,
      null,
      false,
      null
    );

    // Use centralized error handler for logging, but still throw
    if (errorHandler) {
      errorHandler.handle(error, {
        operation: 'translation',
        provider: context.provider,
        ...context
      }, null, context.logger);
    }

    throw error;
  }

  /**
   * Standardized async wrapper for provider operations
   */
  function wrapProviderOperation(operation, context = {}) {
    return async (...args) => {
      try {
        return await operation(...args);
      } catch (error) {
        // If it's already a ProviderError, just re-throw with context
        if (error instanceof ProviderError) {
          if (errorHandler) {
            errorHandler.handle(error, {
              operation: 'translation',
              provider: context.provider,
              ...context
            }, null, context.logger);
          }
          throw error;
        }

        // Handle different error types
        if (error.name === 'AbortError' || error.name === 'TypeError') {
          return handleNetworkError(error, context);
        }

        // Generic error handling
        const providerError = new ProviderError(
          error.message || 'Unknown provider error',
          PROVIDER_ERROR_TYPES.SERVER_ERROR,
          null,
          true,
          5000
        );

        if (errorHandler) {
          errorHandler.handle(providerError, {
            operation: 'translation',
            provider: context.provider,
            originalError: error.name,
            ...context
          }, null, context.logger);
        }

        throw providerError;
      }
    };
  }

  // Public API
  return {
    PROVIDER_ERROR_TYPES,
    ProviderError,
    handleHttpError,
    handleNetworkError,
    handleResponseError,
    wrapProviderOperation
  };

}));