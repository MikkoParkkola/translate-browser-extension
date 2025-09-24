/**
 * Enhanced error handling for browser extension
 * Provides structured error management with fallback values
 */

class ExtensionError extends Error {
  constructor(message, type = 'unknown', severity = 'medium', context = {}) {
    super(message);
    this.name = 'ExtensionError';
    this.type = type;
    this.severity = severity;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }
}

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

const SEVERITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

const DEFAULT_FALLBACKS = {
  translation: { text: '', confidence: 0, error: 'Translation failed' },
  config: {},
  cache: null,
  ui: 'Error occurred',
  network: { success: false, data: null }
};

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

function categorizeError(error) {
  if (!error) return ERROR_TYPES.UNKNOWN;
  if (isNetworkError(error)) return ERROR_TYPES.NETWORK;
  
  const message = error.message || '';
  if (message.includes('translat')) return ERROR_TYPES.TRANSLATION;
  if (message.includes('validat')) return ERROR_TYPES.VALIDATION;
  if (message.includes('cache')) return ERROR_TYPES.CACHE;
  if (message.includes('config')) return ERROR_TYPES.CONFIGURATION;
  
  return ERROR_TYPES.UNKNOWN;
}

function determineSeverity(error, context) {
  if (!error) return SEVERITY.LOW;
  
  // Network errors during active translation are medium
  if (isNetworkError(error) && context?.operation === 'translate') {
    return SEVERITY.MEDIUM;
  }
  
  // Configuration errors can be critical
  if (error.type === ERROR_TYPES.CONFIGURATION && context?.critical) {
    return SEVERITY.CRITICAL;
  }
  
  return SEVERITY.MEDIUM;
}

function enrichError(error, context = {}) {
  if (!error) return new ExtensionError('Unknown error occurred');
  
  const type = categorizeError(error);
  const severity = determineSeverity(error, context);
  
  if (error instanceof ExtensionError) {
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

function getFallback(context, customFallback) {
  if (customFallback !== undefined) return customFallback;
  
  const contextType = context?.operation || context?.type || 'unknown';
  return DEFAULT_FALLBACKS[contextType] || null;
}

function handle(error, context = {}, customFallback, logger = console) {
  try {
    const enriched = enrichError(error, context);
    
    // Log with appropriate severity
    switch (enriched.severity) {
      case SEVERITY.CRITICAL:
        logger.error('CRITICAL:', enriched.message, enriched.context);
        break;
      case SEVERITY.HIGH:
        logger.error('ERROR:', enriched.message, enriched.context);
        break;
      case SEVERITY.MEDIUM:
        logger.warn('WARNING:', enriched.message, enriched.context);
        break;
      case SEVERITY.LOW:
      default:
        logger.debug && logger.debug('DEBUG:', enriched.message, enriched.context);
        break;
    }
    
    return getFallback(context, customFallback);
  } catch (handlerError) {
    logger.error('Error handler failed:', handlerError);
    return customFallback || null;
  }
}

async function handleAsync(promise, context = {}, customFallback, logger) {
  try {
    return await promise;
  } catch (error) {
    return handle(error, context, customFallback, logger);
  }
}

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

// Export for browser extension
if (typeof window !== 'undefined') {
  window.ErrorHandler = {
    ERROR_TYPES,
    SEVERITY,
    ExtensionError,
    handle,
    handleAsync,
    safe,
    enrichError,
    isNetworkError,
    categorizeError
  };
} else if (typeof self !== 'undefined') {
  // Service worker context
  self.ErrorHandler = {
    ERROR_TYPES,
    SEVERITY,
    ExtensionError,
    handle,
    handleAsync,
    safe,
    enrichError,
    isNetworkError,
    categorizeError
  };
}
