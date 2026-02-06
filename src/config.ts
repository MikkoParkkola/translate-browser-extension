/**
 * Centralized configuration constants for the extension.
 * All hardcoded values extracted here for maintainability.
 */

export const CONFIG = {
  /**
   * Translation cache settings (LRU cache in service worker)
   */
  cache: {
    /** Maximum number of cached translations */
    maxSize: 100,
  },

  /**
   * Timeout settings for various operations.
   * Split by model size to avoid UI blocking for smaller models.
   */
  timeouts: {
    /** OPUS-MT direct model loading timeout (60s for ~170MB models) */
    opusMtDirectMs: 60 * 1000,
    /** OPUS-MT pivot model loading timeout (120s for 2 × ~170MB models) */
    opusMtPivotMs: 2 * 60 * 1000,
    /** TranslateGemma model loading timeout (5 minutes for ~3.6GB model) */
    translateGemmaMs: 5 * 60 * 1000,
    /** Legacy: default model loading timeout (kept for backward compatibility) */
    modelLoadMs: 2 * 60 * 1000,
    /** Offscreen document communication timeout */
    offscreenMs: 2 * 60 * 1000,
  },

  /**
   * Rate limiting configuration
   */
  rateLimits: {
    /** Maximum requests per window */
    requestsPerMinute: 60,
    /** Maximum tokens per window */
    tokensPerMinute: 100000,
    /** Rate limit window duration */
    windowMs: 60000,
  },

  /**
   * Batching configuration for page translation
   */
  batching: {
    /** Maximum texts per batch */
    maxSize: 50,
    /** Maximum text length for translation */
    maxTextLength: 5000,
    /** Minimum text length for translation */
    minTextLength: 2,
  },

  /**
   * Retry configuration for network operations
   */
  retry: {
    /** Network retry settings */
    network: {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 10000,
    },
    /** Offscreen document retry settings */
    offscreen: {
      maxRetries: 2,
      baseDelayMs: 500,
      maxDelayMs: 3000,
    },
    /** Maximum offscreen document creation failures before hard error */
    maxOffscreenFailures: 3,
  },

  /**
   * Mutation observer throttling for dynamic content
   */
  mutations: {
    /** Debounce delay for processing mutations */
    debounceMs: 500,
    /** Maximum pending mutations to buffer */
    maxPending: 100,
  },

  /**
   * Throttle defaults (used by Throttle class)
   */
  throttle: {
    requestLimit: 60,
    tokenLimit: 100000,
    windowMs: 60000,
  },
} as const;

/**
 * Type for accessing nested config values
 */
export type Config = typeof CONFIG;
