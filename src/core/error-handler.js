/**
 * @fileoverview Centralized error handling utility for consistent error management
 * Provides standardized error handling patterns across the extension
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenErrorHandler = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Error types for categorization
   */
  const ERROR_TYPES = {
    NETWORK: 'network',
    TRANSLATION: 'translation', 
    SECURITY: 'security',
    VALIDATION: 'validation',
    CACHE: 'cache',
    UI: 'ui',
    CONFIGURATION: 'configuration',
    UNKNOWN: 'unknown'
  };

  /**
   * Error severity levels
   */
  const SEVERITY = {
    LOW: 'low',
    MEDIUM: 'medium', 
    HIGH: 'high',
    CRITICAL: 'critical'
  };

  /**
   * Default fallback values for different contexts
   */
  const DEFAULT_FALLBACKS = {
    translation: { text: '', confidence: 0, error: 'Translation failed' },
    config: {},
    cache: null,
    ui: 'Error occurred',
    network: { success: false, data: null }
  };

  /**
   * Enhanced error class with additional context
   */
  class ExtensionError extends Error {
    constructor(message, type = ERROR_TYPES.UNKNOWN, severity = SEVERITY.MEDIUM, context = {}) {
      super(message);
      this.name = 'ExtensionError';
      this.type = type;
      this.severity = severity;
      this.context = context;
      this.timestamp = new Date().toISOString();
      
      // Capture stack trace if available
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, ExtensionError);
      }
    }
  }

  /**
   * Check if error is network/offline related
   */
  function isNetworkError(error) {
    if (!error) return false;
    
    const message = error.message || '';
    const networkIndicators = [
      'fetch', 'network', 'connection', 'timeout', 'cors', 
      'failed to fetch', 'net::', 'offline', 'DNS_PROBE_FINISHED'
    ];
    
    return networkIndicators.some(indicator => 
      message.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  /**
   * Check if error is security related
   */
  function isSecurityError(error) {
    if (!error) return false;
    
    const message = error.message || '';
    const securityIndicators = [
      'security', 'xss', 'csp', 'blocked', 'unsafe', 'sanitize'
    ];
    
    return securityIndicators.some(indicator => 
      message.toLowerCase().includes(indicator.toLowerCase())
    );
  }

  /**
   * Determine error type from error object
   */
  function categorizeError(error) {
    if (!error) return ERROR_TYPES.UNKNOWN;
    
    if (isNetworkError(error)) return ERROR_TYPES.NETWORK;
    if (isSecurityError(error)) return ERROR_TYPES.SECURITY;
    
    const message = error.message || '';
    if (message.includes('translat')) return ERROR_TYPES.TRANSLATION;
    if (message.includes('validat')) return ERROR_TYPES.VALIDATION;
    if (message.includes('cache')) return ERROR_TYPES.CACHE;
    if (message.includes('config')) return ERROR_TYPES.CONFIGURATION;
    
    return ERROR_TYPES.UNKNOWN;
  }

  /**
   * Determine error severity
   */
  function determineSeverity(error, context) {
    if (!error) return SEVERITY.LOW;
    
    // Security errors are always high severity
    if (isSecurityError(error)) return SEVERITY.HIGH;
    
    // Network errors during active translation are medium
    if (isNetworkError(error) && context?.operation === 'translate') {
      return SEVERITY.MEDIUM;
    }
    
    // Cache errors are typically low severity
    if (error.type === ERROR_TYPES.CACHE) return SEVERITY.LOW;
    
    // Configuration errors can be critical if they affect core functionality
    if (error.type === ERROR_TYPES.CONFIGURATION && context?.critical) {
      return SEVERITY.CRITICAL;
    }
    
    return SEVERITY.MEDIUM;
  }

  /**
   * Create an enriched error with additional context
   */
  function enrichError(error, context = {}) {
    if (!error) return new ExtensionError('Unknown error occurred');
    
    const type = categorizeError(error);
    const severity = determineSeverity(error, context);
    
    if (error instanceof ExtensionError) {
      // Already enriched, just update context
      return Object.assign(error, {
        context: { ...error.context, ...context }
      });
    }
    
    return new ExtensionError(
      error.message || 'Unexpected error',
      type,
      severity,
      {
        originalError: error.name || 'Error',
        stack: error.stack,
        ...context
      }
    );
  }

  /**
   * Log error with appropriate severity
   */
  function logError(error, logger) {
    const log = logger || console;
    const enriched = enrichError(error);
    
    const logData = {
      message: enriched.message,
      type: enriched.type,
      severity: enriched.severity,
      timestamp: enriched.timestamp,
      context: enriched.context
    };
    
    switch (enriched.severity) {
      case SEVERITY.CRITICAL:
        log.error('CRITICAL:', logData);
        break;
      case SEVERITY.HIGH:
        log.error('ERROR:', logData);
        break;
      case SEVERITY.MEDIUM:
        log.warn('WARNING:', logData);
        break;
      case SEVERITY.LOW:
      default:
        log.debug('DEBUG:', logData);
        break;
    }
  }

  /**
   * Get appropriate fallback value for error context
   */
  function getFallback(context, customFallback) {
    if (customFallback !== undefined) return customFallback;
    
    const contextType = context?.operation || context?.type || 'unknown';
    return DEFAULT_FALLBACKS[contextType] || null;
  }

  /**
   * Main error handler - processes error and returns safe fallback
   */
  function handle(error, context = {}, customFallback, logger) {
    try {
      const enriched = enrichError(error, context);
      logError(enriched, logger);
      
      // Log security event if security module is available
      if (enriched.type === ERROR_TYPES.SECURITY && 
          typeof self !== 'undefined' && 
          self.qwenSecurity?.logSecurityEvent) {
        self.qwenSecurity.logSecurityEvent('Error handler security event', {
          message: enriched.message,
          context: enriched.context
        });
      }
      
      return getFallback(context, customFallback);
    } catch (handlerError) {
      // If error handler itself fails, use console and basic fallback
      console.error('Error handler failed:', handlerError);
      return customFallback || null;
    }
  }

  /**
   * Async wrapper for error handling in promises
   */
  async function handleAsync(promise, context = {}, customFallback, logger) {
    try {
      return await promise;
    } catch (error) {
      return handle(error, context, customFallback, logger);
    }
  }

  /**
   * Create a safe function wrapper that handles errors
   */
  function safe(fn, context = {}, customFallback, logger) {
    return function(...args) {
      try {
        const result = fn.apply(this, args);
        
        // Handle async functions
        if (result && typeof result.catch === 'function') {
          return result.catch(error => 
            handle(error, context, customFallback, logger)
          );
        }
        
        return result;
      } catch (error) {
        return handle(error, context, customFallback, logger);
      }
    };
  }

  // Public API
  return {
    ERROR_TYPES,
    SEVERITY,
    ExtensionError,
    handle,
    handleAsync,
    safe,
    enrichError,
    logError,
    isNetworkError,
    isSecurityError,
    categorizeError
  };

}));