/**
 * Core Interface Definitions for Qwen Translator Extension
 * 
 * This file defines clear interfaces between modules to improve separation
 * of concerns and maintainability. Each interface defines the contract
 * between modules without implementation details.
 */

/**
 * Translation Request Interface
 * @typedef {Object} TranslationRequest
 * @property {string} text - Text to translate
 * @property {string} [source] - Source language code (defaults to 'auto')
 * @property {string} target - Target language code
 * @property {string} [endpoint] - API endpoint URL
 * @property {string} [apiKey] - API authentication key
 * @property {string} [model] - Translation model to use
 * @property {string} [provider] - Specific provider to use
 * @property {boolean} [debug] - Enable debug logging
 * @property {boolean} [stream] - Enable streaming responses
 * @property {AbortSignal} [signal] - Abort signal for cancellation
 */

/**
 * Translation Result Interface
 * @typedef {Object} TranslationResult
 * @property {string} text - Translated text
 * @property {string} [source] - Detected/used source language
 * @property {string} [target] - Target language
 * @property {number} [confidence] - Translation confidence (0-1)
 * @property {Object} [metadata] - Provider-specific metadata
 */

/**
 * Cache Interface - Abstract caching layer
 * @interface CacheInterface
 */
const CacheInterface = {
  /**
   * Get cached value
   * @param {string} key - Cache key
   * @returns {Promise<any>} Cached value or undefined
   */
  get: async (key) => {},

  /**
   * Set cached value with optional TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {Object} [options] - Cache options
   * @param {number} [options.ttl] - Time to live in milliseconds
   * @returns {Promise<void>}
   */
  set: async (key, value, options = {}) => {},

  /**
   * Check if key exists in cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>}
   */
  has: async (key) => {},

  /**
   * Delete cached value
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} True if deleted
   */
  delete: async (key) => {},

  /**
   * Clear all cached values
   * @returns {Promise<void>}
   */
  clear: async () => {},

  /**
   * Get cache statistics
   * @returns {Object} Stats object with size, hits, misses, etc.
   */
  getStats: () => ({})
};

/**
 * Provider Interface - Translation provider contract
 * @interface ProviderInterface
 */
const ProviderInterface = {
  /**
   * Provider metadata
   * @property {string} id - Unique provider identifier
   * @property {string} label - Human-readable name
   * @property {string} [description] - Provider description
   * @property {Object} [throttle] - Rate limiting configuration
   */
  metadata: {
    id: '',
    label: '',
    description: '',
    throttle: {}
  },

  /**
   * Translate text using this provider
   * @param {TranslationRequest} request - Translation request
   * @returns {Promise<TranslationResult>} Translation result
   */
  translate: async (request) => {},

  /**
   * Check if provider supports given language pair
   * @param {string} source - Source language
   * @param {string} target - Target language
   * @returns {boolean} True if supported
   */
  supportsLanguages: (source, target) => false,

  /**
   * Get supported languages
   * @returns {Object} Object with source and target language arrays
   */
  getSupportedLanguages: () => ({ source: [], target: [] })
};

/**
 * Language Detector Interface
 * @interface DetectorInterface
 */
const DetectorInterface = {
  /**
   * Detect language of text
   * @param {string} text - Text to analyze
   * @param {Object} [options] - Detection options
   * @param {number} [options.minLength] - Minimum text length
   * @param {number} [options.sensitivity] - Detection sensitivity (0-1)
   * @returns {Promise<Object>} Detection result with lang and confidence
   */
  detect: async (text, options = {}) => ({ lang: '', confidence: 0 }),

  /**
   * Get supported languages for detection
   * @returns {Array<string>} Array of supported language codes
   */
  getSupportedLanguages: () => []
};

/**
 * HTTP Client Interface
 * @interface HttpClientInterface
 */
