/**
 * Unified Error Management System for Qwen Translator Extension
 * 
 * This module provides centralized error handling, custom error classes,
 * retry logic, recovery strategies, and error reporting capabilities.
 * 
 * @module ErrorManager
 */

// Load dependencies
let logger = console;
try {
  if (typeof window !== 'undefined' && window.qwenLogger) {
    logger = window.qwenLogger.create('error-manager');
  } else if (typeof self !== 'undefined' && self.qwenLogger) {
    logger = self.qwenLogger.create('error-manager');
  } else if (typeof require !== 'undefined') {
    logger = require('./logger').create('error-manager');
  }
} catch {}

// ==============================================================================
// CUSTOM ERROR CLASSES
// ==============================================================================

/**
 * Base class for all Qwen extension errors
 */
class QwenError extends Error {
  constructor(message, code, context = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    this.timestamp = new Date().toISOString();
    this.retryable = false;
    this.recoverable = false;
    this.severity = 'medium';
    
    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      timestamp: this.timestamp,
      retryable: this.retryable,
      recoverable: this.recoverable,
      severity: this.severity,
      stack: this.stack
    };
  }
}

/**
 * Translation-related errors
 */
class TranslationError extends QwenError {
  constructor(message, code, context = {}) {
    super(message, code, context);
    this.category = 'translation';
    this.retryable = true;
    this.recoverable = true;
  }
}

class TranslationTimeoutError extends TranslationError {
  constructor(timeout, context = {}) {
    super(`Translation request timed out after ${timeout}ms`, 'TRANSLATION_TIMEOUT', context);
    this.timeout = timeout;
    this.severity = 'high';
  }
}

class ProviderError extends TranslationError {
  constructor(provider, message, context = {}) {
    super(`Provider ${provider} error: ${message}`, 'PROVIDER_ERROR', context);
    this.provider = provider;
    this.retryable = true;
  }
}

class BatchSizeExceededError extends TranslationError {
  constructor(size, limit, context = {}) {
    super(`Batch size ${size} exceeds limit ${limit}`, 'BATCH_SIZE_EXCEEDED', context);
    this.batchSize = size;
    this.limit = limit;
    this.recoverable = true;
    this.severity = 'low';
  }
}

/**
 * Storage-related errors
 */
class StorageError extends QwenError {
  constructor(message, code, context = {}) {
    super(message, code, context);
    this.category = 'storage';
    this.retryable = true;
  }
}

class ValidationError extends QwenError {
  constructor(field, value, expected, context = {}) {
    super(`Validation failed for ${field}: expected ${expected}, got ${value}`, 'VALIDATION_ERROR', context);
    this.category = 'validation';
    this.field = field;
    this.value = value;
    this.expected = expected;
    this.severity = 'low';
  }
}

class QuotaExceededError extends StorageError {
  constructor(quota, context = {}) {
    super(`Storage quota exceeded: ${quota}`, 'QUOTA_EXCEEDED', context);
    this.quota = quota;
    this.severity = 'high';
    this.recoverable = true;
  }
}

/**
 * Rate limiting errors
 */
class RateLimitError extends QwenError {
  constructor(limit, retryAfter, context = {}) {
    super(`Rate limit exceeded: ${limit}`, 'RATE_LIMIT_EXCEEDED', context);
    this.category = 'rate_limit';
    this.limit = limit;
    this.retryAfter = retryAfter;
    this.retryable = true;
    this.severity = 'medium';
  }
}

class InvalidProviderError extends QwenError {
  constructor(provider, context = {}) {
    super(`Invalid or unsupported provider: ${provider}`, 'INVALID_PROVIDER', context);
    this.category = 'configuration';
    this.provider = provider;
    this.severity = 'high';
  }
}

class ConfigurationError extends QwenError {
  constructor(setting, message, context = {}) {
    super(`Configuration error for ${setting}: ${message}`, 'CONFIGURATION_ERROR', context);
    this.category = 'configuration';
    this.setting = setting;
    this.severity = 'high';
  }
}

/**
 * Cache-related errors
 */
class CacheError extends QwenError {
  constructor(message, code, context = {}) {
    super(message, code, context);
    this.category = 'cache';
    this.retryable = true;
  }
}

class CacheFullError extends CacheError {
  constructor(size, limit, context = {}) {
    super(`Cache full: ${size}/${limit}`, 'CACHE_FULL', context);
    this.size = size;
    this.limit = limit;
    this.recoverable = true;
    this.severity = 'low';
  }
}

class SerializationError extends CacheError {
  constructor(operation, data, context = {}) {
    super(`Serialization failed during ${operation}`, 'SERIALIZATION_ERROR', context);
    this.operation = operation;
    this.data = typeof data === 'string' ? data.slice(0, 100) : String(data).slice(0, 100);
    this.severity = 'medium';
  }
}

