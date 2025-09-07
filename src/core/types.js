/**
 * @fileoverview Core type definitions for Qwen Translator Extension
 * Provides TypeScript-like interfaces using JSDoc comments with zero runtime overhead
 */

(function (root, factory) {
  // UMD pattern for cross-environment compatibility
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.qwenTypes = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Translation request configuration
   * @typedef {Object} TranslationRequest
   * @property {string} text - Text to translate
   * @property {string} sourceLanguage - Source language code (e.g., 'en', 'zh', 'auto')
   * @property {string} targetLanguage - Target language code (e.g., 'en', 'zh')
   * @property {string} [provider] - Translation provider ID (defaults to 'qwen')
   * @property {string} [model] - Model to use for translation
   * @property {number} [timeout] - Request timeout in milliseconds
   * @property {boolean} [stream] - Whether to use streaming translation
   * @property {Object.<string, any>} [metadata] - Additional request metadata
   */

  /**
   * Translation response result
   * @typedef {Object} TranslationResult
   * @property {string} translatedText - The translated text
   * @property {string} sourceLanguage - Detected or specified source language
   * @property {string} targetLanguage - Target language used
   * @property {string} provider - Provider that handled the translation
   * @property {string} model - Model used for translation
   * @property {number} tokensUsed - Number of tokens consumed
   * @property {number} duration - Translation duration in milliseconds
   * @property {number} confidence - Translation confidence score (0-1)
   * @property {boolean} cached - Whether result came from cache
   * @property {Object.<string, any>} [metadata] - Provider-specific metadata
   */

  /**
   * Translation provider configuration
   * @typedef {Object} ProviderConfig
   * @property {string} id - Unique provider identifier
   * @property {string} name - Human-readable provider name
   * @property {string} apiKey - Encrypted API key
   * @property {string} apiEndpoint - API endpoint URL
   * @property {string} model - Default model to use
   * @property {string[]} models - Available models for this provider
   * @property {number} requestLimit - Requests per minute limit
   * @property {number} tokenLimit - Tokens per minute limit
   * @property {number} charLimit - Characters per request limit
   * @property {number} weight - Provider weight for load balancing (0-1)
   * @property {string} strategy - Translation strategy ('fast', 'balanced', 'quality')
   * @property {number} costPerInputToken - Cost per input token
   * @property {number} costPerOutputToken - Cost per output token
   * @property {boolean} enabled - Whether provider is enabled
   * @property {ThrottleConfig} [throttle] - Provider-specific throttling config
   */

  /**
   * Cache entry structure
   * @typedef {Object} CacheEntry
   * @property {string} key - Cache key (source:target:text hash)
   * @property {string} translatedText - Cached translation result
   * @property {string} sourceLanguage - Source language of cached entry
   * @property {string} targetLanguage - Target language of cached entry
   * @property {string} provider - Provider that generated this translation
   * @property {number} timestamp - Entry creation timestamp
   * @property {number} ttl - Time to live in milliseconds
   * @property {number} accessCount - Number of times entry was accessed
   * @property {number} lastAccessed - Last access timestamp
   */

  /**
   * Throttling configuration
   * @typedef {Object} ThrottleConfig
   * @property {number} requestLimit - Maximum requests per window
   * @property {number} tokenLimit - Maximum tokens per window
   * @property {number} windowMs - Time window in milliseconds
   * @property {Object.<string, ThrottleConfig>} [contexts] - Context-specific configs
   */

  /**
   * Storage operation result
   * @typedef {Object} StorageResult
   * @property {boolean} success - Whether operation succeeded
   * @property {any} [data] - Retrieved data (for read operations)
   * @property {Error} [error] - Error that occurred (if any)
   * @property {number} duration - Operation duration in milliseconds
   */

  /**
   * Extension configuration schema
   * @typedef {Object} ExtensionConfig
   * @property {string} apiKey - Primary API key (legacy, use providers instead)
   * @property {string} detectApiKey - Language detection API key
   * @property {string} apiEndpoint - Primary API endpoint
   * @property {string} model - Primary model
   * @property {string} sourceLanguage - Default source language
   * @property {string} targetLanguage - Default target language
   * @property {boolean} autoTranslate - Auto-translate page content
   * @property {number} requestLimit - Global request limit
   * @property {number} tokenLimit - Global token limit
   * @property {number} tokenBudget - Token budget tracking
   * @property {number} calibratedAt - Last calibration timestamp
   * @property {number} memCacheMax - Maximum in-memory cache entries
   * @property {boolean} tmSync - Translation memory sync enabled
   * @property {number} sensitivity - Translation sensitivity threshold
   * @property {number} minDetectLength - Minimum text length for detection
   * @property {boolean} debug - Debug mode enabled
   * @property {boolean} qualityVerify - Quality verification enabled
   * @property {boolean} useWasmEngine - Use WASM engine for processing
   * @property {boolean} autoOpenAfterSave - Auto-open saved files
   * @property {boolean} selectionPopup - Show selection popup
   * @property {string} theme - UI theme ('dark', 'light', 'auto')
   * @property {string} themeStyle - Theme style variant
   * @property {number} charLimit - Global character limit
   * @property {string} strategy - Default translation strategy
   * @property {string} secondaryModel - Fallback model
   * @property {string[]} models - Available models
   * @property {Object.<string, ProviderConfig>} providers - Provider configurations
   * @property {string[]} providerOrder - Provider preference order
   * @property {boolean} failover - Enable provider failover
   * @property {boolean|string} parallel - Parallel translation mode
   * @property {number} translateTimeoutMs - Translation timeout
   */

  /**
   * Logger configuration
   * @typedef {Object} LoggerConfig
   * @property {string} level - Log level ('error', 'warn', 'info', 'debug')
   * @property {string} namespace - Logger namespace/context
   * @property {boolean} sanitize - Whether to sanitize sensitive data
   * @property {number} bufferSize - Log buffer size for batching
   * @property {number} flushInterval - Buffer flush interval in milliseconds
   */

  /**
   * API error types
   * @typedef {Object} ApiError
   * @property {string} code - Error code
   * @property {string} message - Error message
   * @property {string} [provider] - Provider that generated the error
   * @property {number} [status] - HTTP status code
   * @property {Object} [details] - Additional error details
   * @property {number} retryAfter - Retry after milliseconds (for rate limiting)
   */

  /**
   * Translation batch configuration
   * @typedef {Object} BatchConfig
   * @property {number} maxTokens - Maximum tokens per batch
   * @property {number} maxTexts - Maximum text entries per batch
   * @property {number} timeoutMs - Batch processing timeout
   * @property {string} delimiter - Text delimiter for batching
   * @property {boolean} preserveWhitespace - Preserve leading/trailing whitespace
   */

  /**
   * Usage statistics
   * @typedef {Object} UsageStats
   * @property {number} requests - Total requests made
   * @property {number} tokens - Total tokens consumed
   * @property {number} characters - Total characters translated
   * @property {number} cacheHits - Cache hit count
   * @property {number} cacheMisses - Cache miss count
   * @property {number} errors - Error count
   * @property {Object.<string, number>} providers - Usage by provider
   * @property {number} timestamp - Statistics snapshot timestamp
   */

  // Export all type definitions (no runtime code, just documentation)
  return {
    // This module provides only JSDoc type definitions
    // No runtime exports needed - types are used via JSDoc comments
    __types: 'Core type definitions for Qwen Translator Extension',
    version: '1.0.0'
  };

}));