const HttpClientInterface = {
  /**
   * Make HTTP request with automatic retries and error handling
   * @param {string} url - Request URL
   * @param {Object} options - Request options
   * @param {string} [options.method] - HTTP method
   * @param {Object} [options.headers] - Request headers
   * @param {any} [options.body] - Request body
   * @param {AbortSignal} [options.signal] - Abort signal
   * @param {number} [options.retries] - Max retry attempts
   * @returns {Promise<Response>} HTTP response
   */
  request: async (url, options) => {},

  /**
   * Make streaming request
   * @param {string} url - Request URL
   * @param {Object} options - Request options
   * @param {Function} onData - Callback for streaming data
   * @returns {Promise<Response>} HTTP response
   */
  requestStream: async (url, options, onData) => {}
};

/**
 * Batch Processor Interface
 * @interface BatchProcessorInterface
 */
const BatchProcessorInterface = {
  /**
   * Process multiple texts in batches with smart grouping
   * @param {Array<string>} texts - Texts to translate
   * @param {TranslationRequest} options - Translation options
   * @param {Object} [batchOptions] - Batch processing options
   * @param {number} [batchOptions.tokenBudget] - Max tokens per batch
   * @param {number} [batchOptions.maxBatchSize] - Max items per batch
   * @param {Function} [batchOptions.onProgress] - Progress callback
   * @returns {Promise<Object>} Batch result with texts and stats
   */
  processBatch: async (texts, options, batchOptions = {}) => ({ texts: [], stats: {} })
};

/**
 * Security Interface
 * @interface SecurityInterface
 */
const SecurityInterface = {
  /**
   * Sanitize input text to prevent XSS and other attacks
   * @param {string} text - Text to sanitize
   * @param {Object} [options] - Sanitization options
   * @returns {string} Sanitized text
   */
  sanitizeInput: (text, options = {}) => '',

  /**
   * Sanitize translation output
   * @param {string} text - Text to sanitize
   * @param {Object} [options] - Sanitization options
   * @returns {string} Sanitized text
   */
  sanitizeOutput: (text, options = {}) => '',

  /**
   * Validate input parameters
   * @param {any} input - Input to validate
   * @returns {Object} Validation result with valid flag and sanitized input
   */
  validateInput: (input) => ({ valid: true, sanitized: input }),

  /**
   * Log security events for monitoring
   * @param {string} event - Event type
   * @param {Object} details - Event details
   * @returns {void}
   */
  logSecurityEvent: (event, details) => {}
};

/**
 * Module Registry - Central registry for module instances
 */
class ModuleRegistry {
  constructor() {
    this.modules = new Map();
  }

  /**
   * Register a module implementation
   * @param {string} name - Module name
   * @param {any} implementation - Module implementation
   */
  register(name, implementation) {
    this.modules.set(name, implementation);
  }

  /**
   * Get module implementation
   * @param {string} name - Module name
   * @returns {any} Module implementation
   */
  get(name) {
    return this.modules.get(name);
  }

  /**
   * Check if module is registered
   * @param {string} name - Module name
   * @returns {boolean} True if registered
   */
  has(name) {
    return this.modules.has(name);
  }

  /**
   * List all registered modules
   * @returns {Array<string>} Module names
   */
  list() {
    return Array.from(this.modules.keys());
  }
}

// Export interfaces and registry
const moduleRegistry = new ModuleRegistry();

if (typeof module !== 'undefined') {
  module.exports = {
    CacheInterface,
    ProviderInterface,
    DetectorInterface,
    HttpClientInterface,
    BatchProcessorInterface,
    SecurityInterface,
    ModuleRegistry,
    moduleRegistry
  };
}

if (typeof window !== 'undefined') {
  window.qwenInterfaces = {
    CacheInterface,
    ProviderInterface,
    DetectorInterface,
    HttpClientInterface,
    BatchProcessorInterface,
    SecurityInterface,
    ModuleRegistry,
    moduleRegistry
  };
}