/**
 * Messaging-related errors
 */
class MessagingError extends QwenError {
  constructor(message, code, context = {}) {
    super(message, code, context);
    this.category = 'messaging';
    this.retryable = true;
  }
}

class MessageTimeoutError extends MessagingError {
  constructor(timeout, context = {}) {
    super(`Message timeout after ${timeout}ms`, 'MESSAGE_TIMEOUT', context);
    this.timeout = timeout;
    this.severity = 'medium';
  }
}

class ContextInvalidatedError extends MessagingError {
  constructor(context = {}) {
    super('Extension context invalidated', 'CONTEXT_INVALIDATED', context);
    this.severity = 'high';
    this.retryable = false;
  }
}

class TabNotFoundError extends MessagingError {
  constructor(tabId, context = {}) {
    super(`Tab ${tabId} not found or not accessible`, 'TAB_NOT_FOUND', context);
    this.tabId = tabId;
    this.severity = 'medium';
  }
}

/**
 * PDF-related errors
 */
class PdfError extends QwenError {
  constructor(message, code, context = {}) {
    super(message, code, context);
    this.category = 'pdf';
    this.retryable = true;
  }
}

class PdfLoadError extends PdfError {
  constructor(url, reason, context = {}) {
    super(`Failed to load PDF from ${url}: ${reason}`, 'PDF_LOAD_ERROR', context);
    this.url = url;
    this.reason = reason;
    this.severity = 'high';
  }
}

class ViewerError extends PdfError {
  constructor(operation, reason, context = {}) {
    super(`PDF viewer ${operation} failed: ${reason}`, 'VIEWER_ERROR', context);
    this.operation = operation;
    this.reason = reason;
    this.severity = 'medium';
  }
}

// ==============================================================================
// ERROR MANAGER CLASS
// ==============================================================================

class ErrorManager {
  constructor(options = {}) {
    this.options = {
      maxRetries: 3,
      baseDelay: 1000,
      maxDelay: 30000,
      enableAnalytics: true,
      enableReporting: true,
      logLevel: 'error',
      ...options
    };

    this.errorCounts = new Map();
    this.errorHistory = [];
    this.maxHistorySize = options.maxHistorySize || 100;
    this.listeners = new Set();
    this.recoveryStrategies = new Map();
    
    this._setupDefaultRecoveryStrategies();
    this._setupGlobalErrorHandlers();
  }

  /**
   * Create a typed error instance
   */
  createError(type, ...args) {
    const errorClasses = {
      'translation-timeout': TranslationTimeoutError,
      'provider-error': ProviderError,
      'batch-size-exceeded': BatchSizeExceededError,
      'storage-error': StorageError,
      'validation-error': ValidationError,
      'quota-exceeded': QuotaExceededError,
      'rate-limit-exceeded': RateLimitError,
      'invalid-provider': InvalidProviderError,
      'configuration-error': ConfigurationError,
      'cache-full': CacheFullError,
      'serialization-error': SerializationError,
      'message-timeout': MessageTimeoutError,
      'context-invalidated': ContextInvalidatedError,
      'tab-not-found': TabNotFoundError,
      'pdf-load-error': PdfLoadError,
      'viewer-error': ViewerError
    };

    const ErrorClass = errorClasses[type] || QwenError;
    return new ErrorClass(...args);
  }

  /**
   * Handle an error with automatic recovery and reporting
   */
  async handleError(error, context = {}) {
    const qwenError = error instanceof QwenError ? error : this._wrapError(error, context);
    
    // Log the error
    this._logError(qwenError, context);
    
    // Track error metrics
    this._trackError(qwenError);
    
    // Add to history
    this._addToHistory(qwenError, context);
    
    // Notify listeners
    this._notifyListeners(qwenError, context);
    
    // Attempt recovery if possible
    if (qwenError.recoverable) {
      try {
        const recovered = await this._attemptRecovery(qwenError, context);
        if (recovered) {
          logger.info('Error recovered successfully', { error: qwenError.code, context });
          return { recovered: true, result: recovered };
        }
      } catch (recoveryError) {
        logger.error('Recovery failed', { originalError: qwenError.code, recoveryError: recoveryError.message });
      }
    }

    return { recovered: false, error: qwenError };
  }

