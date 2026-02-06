/**
 * Standardized Error Handling System
 * Provides consistent error handling, classification, and reporting across all modules
 */

import { secureLogger } from './secureLogging.js';
import { generateSecureId } from './securityUtils.js';

/**
 * Standard error codes and categories
 */
export const ERROR_CODES = {
  // Configuration errors (1000-1099)
  CONFIG_MISSING: { code: 1001, severity: 'error', category: 'configuration' },
  CONFIG_INVALID: { code: 1002, severity: 'error', category: 'configuration' },
  CONFIG_LOAD_FAILED: { code: 1003, severity: 'error', category: 'configuration' },

  // Network errors (1100-1199)
  NETWORK_TIMEOUT: { code: 1101, severity: 'error', category: 'network' },
  NETWORK_CONNECTION: { code: 1102, severity: 'error', category: 'network' },
  NETWORK_RATE_LIMITED: { code: 1103, severity: 'warn', category: 'network' },
  NETWORK_AUTH_FAILED: { code: 1104, severity: 'error', category: 'network' },

  // Translation errors (1200-1299)
  TRANSLATION_FAILED: { code: 1201, severity: 'error', category: 'translation' },
  TRANSLATION_INVALID_INPUT: { code: 1202, severity: 'warn', category: 'translation' },
  TRANSLATION_UNSUPPORTED_LANGUAGE: { code: 1203, severity: 'warn', category: 'translation' },
  TRANSLATION_QUOTA_EXCEEDED: { code: 1204, severity: 'error', category: 'translation' },

  // Storage errors (1300-1399)
  STORAGE_READ_FAILED: { code: 1301, severity: 'error', category: 'storage' },
  STORAGE_WRITE_FAILED: { code: 1302, severity: 'error', category: 'storage' },
  STORAGE_QUOTA_EXCEEDED: { code: 1303, severity: 'warn', category: 'storage' },

  // UI errors (1400-1499)
  UI_ELEMENT_NOT_FOUND: { code: 1401, severity: 'warn', category: 'ui' },
  UI_RENDER_FAILED: { code: 1402, severity: 'error', category: 'ui' },
  UI_EVENT_HANDLER_FAILED: { code: 1403, severity: 'warn', category: 'ui' },

  // Content Script errors (1500-1599)
  CONTENT_INJECTION_FAILED: { code: 1501, severity: 'error', category: 'content' },
  CONTENT_DOM_ACCESS_DENIED: { code: 1502, severity: 'warn', category: 'content' },
  CONTENT_OBSERVER_FAILED: { code: 1503, severity: 'warn', category: 'content' },

  // Security errors (1600-1699)
  SECURITY_CSP_VIOLATION: { code: 1601, severity: 'error', category: 'security' },
  SECURITY_XSS_ATTEMPT: { code: 1602, severity: 'error', category: 'security' },
  SECURITY_INVALID_ORIGIN: { code: 1603, severity: 'error', category: 'security' },

  // Performance errors (1700-1799)
  PERFORMANCE_MEMORY_LIMIT: { code: 1701, severity: 'warn', category: 'performance' },
  PERFORMANCE_TIMEOUT: { code: 1702, severity: 'warn', category: 'performance' },

  // Generic errors (1900-1999)
  UNKNOWN_ERROR: { code: 1999, severity: 'error', category: 'unknown' }
};

/**
 * Standardized Extension Error class
 */
export class ExtensionError extends Error {
  constructor(errorCode, message, originalError = null, context = {}) {
    const errorInfo = ERROR_CODES[errorCode] || ERROR_CODES.UNKNOWN_ERROR;

    super(message);

    this.name = 'ExtensionError';
    this.errorCode = errorCode;
    this.code = errorInfo.code;
    this.severity = errorInfo.severity;
    this.category = errorInfo.category;
    this.originalError = originalError;
    this.context = context;
    this.timestamp = Date.now();
    this.errorId = generateSecureId(8);

    // Preserve original stack trace
    if (originalError && originalError.stack) {
      this.stack = originalError.stack;
    }
  }

  /**
   * Convert error to safe JSON representation
   */
  toJSON() {
    return {
      name: this.name,
      errorCode: this.errorCode,
      code: this.code,
      severity: this.severity,
      category: this.category,
      message: this.message,
      timestamp: this.timestamp,
      errorId: this.errorId,
      context: this.context,
      originalError: this.originalError ? {
        name: this.originalError.name,
        message: this.originalError.message
      } : null
    };
  }

  /**
   * Check if error is recoverable
   */
  isRecoverable() {
    const recoverableCategories = ['network', 'storage'];
    const recoverableCodes = ['NETWORK_TIMEOUT', 'NETWORK_RATE_LIMITED', 'STORAGE_QUOTA_EXCEEDED'];

    return recoverableCategories.includes(this.category) ||
           recoverableCodes.includes(this.errorCode);
  }