  /**
   * Execute a function with automatic retry logic
   */
  async withRetry(fn, options = {}) {
    const config = {
      maxRetries: this.options.maxRetries,
      baseDelay: this.options.baseDelay,
      maxDelay: this.options.maxDelay,
      retryCondition: (error) => error.retryable,
      onRetry: null,
      ...options
    };

    let lastError;
    let attempt = 0;

    while (attempt <= config.maxRetries) {
      try {
        const result = await fn(attempt);
        
        // Reset error count on success
        if (attempt > 0 && lastError) {
          this._resetErrorCount(lastError.code);
        }
        
        return result;
      } catch (error) {
        lastError = error instanceof QwenError ? error : this._wrapError(error);
        attempt++;

        // Check if we should retry
        if (attempt > config.maxRetries || !config.retryCondition(lastError)) {
          break;
        }

        // Calculate delay with exponential backoff + jitter
        const delay = Math.min(
          config.baseDelay * Math.pow(2, attempt - 1),
          config.maxDelay
        );
        const jitter = delay * 0.1 * Math.random();
        const totalDelay = Math.floor(delay + jitter);

        logger.debug(`Retry attempt ${attempt}/${config.maxRetries} after ${totalDelay}ms`, {
          error: lastError.code,
          message: lastError.message
        });

        if (config.onRetry) {
          config.onRetry(lastError, attempt, totalDelay);
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, totalDelay));
      }
    }

    // All retries exhausted
    await this.handleError(lastError, { retriesExhausted: true, attempts: attempt });
    throw lastError;
  }

  /**
   * Execute with timeout and error handling
   */
  async withTimeout(fn, timeoutMs, timeoutErrorType = 'message-timeout') {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const error = this.createError(timeoutErrorType, timeoutMs);
        reject(error);
      }, timeoutMs);

      try {
        const result = await fn();
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        const qwenError = error instanceof QwenError ? error : this._wrapError(error);
        const handled = await this.handleError(qwenError);
        
        if (handled.recovered) {
          resolve(handled.result);
        } else {
          reject(handled.error);
        }
      }
    });
  }

  /**
   * Add error recovery strategy
   */
  addRecoveryStrategy(errorCode, strategy) {
    this.recoveryStrategies.set(errorCode, strategy);
  }

  /**
   * Add error event listener
   */
  addListener(listener) {
    this.listeners.add(listener);
  }

  /**
   * Remove error event listener
   */
  removeListener(listener) {
    this.listeners.delete(listener);
  }

  /**
   * Get error statistics
   */
  getStats() {
    const totalErrors = Array.from(this.errorCounts.values()).reduce((sum, count) => sum + count, 0);
    const recentErrors = this.errorHistory.slice(-10);
    
    return {
      totalErrors,
      errorsByCode: Object.fromEntries(this.errorCounts),
      recentErrors: recentErrors.map(entry => ({
        code: entry.error.code,
        message: entry.error.message,
        timestamp: entry.error.timestamp,
        context: entry.context
      })),
      topErrors: Array.from(this.errorCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([code, count]) => ({ code, count }))
    };
  }

  /**
   * Clear error history and counts
   */
  clearHistory() {
    this.errorCounts.clear();
    this.errorHistory = [];
    logger.info('Error history cleared');
  }

  // Private methods

  _wrapError(error, context = {}) {
    if (error instanceof QwenError) return error;
    
    // Handle null/undefined errors
    if (!error) {
      return new QwenError('Unknown error occurred', 'UNKNOWN_ERROR', context);
    }
    
    // Try to detect error type from message
    const message = error && error.message ? error.message : String(error);
    
    if (/timeout|timed out/i.test(message)) {
      return this.createError('message-timeout', 5000, context);
    }
    if (/rate limit|429/i.test(message)) {
      return this.createError('rate-limit-exceeded', 'unknown', 60000, context);
    }
    if (/quota|storage/i.test(message)) {
      return this.createError('quota-exceeded', 'unknown', context);
    }
    if (/context invalidated/i.test(message)) {
      return this.createError('context-invalidated', context);
    }
    
    // Generic QwenError wrapper
    return new QwenError(message, 'UNKNOWN_ERROR', { ...context, originalError: error });
  }

  _logError(error, context) {
    const logData = {
      code: error.code,
      message: error.message,
      category: error.category,
      severity: error.severity,
      retryable: error.retryable,
      recoverable: error.recoverable,
      context
    };

    switch (error.severity) {
      case 'low':
        logger.debug('Error occurred', logData);
        break;
      case 'medium':
        logger.warn('Error occurred', logData);
        break;
      case 'high':
        logger.error('Error occurred', logData);
        break;
      default:
        logger.error('Error occurred', logData);
    }
  }

  _trackError(error) {
    const count = this.errorCounts.get(error.code) || 0;
    this.errorCounts.set(error.code, count + 1);
  }

  _addToHistory(error, context) {
    this.errorHistory.push({
      error: error.toJSON(),
      context,
      timestamp: Date.now()
    });

    // Keep history size manageable
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
    }
  }

  _notifyListeners(error, context) {
    this.listeners.forEach(listener => {
      try {
        listener(error, context);
      } catch (e) {
        logger.error('Error listener failed', { error: e.message });
      }
    });
  }

  async _attemptRecovery(error, context) {
    const strategy = this.recoveryStrategies.get(error.code) || 
                    this.recoveryStrategies.get(error.category) ||
                    this.recoveryStrategies.get('default');

    if (strategy) {
      return await strategy(error, context);
    }

    return null;
  }

  _resetErrorCount(errorCode) {
    this.errorCounts.delete(errorCode);
  }

  _setupDefaultRecoveryStrategies() {
    // Cache cleanup recovery
    this.addRecoveryStrategy('CACHE_FULL', async (error, context) => {
      try {
        if (typeof window !== 'undefined' && window.qwenClearCache) {
          window.qwenClearCache();
          logger.info('Cache cleared as recovery strategy');
          return true;
        }
      } catch (e) {
        logger.error('Cache cleanup recovery failed', { error: e.message });
      }
      return null;
    });

    // Quota exceeded recovery
    this.addRecoveryStrategy('QUOTA_EXCEEDED', async (error, context) => {
      try {
        // Try to clear old data
        if (typeof chrome !== 'undefined' && chrome.storage) {
          // Clear old usage logs
          chrome.storage.local.remove(['usageLog', 'usageHistory'], () => {
            logger.info('Storage cleanup completed as recovery strategy');
          });
          return true;
        }
      } catch (e) {
        logger.error('Storage cleanup recovery failed', { error: e.message });
      }
      return null;
    });

    // Provider fallback recovery  
    this.addRecoveryStrategy('PROVIDER_ERROR', async (error, context) => {
      if (context.providerOrder && context.providerOrder.length > 1) {
        const failedProvider = error.provider;
        const remainingProviders = context.providerOrder.filter(p => p !== failedProvider);
        
        if (remainingProviders.length > 0) {
          logger.info('Attempting provider fallback', { 
            failed: failedProvider, 
            fallback: remainingProviders[0] 
          });
          return { fallbackProvider: remainingProviders[0] };
        }
      }
      return null;
    });
  }

  _setupGlobalErrorHandlers() {
    // Handle unhandled promise rejections
    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', (event) => {
        const error = event.reason;
        this.handleError(error, { type: 'unhandledRejection' });
      });

      // Handle general errors
      window.addEventListener('error', (event) => {
        this.handleError(new Error(event.message), { 
          type: 'globalError',
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno
        });
      });
    }
  }
}