  /**
   * Get user-friendly error message
   */
  getUserMessage() {
    const userMessages = {
      CONFIG_MISSING: 'Extension configuration is missing. Please check your settings.',
      CONFIG_INVALID: 'Extension configuration is invalid. Please verify your settings.',
      NETWORK_TIMEOUT: 'Request timed out. Please try again.',
      NETWORK_CONNECTION: 'Unable to connect to the translation service. Please check your internet connection.',
      NETWORK_RATE_LIMITED: 'Too many requests. Please wait a moment before trying again.',
      NETWORK_AUTH_FAILED: 'Authentication failed. Please check your API key.',
      TRANSLATION_FAILED: 'Translation failed. Please try again.',
      TRANSLATION_UNSUPPORTED_LANGUAGE: 'This language combination is not supported.',
      TRANSLATION_QUOTA_EXCEEDED: 'Translation quota exceeded. Please try again later.',
      STORAGE_QUOTA_EXCEEDED: 'Storage quota exceeded. Please clear some data.',
      UI_RENDER_FAILED: 'Interface failed to load. Please refresh the page.',
      CONTENT_INJECTION_FAILED: 'Unable to access page content. Please refresh the page.',
      SECURITY_CSP_VIOLATION: 'Security policy violation detected.',
      PERFORMANCE_MEMORY_LIMIT: 'Memory limit reached. Consider reducing the amount of text.',
      UNKNOWN_ERROR: 'An unexpected error occurred. Please try again.'
    };

    return userMessages[this.errorCode] || 'An error occurred. Please try again.';
  }
}

/**
 * Error Handler class for centralized error management
 */
export class StandardErrorHandler {
  constructor(options = {}) {
    this.component = options.component || 'Unknown';
    this.enableUserNotifications = options.enableUserNotifications !== false;
    this.enableTelemetry = options.enableTelemetry !== false;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelays = options.retryDelays || [1000, 2000, 4000]; // Exponential backoff

    // Error statistics
    this.stats = {
      totalErrors: 0,
      errorsByCategory: {},
      errorsByCode: {},
      recentErrors: []
    };
  }

  /**
   * Handle an error with full processing pipeline
   */
  async handleError(error, context = {}) {
    let extensionError;

    // Convert to ExtensionError if needed
    if (error instanceof ExtensionError) {
      extensionError = error;
    } else {
      // Try to classify the error
      const errorCode = this.classifyError(error);
      extensionError = new ExtensionError(errorCode, error.message, error, context);
    }

    // Log the error securely
    this.logError(extensionError);

    // Update statistics
    this.updateStats(extensionError);

    // Send telemetry if enabled
    if (this.enableTelemetry) {
      await this.sendTelemetry(extensionError);
    }

    // Show user notification if appropriate
    if (this.enableUserNotifications && this.shouldNotifyUser(extensionError)) {
      this.notifyUser(extensionError);
    }

    return extensionError;
  }

  /**
   * Classify unknown errors into standard error codes
   */
  classifyError(error) {
    const message = error.message?.toLowerCase() || '';
    const name = error.name?.toLowerCase() || '';

    // Network errors
    if (message.includes('timeout') || name.includes('timeout')) {
      return 'NETWORK_TIMEOUT';
    }
    if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
      return 'NETWORK_CONNECTION';
    }
    if (message.includes('429') || message.includes('rate limit')) {
      return 'NETWORK_RATE_LIMITED';
    }
    if (message.includes('401') || message.includes('403') || message.includes('unauthorized')) {
      return 'NETWORK_AUTH_FAILED';
    }

    // Storage errors
    if (message.includes('quota') && message.includes('exceeded')) {
      return 'STORAGE_QUOTA_EXCEEDED';
    }
    if (message.includes('storage') || message.includes('indexeddb')) {
      return 'STORAGE_READ_FAILED';
    }

    // DOM/UI errors
    if (message.includes('element') && message.includes('not found')) {
      return 'UI_ELEMENT_NOT_FOUND';
    }
    if (message.includes('dom') || message.includes('render')) {
      return 'UI_RENDER_FAILED';
    }

    // Content script errors
    if (message.includes('content script') || message.includes('injection')) {
      return 'CONTENT_INJECTION_FAILED';
    }

    // Security errors
    if (message.includes('csp') || message.includes('content security')) {
      return 'SECURITY_CSP_VIOLATION';
    }

    // Translation errors
    if (message.includes('translation') || message.includes('translate')) {
      return 'TRANSLATION_FAILED';
    }