// ==============================================================================
// EXPORTS AND GLOBAL SETUP
// ==============================================================================

// Create singleton instance
const errorManager = new ErrorManager();

// Export classes and instance
const errorManagerExports = {
  // Error Classes
  QwenError,
  TranslationError,
  TranslationTimeoutError,
  ProviderError,
  BatchSizeExceededError,
  StorageError,
  ValidationError,
  QuotaExceededError,
  RateLimitError,
  InvalidProviderError,
  ConfigurationError,
  CacheError,
  CacheFullError,
  SerializationError,
  MessagingError,
  MessageTimeoutError,
  ContextInvalidatedError,
  TabNotFoundError,
  PdfError,
  PdfLoadError,
  ViewerError,

  // Manager instance and helpers
  ErrorManager,
  errorManager,
  
  // Utility functions
  createError: (type, ...args) => errorManager.createError(type, ...args),
  handleError: (error, context) => errorManager.handleError(error, context),
  withRetry: (fn, options) => errorManager.withRetry(fn, options),
  withTimeout: (fn, timeout, errorType) => errorManager.withTimeout(fn, timeout, errorType),
  getErrorStats: () => errorManager.getStats(),
  clearErrorHistory: () => errorManager.clearHistory(),
  addErrorListener: (listener) => errorManager.addListener(listener),
  removeErrorListener: (listener) => errorManager.removeListener(listener),
  addRecoveryStrategy: (code, strategy) => errorManager.addRecoveryStrategy(code, strategy),

  // Chrome extension specific helpers
  isExtensionError: (error) => {
    return error instanceof ContextInvalidatedError || 
           (error.message && error.message.includes('Extension context invalidated'));
  },

  isOfflineError: (error) => {
    const message = error.message || String(error);
    return /network|offline|fetch|connection/i.test(message);
  },

  shouldRetry: (error) => {
    return error instanceof QwenError ? error.retryable : false;
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.qwenErrorManager = errorManager;
  window.qwenErrors = errorManagerExports;
}

if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.qwenErrorManager = errorManager;
  self.qwenErrors = errorManagerExports;
}

if (typeof module !== 'undefined') {
  module.exports = errorManagerExports;
}

logger.info('Error management system initialized');