    return 'UNKNOWN_ERROR';
  }

  /**
   * Log error securely
   */
  logError(error) {
    const logLevel = error.severity === 'error' ? 'error' : 'warn';

    secureLogger[logLevel](
      this.component,
      `${error.errorCode}: ${error.message}`,
      {
        errorId: error.errorId,
        code: error.code,
        category: error.category,
        context: error.context,
        originalError: error.originalError?.name
      }
    );
  }

  /**
   * Update error statistics
   */
  updateStats(error) {
    this.stats.totalErrors++;

    // Track by category
    this.stats.errorsByCategory[error.category] =
      (this.stats.errorsByCategory[error.category] || 0) + 1;

    // Track by code
    this.stats.errorsByCode[error.errorCode] =
      (this.stats.errorsByCode[error.errorCode] || 0) + 1;

    // Keep recent errors (last 50)
    this.stats.recentErrors.push({
      errorCode: error.errorCode,
      timestamp: error.timestamp,
      errorId: error.errorId
    });

    if (this.stats.recentErrors.length > 50) {
      this.stats.recentErrors.shift();
    }
  }

  /**
   * Send error telemetry
   */
  async sendTelemetry(error) {
    try {
      // Only send non-sensitive telemetry data
      const telemetryData = {
        errorCode: error.errorCode,
        code: error.code,
        category: error.category,
        severity: error.severity,
        component: this.component,
        timestamp: error.timestamp,
        userAgent: navigator.userAgent,
        url: window.location?.hostname || 'extension'
      };

      // Could send to analytics service here
      secureLogger.debug('ErrorHandler', 'Error telemetry collected', telemetryData);
    } catch (telemetryError) {
      secureLogger.warn('ErrorHandler', 'Failed to send error telemetry', telemetryError);
    }
  }

  /**
   * Check if user should be notified
   */
  shouldNotifyUser(error) {
    // Don't notify for low-severity errors
    if (error.severity === 'debug' || error.severity === 'info') {
      return false;
    }

    // Don't spam user with repeated errors
    const recentSimilarErrors = this.stats.recentErrors.filter(
      e => e.errorCode === error.errorCode &&
           (Date.now() - e.timestamp) < 30000 // Last 30 seconds
    );

    return recentSimilarErrors.length <= 1;
  }

  /**
   * Show user notification
   */
  notifyUser(error) {
    const message = error.getUserMessage();

    // Different notification methods based on context
    if (typeof chrome !== 'undefined' && chrome.notifications) {
      // Extension notification
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon-48.png',
        title: 'Translation Extension',
        message: message
      });
    } else if (typeof window !== 'undefined' && window.Notification) {
      // Browser notification
      if (Notification.permission === 'granted') {
        new Notification('Translation Extension', { body: message });
      }
    } else {
      // Fallback to console
      console.warn(`Extension Error: ${message}`);
    }
  }

  /**
   * Retry operation with exponential backoff
   */
  async retryOperation(operation, context = {}) {
    let lastError = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const result = await operation();

        // Success - reset any previous error tracking
        if (attempt > 0) {
          secureLogger.info(this.component, `Operation succeeded after ${attempt + 1} attempts`);
        }

        return result;
      } catch (error) {
        lastError = error;

        // Handle the error but don't show user notifications for retry attempts
        const extensionError = await this.handleError(error, {
          ...context,
          attempt: attempt + 1,
          isRetry: true
        });

        // If this is not recoverable or final attempt, throw
        if (!extensionError.isRecoverable() || attempt === this.maxRetries - 1) {
          throw extensionError;
        }

        // Wait before retry
        const delay = this.retryDelays[Math.min(attempt, this.retryDelays.length - 1)];
        secureLogger.debug(this.component, `Retrying operation in ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  /**
   * Get error statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Clear error statistics
   */
  clearStats() {
    this.stats = {
      totalErrors: 0,
      errorsByCategory: {},
      errorsByCode: {},
      recentErrors: []
    };
  }
}

/**
 * Create a standardized error handler for a component
 */
export function createErrorHandler(component, options = {}) {
  return new StandardErrorHandler({ ...options, component });
}

/**
 * Convenience function to create and throw a standardized error
 */
export function throwStandardError(errorCode, message, originalError = null, context = {}) {
  throw new ExtensionError(errorCode, message, originalError, context);
}

/**
 * Wrap async functions with error handling
 */
export function withErrorHandling(asyncFn, errorHandler, context = {}) {
  return async (...args) => {
    try {
      return await asyncFn(...args);
    } catch (error) {
      throw await errorHandler.handleError(error, context);
    }
  };
}

/**
 * Wrap async functions with retry logic
 */
export function withRetry(asyncFn, errorHandler, context = {}) {
  return async (...args) => {
    return errorHandler.retryOperation(() => asyncFn(...args), context);
  };
}

// Create default singleton instance for global use
export const standardErrorHandler = new StandardErrorHandler({
  component: 'Extension',
  enableUserNotifications: true,
  enableTelemetry: false // Disable telemetry by default for privacy
});